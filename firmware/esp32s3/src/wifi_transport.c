/**
 * @file wifi_transport.c
 * @brief ESP-IDF Wi-Fi Station Transport Implementation
 */

#include "wifi_transport.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/timers.h"
#include <string.h>

static const char *TAG = "WIFI_TRANSPORT";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t s_wifi_event_group = NULL;
static esp_netif_t *s_sta_netif = NULL;
static volatile wifi_transport_state_t s_state = WIFI_TRANSPORT_DISCONNECTED;
static char s_assigned_ip[32] = {0};
static bool s_credentials_configured = false;

/* Exponential Backoff Parameters */
static uint32_t s_backoff_delay_ms = 1000;
#define BACKOFF_MIN_DELAY_MS 1000
#define BACKOFF_MAX_DELAY_MS 30000
static TimerHandle_t s_reconnect_timer = NULL;

static void reconnect_timer_callback(TimerHandle_t xTimer) {
    ESP_LOGI(TAG, "Reconnecting to Wi-Fi (backoff delay: %u ms)...", (unsigned)s_backoff_delay_ms);
    esp_wifi_connect();
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG, "Wi-Fi Station started, connecting...");
        s_state = WIFI_TRANSPORT_CONNECTING;
        if (s_credentials_configured) esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_state = WIFI_TRANSPORT_DISCONNECTED;
        memset(s_assigned_ip, 0, sizeof(s_assigned_ip));
        if (s_wifi_event_group) {
            xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }

        // Apply exponential backoff before reconnecting
        ESP_LOGW(TAG, "Wi-Fi disconnected. Next reconnect attempt in %u ms.", (unsigned)s_backoff_delay_ms);
        if (s_reconnect_timer) {
            xTimerChangePeriod(s_reconnect_timer, pdMS_TO_TICKS(s_backoff_delay_ms), 0);
            xTimerStart(s_reconnect_timer, 0);
        } else {
            esp_wifi_connect();
        }

        s_backoff_delay_ms = (s_backoff_delay_ms * 2 > BACKOFF_MAX_DELAY_MS)
                                 ? BACKOFF_MAX_DELAY_MS
                                 : s_backoff_delay_ms * 2;
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        esp_ip4addr_ntoa(&event->ip_info.ip, s_assigned_ip, sizeof(s_assigned_ip));
        ESP_LOGI(TAG, "Wi-Fi Connected! Assigned IP: %s", s_assigned_ip);

        s_state = WIFI_TRANSPORT_CONNECTED;
        s_backoff_delay_ms = BACKOFF_MIN_DELAY_MS; // Reset backoff on success

        if (s_reconnect_timer) {
            xTimerStop(s_reconnect_timer, 0);
        }
        if (s_wifi_event_group) {
            xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }
    }
}

esp_err_t wifi_transport_init(void) {
    if (s_wifi_event_group != NULL) return ESP_OK; // Already initialized

    s_wifi_event_group = xEventGroupCreate();
    s_reconnect_timer = xTimerCreate("wifi_rec", pdMS_TO_TICKS(1000), pdFALSE, NULL, reconnect_timer_callback);

    esp_err_t ret = esp_netif_init();
    if (ret != ESP_OK) return ret;

    ret = esp_event_loop_create_default();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) return ret;

    s_sta_netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ret = esp_wifi_init(&cfg);
    if (ret != ESP_OK) return ret;

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip);

    ret = esp_wifi_set_mode(WIFI_MODE_STA);
    if (ret != ESP_OK) return ret;

    return esp_wifi_start();
}

esp_err_t wifi_transport_connect(const char *ssid, const char *password) {
    if (!ssid || strlen(ssid) == 0) return ESP_ERR_INVALID_ARG;

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
    if (password) {
        strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password) - 1);
    }
    wifi_config.sta.threshold.authmode = password && strlen(password) > 0 ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    wifi_config.sta.pmf_cfg.capable = true;
    wifi_config.sta.pmf_cfg.required = false;

    esp_err_t ret = esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    if (ret != ESP_OK) return ret;

    s_credentials_configured = true;
    s_state = WIFI_TRANSPORT_CONNECTING;
    s_backoff_delay_ms = BACKOFF_MIN_DELAY_MS;
    return esp_wifi_connect();
}

bool wifi_transport_is_connected(void) {
    return s_state == WIFI_TRANSPORT_CONNECTED;
}

bool wifi_transport_wait_connected(uint32_t timeout_ms) {
    if (!s_wifi_event_group) return false;
    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(timeout_ms)
    );
    return (bits & WIFI_CONNECTED_BIT) != 0;
}

esp_err_t wifi_transport_get_ip(char *out_ip_str, size_t max_len) {
    if (!out_ip_str || max_len == 0) return ESP_ERR_INVALID_ARG;
    if (s_state != WIFI_TRANSPORT_CONNECTED || strlen(s_assigned_ip) == 0) {
        return ESP_ERR_INVALID_STATE;
    }
    strncpy(out_ip_str, s_assigned_ip, max_len - 1);
    out_ip_str[max_len - 1] = '\0';
    return ESP_OK;
}

int8_t wifi_transport_get_rssi(void) {
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
        return ap_info.rssi;
    }
    return -127;
}

wifi_transport_state_t wifi_transport_get_state(void) {
    return s_state;
}
