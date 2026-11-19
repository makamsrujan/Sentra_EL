/**
 * @file vl53l0x.h
 * @brief Single Forward VL53L0X Time-of-Flight Sensor Driver for SENTRA.
 *
 * Designed strictly for ONE forward-facing VL53L0X headband sensor on shared I2C.
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
#ifndef ESP_OK
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_INVALID_SIZE 0x104
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NOT_SUPPORTED 0x106
#define ESP_ERR_TIMEOUT 0x107
#define ESP_ERR_INVALID_RESPONSE 0x108
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    VL53L0X_STATUS_UNINITIALIZED = 0,
    VL53L0X_STATUS_OK,
    VL53L0X_STATUS_INIT_FAILED,
    VL53L0X_STATUS_I2C_ERROR,
    VL53L0X_STATUS_TIMEOUT,
    VL53L0X_STATUS_DISCONNECTED,
    VL53L0X_STATUS_OUT_OF_RANGE,
    VL53L0X_STATUS_INVALID_RANGE
} vl53l0x_status_t;

typedef struct {
    bool valid;
    bool out_of_range;
    uint16_t raw_mm;
    float distance_cm;
    uint8_t range_status;
    vl53l0x_status_t status;
    int64_t timestamp_ms;
} vl53l0x_reading_t;

/* Pure-C conversion & validation helpers (host-testable and firmware-shared). */
bool vl53l0x_is_range_valid(uint8_t range_status, uint16_t raw_mm);
float vl53l0x_mm_to_cm(uint16_t distance_mm);
const char *vl53l0x_status_to_string(vl53l0x_status_t status);

/** Initialize ONE forward VL53L0X sensor on the shared I2C bus. */
int vl53l0x_init(i2c_port_t i2c_num, uint8_t address);

/** Hardware reset via XSHUT GPIO (-1 skips GPIO toggle) then initialize single VL53L0X. */
esp_err_t vl53l0x_init_single(i2c_port_t i2c_num, int xshut_gpio, uint8_t address);

/** Verify sensor presence over I2C by reading VL53L0X Model ID (0xC0 == 0xEE). */
esp_err_t vl53l0x_ping(i2c_port_t i2c_num, uint8_t address);

/** Check whether the driver currently believes the forward VL53L0X is initialized & attached. */
bool vl53l0x_is_initialized(void);

/** Start or stop continuous back-to-back ranging mode (intermeasurement_ms=0 for back-to-back). */
esp_err_t vl53l0x_start_continuous(i2c_port_t i2c_num, uint8_t address, uint32_t period_ms);
esp_err_t vl53l0x_stop_continuous(i2c_port_t i2c_num, uint8_t address);

/** Perform a single ranging measurement in millimetres. */
int vl53l0x_measure(i2c_port_t i2c_num, uint8_t address, uint16_t *out_mm);

/** Perform validated measurement with mm->cm conversion, error classification, and disconnect tracking. */
esp_err_t vl53l0x_read_validated(i2c_port_t i2c_num, uint8_t address, vl53l0x_reading_t *out_reading);

/** De-initialize / mark sensor inactive cleanly. */
void vl53l0x_deinit(i2c_port_t i2c_num, uint8_t address);

#ifdef __cplusplus
}
#endif

#endif /* VL53L0X_H */