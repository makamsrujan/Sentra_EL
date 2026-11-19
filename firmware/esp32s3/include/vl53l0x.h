/**
 * @file vl53l0x.h
 * @brief Minimal VL53L0X Time‑of‑Flight sensor driver header for SENTRA.
 */

#ifndef VL53L0X_H
#define VL53L0X_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Initialize the VL53L0X sensor on the shared I2C bus.
 *  @param i2c_num I2C port number (e.g., I2C_NUM_0).
 *  @param address 7‑bit I2C address of the sensor.
 *  @return ESP_OK on success, otherwise error code.
 */
int vl53l0x_init(i2c_port_t i2c_num, uint8_t address);

/** Perform a single ranging measurement.
 *  @param i2c_num I2C port number.
 *  @param address Sensor I2C address.
 *  @param out_mm  Pointer to receive distance in millimetres.
 *  @return ESP_OK on success, otherwise error code.
 */
int vl53l0x_measure(i2c_port_t i2c_num, uint8_t address, uint16_t *out_mm);

/** De‑initialize the sensor (if needed).
 *  @param i2c_num I2C port number.
 *  @param address Sensor address.
 */
void vl53l0x_deinit(i2c_port_t i2c_num, uint8_t address);

#ifdef __cplusplus
}
#endif

#endif // VL53L0X_H