/**
 * @file wifi_transport.h
 * @brief ESP-IDF Wi-Fi Station Transport with Bounded Exponential Backoff Reconnection
 */

#ifndef SENTRA_WIFI_TRANSPORT_H
#define SENTRA_WIFI_TRANSPORT_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    WIFI_TRANSPORT_DISCONNECTED = 0,
    WIFI_TRANSPORT_CONNECTING,
    WIFI_TRANSPORT_CONNECTED,
    WIFI_TRANSPORT_FAILED
} wifi_transport_state_t;

/**
 * @brief Initialize Wi-Fi in Station mode and register event handlers.
 */
esp_err_t wifi_transport_init(void);

/**
 * @brief Start connection to Wi-Fi access point with exponential backoff retry.
 *
 * @param ssid Wi-Fi SSID
 * @param password Wi-Fi passphrase
 * @return esp_err_t ESP_OK if connection sequence started
 */
esp_err_t wifi_transport_connect(const char *ssid, const char *password);

/**
 * @brief Check if Wi-Fi is currently connected and an IP address is assigned.
 */
bool wifi_transport_is_connected(void);

/**
 * @brief Wait synchronously for connection up to timeout_ms.
 */
bool wifi_transport_wait_connected(uint32_t timeout_ms);

/**
 * @brief Get assigned IP address string (e.g. "192.168.1.150").
 */
esp_err_t wifi_transport_get_ip(char *out_ip_str, size_t max_len);

/**
 * @brief Get current Wi-Fi RSSI in dBm.
 */
int8_t wifi_transport_get_rssi(void);

/**
 * @brief Current transport state.
 */
wifi_transport_state_t wifi_transport_get_state(void);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_WIFI_TRANSPORT_H */
