/**
 * @file vl53l5cx_optional.h
 * @brief Optional VL53L5CX multizone depth sensor capability header (disabled by default).
 */

#ifndef SENTRA_VL53L5CX_OPTIONAL_H
#define SENTRA_VL53L5CX_OPTIONAL_H

#include <stdbool.h>
#include <stdint.h>

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
    bool available;
    uint8_t valid_zones;
    uint16_t min_distance_mm;
} sentra_vl53l5cx_sample_t;

bool vl53l5cx_optional_is_enabled(void);
esp_err_t vl53l5cx_optional_init(i2c_port_t bus);
esp_err_t vl53l5cx_optional_read(i2c_port_t bus, sentra_vl53l5cx_sample_t *out_sample);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_VL53L5CX_OPTIONAL_H */
