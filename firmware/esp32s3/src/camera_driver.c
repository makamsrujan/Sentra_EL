/**
 * @file camera_driver.c
 * @brief ESP32-S3 OV2640 Parallel DVP Camera Driver with PSRAM fallback & recovery.
 */

#include "camera_driver.h"
#include "board_profile.h"
#include "esp_log.h"
#include "esp_camera.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "esp_psram.h"
#include <string.h>
#include <stdio.h>

static const char *TAG = "CAMERA_DRIVER";
static camera_fb_t *s_active_fb = NULL;
static bool s_cam_initialized = false;
static bool s_psram_active = false;
static uint8_t s_consecutive_errors = 0;

static uint8_t clamp_quality(uint8_t q) {
    if (q < 4) return 4;
    if (q > 63) return 63;
    return q;
}

esp_err_t camera_driver_init(void) {
    if (s_cam_initialized) return ESP_OK;

    s_psram_active = esp_psram_is_initialized();
    ESP_LOGI(TAG, "Initializing OV2640 camera on parallel DVP bus (PSRAM=%s)...",
             s_psram_active ? "enabled" : "unavailable-DRAM-fallback");

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
#ifdef CONFIG_SENTRA_CAM_SHARE_I2C_PORT
    /* Prevent duplicate I2C driver installation when sharing port 0 with VL53L0X/MPU6050. */
    config.pin_sccb_sda = -1;
    config.pin_sccb_scl = BOARD_PIN_I2C_SCL;
    config.sccb_i2c_port = 0;
#else
    config.pin_sccb_sda = BOARD_PIN_I2C_SDA;
    config.pin_sccb_scl = BOARD_PIN_I2C_SCL;
#endif
    config.pin_pwdn = BOARD_PIN_CAM_PWDN;
    config.pin_reset = BOARD_PIN_CAM_RESET;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;

#ifdef CONFIG_SENTRA_CAM_DEFAULT_QUALITY
    config.jpeg_quality = clamp_quality(CONFIG_SENTRA_CAM_DEFAULT_QUALITY);
#else
    config.jpeg_quality = 12;
#endif

    if (s_psram_active) {
        config.frame_size = FRAMESIZE_QVGA;
        config.fb_count = 2;
        config.fb_location = CAMERA_FB_IN_PSRAM;
        config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
        config.frame_size = FRAMESIZE_QVGA;
        config.fb_count = 1;
        config.fb_location = CAMERA_FB_IN_DRAM;
        config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    }

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OV2640 Camera init failed (0x%x: %s)", err, esp_err_to_name(err));
        return err;
    }

    sensor_t *s = esp_camera_sensor_get();
    if (s != NULL) {
        s->set_vflip(s, 0);
        s->set_hmirror(s, 0);
    }

    s_cam_initialized = true;
    s_consecutive_errors = 0;
    ESP_LOGI(TAG, "OV2640 camera initialized (QVGA JPEG, q=%d, fb_count=%d).",
             config.jpeg_quality, config.fb_count);
    return ESP_OK;
}

esp_err_t camera_driver_deinit(void) {
    camera_driver_release(NULL);
    if (!s_cam_initialized) return ESP_OK;
    s_cam_initialized = false;
    return esp_camera_deinit();
}

bool camera_driver_is_psram_active(void) {
    return s_psram_active;
}

esp_err_t camera_driver_set_quality(uint8_t jpeg_quality) {
    if (!s_cam_initialized) return ESP_ERR_INVALID_STATE;
    sensor_t *s = esp_camera_sensor_get();
    if (!s || !s->set_quality) return ESP_ERR_NOT_SUPPORTED;
    int rc = s->set_quality(s, clamp_quality(jpeg_quality));
    return rc == 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t camera_driver_set_framesize(sentra_cam_framesize_t size) {
    if (!s_cam_initialized) return ESP_ERR_INVALID_STATE;
    sensor_t *s = esp_camera_sensor_get();
    if (!s || !s->set_framesize) return ESP_ERR_NOT_SUPPORTED;
    framesize_t target = FRAMESIZE_QVGA;
    if (s_psram_active) {
        if (size == SENTRA_CAM_SIZE_VGA) target = FRAMESIZE_VGA;
        else if (size == SENTRA_CAM_SIZE_SVGA) target = FRAMESIZE_SVGA;
    }
    int rc = s->set_framesize(s, target);
    return rc == 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t camera_driver_capture(sentra_camera_frame_t *out_frame) {
    if (!out_frame) return ESP_ERR_INVALID_ARG;
    if (!s_cam_initialized) return ESP_ERR_INVALID_STATE;

    /* Always release any leaked active framebuffer before grabbing a fresh one. */
    if (s_active_fb != NULL) {
        esp_camera_fb_return(s_active_fb);
        s_active_fb = NULL;
    }

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb || !fb->buf || fb->len < 4) {
        if (fb) esp_camera_fb_return(fb);
        s_consecutive_errors++;
        ESP_LOGE(TAG, "Camera frame capture failed (streak=%u).", (unsigned)s_consecutive_errors);
        if (s_consecutive_errors >= 5) {
            ESP_LOGW(TAG, "Reinitializing OV2640 driver after repeated capture failures...");
            camera_driver_deinit();
            camera_driver_init();
        }
        return ESP_FAIL;
    }

    /* Sanity-check JPEG SOI marker FF D8 before accepting frame */
    if (fb->buf[0] != 0xFF || fb->buf[1] != 0xD8) {
        ESP_LOGW(TAG, "Discarding corrupt non-JPEG frame buffer.");
        esp_camera_fb_return(fb);
        s_consecutive_errors++;
        return ESP_ERR_INVALID_RESPONSE;
    }

    s_consecutive_errors = 0;
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
    if (!frame || !frame->buf || frame->len == 0 || !server_url || server_url[0] == '\0' || !device_id) {
        return ESP_ERR_INVALID_ARG;
    }

    char url[256];
    int n = snprintf(url, sizeof(url), "%s/api/device/frame", server_url);
    if (n < 0 || n >= (int)sizeof(url)) {
        return ESP_ERR_INVALID_SIZE;
    }

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
