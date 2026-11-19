/**
 * @file sentra_nvs_config.h
 * @brief Runtime NVS configuration for credentials and dynamically adjustable intervals/thresholds.
 */

#ifndef SENTRA_NVS_CONFIG_H
#define SENTRA_NVS_CONFIG_H

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char wifi_ssid[64];
    char wifi_password[64];
    char server_url[160];
    char device_id[64];
    char device_token[128];
    uint32_t tof_sample_interval_ms;
    uint32_t imu_sample_interval_ms;
    uint32_t telemetry_interval_ms;
    uint32_t frame_upload_interval_ms;
    uint8_t jpeg_quality;
    uint16_t proximity_caution_cm;
    uint16_t proximity_critical_cm;
} sentra_runtime_config_t;

esp_err_t sentra_nvs_config_load(void);
void sentra_nvs_config_get(sentra_runtime_config_t *out_cfg);
esp_err_t sentra_nvs_config_update_tuning(
    uint32_t tof_interval_ms,
    uint32_t imu_interval_ms,
    uint32_t frame_interval_ms,
    uint8_t jpeg_quality,
    uint16_t caution_cm,
    uint16_t critical_cm
);
void sentra_nvs_request_imu_recalibration(bool requested);
bool sentra_nvs_consume_imu_recalibration_request(void);
void sentra_nvs_request_immediate_frame(bool requested);
bool sentra_nvs_consume_immediate_frame_request(void);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_NVS_CONFIG_H */
