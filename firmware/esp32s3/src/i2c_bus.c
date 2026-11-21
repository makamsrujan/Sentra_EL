/**
 * @file i2c_bus.c
 * @brief Thread-safe shared I2C bus helper and bench address scanner.
 */

#include "i2c_bus.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"

#define I2C_XFER_TIMEOUT_MS 150
#define I2C_LOCK_TIMEOUT_MS 200
#define I2C_SCAN_TIMEOUT_MS 40

static const char *TAG = "SENTRA_I2C";
static SemaphoreHandle_t s_i2c_mutex = NULL;
static bool s_i2c_ready = false;

esp_err_t sentra_i2c_bus_init(i2c_port_t bus, int sda_gpio, int scl_gpio, uint32_t freq_hz) {
    if (s_i2c_ready) return ESP_OK;

    if (!s_i2c_mutex) {
        s_i2c_mutex = xSemaphoreCreateMutex();
        if (!s_i2c_mutex) return ESP_ERR_NO_MEM;
    }

    i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = sda_gpio,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_io_num = scl_gpio,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = freq_hz,
    };
    esp_err_t err = i2c_param_config(bus, &conf);
    if (err != ESP_OK) return err;

    err = i2c_driver_install(bus, conf.mode, 0, 0, 0);
    if (err == ESP_OK || err == ESP_ERR_INVALID_STATE) {
        s_i2c_ready = true;
        ESP_LOGI(TAG, "I2C bus %d initialized (SDA=GPIO%d, SCL=GPIO%d, freq=%u Hz).",
                 (int)bus, sda_gpio, scl_gpio, (unsigned)freq_hz);
        return ESP_OK;
    }
    return err;
}

bool sentra_i2c_bus_is_ready(void) {
    return s_i2c_ready;
}

bool sentra_i2c_bus_lock(uint32_t timeout_ms) {
    if (!s_i2c_mutex) return false;
    return xSemaphoreTake(s_i2c_mutex, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

void sentra_i2c_bus_unlock(void) {
    if (s_i2c_mutex) {
        xSemaphoreGive(s_i2c_mutex);
    }
}

int sentra_i2c_bus_scan(i2c_port_t bus) {
    if (!s_i2c_ready) return -1;
    if (!sentra_i2c_bus_lock(I2C_LOCK_TIMEOUT_MS)) return -1;

    int found = 0;
    bool saw_vl53l0x = false;
    bool saw_mpu6050 = false;

    ESP_LOGI(TAG, "Starting I2C bench scan (0x08..0x77)...");
    for (uint8_t addr = 0x08; addr <= 0x77; addr++) {
        i2c_cmd_handle_t cmd = i2c_cmd_link_create();
        if (!cmd) continue;
        i2c_master_start(cmd);
        i2c_master_write_byte(cmd, (uint8_t)((addr << 1) | I2C_MASTER_WRITE), true);
        i2c_master_stop(cmd);
        esp_err_t err = i2c_master_cmd_begin(bus, cmd, pdMS_TO_TICKS(I2C_SCAN_TIMEOUT_MS));
        i2c_cmd_link_delete(cmd);

        if (err == ESP_OK) {
            found++;
            if (addr == 0x29) saw_vl53l0x = true;
            if (addr == 0x68) saw_mpu6050 = true;
            ESP_LOGI(TAG, "  I2C ACK at 0x%02X%s", addr,
                     addr == 0x29 ? " (expected VL53L0X forward ToF)" :
                     addr == 0x68 ? " (expected GY-521 MPU6050, AD0=LOW)" : "");
        }
    }

    sentra_i2c_bus_unlock();
    ESP_LOGI(TAG, "I2C bench scan complete: %d device(s) found (VL53L0X@0x29=%s, MPU6050@0x68=%s).",
             found, saw_vl53l0x ? "FOUND" : "MISSING", saw_mpu6050 ? "FOUND" : "MISSING");
    return found;
}

esp_err_t sentra_i2c_write_reg8(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t value) {
    if (!s_i2c_ready) return ESP_ERR_INVALID_STATE;
    if (!sentra_i2c_bus_lock(I2C_LOCK_TIMEOUT_MS)) return ESP_ERR_TIMEOUT;

    const uint8_t cmd[2] = { reg, value };
    esp_err_t err = i2c_master_write_to_device(bus, dev_addr, cmd, sizeof(cmd), pdMS_TO_TICKS(I2C_XFER_TIMEOUT_MS));
    sentra_i2c_bus_unlock();
    return err;
}

esp_err_t sentra_i2c_read_regs(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t *out_buf, size_t len) {
    if (!out_buf || len == 0) return ESP_ERR_INVALID_ARG;
    if (!s_i2c_ready) return ESP_ERR_INVALID_STATE;
    if (!sentra_i2c_bus_lock(I2C_LOCK_TIMEOUT_MS)) return ESP_ERR_TIMEOUT;

    esp_err_t err = i2c_master_write_read_device(
        bus, dev_addr, &reg, 1, out_buf, len, pdMS_TO_TICKS(I2C_XFER_TIMEOUT_MS)
    );
    sentra_i2c_bus_unlock();
    return err;
}

esp_err_t sentra_i2c_write_reg16(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint16_t value_be) {
    if (!s_i2c_ready) return ESP_ERR_INVALID_STATE;
    if (!sentra_i2c_bus_lock(I2C_LOCK_TIMEOUT_MS)) return ESP_ERR_TIMEOUT;

    const uint8_t cmd[3] = { reg, (uint8_t)(value_be >> 8), (uint8_t)(value_be & 0xFF) };
    esp_err_t err = i2c_master_write_to_device(bus, dev_addr, cmd, sizeof(cmd), pdMS_TO_TICKS(I2C_XFER_TIMEOUT_MS));
    sentra_i2c_bus_unlock();
    return err;
}

esp_err_t sentra_i2c_read_reg16(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint16_t *out_val_be) {
    if (!out_val_be) return ESP_ERR_INVALID_ARG;
    uint8_t buf[2] = { 0 };
    esp_err_t err = sentra_i2c_read_regs(bus, dev_addr, reg, buf, sizeof(buf));
    if (err == ESP_OK) {
        *out_val_be = ((uint16_t)buf[0] << 8) | (uint16_t)buf[1];
    }
    return err;
}
