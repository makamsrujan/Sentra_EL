/**
 * @file local_alerts.h
 * @brief Autonomous Offline Acoustic Safety Alerts for Visually Impaired Wearable
 *
 * Generates immediate localized audio warning tones through WM8960 DAC
 * directly from sensor interrupts without requiring cloud or Wi-Fi connectivity.
 */

#ifndef SENTRA_LOCAL_ALERTS_H
#define SENTRA_LOCAL_ALERTS_H

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SENTRA_ALERT_OBSTACLE_CLOSE = 0,  /* Rapid high-pitch double chirp (880Hz / 1175Hz) */
    SENTRA_ALERT_CLIFF_DROPOFF,        /* Descending caution tone (500Hz -> 300Hz) */
    SENTRA_ALERT_DISCONNECTED,         /* Low warble tone indicating loss of network connection */
    SENTRA_ALERT_MIC_ACTIVATED,        /* Short gentle chime indicating mic is recording */
    SENTRA_ALERT_MIC_STOPPED           /* Low click indicating mic closed */
} sentra_local_alert_type_t;

/**
 * @brief Play an autonomous offline safety alert tone.
 *
 * Immediately aborts any non-critical conversational speech and
 * outputs modest-volume acoustic warning directly to headphone DAC.
 */
esp_err_t local_alerts_play(sentra_local_alert_type_t alert_type);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_LOCAL_ALERTS_H */
