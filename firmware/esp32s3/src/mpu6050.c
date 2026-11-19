/* Basic MPU6050 I2C driver for stationary tilt and motion telemetry.
   Not a full AHRS or absolute heading/SLAM implementation. */
#include "mpu6050.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <math.h>
#include <stdint.h>

#define MPU_ADDR 0x68
#define MPU_REG_PWR_MGMT_1 0x6B
#define MPU_REG_WHO_AM_I 0x75
#define MPU_REG_ACCEL_XOUT_H 0x3B
#define MPU_REG_GYRO_CONFIG 0x1B
#define MPU_REG_ACCEL_CONFIG 0x1C
#define MPU_TIMEOUT pdMS_TO_TICKS(150)

static esp_err_t read_regs(i2c_port_t bus, uint8_t reg, uint8_t *buffer, size_t count) {
    return i2c_master_write_read_device(bus, MPU_ADDR, &reg, 1,
                                        buffer, count, MPU_TIMEOUT);
}
static esp_err_t write_reg(i2c_port_t bus, uint8_t reg, uint8_t value) {
    const uint8_t command[2] = {reg, value};
    return i2c_master_write_to_device(bus, MPU_ADDR, command,
                                      sizeof(command), MPU_TIMEOUT);
}
static int16_t signed_be(const uint8_t *data) {
    return (int16_t)(((uint16_t)data[0] << 8) | data[1]);
}
esp_err_t sentra_mpu6050_init(i2c_port_t bus) {
    uint8_t who = 0;
    esp_err_t err = read_regs(bus, MPU_REG_WHO_AM_I, &who, 1);
    if (err != ESP_OK) return err;
    if ((who & 0x7E) != 0x68) return ESP_ERR_INVALID_RESPONSE;

    err = write_reg(bus, MPU_REG_PWR_MGMT_1, 0x00); /* wake from sleep */
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(100));
    err = write_reg(bus, MPU_REG_ACCEL_CONFIG, 0x00); /* ±2 g */
    if (err != ESP_OK) return err;
    return write_reg(bus, MPU_REG_GYRO_CONFIG, 0x00); /* ±250 deg/s */
}
esp_err_t sentra_mpu6050_read(i2c_port_t bus, sentra_mpu_sample_t *out) {
    if (!out) return ESP_ERR_INVALID_ARG;
    uint8_t data[14] = {0};
    esp_err_t err = read_regs(bus, MPU_REG_ACCEL_XOUT_H, data, sizeof(data));
    if (err != ESP_OK) return err;
    const float accel = 9.80665f / 16384.0f;
    const float gyro = 1.0f / 131.0f;
    out->ax = signed_be(data) * accel;
    out->ay = signed_be(data + 2) * accel;
    out->az = signed_be(data + 4) * accel;
    out->gx = signed_be(data + 8) * gyro;
    out->gy = signed_be(data + 10) * gyro;
    out->gz = signed_be(data + 12) * gyro;
    out->pitch_deg = atan2f(-out->ax, sqrtf(out->ay*out->ay + out->az*out->az)) *
                     (180.0f / 3.14159265358979323846f);
    if (!isfinite(out->pitch_deg)) return ESP_ERR_INVALID_RESPONSE;
    return ESP_OK;
}
