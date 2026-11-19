/**
 * @file sentra_nvs_config.c
 * @brief Runtime NVS configuration loader/updater without hardcoded credentials.
 */

#include "sentra_nvs_config.h"
#include "sentra_config.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>

static const char *TAG = "SENTRA_NVS";
static const char *NVS_NAMESPACE = "sentra_cfg";

static sentra_runtime_config_t s_cfg = {0};
static SemaphoreHandle_t s_cfg_mutex = NULL;
static volatile bool s_imu_recal_pending = false;
static volatile bool s_immediate_frame_pending = false;

static void copy_str_safe(char *dst, size_t dst_size, const char *src) {
    if (!dst || dst_size == 0) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    strncpy(dst, src, dst_size - 1);
    dst[dst_size - 1] = '\0';
}

static void load_nvs_str(nvs_handle_t handle, const char *key, char *dst, size_t dst_size) {
    size_t len = dst_size;
    char tmp[160] = {0};
    if (dst_size <= sizeof(tmp) && nvs_get_str(handle, key, tmp, &len) == ESP_OK && tmp[0] != '\0') {
        copy_str_safe(dst, dst_size, tmp);
    }
}

esp_err_t sentra_nvs_config_load(void) {
    if (!s_cfg_mutex) {
        s_cfg_mutex = xSemaphoreCreateMutex();
        if (!s_cfg_mutex) return ESP_ERR_NO_MEM;
    }

    xSemaphoreTake(s_cfg_mutex, portMAX_DELAY);

    copy_str_safe(s_cfg.wifi_ssid, sizeof(s_cfg.wifi_ssid), SENTRA_WIFI_SSID);
    copy_str_safe(s_cfg.wifi_password, sizeof(s_cfg.wifi_password), SENTRA_WIFI_PASS);
    copy_str_safe(s_cfg.server_url, sizeof(s_cfg.server_url), SENTRA_DEFAULT_SERVER_URL);
    copy_str_safe(s_cfg.device_id, sizeof(s_cfg.device_id), SENTRA_DEVICE_ID);
    copy_str_safe(s_cfg.device_token, sizeof(s_cfg.device_token), SENTRA_DEFAULT_DEVICE_TOKEN);

    s_cfg.tof_sample_interval_ms = SENTRA_TOF_SAMPLE_INTERVAL_MS;
    s_cfg.imu_sample_interval_ms = SENTRA_IMU_SAMPLE_INTERVAL_MS;
    s_cfg.telemetry_interval_ms = SENTRA_TELEMETRY_INTERVAL_MS;
    s_cfg.frame_upload_interval_ms = SENTRA_FRAME_UPLOAD_INTERVAL_MS;
#ifdef CONFIG_SENTRA_CAM_DEFAULT_QUALITY
    s_cfg.jpeg_quality = CONFIG_SENTRA_CAM_DEFAULT_QUALITY;
#else
    s_cfg.jpeg_quality = 12;
#endif
    s_cfg.proximity_caution_cm = SENTRA_HAZARD_CAUTION_CM;
    s_cfg.proximity_critical_cm = SENTRA_HAZARD_OBSTACLE_CM;

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_OK) {
        load_nvs_str(handle, "wifi_ssid", s_cfg.wifi_ssid, sizeof(s_cfg.wifi_ssid));
        load_nvs_str(handle, "wifi_pass", s_cfg.wifi_password, sizeof(s_cfg.wifi_password));
        load_nvs_str(handle, "server_url", s_cfg.server_url, sizeof(s_cfg.server_url));
        load_nvs_str(handle, "device_id", s_cfg.device_id, sizeof(s_cfg.device_id));
        load_nvs_str(handle, "device_token", s_cfg.device_token, sizeof(s_cfg.device_token));

        uint32_t u32_val = 0;
        if (nvs_get_u32(handle, "tof_ms", &u32_val) == ESP_OK && u32_val >= 50 && u32_val <= 5000) {
            s_cfg.tof_sample_interval_ms = u32_val;
        }
        if (nvs_get_u32(handle, "imu_ms", &u32_val) == ESP_OK && u32_val >= 20 && u32_val <= 5000) {
            s_cfg.imu_sample_interval_ms = u32_val;
        }
        if (nvs_get_u32(handle, "frame_ms", &u32_val) == ESP_OK && u32_val >= 250 && u32_val <= 30000) {
            s_cfg.frame_upload_interval_ms = u32_val;
        }
        uint8_t u8_val = 0;
        if (nvs_get_u8(handle, "jpeg_q", &u8_val) == ESP_OK && u8_val >= 4 && u8_val <= 63) {
            s_cfg.jpeg_quality = u8_val;
        }
        uint16_t u16_val = 0;
        if (nvs_get_u16(handle, "caution_cm", &u16_val) == ESP_OK && u16_val >= 25 && u16_val <= 300) {
            s_cfg.proximity_caution_cm = u16_val;
        }
        if (nvs_get_u16(handle, "critical_cm", &u16_val) == ESP_OK && u16_val >= 10 && u16_val <= 150) {
            s_cfg.proximity_critical_cm = u16_val;
        }
        nvs_close(handle);
        ESP_LOGI(TAG, "Loaded runtime overrides from NVS namespace '%s'.", NVS_NAMESPACE);
    } else {
        ESP_LOGI(TAG, "Using Kconfig defaults (NVS namespace not yet populated).");
    }

    xSemaphoreGive(s_cfg_mutex);
    return ESP_OK;
}

void sentra_nvs_config_get(sentra_runtime_config_t *out_cfg) {
    if (!out_cfg) return;
    if (s_cfg_mutex) xSemaphoreTake(s_cfg_mutex, portMAX_DELAY);
    memcpy(out_cfg, &s_cfg, sizeof(s_cfg));
    if (s_cfg_mutex) xSemaphoreGive(s_cfg_mutex);
}

esp_err_t sentra_nvs_config_update_tuning(
    uint32_t tof_interval_ms,
    uint32_t imu_interval_ms,
    uint32_t frame_interval_ms,
    uint8_t jpeg_quality,
    uint16_t caution_cm,
    uint16_t critical_cm
) {
    if (s_cfg_mutex) xSemaphoreTake(s_cfg_mutex, portMAX_DELAY);
    if (tof_interval_ms >= 50 && tof_interval_ms <= 5000) s_cfg.tof_sample_interval_ms = tof_interval_ms;
    if (imu_interval_ms >= 20 && imu_interval_ms <= 5000) s_cfg.imu_sample_interval_ms = imu_interval_ms;
    if (frame_interval_ms >= 250 && frame_interval_ms <= 30000) s_cfg.frame_upload_interval_ms = frame_interval_ms;
    if (jpeg_quality >= 4 && jpeg_quality <= 63) s_cfg.jpeg_quality = jpeg_quality;
    if (caution_cm >= 25 && caution_cm <= 300) s_cfg.proximity_caution_cm = caution_cm;
    if (critical_cm >= 10 && critical_cm <= 150) s_cfg.proximity_critical_cm = critical_cm;

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        nvs_set_u32(handle, "tof_ms", s_cfg.tof_sample_interval_ms);
        nvs_set_u32(handle, "imu_ms", s_cfg.imu_sample_interval_ms);
        nvs_set_u32(handle, "frame_ms", s_cfg.frame_upload_interval_ms);
        nvs_set_u8(handle, "jpeg_q", s_cfg.jpeg_quality);
        nvs_set_u16(handle, "caution_cm", s_cfg.proximity_caution_cm);
        nvs_set_u16(handle, "critical_cm", s_cfg.proximity_critical_cm);
        err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (s_cfg_mutex) xSemaphoreGive(s_cfg_mutex);
    return err;
}

void sentra_nvs_request_imu_recalibration(bool requested) {
    s_imu_recal_pending = requested;
}

bool sentra_nvs_consume_imu_recalibration_request(void) {
    bool v = s_imu_recal_pending;
    s_imu_recal_pending = false;
    return v;
}

void sentra_nvs_request_immediate_frame(bool requested) {
    s_immediate_frame_pending = requested;
}

bool sentra_nvs_consume_immediate_frame_request(void) {
    bool v = s_immediate_frame_pending;
    s_immediate_frame_pending = false;
    return v;
}
