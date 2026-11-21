/* Uses POST /api/device/telemetry as heartbeat and sensor stream. Never invents data. */
#include "device_telemetry.h"
#include "sentra_config.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static void json_escape_str(const char *src, char *dst, size_t dst_size) {
    if (!dst || dst_size == 0) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0' && j + 2 < dst_size; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c == '"' || c == '\\') {
            if (j + 2 >= dst_size) break;
            dst[j++] = '\\';
            dst[j++] = (char)c;
        } else if (c >= 0x20) {
            dst[j++] = (char)c;
        }
    }
    dst[j] = '\0';
}

bool sentra_telemetry_can_upload(bool wifi_connected, const char *server_url, const char *device_token) {
    return wifi_connected &&
           server_url != NULL && server_url[0] != '\0' &&
           device_token != NULL && device_token[0] != '\0';
}

int sentra_telemetry_build_json(const sentra_telemetry_snapshot_t *snap, char *out_buf, size_t out_buf_size) {
    if (!snap || !out_buf || out_buf_size < 256) return -1;

    char esc_device_id[96];
    char esc_fw_ver[64];
    json_escape_str(snap->device_id ? snap->device_id : "ESP32-S3-SENTRA-001", esc_device_id, sizeof(esc_device_id));
    json_escape_str(snap->firmware_version ? snap->firmware_version : SENTRA_FIRMWARE_VERSION, esc_fw_ver, sizeof(esc_fw_ver));

    const bool tof_valid = snap->forward_tof_ready && snap->tof_fresh && snap->forward_reading.valid;
    const char *tof_status = "unavailable";
    if (!snap->forward_tof_ready) {
        tof_status = (snap->forward_reading.status == VL53L0X_STATUS_DISCONNECTED) ? "invalid" : "unavailable";
    } else if (!snap->tof_fresh) {
        tof_status = "stale";
    } else if (tof_valid) {
        tof_status = "valid";
    } else {
        tof_status = "invalid";
    }

    char fwd_dist_str[32];
    if (tof_valid && isfinite(snap->forward_reading.distance_cm)) {
        snprintf(fwd_dist_str, sizeof(fwd_dist_str), "%.1f", (double)snap->forward_reading.distance_cm);
    } else {
        snprintf(fwd_dist_str, sizeof(fwd_dist_str), "null");
    }

    char pitch_str[32];
    char imu_obj_str[320];
    if (snap->imu_ready && snap->imu_valid && isfinite(snap->imu_sample.pitch_deg)) {
        snprintf(pitch_str, sizeof(pitch_str), "%.2f", (double)snap->imu_sample.pitch_deg);
        snprintf(
            imu_obj_str,
            sizeof(imu_obj_str),
            "{\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f,"
            "\"heading\":null,\"calibrated\":%s,\"motionMagnitude\":%.2f}",
            (double)snap->imu_sample.ax,
            (double)snap->imu_sample.ay,
            (double)snap->imu_sample.az,
            (double)snap->imu_sample.gx,
            (double)snap->imu_sample.gy,
            (double)snap->imu_sample.gz,
            snap->imu_sample.calibrated ? "true" : "false",
            (double)snap->imu_sample.motion_magnitude
        );
    } else {
        snprintf(pitch_str, sizeof(pitch_str), "null");
        snprintf(imu_obj_str, sizeof(imu_obj_str), "null");
    }

    const char *imu_status = !snap->imu_ready ? "unavailable" : (snap->imu_valid ? "valid" : "invalid");

    int written = snprintf(
        out_buf,
        out_buf_size,
        "{\"schemaVersion\":1,\"deviceId\":\"%s\",\"sequence\":%u,\"uptimeMs\":%lld,"
        "\"firmwareVersion\":\"%s\",\"batteryPercent\":null,\"batteryCharging\":null,"
        "\"earphoneConnected\":null,\"audioVolume\":null,"
        "\"sensors\":{\"forwardDistanceCm\":%s,\"downwardDistanceMm\":null,"
        "\"headPitchDeg\":%s,\"imu\":%s,\"vl53l5cx\":null},"
        "\"sensorHealth\":{\"forwardToF\":\"%s\",\"downwardToF\":\"unavailable\","
        "\"imu\":\"%s\",\"imuCalibrated\":%s,\"camera\":\"%s\","
        "\"vl53l5cx\":\"%s\",\"wm8960\":\"%s\"},"
        "\"capabilities\":{\"camera\":%s,\"forwardToF\":%s,\"downwardToF\":false,"
        "\"imu\":%s,\"audioOutput\":%s,\"vl53l5cx\":%s}}",
        esc_device_id,
        (unsigned)snap->sequence,
        (long long)snap->uptime_ms,
        esc_fw_ver,
        fwd_dist_str,
        pitch_str,
        imu_obj_str,
        tof_status,
        imu_status,
        snap->imu_calibrated ? "true" : "false",
        snap->camera_ready ? "valid" : "unavailable",
        snap->vl53l5cx_ready ? "valid" : "unavailable",
        snap->wm8960_ready ? "valid" : "unavailable",
        snap->camera_ready ? "true" : "false",
        snap->forward_tof_ready ? "true" : "false",
        snap->imu_ready ? "true" : "false",
        (snap->audio_output_ready || snap->wm8960_ready) ? "true" : "false",
        snap->vl53l5cx_ready ? "true" : "false"
    );

    if (written < 0 || (size_t)written >= out_buf_size) {
        return -1;
    }
    return written;
}

#ifdef ESP_PLATFORM

#include "sentra_nvs_config.h"
#include "wifi_transport.h"
#include "mpu6050.h"
#include "vl53l5cx_optional.h"
#include "esp_http_client.h"
#ifdef CONFIG_MBEDTLS_CERTIFICATE_BUNDLE
#include "esp_crt_bundle.h"
#endif
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char *TAG = "SENTRA_TELEMETRY";
static SemaphoreHandle_t s_telem_mutex = NULL;
static bool s_camera_ready = false;
static bool s_imu_ready = false;
static bool s_forward_tof_ready = false;
static bool s_wm8960_ready = false;
static bool s_audio_output_ready = false;
static bool s_vl53l5cx_ready = false;
static vl53l0x_reading_t s_latest_tof = {0};
static int64_t s_latest_tof_ms = 0;
static sentra_obstacle_level_t s_obstacle_level = SENTRA_OBSTACLE_UNKNOWN;
static uint32_t s_sequence = 1;

void sentra_telemetry_init_sync(void) {
    if (!s_telem_mutex) {
        s_telem_mutex = xSemaphoreCreateMutex();
    }
}

static void lock_state(void) {
    if (s_telem_mutex) xSemaphoreTake(s_telem_mutex, portMAX_DELAY);
}

static void unlock_state(void) {
    if (s_telem_mutex) xSemaphoreGive(s_telem_mutex);
}

void sentra_telemetry_set_camera_initialized(bool value) {
    lock_state(); s_camera_ready = value; unlock_state();
}
void sentra_telemetry_set_imu_initialized(bool value) {
    lock_state(); s_imu_ready = value; unlock_state();
}
void sentra_telemetry_set_forward_tof_initialized(bool value) {
    lock_state(); s_forward_tof_ready = value; unlock_state();
}
void sentra_telemetry_set_wm8960_initialized(bool value) {
    lock_state(); s_wm8960_ready = value; unlock_state();
}
void sentra_telemetry_set_audio_output_initialized(bool value) {
    lock_state(); s_audio_output_ready = value; unlock_state();
}
void sentra_telemetry_set_vl53l5cx_initialized(bool value) {
    lock_state(); s_vl53l5cx_ready = value; unlock_state();
}

void sentra_telemetry_update_forward_tof(const vl53l0x_reading_t *reading, sentra_obstacle_level_t obstacle_level) {
    lock_state();
    if (reading) {
        memcpy(&s_latest_tof, reading, sizeof(s_latest_tof));
        s_latest_tof_ms = reading->timestamp_ms > 0 ? reading->timestamp_ms : (esp_timer_get_time() / 1000);
    }
    s_obstacle_level = obstacle_level;
    unlock_state();
}

static esp_err_t post_telemetry(void) {
    sentra_runtime_config_t cfg = {0};
    sentra_nvs_config_get(&cfg);
    if (!sentra_telemetry_can_upload(wifi_transport_is_connected(), cfg.server_url, cfg.device_token)) {
        return ESP_ERR_INVALID_STATE;
    }

    int64_t now_ms = esp_timer_get_time() / 1000;
    sentra_telemetry_snapshot_t snap = {0};

    lock_state();
    snap.device_id = cfg.device_id;
    snap.firmware_version = SENTRA_FIRMWARE_VERSION;
    snap.sequence = s_sequence++;
    snap.uptime_ms = now_ms;
    snap.camera_ready = s_camera_ready;
    snap.imu_ready = s_imu_ready;
    snap.forward_tof_ready = s_forward_tof_ready;
    snap.wm8960_ready = s_wm8960_ready;
    snap.audio_output_ready = s_audio_output_ready;
    snap.vl53l5cx_ready = s_vl53l5cx_ready;
    snap.tof_fresh = s_latest_tof_ms > 0 && ((now_ms - s_latest_tof_ms) <= 5000);
    snap.forward_reading = s_latest_tof;
    snap.obstacle_level = s_obstacle_level;
    unlock_state();

    if (snap.imu_ready) {
        snap.imu_valid = (sentra_mpu6050_read(I2C_NUM_0, &snap.imu_sample) == ESP_OK && snap.imu_sample.valid);
    }
    snap.imu_calibrated = sentra_mpu6050_is_calibrated();

    char json_buf[1280];
    int json_len = sentra_telemetry_build_json(&snap, json_buf, sizeof(json_buf));
    if (json_len <= 0) return ESP_ERR_NO_MEM;

    char url[256];
    int len = snprintf(url, sizeof(url), "%s/api/device/telemetry", cfg.server_url);
    if (len < 0 || len >= (int)sizeof(url)) {
        return ESP_ERR_INVALID_SIZE;
    }

    esp_http_client_config_t http_cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 6000,
    };
#ifdef CONFIG_MBEDTLS_CERTIFICATE_BUNDLE
    if (strncmp(url, "https://", 8) == 0) {
        http_cfg.crt_bundle_attach = esp_crt_bundle_attach;
    }
#endif
    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    if (!client) {
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Token", cfg.device_token);
    esp_http_client_set_post_field(client, json_buf, (size_t)json_len);

    esp_err_t result = esp_http_client_perform(client);
    if (result == ESP_OK && esp_http_client_get_status_code(client) != 200) {
        ESP_LOGW(TAG, "Device telemetry HTTP %d; check registration and token",
                 esp_http_client_get_status_code(client));
        result = ESP_FAIL;
    }
    esp_http_client_cleanup(client);
    return result;
}

void sentra_telemetry_task(void *argument) {
    (void)argument;
    ESP_LOGI(TAG, "Telemetry task active (single-forward VL53L0X=%s, MPU6050=%s, OV2640=%s, WM8960=%s).",
             s_forward_tof_ready ? "yes" : "no",
             s_imu_ready ? "yes" : "no",
             s_camera_ready ? "yes" : "no",
             s_wm8960_ready ? "yes" : "no");

    for (;;) {
        sentra_runtime_config_t cfg = {0};
        sentra_nvs_config_get(&cfg);
        uint32_t delay_ms = cfg.telemetry_interval_ms >= 500 ? cfg.telemetry_interval_ms : 2000;

        if (wifi_transport_is_connected()) {
            esp_err_t result = post_telemetry();
            if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) {
                ESP_LOGW(TAG, "Device heartbeat failed: %s", esp_err_to_name(result));
            }
        }
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
    }
}

#endif /* ESP_PLATFORM */
