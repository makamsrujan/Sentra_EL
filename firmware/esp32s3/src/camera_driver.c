/**
 * @file camera_driver.c
 * @brief ESP32-S3 OV2640 Parallel DVP Camera Module Driver Implementation
 */

#include "camera_driver.h"
#include "board_profile.h"
#include "esp_log.h"
#include "esp_camera.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include <string.h>

static const char *TAG = "CAMERA_DRIVER";
static camera_fb_t *s_active_fb = NULL;

esp_err_t camera_driver_init(void) {
    ESP_LOGI(TAG, "Initializing OV2640 camera on parallel DVP bus...");

    camera_config_t config = {0};
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;
    config.pin_d0 = BOARD_PIN_CAM_D0;
    config.pin_d1 = BOARD_PIN_CAM_D1;
    config.pin_d2 = BOARD_PIN_CAM_D2;
    config.pin_d3 = BOARD_PIN_CAM_D3;
    config.pin_d4 = BOARD_PIN_CAM_D4;
    config.pin_d5 = BOARD_PIN_CAM_D5;
    config.pin_d6 = BOARD_PIN_CAM_D6;
    config.pin_d7 = BOARD_PIN_CAM_D7;
    config.pin_xclk = BOARD_PIN_CAM_XCLK;
    config.pin_pclk = BOARD_PIN_CAM_PCLK;
    config.pin_vsync = BOARD_PIN_CAM_VSYNC;
    config.pin_href = BOARD_PIN_CAM_HREF;
    config.pin_sccb_sda = BOARD_PIN_I2C_SDA;
    config.pin_sccb_scl = BOARD_PIN_I2C_SCL;
    config.pin_pwdn = BOARD_PIN_CAM_PWDN;
    config.pin_reset = BOARD_PIN_CAM_RESET;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;
    config.frame_size = FRAMESIZE_QVGA; // 320x240 for balanced bandwidth and assistive perception
    config.jpeg_quality = 12;            // 0-63 (lower = higher quality)
    config.fb_count = 2;                // Double buffering in PSRAM
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OV2640 Camera init failed with error 0x%x: %s", err, esp_err_to_name(err));
        return err;
    }

    sensor_t *s = esp_camera_sensor_get();
    if (s != NULL) {
        // Adjust default orientation
        s->set_vflip(s, 0);
        s->set_hmirror(s, 0);
    }

    ESP_LOGI(TAG, "OV2640 camera initialized successfully in QVGA JPEG mode.");
    return ESP_OK;
}

esp_err_t camera_driver_capture(sentra_camera_frame_t *out_frame) {
    if (!out_frame) return ESP_ERR_INVALID_ARG;

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        ESP_LOGE(TAG, "Camera frame capture failed!");
        return ESP_FAIL;
    }

    s_active_fb = fb;
    out_frame->buf = fb->buf;
    out_frame->len = fb->len;
    out_frame->width = fb->width;
    out_frame->height = fb->height;
    out_frame->timestamp_us = esp_timer_get_time();

    return ESP_OK;
}

void camera_driver_release(sentra_camera_frame_t *frame) {
    if (s_active_fb) {
        esp_camera_fb_return(s_active_fb);
        s_active_fb = NULL;
    }
    if (frame) {
        frame->buf = NULL;
        frame->len = 0;
    }
}

esp_err_t camera_driver_upload_frame(
    const sentra_camera_frame_t *frame,
    const char *server_url,
    const char *device_id,
    const char *device_token,
    uint32_t sequence
) {
    if (!frame || !frame->buf || frame->len == 0 || !server_url || !device_id) {
        return ESP_ERR_INVALID_ARG;
    }

    char url[160];
    snprintf(url, sizeof(url), "%s/api/device/frame", server_url);

    char seq_str[16];
    snprintf(seq_str, sizeof(seq_str), "%u", (unsigned)sequence);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 5000,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_FAIL;

    esp_http_client_set_header(client, "Content-Type", "image/jpeg");
    esp_http_client_set_header(client, "X-Device-Id", device_id);
    if (device_token && strlen(device_token) > 0) {
        esp_http_client_set_header(client, "X-Device-Token", device_token);
    }
    esp_http_client_set_header(client, "X-Frame-Sequence", seq_str);

    esp_http_client_set_post_field(client, (const char *)frame->buf, frame->len);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        if (status_code != 200) {
            ESP_LOGW(TAG, "Frame upload returned HTTP %d", status_code);
            err = ESP_FAIL;
        }
    } else {
        ESP_LOGE(TAG, "Frame upload failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return err;
}
