/**
 * @file vl53l0x.c
 * @brief Single Forward VL53L0X Time-of-Flight Sensor Driver for SENTRA (ESP32-S3).
 *
 * Implements ST VL53L0X I2C register identification, documented initialization &
 * reference calibration, single-shot & continuous ranging, strict range-status
 * validation, mm-to-cm conversion, timeout handling, and disconnection recovery
 * for ONE forward-facing VL53L0X headband sensor.
 */

#include "vl53l0x.h"
#include <string.h>

#define VL53L0X_REG_SYSRANGE_START           0x00
#define VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG   0x01
#define VL53L0X_REG_SYSTEM_INTERMEAS_PERIOD  0x04
#define VL53L0X_REG_SYSTEM_INTERRUPT_CONFIG  0x0A
#define VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR   0x0B
#define VL53L0X_REG_RESULT_INTERRUPT_STATUS  0x13
#define VL53L0X_REG_RESULT_RANGE_STATUS      0x14
#define VL53L0X_REG_OSC_CALIBRATE_VAL        0xF8
#define VL53L0X_REG_VHV_CONFIG_PAD_SCL_SDA   0x89
#define VL53L0X_REG_I2C_SLAVE_DEVICE_ADDRESS 0x8A
#define VL53L0X_REG_MSRC_CONFIG_CONTROL      0x60
#define VL53L0X_REG_FINAL_RANGE_MIN_RATE_HI  0x44
#define VL53L0X_REG_IDENTIFICATION_MODEL_ID  0xC0
#define VL53L0X_EXPECTED_MODEL_ID            0xEE
#define VL53L0X_DEFAULT_ADDR                 0x29

#define VL53L0X_CONSEC_I2C_DISCONNECT_LIMIT  3

bool vl53l0x_is_range_valid(uint8_t range_status, uint16_t raw_mm) {
    /* ST VL53L0X reports >= 8190 (0x1FFE / 0x1FFF) when no target is detected / out of range.
     * Enforced protocol bounds: 20 mm (2 cm) .. 4000 mm (400 cm); usable physical range ~30..2000 mm. */
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

const char *vl53l0x_status_to_string(vl53l0x_status_t status) {
    switch (status) {
        case VL53L0X_STATUS_OK:            return "ok";
        case VL53L0X_STATUS_UNINITIALIZED: return "uninitialized";
        case VL53L0X_STATUS_INIT_FAILED:   return "init_failed";
        case VL53L0X_STATUS_I2C_ERROR:     return "i2c_error";
        case VL53L0X_STATUS_TIMEOUT:       return "timeout";
        case VL53L0X_STATUS_DISCONNECTED:  return "disconnected";
        case VL53L0X_STATUS_OUT_OF_RANGE:  return "out_of_range";
        case VL53L0X_STATUS_INVALID_RANGE: return "invalid_range";
        default:                           return "unknown";
    }
}

#if defined(ESP_PLATFORM) || defined(SENTRA_FIRMWARE_HOST_TEST)

#ifdef ESP_PLATFORM
#include "i2c_bus.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#else
#include "mock_idf.h"
#endif

static const char *TAG = "VL53L0X";
static bool s_initialized = false;
static bool s_continuous_mode = false;
static uint8_t s_stop_variable = 0;
static uint8_t s_active_address = VL53L0X_DEFAULT_ADDR;
static uint16_t s_osc_calibrate_val = 0;
static uint8_t s_consec_i2c_errors = 0;

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

static esp_err_t vl53l0x_perform_single_ref_cal(i2c_port_t bus, uint8_t addr, uint8_t seq_cfg, uint8_t start_val) {
    esp_err_t err = vl_write8(bus, addr, VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG, seq_cfg);
    if (err != ESP_OK) return err;
    err = vl_write8(bus, addr, VL53L0X_REG_SYSRANGE_START, start_val);
    if (err != ESP_OK) return err;
    err = vl53l0x_wait_data_ready(bus, addr, 250);
    if (err != ESP_OK) return err;
    err = vl_write8(bus, addr, VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01);
    if (err != ESP_OK) return err;
    return vl_write8(bus, addr, VL53L0X_REG_SYSRANGE_START, 0x00);
}

esp_err_t vl53l0x_ping(i2c_port_t i2c_num, uint8_t address) {
    uint8_t model_id = 0;
    esp_err_t err = vl_read8(i2c_num, address, VL53L0X_REG_IDENTIFICATION_MODEL_ID, &model_id);
    if (err != ESP_OK) return err;
    return (model_id == VL53L0X_EXPECTED_MODEL_ID) ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
}

bool vl53l0x_is_initialized(void) {
    return s_initialized;
}

esp_err_t vl53l0x_init_single(i2c_port_t i2c_num, int xshut_gpio, uint8_t address) {
    s_initialized = false;
    s_continuous_mode = false;
    s_consec_i2c_errors = 0;
    s_active_address = address;

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

    /* Probe default 0x29 first; if already remapped on warm reboot, also probe target address. */
    uint8_t active_addr = VL53L0X_DEFAULT_ADDR;
    uint8_t model_id = 0;
    esp_err_t err = vl_read8(i2c_num, VL53L0X_DEFAULT_ADDR, VL53L0X_REG_IDENTIFICATION_MODEL_ID, &model_id);
    if (err != ESP_OK && address != VL53L0X_DEFAULT_ADDR) {
        active_addr = address;
        err = vl_read8(i2c_num, active_addr, VL53L0X_REG_IDENTIFICATION_MODEL_ID, &model_id);
    }
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "VL53L0X probe failed on I2C bus %d (err=0x%x)", i2c_num, (unsigned)err);
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
    err = vl_read8(i2c_num, active_addr, VL53L0X_REG_VHV_CONFIG_PAD_SCL_SDA, &pad_cfg);
    if (err != ESP_OK) return err;
    err = vl_write8(i2c_num, active_addr, VL53L0X_REG_VHV_CONFIG_PAD_SCL_SDA, (uint8_t)(pad_cfg | 0x01));
    if (err != ESP_OK) return err;

    static const uint8_t data_init_seq[] = {
        0x88, 0x00,
        0x80, 0x01,
        0xFF, 0x01,
        0x00, 0x00,
    };
    err = vl_write_seq_pair(i2c_num, active_addr, data_init_seq, sizeof(data_init_seq));
    if (err != ESP_OK) return err;

    err = vl_read8(i2c_num, active_addr, 0x91, &s_stop_variable);
    if (err != ESP_OK) return err;

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

    /* Run reference VHV + phase calibration with strict error checks */
    err = vl53l0x_perform_single_ref_cal(i2c_num, active_addr, 0x01, 0x41);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "VL53L0X VHV calibration failed (err=0x%x)", (unsigned)err);
        return err;
    }
    err = vl53l0x_perform_single_ref_cal(i2c_num, active_addr, 0x02, 0x01);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "VL53L0X Phase calibration failed (err=0x%x)", (unsigned)err);
        return err;
    }

    err = vl_write8(i2c_num, active_addr, VL53L0X_REG_SYSTEM_SEQUENCE_CONFIG, 0xE8);
    if (err != ESP_OK) return err;

    (void)vl_read16(i2c_num, active_addr, VL53L0X_REG_OSC_CALIBRATE_VAL, &s_osc_calibrate_val);

    s_active_address = active_addr;
    s_initialized = true;
    ESP_LOGI(TAG, "Single forward VL53L0X initialized at I2C addr 0x%02X (model 0x%02X).", active_addr, model_id);
    return ESP_OK;
}

int vl53l0x_init(i2c_port_t i2c_num, uint8_t address) {
    return vl53l0x_init_single(i2c_num, -1, address);
}

esp_err_t vl53l0x_start_continuous(i2c_port_t i2c_num, uint8_t address, uint32_t period_ms) {
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    uint8_t addr = (address != 0) ? address : s_active_address;

    const uint8_t prep[] = {
        0x80, 0x01,
        0xFF, 0x01,
        0x00, 0x00,
        0x91, s_stop_variable,
        0x00, 0x01,
        0xFF, 0x00,
        0x80, 0x00,
    };
    esp_err_t err = vl_write_seq_pair(i2c_num, addr, prep, sizeof(prep));
    if (err != ESP_OK) return err;

    if (period_ms > 0) {
        uint16_t osc = s_osc_calibrate_val ? s_osc_calibrate_val : 1;
        uint32_t reg_val = period_ms * (uint32_t)osc;
        uint8_t b0 = (uint8_t)((reg_val >> 24) & 0xFF);
        uint8_t b1 = (uint8_t)((reg_val >> 16) & 0xFF);
        uint8_t b2 = (uint8_t)((reg_val >> 8) & 0xFF);
        uint8_t b3 = (uint8_t)(reg_val & 0xFF);
        const uint8_t period_regs[] = {
            VL53L0X_REG_SYSTEM_INTERMEAS_PERIOD, b0,
            (uint8_t)(VL53L0X_REG_SYSTEM_INTERMEAS_PERIOD + 1), b1,
            (uint8_t)(VL53L0X_REG_SYSTEM_INTERMEAS_PERIOD + 2), b2,
            (uint8_t)(VL53L0X_REG_SYSTEM_INTERMEAS_PERIOD + 3), b3,
        };
        err = vl_write_seq_pair(i2c_num, addr, period_regs, sizeof(period_regs));
        if (err != ESP_OK) return err;
        err = vl_write8(i2c_num, addr, VL53L0X_REG_SYSRANGE_START, 0x04);
    } else {
        err = vl_write8(i2c_num, addr, VL53L0X_REG_SYSRANGE_START, 0x02);
    }

    if (err == ESP_OK) {
        s_continuous_mode = true;
    }
    return err;
}

esp_err_t vl53l0x_stop_continuous(i2c_port_t i2c_num, uint8_t address) {
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    uint8_t addr = (address != 0) ? address : s_active_address;

    const uint8_t stop_seq[] = {
        VL53L0X_REG_SYSRANGE_START, 0x01,
        0xFF, 0x01,
        0x00, 0x00,
        0x91, 0x00,
        0x00, 0x01,
        0xFF, 0x00,
    };
    esp_err_t err = vl_write_seq_pair(i2c_num, addr, stop_seq, sizeof(stop_seq));
    s_continuous_mode = false;
    return err;
}

int vl53l0x_measure(i2c_port_t i2c_num, uint8_t address, uint16_t *out_mm) {
    if (!out_mm) return ESP_ERR_INVALID_ARG;
    vl53l0x_reading_t reading = {0};
    esp_err_t err = vl53l0x_read_validated(i2c_num, address, &reading);
    if (err != ESP_OK) return err;
    *out_mm = reading.raw_mm;
    return ESP_OK;
}

static esp_err_t record_i2c_failure(i2c_port_t i2c_num, uint8_t addr, esp_err_t err, vl53l0x_reading_t *out_reading) {
    s_consec_i2c_errors++;
    if (s_consec_i2c_errors >= VL53L0X_CONSEC_I2C_DISCONNECT_LIMIT ||
        vl53l0x_ping(i2c_num, addr) != ESP_OK) {
        s_initialized = false;
        s_continuous_mode = false;
        out_reading->status = VL53L0X_STATUS_DISCONNECTED;
        ESP_LOGW(TAG, "Forward VL53L0X disconnected on I2C bus %d (errors=%u).",
                 i2c_num, (unsigned)s_consec_i2c_errors);
    } else {
        out_reading->status = VL53L0X_STATUS_I2C_ERROR;
    }
    return err;
}

esp_err_t vl53l0x_read_validated(i2c_port_t i2c_num, uint8_t address, vl53l0x_reading_t *out_reading) {
    if (!out_reading) return ESP_ERR_INVALID_ARG;
    memset(out_reading, 0, sizeof(*out_reading));
    out_reading->timestamp_ms = esp_timer_get_time() / 1000;

    if (!s_initialized) {
        out_reading->status = VL53L0X_STATUS_UNINITIALIZED;
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t addr = (address != 0) ? address : s_active_address;

    if (!s_continuous_mode) {
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
        esp_err_t err = vl_write_seq_pair(i2c_num, addr, prep_seq, sizeof(prep_seq));
        if (err != ESP_OK) {
            return record_i2c_failure(i2c_num, addr, err, out_reading);
        }
    }

    esp_err_t err = vl53l0x_wait_data_ready(i2c_num, addr, 120);
    if (err == ESP_ERR_TIMEOUT) {
        (void)vl_write8(i2c_num, addr, VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01);
        out_reading->status = VL53L0X_STATUS_TIMEOUT;
        return ESP_ERR_TIMEOUT;
    }
    if (err != ESP_OK) {
        return record_i2c_failure(i2c_num, addr, err, out_reading);
    }

    uint8_t status = 0;
    uint16_t raw_mm = 0;
    err = vl_read8(i2c_num, addr, VL53L0X_REG_RESULT_RANGE_STATUS, &status);
    if (err == ESP_OK) {
        err = vl_read16(i2c_num, addr, (uint8_t)(VL53L0X_REG_RESULT_RANGE_STATUS + 10), &raw_mm);
    }
    (void)vl_write8(i2c_num, addr, VL53L0X_REG_SYSTEM_INTERRUPT_CLEAR, 0x01);

    if (err != ESP_OK) {
        return record_i2c_failure(i2c_num, addr, err, out_reading);
    }

    s_consec_i2c_errors = 0;
    out_reading->timestamp_ms = esp_timer_get_time() / 1000;
    out_reading->range_status = status;
    out_reading->raw_mm = raw_mm;
    out_reading->out_of_range = (raw_mm >= 8190 || raw_mm > 4000);
    out_reading->valid = vl53l0x_is_range_valid(status, raw_mm);
    out_reading->distance_cm = out_reading->valid ? vl53l0x_mm_to_cm(raw_mm) : 0.0f;

    if (out_reading->valid) {
        out_reading->status = VL53L0X_STATUS_OK;
    } else if (out_reading->out_of_range) {
        out_reading->status = VL53L0X_STATUS_OUT_OF_RANGE;
    } else {
        out_reading->status = VL53L0X_STATUS_INVALID_RANGE;
    }
    return ESP_OK;
}

void vl53l0x_deinit(i2c_port_t i2c_num, uint8_t address) {
    if (s_initialized && s_continuous_mode) {
        (void)vl53l0x_stop_continuous(i2c_num, address);
    }
    s_initialized = false;
    s_continuous_mode = false;
    s_consec_i2c_errors = 0;
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
esp_err_t vl53l0x_ping(i2c_port_t i2c_num, uint8_t address) {
    (void)i2c_num; (void)address;
    return ESP_ERR_NOT_SUPPORTED;
}
bool vl53l0x_is_initialized(void) { return false; }
esp_err_t vl53l0x_start_continuous(i2c_port_t i2c_num, uint8_t address, uint32_t period_ms) {
    (void)i2c_num; (void)address; (void)period_ms;
    return ESP_ERR_NOT_SUPPORTED;
}
esp_err_t vl53l0x_stop_continuous(i2c_port_t i2c_num, uint8_t address) {
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
