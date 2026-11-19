#ifndef SENTRA_MPU6050_H
#define SENTRA_MPU6050_H

#include "driver/i2c.h"
#include "esp_err.h"

typedef struct {
    float ax, ay, az;           /* m/s^2 */
    float gx, gy, gz;           /* deg/s */
    float pitch_deg;            /* relative gravity tilt; NOT compass heading */
} sentra_mpu_sample_t;

/* Requires the shared I2C bus to have been installed by the main app. */
esp_err_t sentra_mpu6050_init(i2c_port_t bus);
esp_err_t sentra_mpu6050_read(i2c_port_t bus, sentra_mpu_sample_t *out);

#endif
