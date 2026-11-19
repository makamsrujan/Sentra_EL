/**
 * @file sentra_config.h
 * @brief SENTRA Hardware Pinout, Coexistence Map, and Codec Configuration
 *
 * Target: ESP32-S3 N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM)
 * Codec: Standalone Waveshare WM8960 Audio Board (not Raspberry Pi Audio HAT)
 * Headset: Single-ear wired TRRS headset with microphone (CTIA standard)
 */

#ifndef SENTRA_CONFIG_H
#define SENTRA_CONFIG_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* 1. HARDWARE IDENTIFIERS & NETWORK CONFIGURATION                           */
/* ========================================================================= */
#define SENTRA_DEVICE_ID              "ESP32-S3-SENTRA-001"
#define SENTRA_DEFAULT_SERVER_URL     "http://192.168.1.100:3000"
#define SENTRA_DEFAULT_DEVICE_TOKEN   "sentra-dev-key-default"
#define SENTRA_WIFI_SSID              "YOUR_WIFI_SSID"
#define SENTRA_WIFI_PASS              "YOUR_WIFI_PASSWORD"

/* ========================================================================= */
/* 2. GPIO PINOUT COEXISTENCE MATRIX                                         */
/* ========================================================================= */

/* --- Primary Shared I2C Bus --- */
/* Shared by: MPU6050 (0x68), VL53L0X #1 (0x30), VL53L0X #2 (0x31), WM8960 (0x1A) */
#define SENTRA_PIN_I2C_SDA            47
#define SENTRA_PIN_I2C_SCL            48
#define SENTRA_I2C_FREQ_HZ            400000

/* --- VL53L0X ToF Reset / XSHUT Pins --- */
#define SENTRA_PIN_TOF_FWD_XSHUT      21
#define SENTRA_PIN_TOF_DOWN_XSHUT     4

/* --- Waveshare WM8960 Audio Board I2S Bus --- */
#define SENTRA_PIN_I2S_BCLK           41  /* Bit Clock (BCLK) */
#define SENTRA_PIN_I2S_WS             42  /* Word Select / Frame Sync (LRC) */
#define SENTRA_PIN_I2S_DOUT           2   /* ESP32-S3 to WM8960 DAC (Headphone Out) */
#define SENTRA_PIN_I2S_DIN            1   /* WM8960 ADC to ESP32-S3 (Microphone In) */
#define SENTRA_PIN_I2S_MCLK           38  /* Master Clock (MCLK, 12.288 MHz or 256*fs) */

/* --- OV2640 Parallel DVP Camera Pinout --- */
#define SENTRA_PIN_CAM_D0             11
#define SENTRA_PIN_CAM_D1             9
#define SENTRA_PIN_CAM_D2             8
#define SENTRA_PIN_CAM_D3             10
#define SENTRA_PIN_CAM_D4             12
#define SENTRA_PIN_CAM_D5             18
#define SENTRA_PIN_CAM_D6             17
#define SENTRA_PIN_CAM_D7             16
#define SENTRA_PIN_CAM_XCLK           15
#define SENTRA_PIN_CAM_PCLK           13
#define SENTRA_PIN_CAM_VSYNC          6
#define SENTRA_PIN_CAM_HREF           7
#define SENTRA_PIN_CAM_SIOD           SENTRA_PIN_I2C_SDA  /* Shared or SCCB */
#define SENTRA_PIN_CAM_SIOC           SENTRA_PIN_I2C_SCL  /* Shared or SCCB */
#define SENTRA_PIN_CAM_PWDN           14
#define SENTRA_PIN_CAM_RESET          -1                  /* Tied to 3.3V */

/* --- Push-to-Talk / User Action Button --- */
#define SENTRA_PIN_ACTION_BUTTON      5   /* Active Low with internal pull-up */

/* --- RESERVED PINS (NEVER ASSIGN IN FIRMWARE) --- */
/* GPIO 0, 3, 45, 46: Strapping pins */
/* GPIO 19, 20: USB D- / D+ (JTAG / Serial Console) */
/* GPIO 33, 34, 35, 36, 37: Octal PSRAM & SPI Flash on ESP32-S3 N16R8 */

/* ========================================================================= */
/* 3. AUDIO PARAMETERS & BUFFER LIMITS                                       */
/* ========================================================================= */
#define SENTRA_AUDIO_REC_SAMPLE_RATE  16000   /* 16 kHz for Speech-to-Text */
#define SENTRA_AUDIO_PLAY_SAMPLE_RATE 24000   /* 24 kHz for Spoken Speech */
#define SENTRA_AUDIO_CHANNELS         1       /* Mono */
#define SENTRA_AUDIO_BITS_PER_SAMPLE  16      /* 16-bit PCM */

#define SENTRA_AUDIO_MAX_RECORD_SEC   8       /* Maximum 8 seconds utterance */
#define SENTRA_AUDIO_REC_BUFFER_SIZE  (SENTRA_AUDIO_REC_SAMPLE_RATE * 2 * SENTRA_AUDIO_MAX_RECORD_SEC)
#define SENTRA_AUDIO_WAV_HEADER_SIZE  44

/* ========================================================================= */
/* 4. SENSOR THRESHOLDS (LOCAL SAFETY)                                       */
/* ========================================================================= */
#define SENTRA_HAZARD_OBSTACLE_CM     80      /* Alert if forward distance < 80 cm */
#define SENTRA_HAZARD_CLIFF_MM        150     /* Alert if ground drop-off > 150 mm */

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
