/**
 * @file local_alerts.h
 * @brief Optional Autonomous Acoustic Alert Delivery for SENTRA Wearable
 *
 * Strictly gated on BOTH build configuration (CONFIG_SENTRA_ENABLE_WM8960)
 * AND confirmed runtime WM8960 + I2S initialization. When audio hardware is
 * absent or disabled, alert playback gracefully degrades to silent telemetry
 * without blocking or failing sensor loops.
 */

#ifndef SENTRA_LOCAL_ALERTS_H
#define SENTRA_LOCAL_ALERTS_H

#include <stdint.h>
#include <stdbool.h>

#ifdef ESP_PLATFORM
#include "esp_err.h"
#else
typedef int esp_err_t;
#ifndef ESP_OK
#define ESP_OK 0
#define ESP_ERR_NOT_SUPPORTED 0x106
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SENTRA_ALERT_OBSTACLE_CLOSE = 0,  /* Rapid high-pitch double chirp (880Hz / 1175Hz) */
    SENTRA_ALERT_CLIFF_DROPOFF,       /* Reserved ONLY for optional downward depth sensor; never call from forward VL53L0X */
    SENTRA_ALERT_DISCONNECTED,        /* Low tone indicating loss of network connection */
    SENTRA_ALERT_MIC_ACTIVATED,       /* Short gentle chime indicating mic is recording */
    SENTRA_ALERT_MIC_STOPPED          /* Low click indicating mic closed */
} sentra_local_alert_type_t;

void local_alerts_set_audio_ready(bool ready);
bool local_alerts_is_available(void);
esp_err_t local_alerts_play(sentra_local_alert_type_t alert_type);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_LOCAL_ALERTS_H */
