/* Uses the existing telemetry route as a heartbeat. Never invent sensor data. */
#include "device_telemetry.h"
#include "sentra_config.h"
#include "wifi_transport.h"
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
static uint32_t s_sequence = 1;
void sentra_telemetry_set_camera_initialized(bool value) { s_camera_ready = value; }

static esp_err_t post_telemetry(void) {
    if (!wifi_transport_is_connected()) return ESP_ERR_INVALID_STATE;
    if (SENTRA_DEFAULT_DEVICE_TOKEN[0] == 0 || SENTRA_DEFAULT_SERVER_URL[0] == 0)
        return ESP_ERR_INVALID_STATE;

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;
    cJSON_AddNumberToObject(root, "schemaVersion", 1);
    cJSON_AddStringToObject(root, "deviceId", SENTRA_DEVICE_ID);
    cJSON_AddNumberToObject(root, "sequence", s_sequence++);
    cJSON_AddNumberToObject(root, "uptimeMs", (double)(esp_timer_get_time() / 1000));
    cJSON_AddNullToObject(root, "batteryPercent");
    cJSON_AddNullToObject(root, "batteryCharging");
    cJSON_AddNullToObject(root, "earphoneConnected");
    cJSON_AddNullToObject(root, "audioVolume");

    cJSON *sensors = cJSON_AddObjectToObject(root, "sensors");
    if (sensors) {
        cJSON_AddNullToObject(sensors, "forwardDistanceCm");
        cJSON_AddNullToObject(sensors, "downwardDistanceMm");
        cJSON_AddNullToObject(sensors, "headPitchDeg");
        cJSON_AddNullToObject(sensors, "imu");
    }

    cJSON *caps = cJSON_AddObjectToObject(root, "capabilities");
    if (caps) {
        cJSON_AddBoolToObject(caps, "camera", s_camera_ready);
        cJSON_AddBoolToObject(caps, "forwardToF", false);
        cJSON_AddBoolToObject(caps, "downwardToF", false);
        cJSON_AddBoolToObject(caps, "imu", false);
        cJSON_AddBoolToObject(caps, "audioOutput", false);
    }
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!json) return ESP_ERR_NO_MEM;

    char url[256];
    int len = snprintf(url, sizeof(url), "%s/api/device/telemetry", SENTRA_DEFAULT_SERVER_URL);
    if (len < 0 || len >= (int)sizeof(url)) { cJSON_free(json); return ESP_ERR_INVALID_SIZE; }
    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 6000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) { cJSON_free(json); return ESP_ERR_NO_MEM; }
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Token", SENTRA_DEFAULT_DEVICE_TOKEN);
    esp_http_client_set_post_field(client, json, strlen(json));
    esp_err_t result = esp_http_client_perform(client);
    if (result == ESP_OK && esp_http_client_get_status_code(client) != 200) {
        ESP_LOGW(TAG, "Device status HTTP %d; check registration and token",
                 esp_http_client_get_status_code(client));
        result = ESP_FAIL;
    }
    esp_http_client_cleanup(client);
    cJSON_free(json);
    return result;
}

void sentra_telemetry_task(void *argument) {
    (void)argument;
    ESP_LOGW(TAG, "Unimplemented ToF/IMU/battery values remain null, capabilities remain false");
    for (;;) {
        if (wifi_transport_is_connected()) {
            esp_err_t result = post_telemetry();
            if (result != ESP_OK) ESP_LOGW(TAG, "Device heartbeat failed: %s", esp_err_to_name(result));
        }
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}
