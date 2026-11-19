/* Uses POST /api/device/telemetry as heartbeat and sensor stream. Never invents data. */
#include "device_telemetry.h"
#include "sentra_config.h"
#include "sentra_nvs_config.h"
#include "wifi_transport.h"
#include "mpu6050.h"
#include "vl53l5cx_optional.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cJSON.h"
#include <stdint.h>
#include <string.h>
#include <stdio.h>

static const char *TAG = "SENTRA_TELEMETRY";
static bool s_camera_ready = false;
static bool s_imu_ready = false;
static bool s_forward_tof_ready = false;
static bool s_wm8960_ready = false;
static bool s_vl53l5cx_ready = false;
static vl53l0x_reading_t s_latest_tof = {0};
static int64_t s_latest_tof_ms = 0;
static uint32_t s_sequence = 1;

void sentra_telemetry_set_camera_initialized(bool value) { s_camera_ready = value; }
void sentra_telemetry_set_imu_initialized(bool value) { s_imu_ready = value; }
void sentra_telemetry_set_forward_tof_initialized(bool value) { s_forward_tof_ready = value; }
void sentra_telemetry_set_wm8960_initialized(bool value) { s_wm8960_ready = value; }
void sentra_telemetry_set_vl53l5cx_initialized(bool value) { s_vl53l5cx_ready = value; }

void sentra_telemetry_update_forward_tof(const vl53l0x_reading_t *reading) {
    if (reading) {
        memcpy(&s_latest_tof, reading, sizeof(s_latest_tof));
        s_latest_tof_ms = esp_timer_get_time() / 1000;
    }
}

static esp_err_t post_telemetry(void) {
    if (!wifi_transport_is_connected()) return ESP_ERR_INVALID_STATE;

    sentra_runtime_config_t cfg = {0};
    sentra_nvs_config_get(&cfg);
    if (cfg.device_token[0] == '\0' || cfg.server_url[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    int64_t now_ms = esp_timer_get_time() / 1000;

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;
    cJSON_AddNumberToObject(root, "schemaVersion", 1);
    cJSON_AddStringToObject(root, "deviceId", cfg.device_id);
    cJSON_AddNumberToObject(root, "sequence", s_sequence++);
    cJSON_AddNumberToObject(root, "uptimeMs", (double)now_ms);
    cJSON_AddStringToObject(root, "firmwareVersion", SENTRA_FIRMWARE_VERSION);
    cJSON_AddNullToObject(root, "batteryPercent");
    cJSON_AddNullToObject(root, "batteryCharging");
    cJSON_AddNullToObject(root, "earphoneConnected");
    cJSON_AddNullToObject(root, "audioVolume");

    sentra_mpu_sample_t sample = {0};
    const bool imu_valid = s_imu_ready && sentra_mpu6050_read(I2C_NUM_0, &sample) == ESP_OK && sample.valid;

    const bool tof_fresh = (now_ms - s_latest_tof_ms) <= 5000;
    const bool tof_valid = s_forward_tof_ready && tof_fresh && s_latest_tof.valid;

    cJSON *sensors = cJSON_AddObjectToObject(root, "sensors");
    if (sensors) {
        if (tof_valid) {
            cJSON_AddNumberToObject(sensors, "forwardDistanceCm", (double)s_latest_tof.distance_cm);
        } else {
            cJSON_AddNullToObject(sensors, "forwardDistanceCm");
        }
        /* Downward VL53L0X is NOT installed on the baseline single-ToF headband. */
        cJSON_AddNullToObject(sensors, "downwardDistanceMm");

        if (imu_valid) {
            cJSON_AddNumberToObject(sensors, "headPitchDeg", sample.pitch_deg);
            cJSON *imu = cJSON_AddObjectToObject(sensors, "imu");
            if (imu) {
                cJSON_AddNumberToObject(imu, "ax", sample.ax);
                cJSON_AddNumberToObject(imu, "ay", sample.ay);
                cJSON_AddNumberToObject(imu, "az", sample.az);
                cJSON_AddNumberToObject(imu, "gx", sample.gx);
                cJSON_AddNumberToObject(imu, "gy", sample.gy);
                cJSON_AddNumberToObject(imu, "gz", sample.gz);
                /* Strictly null: 6-axis MPU6050 has no magnetometer for absolute heading. */
                cJSON_AddNullToObject(imu, "heading");
                cJSON_AddBoolToObject(imu, "calibrated", sample.calibrated);
                cJSON_AddNumberToObject(imu, "motionMagnitude", sample.motion_magnitude);
            }
        } else {
            cJSON_AddNullToObject(sensors, "headPitchDeg");
            cJSON_AddNullToObject(sensors, "imu");
        }
        cJSON_AddNullToObject(sensors, "vl53l5cx");
    }

    cJSON *health = cJSON_AddObjectToObject(root, "sensorHealth");
    if (health) {
        const char *tof_status = !s_forward_tof_ready ? "unavailable" : (!tof_fresh ? "stale" : (tof_valid ? "valid" : "invalid"));
        cJSON_AddStringToObject(health, "forwardToF", tof_status);
        cJSON_AddStringToObject(health, "downwardToF", "unavailable");
        cJSON_AddStringToObject(health, "imu", !s_imu_ready ? "unavailable" : (imu_valid ? "valid" : "invalid"));
        cJSON_AddBoolToObject(health, "imuCalibrated", sentra_mpu6050_is_calibrated());
        cJSON_AddStringToObject(health, "camera", s_camera_ready ? "valid" : "unavailable");
        cJSON_AddStringToObject(health, "vl53l5cx", s_vl53l5cx_ready ? "valid" : "unavailable");
        cJSON_AddStringToObject(health, "wm8960", s_wm8960_ready ? "valid" : "unavailable");
    }

    cJSON *caps = cJSON_AddObjectToObject(root, "capabilities");
    if (caps) {
        cJSON_AddBoolToObject(caps, "camera", s_camera_ready);
        cJSON_AddBoolToObject(caps, "forwardToF", s_forward_tof_ready);
        cJSON_AddBoolToObject(caps, "downwardToF", false);
        cJSON_AddBoolToObject(caps, "imu", s_imu_ready);
        cJSON_AddBoolToObject(caps, "audioOutput", s_wm8960_ready);
        cJSON_AddBoolToObject(caps, "vl53l5cx", s_vl53l5cx_ready);
    }

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!json) return ESP_ERR_NO_MEM;

    char url[256];
    int len = snprintf(url, sizeof(url), "%s/api/device/telemetry", cfg.server_url);
    if (len < 0 || len >= (int)sizeof(url)) {
        cJSON_free(json);
        return ESP_ERR_INVALID_SIZE;
    }

    esp_http_client_config_t http_cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 6000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    if (!client) {
        cJSON_free(json);
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Token", cfg.device_token);
    esp_http_client_set_post_field(client, json, strlen(json));

    esp_err_t result = esp_http_client_perform(client);
    if (result == ESP_OK && esp_http_client_get_status_code(client) != 200) {
        ESP_LOGW(TAG, "Device telemetry HTTP %d; check registration and token",
                 esp_http_client_get_status_code(client));
        result = ESP_FAIL;
    }
    esp_http_client_cleanup(client);
    cJSON_free(json);
    return result;
}

void sentra_telemetry_task(void *argument) {
    (void)argument;
    ESP_LOGI(TAG, "Telemetry task active (single-forward VL53L0X=%s, MPU6050=%s, OV2640=%s).",
             s_forward_tof_ready ? "yes" : "no",
             s_imu_ready ? "yes" : "no",
             s_camera_ready ? "yes" : "no");

    for (;;) {
        sentra_runtime_config_t cfg = {0};
        sentra_nvs_config_get(&cfg);
        uint32_t delay_ms = cfg.telemetry_interval_ms >= 500 ? cfg.telemetry_interval_ms : 2000;

        if (wifi_transport_is_connected()) {
            esp_err_t result = post_telemetry();
            if (result != ESP_OK) {
                ESP_LOGW(TAG, "Device heartbeat failed: %s", esp_err_to_name(result));
            }
        }
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
    }
}
