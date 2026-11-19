#ifndef SENTRA_MPU6050_H
#define SENTRA_MPU6050_H

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
    float gx_bias_dps;
    float gy_bias_dps;
    float gz_bias_dps;
    bool calibrated;
} sentra_mpu_calibration_t;

typedef struct {
    float ax, ay, az;           /* m/s^2 */
    float gx, gy, gz;           /* deg/s */
    float pitch_deg;            /* relative gravity tilt; NOT compass heading */
    float motion_magnitude;     /* deg/s vector magnitude */
    bool calibrated;
    bool valid;
} sentra_mpu_sample_t;

/* Pure-C conversion & calibration application helper (host-testable). */
void mpu6050_compute_sample_from_raw(
    int16_t ax_raw, int16_t ay_raw, int16_t az_raw,
    int16_t gx_raw, int16_t gy_raw, int16_t gz_raw,
    const sentra_mpu_calibration_t *cal,
    sentra_mpu_sample_t *out
);

/* Requires the shared I2C bus to have been initialized via sentra_i2c_bus_init(). */
esp_err_t sentra_mpu6050_init(i2c_port_t bus);
esp_err_t sentra_mpu6050_calibrate(i2c_port_t bus, uint16_t samples);
esp_err_t sentra_mpu6050_read(i2c_port_t bus, sentra_mpu_sample_t *out);
bool sentra_mpu6050_is_calibrated(void);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_MPU6050_H */
