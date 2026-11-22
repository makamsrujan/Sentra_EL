/* GY-521 MPU6050 I2C driver for stationary tilt, bias calibration, and motion telemetry.
 * Strictly does NOT invent an absolute compass heading from 6-axis accel/gyro alone. */
#include "mpu6050.h"
#include <math.h>
#include <string.h>

#define MPU_ADDR             0x68
#define MPU_REG_SMPLRT_DIV   0x19
#define MPU_REG_CONFIG_DLPF  0x1A
#define MPU_REG_GYRO_CONFIG  0x1B
#define MPU_REG_ACCEL_CONFIG 0x1C
#define MPU_REG_ACCEL_XOUT_H 0x3B
#define MPU_REG_PWR_MGMT_1   0x6B
#define MPU_REG_WHO_AM_I     0x75

void mpu6050_compute_sample_from_raw(
    int16_t ax_raw, int16_t ay_raw, int16_t az_raw,
    int16_t gx_raw, int16_t gy_raw, int16_t gz_raw,
    const sentra_mpu_calibration_t *cal,
    sentra_mpu_sample_t *out
) {
    if (!out) return;
    memset(out, 0, sizeof(*out));

    /* Stuck all-zero frame indicates dead bus or unpowered sensor. */
    if (ax_raw == 0 && ay_raw == 0 && az_raw == 0 &&
        gx_raw == 0 && gy_raw == 0 && gz_raw == 0) {
        out->valid = false;
        return;
    }

    const float accel_scale = 9.80665f / 16384.0f; /* ±2g */
    const float gyro_scale = 1.0f / 131.0f;        /* ±250 deg/s */

    out->ax = (float)ax_raw * accel_scale;
    out->ay = (float)ay_raw * accel_scale;
    out->az = (float)az_raw * accel_scale;

    float gx = (float)gx_raw * gyro_scale;
    float gy = (float)gy_raw * gyro_scale;
    float gz = (float)gz_raw * gyro_scale;

    if (cal && cal->calibrated) {
        gx -= cal->gx_bias_dps;
        gy -= cal->gy_bias_dps;
        gz -= cal->gz_bias_dps;
        out->calibrated = true;
    } else {
        out->calibrated = false;
    }

    out->gx = gx;
    out->gy = gy;
    out->gz = gz;
    out->motion_magnitude = sqrtf(gx * gx + gy * gy + gz * gz);

    float denom = sqrtf(out->ay * out->ay + out->az * out->az);
    if (denom < 0.001f && fabsf(out->ax) < 0.001f) {
        out->valid = false;
        return;
    }
    out->pitch_deg = atan2f(-out->ax, denom) * (180.0f / 3.14159265358979323846f);
    out->valid = isfinite(out->pitch_deg) && isfinite(out->motion_magnitude);
}

#ifdef ESP_PLATFORM

#include "i2c_bus.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"

static const char *TAG = "MPU6050";
static sentra_mpu_calibration_t s_calibration = {0};

static int16_t signed_be(const uint8_t *data) {
    return (int16_t)(((uint16_t)data[0] << 8) | data[1]);
}

esp_err_t sentra_mpu6050_init(i2c_port_t bus) {
    memset(&s_calibration, 0, sizeof(s_calibration));

    uint8_t who = 0;
    esp_err_t err = sentra_i2c_read_regs(bus, MPU_ADDR, MPU_REG_WHO_AM_I, &who, 1);
    if (err != ESP_OK) return err;
    ESP_LOGI(TAG, "WHO_AM_I = 0x%02X", (unsigned int)who);
    if ((who & 0x7E) != 0x68 && who != 0x74)
        return ESP_ERR_INVALID_RESPONSE;

    if (who == 0x74) {
        ESP_LOGW(TAG, "MPU variant 0x74 detected; testing compatible mode");
    }

    err = sentra_i2c_write_reg8(bus, MPU_ADDR, MPU_REG_PWR_MGMT_1, 0x01); /* PLL with X gyro ref */
    if (err != ESP_OK) return err;
    vTaskDelay(pdMS_TO_TICKS(50));

    /* DLPF ~44 Hz bandwidth + 100 Hz sample rate divider */
    err = sentra_i2c_write_reg8(bus, MPU_ADDR, MPU_REG_CONFIG_DLPF, 0x03);
    if (err != ESP_OK) return err;
    err = sentra_i2c_write_reg8(bus, MPU_ADDR, MPU_REG_SMPLRT_DIV, 0x09);
    if (err != ESP_OK) return err;
    err = sentra_i2c_write_reg8(bus, MPU_ADDR, MPU_REG_ACCEL_CONFIG, 0x00); /* ±2g */
    if (err != ESP_OK) return err;
    err = sentra_i2c_write_reg8(bus, MPU_ADDR, MPU_REG_GYRO_CONFIG, 0x00);  /* ±250 deg/s */
    if (err != ESP_OK) return err;

    /* Run brief stationary bias calibration at boot */
    esp_err_t cal_err = sentra_mpu6050_calibrate(bus, 40);
    if (cal_err != ESP_OK) {
        ESP_LOGW(TAG, "MPU6050 initial gyro calibration skipped: %s", esp_err_to_name(cal_err));
    }
    return ESP_OK;
}

esp_err_t sentra_mpu6050_calibrate(i2c_port_t bus, uint16_t samples) {
    if (samples < 10) samples = 10;
    float sum_gx = 0.0f, sum_gy = 0.0f, sum_gz = 0.0f;
    uint16_t valid_count = 0;
    const float gyro_scale = 1.0f / 131.0f;

    for (uint16_t i = 0; i < samples; i++) {
        uint8_t data[14] = {0};
        if (sentra_i2c_read_regs(bus, MPU_ADDR, MPU_REG_ACCEL_XOUT_H, data, sizeof(data)) == ESP_OK) {
            sum_gx += (float)signed_be(data + 8) * gyro_scale;
            sum_gy += (float)signed_be(data + 10) * gyro_scale;
            sum_gz += (float)signed_be(data + 12) * gyro_scale;
            valid_count++;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    if (valid_count < (samples / 2)) {
        s_calibration.calibrated = false;
        return ESP_ERR_INVALID_RESPONSE;
    }

    s_calibration.gx_bias_dps = sum_gx / (float)valid_count;
    s_calibration.gy_bias_dps = sum_gy / (float)valid_count;
    s_calibration.gz_bias_dps = sum_gz / (float)valid_count;
    s_calibration.calibrated = true;
    ESP_LOGI(TAG, "MPU6050 gyro calibrated (bias dps: %.2f, %.2f, %.2f)",
             s_calibration.gx_bias_dps, s_calibration.gy_bias_dps, s_calibration.gz_bias_dps);
    return ESP_OK;
}

esp_err_t sentra_mpu6050_read(i2c_port_t bus, sentra_mpu_sample_t *out) {
    if (!out) return ESP_ERR_INVALID_ARG;
    uint8_t data[14] = {0};
    esp_err_t err = sentra_i2c_read_regs(bus, MPU_ADDR, MPU_REG_ACCEL_XOUT_H, data, sizeof(data));
    if (err != ESP_OK) {
        out->valid = false;
        return err;
    }

    mpu6050_compute_sample_from_raw(
        signed_be(data), signed_be(data + 2), signed_be(data + 4),
        signed_be(data + 8), signed_be(data + 10), signed_be(data + 12),
        &s_calibration, out
    );
    return out->valid ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
}

bool sentra_mpu6050_is_calibrated(void) {
    return s_calibration.calibrated;
}

#else

esp_err_t sentra_mpu6050_init(i2c_port_t bus) {
    (void)bus;
    return ESP_ERR_NOT_SUPPORTED;
}
esp_err_t sentra_mpu6050_calibrate(i2c_port_t bus, uint16_t samples) {
    (void)bus; (void)samples;
    return ESP_ERR_NOT_SUPPORTED;
}
esp_err_t sentra_mpu6050_read(i2c_port_t bus, sentra_mpu_sample_t *out) {
    (void)bus; (void)out;
    return ESP_ERR_NOT_SUPPORTED;
}
bool sentra_mpu6050_is_calibrated(void) {
    return false;
}

#endif
