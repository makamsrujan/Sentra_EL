/**
 * @file vl53l0x.h
 * @brief Single Forward VL53L0X Time-of-Flight Sensor Driver for SENTRA.
 */

#ifndef VL53L0X_H
#define VL53L0X_H

#include <stdint.h>
#include <stdbool.h>

#ifdef ESP_PLATFORM
#include "driver/i2c.h"
#include "esp_err.h"
#else
typedef int i2c_port_t;
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_NOT_SUPPORTED 0x106
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool valid;
    bool out_of_range;
    uint16_t raw_mm;
    float distance_cm;
    uint8_t range_status;
} vl53l0x_reading_t;

/* Pure-C conversion & range validation helpers (host-testable and firmware-shared). */
bool vl53l0x_is_range_valid(uint8_t range_status, uint16_t raw_mm);
float vl53l0x_mm_to_cm(uint16_t distance_mm);

/** Initialize ONE forward VL53L0X sensor on the shared I2C bus. */
int vl53l0x_init(i2c_port_t i2c_num, uint8_t address);

/** Hardware reset via XSHUT GPIO (-1 skips GPIO toggle) then initialize single VL53L0X. */
esp_err_t vl53l0x_init_single(i2c_port_t i2c_num, int xshut_gpio, uint8_t address);

/** Perform a single ranging measurement in millimetres. */
int vl53l0x_measure(i2c_port_t i2c_num, uint8_t address, uint16_t *out_mm);

/** Perform validated single ranging measurement with mm->cm conversion and status reporting. */
esp_err_t vl53l0x_read_validated(i2c_port_t i2c_num, uint8_t address, vl53l0x_reading_t *out_reading);

/** De-initialize / mark sensor inactive. */
void vl53l0x_deinit(i2c_port_t i2c_num, uint8_t address);

#ifdef __cplusplus
}
#endif

#endif /* VL53L0X_H */