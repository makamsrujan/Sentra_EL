/**
 * @file sentra_config.h
 * @brief SENTRA Firmware Configuration, Capability Flags, and Protocol Constants
 *
 * Target: ESP32-S3 N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM)
 */

#ifndef SENTRA_CONFIG_H
#define SENTRA_CONFIG_H

#include <stdint.h>
#include <stdbool.h>
#include "board_profile.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* 1. IDENTIFIERS & NETWORK DEFAULTS (OVERRIDABLE VIA NVS AT RUNTIME)        */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_FIRMWARE_VERSION
#define SENTRA_FIRMWARE_VERSION       CONFIG_SENTRA_FIRMWARE_VERSION
#else
#define SENTRA_FIRMWARE_VERSION       "1.1.0-prehw"
#endif

#ifdef CONFIG_SENTRA_DEVICE_ID
#define SENTRA_DEVICE_ID              CONFIG_SENTRA_DEVICE_ID
#else
#define SENTRA_DEVICE_ID              "ESP32-S3-SENTRA-001"
#endif

#ifdef CONFIG_SENTRA_BACKEND_URL
#define SENTRA_DEFAULT_SERVER_URL     CONFIG_SENTRA_BACKEND_URL
#else
#define SENTRA_DEFAULT_SERVER_URL     ""
#endif

#ifdef CONFIG_SENTRA_DEVICE_TOKEN
#define SENTRA_DEFAULT_DEVICE_TOKEN   CONFIG_SENTRA_DEVICE_TOKEN
#else
#define SENTRA_DEFAULT_DEVICE_TOKEN   ""
#endif

#ifdef CONFIG_SENTRA_WIFI_SSID
#define SENTRA_WIFI_SSID              CONFIG_SENTRA_WIFI_SSID
#else
#define SENTRA_WIFI_SSID              ""
#endif

#ifdef CONFIG_SENTRA_WIFI_PASSWORD
#define SENTRA_WIFI_PASS              CONFIG_SENTRA_WIFI_PASSWORD
#else
#define SENTRA_WIFI_PASS              ""
#endif

/* ========================================================================= */
/* 2. PIN & INTERVAL MAPPINGS (DERIVED FROM BOARD_PROFILE + KCONFIG)         */
/* ========================================================================= */
#define SENTRA_PIN_I2C_SDA            BOARD_PIN_I2C_SDA
#define SENTRA_PIN_I2C_SCL            BOARD_PIN_I2C_SCL
#define SENTRA_I2C_FREQ_HZ            BOARD_I2C_FREQUENCY_HZ
#define SENTRA_PIN_TOF_FWD_XSHUT      BOARD_PIN_VL53L0X_FWD_XSHUT
#define SENTRA_VL53L0X_I2C_ADDR       BOARD_ADDR_VL53L0X_FWD

#define SENTRA_PIN_I2S_BCLK           BOARD_PIN_I2S_BCLK
#define SENTRA_PIN_I2S_WS             BOARD_PIN_I2S_WS
#define SENTRA_PIN_I2S_DOUT           BOARD_PIN_I2S_DOUT
#define SENTRA_PIN_I2S_DIN            BOARD_PIN_I2S_DIN
#define SENTRA_PIN_I2S_MCLK           BOARD_PIN_I2S_MCLK
#define SENTRA_PIN_ACTION_BUTTON      BOARD_PIN_PTT_BUTTON

#ifdef CONFIG_SENTRA_TOF_SAMPLE_INTERVAL_MS
#define SENTRA_TOF_SAMPLE_INTERVAL_MS CONFIG_SENTRA_TOF_SAMPLE_INTERVAL_MS
#else
#define SENTRA_TOF_SAMPLE_INTERVAL_MS 250
#endif

#ifdef CONFIG_SENTRA_IMU_SAMPLE_INTERVAL_MS
#define SENTRA_IMU_SAMPLE_INTERVAL_MS CONFIG_SENTRA_IMU_SAMPLE_INTERVAL_MS
#else
#define SENTRA_IMU_SAMPLE_INTERVAL_MS 200
#endif

#ifdef CONFIG_SENTRA_TELEMETRY_INTERVAL_MS
#define SENTRA_TELEMETRY_INTERVAL_MS  CONFIG_SENTRA_TELEMETRY_INTERVAL_MS
#else
#define SENTRA_TELEMETRY_INTERVAL_MS  2000
#endif

#ifdef CONFIG_SENTRA_FRAME_UPLOAD_INTERVAL_MS
#define SENTRA_FRAME_UPLOAD_INTERVAL_MS CONFIG_SENTRA_FRAME_UPLOAD_INTERVAL_MS
#else
#define SENTRA_FRAME_UPLOAD_INTERVAL_MS 1200
#endif

/* ========================================================================= */
/* 3. AUDIO PARAMETERS & BUFFER LIMITS (WHEN OPTIONAL WM8960 ENABLED)        */
/* ========================================================================= */
#define SENTRA_AUDIO_REC_SAMPLE_RATE  16000
#define SENTRA_AUDIO_PLAY_SAMPLE_RATE 24000
#define SENTRA_AUDIO_CHANNELS         1
#define SENTRA_AUDIO_BITS_PER_SAMPLE  16
#define SENTRA_AUDIO_MAX_RECORD_SEC   8
#define SENTRA_AUDIO_REC_BUFFER_SIZE  (SENTRA_AUDIO_REC_SAMPLE_RATE * 2 * SENTRA_AUDIO_MAX_RECORD_SEC)
#define SENTRA_AUDIO_WAV_HEADER_SIZE  44

/* ========================================================================= */
/* 4. EXPERIMENTAL SENSOR THRESHOLDS (SINGLE FORWARD VL53L0X)                */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PROXIMITY_CAUTION_CM
#define SENTRA_HAZARD_CAUTION_CM      CONFIG_SENTRA_PROXIMITY_CAUTION_CM
#else
#define SENTRA_HAZARD_CAUTION_CM      100
#endif

#ifdef CONFIG_SENTRA_PROXIMITY_CRITICAL_CM
#define SENTRA_HAZARD_OBSTACLE_CM     CONFIG_SENTRA_PROXIMITY_CRITICAL_CM
#else
#define SENTRA_HAZARD_OBSTACLE_CM     45
#endif

/* ========================================================================= */
/* 5. AUDIO STATE MACHINE DEFINITION                                         */
/* ========================================================================= */
typedef enum {
    SENTRA_AUDIO_STATE_STANDBY = 0,
    SENTRA_AUDIO_STATE_RECORDING,
    SENTRA_AUDIO_STATE_TRANSCRIBING,
    SENTRA_AUDIO_STATE_REASONING,
    SENTRA_AUDIO_STATE_SPEECH_GENERATION,
    SENTRA_AUDIO_STATE_PLAYBACK,
    SENTRA_AUDIO_STATE_ERROR,
    SENTRA_AUDIO_STATE_CANCELLED,
    SENTRA_AUDIO_STATE_DISCONNECTED
} sentra_audio_state_t;

const char* sentra_audio_state_to_string(sentra_audio_state_t state);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_CONFIG_H */
