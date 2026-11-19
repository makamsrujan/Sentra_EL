/**
 * @file vl53l0x.c
 * @brief Single Forward VL53L0X Time-of-Flight Sensor Driver for SENTRA (ESP32-S3).
 *
 * Implements ST VL53L0X I2C register identification, single-shot measurement sequence,
 * range-status validation, mm-to-cm conversion, and disconnection handling for ONE
 * installed forward-facing VL53L0X sensor.
 */

#include "vl53l0x.h"
#include <string.h>

#define VL53L0X_REG_SYSRANGE_START           0x00
#define VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG   0x01
#define VL53L0X_REG_SYSTEM_INTERRUPT_CONFIG  0x0A
#define VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR   0x0B
#define VL53L0X_REG_RESULT_INTERRUPT_STATUS  0x13
#define VL53L0X_REG_RESULT_RANGE_STATUS      0x14
#define VL53L0X_REG_VHV_CONFIG_PAD_SCL_SDA   0x89
#define VL53L0X_REG_I2C_SLAVE_DEVICE_ADDRESS 0x8A
#define VL53L0X_REG_MSRC_CONFIG_CONTROL      0x60
#define VL53L0X_REG_FINAL_RANGE_MIN_RATE_HI  0x44
#define VL53L0X_REG_IDENTIFICATION_MODEL_ID  0xC0
#define VL53L0X_EXPECTED_MODEL_ID            0xEE
#define VL53L0X_DEFAULT_ADDR                 0x29

bool vl53l0x_is_range_valid(uint8_t range_status, uint16_t raw_mm) {
    /* ST VL53L0X reports >= 8190 (0x1FFE / 0x1FFF) when no target is detected / out of range.
     * Enforced protocol bounds: 20 mm (2 cm) .. 4000 mm (400 cm), physically reliable ~30..2000 mm. */
    if (raw_mm < 20 || raw_mm > 4000 || raw_mm >= 8190) {
        return false;
    }
    /* ST register 0x14 bits [6:3] yield 11 (Range Valid) on standard firmware or 0 on some wrappers. */
    uint8_t dev_status = (uint8_t)((range_status >> 3) & 0x0F);
    return (dev_status == 11 || dev_status == 0);
}

float vl53l0x_mm_to_cm(uint16_t distance_mm) {
    return ((float)distance_mm) / 10.0f;
}

#ifdef ESP_PLATFORM

#include "i2c_bus.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "VL53L0X";
static bool s_initialized = false;
static uint8_t s_stop_variable = 0;

static esp_err_t vl_write8(i2c_port_t bus, uint8_t addr, uint8_t reg, uint8_t val) {
    return sentra_i2c_write_reg8(bus, addr, reg, val);
}

static esp_err_t vl_read8(i2c_port_t bus, uint8_t addr, uint8_t reg, uint8_t *val) {
    return sentra_i2c_read_regs(bus, addr, reg, val, 1);
}

static esp_err_t vl_read16(i2c_port_t bus, uint8_t addr, uint8_t reg, uint16_t *val) {
    return sentra_i2c_read_reg16(bus, addr, reg, val);
}

static esp_err_t vl_write_seq_pair(i2c_port_t bus, uint8_t addr, const uint8_t *pairs, size_t count) {
    for (size_t i = 0; i < count; i += 2) {
        esp_err_t err = vl_write8(bus, addr, pairs[i], pairs[i + 1]);
        if (err != ESP_OK) return err;
    }
    return ESP_OK;
}

static esp_err_t vl53l0x_wait_data_ready(i2c_port_t bus, uint8_t addr, uint32_t timeout_ms) {
    int64_t start_ms = esp_timer_get_time() / 1000;
    while (1) {
        uint8_t irq = 0;
        esp_err_t err = vl_read8(bus, addr, VL53L0X_REG_RESULT_INTERRUPT_STATUS, &irq);
        if (err != ESP_OK) return err;
        if ((irq & 0x07) != 0) return ESP_OK;

        int64_t now_ms = esp_timer_get_time() / 1000;
        if ((now_ms - start_ms) >= (int64_t)timeout_ms) {
            return ESP_ERR_TIMEOUT;
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

esp_err_t vl53l0x_init_single(i2c_port_t i2c_num, int xshut_gpio, uint8_t address) {
    s_initialized = false;

    if (xshut_gpio >= 0) {
        gpio_config_t io_conf = {
            .pin_bit_mask = (1ULL << xshut_gpio),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        gpio_config(&io_conf);
        gpio_set_level((gpio_num_t)xshut_gpio, 0);
        vTaskDelay(pdMS_TO_TICKS(15));
        gpio_set_level((gpio_num_t)xshut_gpio, 1);
        vTaskDelay(pdMS_TO_TICKS(15));
    }

    /* Check sensor presence at default 0x29 first; if remapped address already set, probe target address too. */
    uint8_t active_addr = VL53L0X_DEFAULT_ADDR;
    uint8_t model_id = 0;
    esp_err_t err = vl_read8(i2c_num, VL53L0X_DEFAULT_ADDR, VL53L0X_REG_IDENTIFICATION_MODEL_ID, &model_id);
    if (err != ESP_OK && address != VL53L0X_DEFAULT_ADDR) {
        active_addr = address;
        err = vl_read8(i2c_num, active_addr, VL53L0X_REG_IDENTIFICATION_MODEL_ID, &model_id);
    }
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "VL53L0X probe failed on I2C bus %d (err=%s)", i2c_num, esp_err_to_name(err));
        return err;
    }
    if (model_id != VL53L0X_EXPECTED_MODEL_ID) {
        ESP_LOGE(TAG, "Unexpected VL53L0X model ID: 0x%02X (expected 0x%02X)", model_id, VL53L0X_EXPECTED_MODEL_ID);
        return ESP_ERR_INVALID_RESPONSE;
    }

    if (address != VL53L0X_DEFAULT_ADDR && active_addr == VL53L0X_DEFAULT_ADDR) {
        err = vl_write8(i2c_num, VL53L0X_DEFAULT_ADDR, VL53L0X_REG_I2C_SLAVE_DEVICE_ADDRESS, address & 0x7F);
        if (err != ESP_OK) return err;
        active_addr = address;
    }

    /* Standard ST VL53L0X 2.8V I2C mode + data-init sequence */
    uint8_t pad_cfg = 0;
    if (vl_read8(i2c_num, active_addr, VL53L0X_REG_VHV_CONFIG_PAD_SCL_SDA, &pad_cfg) == ESP_OK) {
        vl_write8(i2c_num, active_addr, VL53L0X_REG_VHV_CONFIG_PAD_SCL_SDA, pad_cfg | 0x01);
    }

    static const uint8_t data_init_seq[] = {
        0x88, 0x00,
        0x80, 0x01,
        0xFF, 0x01,
        0x00, 0x00,
    };
    err = vl_write_seq_pair(i2c_num, active_addr, data_init_seq, sizeof(data_init_seq));
    if (err != ESP_OK) return err;

    vl_read8(i2c_num, active_addr, 0x91, &s_stop_variable);

    static const uint8_t static_init_seq[] = {
        0x00, 0x01,
        0xFF, 0x00,
        0x80, 0x00,
        VL53L0X_REG_MSRC_CONFIG_CONTROL, 0x12,
        VL53L0X_REG_FINAL_RANGE_MIN_RATE_HI, 0x00,
        0x45, 0x20, /* 0.25 MCPS signal rate limit */
        VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG, 0xFF,
        VL53L0X_REG_SYSTEM_INTERRUPT_CONFIG, 0x04,
        0x84, 0x10,
        VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01,
    };
    err = vl_write_seq_pair(i2c_num, active_addr, static_init_seq, sizeof(static_init_seq));
    if (err != ESP_OK) return err;

    /* Run reference VHV + phase calibration */
    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG, 0x01);
    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSRANGE_START, 0x41);
    (void)vl53l0x_wait_data_ready(i2c_num, active_addr, 250);
    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01);

    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG, 0x02);
    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSRANGE_START, 0x01);
    (void)vl53l0x_wait_data_ready(i2c_num, active_addr, 250);
    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01);

    vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG, 0xE8);

    s_initialized = true;
    ESP_LOGI(TAG, "Single forward VL53L0X initialized at I2C addr 0x%02X (model 0x%02X).", active_addr, model_id);
    return ESP_OK;
}

int vl53l0x_init(i2c_port_t i2c_num, uint8_t address) {
    return vl53l0x_init_single(i2c_num, -1, address);
}

int vl53l0x_measure(i2c_port_t i2c_num, uint8_t address, uint16_t *out_mm) {
    if (!out_mm) return ESP_ERR_INVALID_ARG;
    vl53l0x_reading_t reading = {0};
    esp_err_t err = vl53l0x_read_validated(i2c_num, address, &reading);
    if (err != ESP_OK) return err;
    *out_mm = reading.raw_mm;
    return ESP_OK;
}

esp_err_t vl53l0x_read_validated(i2c_port_t i2c_num, uint8_t address, vl53l0x_reading_t *out_reading) {
    if (!out_reading) return ESP_ERR_INVALID_ARG;
    memset(out_reading, 0, sizeof(*out_reading));

    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    const uint8_t prep_seq[] = {
        0x80, 0x01,
        0xFF, 0x01,
        0x00, 0x00,
        0x91, s_stop_variable,
        0x00, 0x01,
        0xFF, 0x00,
        0x80, 0x00,
        VL53L0X_REG_SYSRANGE_START, 0x01,
    };
    esp_err_t err = vl_write_seq_pair(i2c_num, address, prep_seq, sizeof(prep_seq));
    if (err != ESP_OK) {
        s_initialized = false;
        return err;
    }

    err = vl53l0x_wait_data_ready(i2c_num, address, 120);
    if (err != ESP_OK) {
        return err;
    }

    uint8_t status = 0;
    uint16_t raw_mm = 0;
    err = vl_read8(i2c_num, address, VL53L0X_REG_RESULT_RANGE_STATUS, &status);
    if (err == ESP_OK) {
        err = vl_read16(i2c_num, address, (uint8_t)(VL53L0X_REG_RESULT_RANGE_STATUS + 10), &raw_mm);
    }
    (void)vl_write8(i2c_num, address, VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01);

    if (err != ESP_OK) {
        s_initialized = false;
        return err;
    }

    out_reading->range_status = status;
    out_reading->raw_mm = raw_mm;
    out_reading->out_of_range = (raw_mm >= 8190 || raw_mm > 4000);
    out_reading->valid = vl53l0x_is_range_valid(status, raw_mm);
    out_reading->distance_cm = out_reading->valid ? vl53l0x_mm_to_cm(raw_mm) : 0.0f;
    return ESP_OK;
}

void vl53l0x_deinit(i2c_port_t i2c_num, uint8_t address) {
    (void)i2c_num;
    (void)address;
    s_initialized = false;
}

#else

esp_err_t vl53l0x_init_single(i2c_port_t i2c_num, int xshut_gpio, uint8_t address) {
    (void)i2c_num; (void)xshut_gpio; (void)address;
    return ESP_ERR_NOT_SUPPORTED;
}
int vl53l0x_init(i2c_port_t i2c_num, uint8_t address) {
    (void)i2c_num; (void)address;
    return ESP_ERR_NOT_SUPPORTED;
}
int vl53l0x_measure(i2c_port_t i2c_num, uint8_t address, uint16_t *out_mm) {
    (void)i2c_num; (void)address; (void)out_mm;
    return ESP_ERR_NOT_SUPPORTED;
}
esp_err_t vl53l0x_read_validated(i2c_port_t i2c_num, uint8_t address, vl53l0x_reading_t *out_reading) {
    (void)i2c_num; (void)address; (void)out_reading;
    return ESP_ERR_NOT_SUPPORTED;
}
void vl53l0x_deinit(i2c_port_t i2c_num, uint8_t address) {
    (void)i2c_num; (void)address;
}

#endif
