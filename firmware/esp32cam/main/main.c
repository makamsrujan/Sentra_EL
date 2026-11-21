/**
 * @file main.c
 * @brief SENTRA Separate ESP32-CAM (ESP-32S AI-Thinker-compatible) JPEG Uploader.
 *
 * Uses its own registered deviceId and device token (never reuses ESP32-S3 identity).
 * Captures JPEG frames from the onboard OV2640 ribbon and uploads to POST /api/device/frame
 * with a per-boot X-Boot-Session token so camera-only reboots never stall behind stale sequences.
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_camera.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_psram.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#ifdef CONFIG_MBEDTLS_CERTIFICATE_BUNDLE
#include "esp_crt_bundle.h"
#endif

#include "ai_thinker_pins.h"
#include "cam_sender_logic.h"

static const char *TAG = "SENTRA_ESP32CAM";

#define WIFI_CONNECTED_BIT BIT0
static EventGroupHandle_t s_wifi_events = NULL;
static volatile bool s_wifi_connected = false;
static uint8_t s_wifi_retry_count = 0;
static char s_boot_session[32] = {0};

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    (void)arg;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_connected = false;
        xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT);
        uint32_t backoff = sentra_cam_retry_delay_ms(s_wifi_retry_count < 4 ? s_wifi_retry_count++ : 4);
        ESP_LOGW(TAG, "Wi-Fi disconnected; reconnecting after %u ms...", (unsigned)backoff);
        vTaskDelay(pdMS_TO_TICKS(backoff));
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)event_data;
        s_wifi_retry_count = 0;
        s_wifi_connected = true;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
        ESP_LOGI(TAG, "Wi-Fi connected, IP: " IPSTR, IP2STR(&ev->ip_info.ip));
    }
}

static esp_err_t init_wifi(const char *ssid, const char *password) {
    s_wifi_events = xEventGroupCreate();
    if (!s_wifi_events) return ESP_ERR_NO_MEM;

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_cfg = {0};
    strncpy((char *)wifi_cfg.sta.ssid, ssid, sizeof(wifi_cfg.sta.ssid) - 1);
    strncpy((char *)wifi_cfg.sta.password, password, sizeof(wifi_cfg.sta.password) - 1);
    wifi_cfg.sta.threshold.authmode = strlen(password) > 0 ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
    return ESP_OK;
}

static esp_err_t init_camera(void) {
    bool has_psram = esp_psram_is_initialized();
    ESP_LOGI(TAG, "Initializing OV2640 (AI-Thinker first-candidate profile, PSRAM=%s, XCLK=%d Hz)...",
             has_psram ? "YES" : "NO", CONFIG_SENTRA_CAM_XCLK_HZ);

#ifndef CONFIG_SENTRA_CAM_ENABLE_FLASH_LED
    gpio_config_t flash_cfg = {
        .pin_bit_mask = (1ULL << CAM_PIN_FLASH_LED),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&flash_cfg);
    gpio_set_level((gpio_num_t)CAM_PIN_FLASH_LED, 0);
#endif

    camera_config_t config = {
        .pin_pwdn = CAM_PIN_PWDN,
        .pin_reset = CAM_PIN_RESET,
        .pin_xclk = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,
        .pin_d7 = CAM_PIN_D7,
        .pin_d6 = CAM_PIN_D6,
        .pin_d5 = CAM_PIN_D5,
        .pin_d4 = CAM_PIN_D4,
        .pin_d3 = CAM_PIN_D3,
        .pin_d2 = CAM_PIN_D2,
        .pin_d1 = CAM_PIN_D1,
        .pin_d0 = CAM_PIN_D0,
        .pin_vsync = CAM_PIN_VSYNC,
        .pin_href = CAM_PIN_HREF,
        .pin_pclk = CAM_PIN_PCLK,
        .xclk_freq_hz = CONFIG_SENTRA_CAM_XCLK_HZ,
        .ledc_timer = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG,
#ifdef CONFIG_SENTRA_CAM_FRAMESIZE_VGA
        .frame_size = has_psram ? FRAMESIZE_VGA : FRAMESIZE_QVGA,
#else
        .frame_size = FRAMESIZE_QVGA,
#endif
        .jpeg_quality = CONFIG_SENTRA_CAM_JPEG_QUALITY,
        .fb_count = has_psram ? 2 : 1,
        .fb_location = has_psram ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM,
        .grab_mode = CAMERA_GRAB_LATEST,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_camera_init failed: %s (verify clone pinout & 5V power rail).", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "OV2640 initialized successfully.");
    return ESP_OK;
}

static esp_err_t upload_jpeg_with_retries(const uint8_t *buf, size_t len, uint32_t seq) {
    char url[256];
    if (sentra_cam_build_frame_url(CONFIG_SENTRA_CAM_BACKEND_URL, CONFIG_SENTRA_CAM_DEVICE_ID, url, sizeof(url)) <= 0) {
        return ESP_ERR_INVALID_ARG;
    }

    char seq_hdr[16];
    snprintf(seq_hdr, sizeof(seq_hdr), "%u", (unsigned)seq);

    const uint8_t max_retries = (uint8_t)CONFIG_SENTRA_CAM_MAX_UPLOAD_RETRIES;
    esp_err_t last_err = ESP_FAIL;

    for (uint8_t attempt = 0; attempt < max_retries; attempt++) {
        if (!s_wifi_connected) {
            return ESP_ERR_WIFI_NOT_CONNECT;
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
        if (!client) return ESP_ERR_NO_MEM;

        esp_http_client_set_header(client, "Content-Type", "image/jpeg");
        esp_http_client_set_header(client, "X-Device-Token", CONFIG_SENTRA_CAM_DEVICE_TOKEN);
        esp_http_client_set_header(client, "X-Device-Id", CONFIG_SENTRA_CAM_DEVICE_ID);
        esp_http_client_set_header(client, "X-Boot-Session", s_boot_session);
        esp_http_client_set_header(client, "X-Frame-Sequence", seq_hdr);
        esp_http_client_set_post_field(client, (const char *)buf, (int)len);

        last_err = esp_http_client_perform(client);
        int status = (last_err == ESP_OK) ? esp_http_client_get_status_code(client) : -1;
        esp_http_client_cleanup(client);

        if (last_err == ESP_OK && status >= 200 && status < 300) {
            ESP_LOGI(TAG, "Uploaded JPEG seq=%u (%u bytes, session=%s) -> HTTP %d",
                     (unsigned)seq, (unsigned)len, s_boot_session, status);
            return ESP_OK;
        }

        ESP_LOGW(TAG, "JPEG upload attempt %u/%u failed (err=%s, http=%d)",
                 (unsigned)(attempt + 1), (unsigned)max_retries, esp_err_to_name(last_err), status);
        if (status == 401 || status == 403 || status == 400) {
            return ESP_FAIL; /* Do not spin retries on auth/payload rejection */
        }
        if (attempt + 1 < max_retries) {
            vTaskDelay(pdMS_TO_TICKS(sentra_cam_retry_delay_ms(attempt)));
        }
    }
    return last_err;
}

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    sentra_cam_format_boot_session(esp_random(), esp_random(), s_boot_session, sizeof(s_boot_session));
    ESP_LOGI(TAG, "Starting SENTRA ESP32-CAM sender (deviceId=%s, bootSession=%s)",
             CONFIG_SENTRA_CAM_DEVICE_ID, s_boot_session);

    if (init_camera() != ESP_OK) {
        ESP_LOGE(TAG, "Halting upload loop: camera initialization failed.");
        return;
    }

    bool network_configured =
        strlen(CONFIG_SENTRA_CAM_WIFI_SSID) > 0 &&
        strlen(CONFIG_SENTRA_CAM_BACKEND_URL) > 0 &&
        strlen(CONFIG_SENTRA_CAM_DEVICE_TOKEN) > 0;

    if (network_configured) {
        ESP_ERROR_CHECK(init_wifi(CONFIG_SENTRA_CAM_WIFI_SSID, CONFIG_SENTRA_CAM_WIFI_PASSWORD));
    } else {
        ESP_LOGW(TAG, "Wi-Fi/backend/token unset: running local serial JPEG capture bench test only.");
    }

    uint32_t frame_seq = 1;
    for (;;) {
        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
            ESP_LOGW(TAG, "esp_camera_fb_get returned NULL");
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        bool valid_jpeg = (fb->format == PIXFORMAT_JPEG) && sentra_cam_validate_jpeg(fb->buf, fb->len);
        if (!valid_jpeg) {
            ESP_LOGW(TAG, "Captured invalid JPEG buffer (len=%u, format=%d)", (unsigned)fb->len, (int)fb->format);
        } else if (!network_configured) {
            ESP_LOGI(TAG, "[LOCAL JPEG BENCH] Valid OV2640 JPEG captured: seq=%u len=%u bytes (SOI/EOI OK)",
                     (unsigned)frame_seq++, (unsigned)fb->len);
        } else if (s_wifi_connected) {
            (void)upload_jpeg_with_retries(fb->buf, fb->len, frame_seq++);
        } else {
            ESP_LOGI(TAG, "Captured valid JPEG (%u bytes); waiting for Wi-Fi...", (unsigned)fb->len);
        }

        esp_camera_fb_return(fb);
        vTaskDelay(pdMS_TO_TICKS(CONFIG_SENTRA_CAM_FRAME_INTERVAL_MS));
    }
}
