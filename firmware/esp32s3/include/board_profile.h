/**
 * @file board_profile.h
 * @brief SENTRA ESP32-S3 N16R8 Board Profile & Bench Pinout Specification
 *
 * Microcontroller: ESP32-S3 N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM)
 * Actual Two-Board Hardware:
 *   - ESP32-S3 Sensors: 1 x forward VL53L0X (I2C 0x29), 1 x GY-521 MPU6050 (I2C 0x68, AD0 low)
 *   - Separate Camera Board: ESP32-CAM (firmware/esp32cam) over Wi-Fi (no DVP wiring to S3)
 *   - Optional Discrete Audio Profile (disabled by default, no WM8960):
 *     INMP441 I2S RX Mic (I2S_NUM_0) + MAX98357A Mono I2S TX Amp (I2S_NUM_1).
 *   - No downward ToF sensor. No WM8960 codec.
 *
 * HARDWARE SAFETY NOTES:
 * 1. Use XSHUT = -1 ONLY for a single VL53L0X breakout with a confirmed onboard pull-up.
 *    Do not drive an unverified XSHUT GPIO.
 * 2. Leave the speaker physically disconnected until its impedance and wattage are confirmed.
 * 3. Legacy direct OV2640-to-S3 and WM8960 mappings are disabled by default.
 */

#ifndef SENTRA_BOARD_PROFILE_H
#define SENTRA_BOARD_PROFILE_H

#include <stdint.h>
#include <stdbool.h>

#if defined(__has_include)
#  if __has_include("sdkconfig.h")
#    include "sdkconfig.h"
#  endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SENTRA_BOARD_NAME               "ESP32-S3-N16R8-SENTRA-V1"
#define SENTRA_BOARD_PINOUT_STATUS      "BENCH_SENSOR_PROFILE_SDA4_SCL40_PENDING_PHYSICAL_TEST"

/* ========================================================================= */
/* 1. SHARED I2C BUS (Bench profile: SDA=4, SCL=40, 100 kHz, XSHUT=-1)       */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_I2C_SDA
#define BOARD_PIN_I2C_SDA               CONFIG_SENTRA_PIN_I2C_SDA
#else
#define BOARD_PIN_I2C_SDA               4
#endif

#ifdef CONFIG_SENTRA_PIN_I2C_SCL
#define BOARD_PIN_I2C_SCL               CONFIG_SENTRA_PIN_I2C_SCL
#else
#define BOARD_PIN_I2C_SCL               40
#endif

#ifdef CONFIG_SENTRA_I2C_FREQ_HZ
#define BOARD_I2C_FREQUENCY_HZ          CONFIG_SENTRA_I2C_FREQ_HZ
#else
#define BOARD_I2C_FREQUENCY_HZ          100000
#endif

/* XSHUT = -1 ONLY when single-sensor VL53L0X breakout has confirmed onboard pull-up */
#ifdef CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT
#define BOARD_PIN_VL53L0X_FWD_XSHUT     CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT
#else
#define BOARD_PIN_VL53L0X_FWD_XSHUT     -1
#endif

#ifdef CONFIG_SENTRA_VL53L0X_ADDR
#define BOARD_ADDR_VL53L0X_FWD          CONFIG_SENTRA_VL53L0X_ADDR
#else
#define BOARD_ADDR_VL53L0X_FWD          0x29
#endif

/* ========================================================================= */
/* 2. SEPARATE DISCRETE I2S AUDIO PROFILE (DISABLED BY DEFAULT, NO WM8960)   */
/*    INMP441 I2S RX Mic (I2S_NUM_0) + MAX98357A Mono I2S TX Amp (I2S_NUM_1) */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_INMP441_SCK
#define BOARD_PIN_INMP441_SCK           CONFIG_SENTRA_PIN_INMP441_SCK
#else
#define BOARD_PIN_INMP441_SCK           14
#endif

#ifdef CONFIG_SENTRA_PIN_INMP441_WS
#define BOARD_PIN_INMP441_WS            CONFIG_SENTRA_PIN_INMP441_WS
#else
#define BOARD_PIN_INMP441_WS            15
#endif

#ifdef CONFIG_SENTRA_PIN_INMP441_SD
#define BOARD_PIN_INMP441_SD            CONFIG_SENTRA_PIN_INMP441_SD
#else
#define BOARD_PIN_INMP441_SD            16
#endif

#ifdef CONFIG_SENTRA_PIN_MAX98357A_BCLK
#define BOARD_PIN_MAX98357A_BCLK        CONFIG_SENTRA_PIN_MAX98357A_BCLK
#else
#define BOARD_PIN_MAX98357A_BCLK        17
#endif

#ifdef CONFIG_SENTRA_PIN_MAX98357A_LRC
#define BOARD_PIN_MAX98357A_LRC         CONFIG_SENTRA_PIN_MAX98357A_LRC
#else
#define BOARD_PIN_MAX98357A_LRC         18
#endif

#ifdef CONFIG_SENTRA_PIN_MAX98357A_DIN
#define BOARD_PIN_MAX98357A_DIN         CONFIG_SENTRA_PIN_MAX98357A_DIN
#else
#define BOARD_PIN_MAX98357A_DIN         21
#endif

/* ========================================================================= */
/* 3. LEGACY OPTIONAL WAVESHARE WM8960 AUDIO CODEC (DISABLED BY DEFAULT)     */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_I2S_BCLK
#define BOARD_PIN_I2S_BCLK              CONFIG_SENTRA_PIN_I2S_BCLK
#else
#define BOARD_PIN_I2S_BCLK              41
#endif

#ifdef CONFIG_SENTRA_PIN_I2S_WS
#define BOARD_PIN_I2S_WS                CONFIG_SENTRA_PIN_I2S_WS
#else
#define BOARD_PIN_I2S_WS                42
#endif

#ifdef CONFIG_SENTRA_PIN_I2S_DOUT
#define BOARD_PIN_I2S_DOUT              CONFIG_SENTRA_PIN_I2S_DOUT
#else
#define BOARD_PIN_I2S_DOUT              2
#endif

#ifdef CONFIG_SENTRA_PIN_I2S_DIN
#define BOARD_PIN_I2S_DIN               CONFIG_SENTRA_PIN_I2S_DIN
#else
#define BOARD_PIN_I2S_DIN               1
#endif

#ifdef CONFIG_SENTRA_PIN_I2S_MCLK
#define BOARD_PIN_I2S_MCLK              CONFIG_SENTRA_PIN_I2S_MCLK
#else
#define BOARD_PIN_I2S_MCLK              38
#endif

/* ========================================================================= */
/* 4. LEGACY DIRECT OV2640 PARALLEL DVP BUS (DISABLED; USE firmware/esp32cam)*/
/* ========================================================================= */
#ifdef CONFIG_SENTRA_CAM_XCLK_HZ
#define BOARD_CAM_XCLK_HZ               CONFIG_SENTRA_CAM_XCLK_HZ
#else
#define BOARD_CAM_XCLK_HZ               10000000
#endif

#define BOARD_PIN_CAM_D0                11
#define BOARD_PIN_CAM_D1                9
#define BOARD_PIN_CAM_D2                8
#define BOARD_PIN_CAM_D3                10
#define BOARD_PIN_CAM_D4                12
#define BOARD_PIN_CAM_D5                18
#define BOARD_PIN_CAM_D6                17
#define BOARD_PIN_CAM_D7                16
#define BOARD_PIN_CAM_XCLK              15
#define BOARD_PIN_CAM_PCLK              13
#define BOARD_PIN_CAM_VSYNC             6
#define BOARD_PIN_CAM_HREF              7
#define BOARD_PIN_CAM_PWDN              14
#define BOARD_PIN_CAM_RESET             -1

/* ========================================================================= */
/* 5. USER CONTROLS & DIAGNOSTIC PINS                                        */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_ACTION_BUTTON
#define BOARD_PIN_PTT_BUTTON            CONFIG_SENTRA_PIN_ACTION_BUTTON
#else
#define BOARD_PIN_PTT_BUTTON            5
#endif
#define BOARD_PIN_STATUS_LED            -1

/* ========================================================================= */
/* 6. RESERVED ESP32-S3 N16R8 PINS & COMPILE-TIME CONFLICT GUARDS            */
/* ========================================================================= */
/* GPIO 0, 3, 45, 46: Boot / JTAG / VDD_SPI strapping pins                   */
/* GPIO 19, 20: Native USB OTG D- / D+                                       */
/* GPIO 26..32: Quad SPI Flash                                               */
/* GPIO 33..37: Octal SPI PSRAM on ESP32-S3-N16R8 modules                    */
/* GPIO 43, 44: UART0 TX/RX serial monitor                                   */
#define SENTRA_PIN_IS_N16R8_RESERVED(p) ( \
    (p) == 0 || (p) == 3 || \
    (p) == 19 || (p) == 20 || \
    ((p) >= 26 && (p) <= 37) || \
    (p) == 43 || (p) == 44 || \
    (p) == 45 || (p) == 46 \
)

#if SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_I2C_SDA) || SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_I2C_SCL)
#error "I2C SDA/SCL cannot use reserved ESP32-S3 N16R8 Flash/PSRAM/USB/UART0/Strapping pins."
#endif

#if BOARD_PIN_I2C_SDA == BOARD_PIN_I2C_SCL
#error "I2C SDA and SCL must use distinct GPIOs."
#endif

#if BOARD_PIN_VL53L0X_FWD_XSHUT >= 0 && SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_VL53L0X_FWD_XSHUT)
#error "VL53L0X XSHUT cannot use reserved ESP32-S3 N16R8 pins."
#endif

#if BOARD_PIN_PTT_BUTTON >= 0 && SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_PTT_BUTTON)
#error "Action button cannot use reserved ESP32-S3 N16R8 pins."
#endif

#ifdef CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE
#if defined(CONFIG_SENTRA_ENABLE_WM8960)
#error "Cannot enable both discrete INMP441/MAX98357A audio and legacy WM8960."
#endif
#if defined(CONFIG_SENTRA_ENABLE_CAMERA)
#error "Discrete INMP441/MAX98357A pins overlap legacy S3 DVP pins; keep CONFIG_SENTRA_ENABLE_CAMERA=n."
#endif
#if SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_INMP441_SCK) || \
    SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_INMP441_WS) || \
    SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_INMP441_SD) || \
    SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_MAX98357A_BCLK) || \
    SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_MAX98357A_LRC) || \
    SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_MAX98357A_DIN)
#error "INMP441/MAX98357A GPIOs cannot use reserved ESP32-S3 N16R8 pins."
#endif
#if BOARD_PIN_INMP441_SCK == BOARD_PIN_I2C_SDA || BOARD_PIN_INMP441_SCK == BOARD_PIN_I2C_SCL || \
    BOARD_PIN_INMP441_WS  == BOARD_PIN_I2C_SDA || BOARD_PIN_INMP441_WS  == BOARD_PIN_I2C_SCL || \
    BOARD_PIN_INMP441_SD  == BOARD_PIN_I2C_SDA || BOARD_PIN_INMP441_SD  == BOARD_PIN_I2C_SCL || \
    BOARD_PIN_MAX98357A_BCLK == BOARD_PIN_I2C_SDA || BOARD_PIN_MAX98357A_BCLK == BOARD_PIN_I2C_SCL || \
    BOARD_PIN_MAX98357A_LRC  == BOARD_PIN_I2C_SDA || BOARD_PIN_MAX98357A_LRC  == BOARD_PIN_I2C_SCL || \
    BOARD_PIN_MAX98357A_DIN  == BOARD_PIN_I2C_SDA || BOARD_PIN_MAX98357A_DIN  == BOARD_PIN_I2C_SCL
#error "INMP441/MAX98357A GPIOs cannot conflict with the I2C sensor bus (SDA/SCL)."
#endif
#if BOARD_PIN_INMP441_SCK == BOARD_PIN_MAX98357A_BCLK || BOARD_PIN_INMP441_SCK == BOARD_PIN_MAX98357A_LRC || \
    BOARD_PIN_INMP441_SCK == BOARD_PIN_MAX98357A_DIN  || BOARD_PIN_INMP441_WS  == BOARD_PIN_MAX98357A_BCLK || \
    BOARD_PIN_INMP441_WS  == BOARD_PIN_MAX98357A_LRC  || BOARD_PIN_INMP441_WS  == BOARD_PIN_MAX98357A_DIN || \
    BOARD_PIN_INMP441_SD  == BOARD_PIN_MAX98357A_BCLK || BOARD_PIN_INMP441_SD  == BOARD_PIN_MAX98357A_LRC || \
    BOARD_PIN_INMP441_SD  == BOARD_PIN_MAX98357A_DIN
#error "INMP441 and MAX98357A GPIOs must be distinct."
#endif
#endif

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_BOARD_PROFILE_H */
