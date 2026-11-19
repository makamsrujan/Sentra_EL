/**
 * @file i2c_bus.h
 * @brief Thread-safe shared I2C bus helper for VL53L0X, MPU6050, and optional peripherals.
 */

#ifndef SENTRA_I2C_BUS_H
#define SENTRA_I2C_BUS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "driver/i2c.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t sentra_i2c_bus_init(i2c_port_t bus, int sda_gpio, int scl_gpio, uint32_t freq_hz);
bool sentra_i2c_bus_is_ready(void);
bool sentra_i2c_bus_lock(uint32_t timeout_ms);
void sentra_i2c_bus_unlock(void);

esp_err_t sentra_i2c_write_reg8(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t value);
esp_err_t sentra_i2c_read_regs(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t *out_buf, size_t len);
esp_err_t sentra_i2c_write_reg16(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint16_t value_be);
esp_err_t sentra_i2c_read_reg16(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint16_t *out_val_be);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_I2C_BUS_H */
