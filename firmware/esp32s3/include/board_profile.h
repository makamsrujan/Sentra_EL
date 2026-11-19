/**
 * @file board_profile.h
 * @brief SENTRA Hardware Board Profile & Provisional Pinout Specification
 *
 * Microcontroller: ESP32-S3 N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM)
 * Finalized Baseline Headband Hardware (wired harness to bag enclosure):
 *   - 1 x OV2640 Camera Module
 *   - 1 x VL53L0X Forward Time-of-Flight Sensor (default I2C 0x29, optional XSHUT)
 *   - 1 x GY-521 MPU6050 6-DoF IMU (I2C 0x68)
 * Optional Modules (disabled by default; not required for operation):
 *   - Waveshare WM8960 Audio Codec (I2C 0x1A + I2S)
 *   - VL53L5CX Multi-Zone Depth Sensor
 *
 * CRITICAL HARDWARE WARNINGS:
 * 1. Pin assignments below are PROVISIONAL until exact ESP32-S3 carrier board
 *    and OV2640 breakout pinouts are physically verified with a multimeter.
 * 2. Parallel DVP camera signal integrity (OV2640 8-bit D0..D7 + PCLK/XCLK)
 *    degrades rapidly on ribbon cables longer than ~10-15 cm. If the headband-to-bag
 *    harness exceeds ~15 cm, verify signal integrity or reduce XCLK (e.g. 10 MHz).
 * 3. On some ESP32-S3-DevKitC-1 N16R8 revisions, GPIO 48 (or GPIO 38 on v1.1) drives
 *    the onboard addressable RGB LED. Override SDA/SCL via menuconfig if conflicting.
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
#define SENTRA_BOARD_PINOUT_STATUS      "PROVISIONAL_PENDING_BOARD_PINOUT_VERIFICATION"

/* ========================================================================= */
/* 1. SHARED I2C BUS (400 kHz Fast Mode, single VL53L0X + MPU6050)           */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_I2C_SDA
#define BOARD_PIN_I2C_SDA               CONFIG_SENTRA_PIN_I2C_SDA
#else
#define BOARD_PIN_I2C_SDA               47
#endif

#ifdef CONFIG_SENTRA_PIN_I2C_SCL
#define BOARD_PIN_I2C_SCL               CONFIG_SENTRA_PIN_I2C_SCL
#else
#define BOARD_PIN_I2C_SCL               48
#endif

#define BOARD_I2C_FREQUENCY_HZ          400000

/* Single Forward VL53L0X Reset / XSHUT Pin (-1 if XSHUT pulled high on breakout) */
#ifdef CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT
#define BOARD_PIN_VL53L0X_FWD_XSHUT     CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT
#else
#define BOARD_PIN_VL53L0X_FWD_XSHUT     21
#endif

#ifdef CONFIG_SENTRA_VL53L0X_ADDR
#define BOARD_ADDR_VL53L0X_FWD          CONFIG_SENTRA_VL53L0X_ADDR
#else
#define BOARD_ADDR_VL53L0X_FWD          0x29
#endif

/* ========================================================================= */
/* 2. OPTIONAL WAVESHARE WM8960 AUDIO CODEC (I2S DUPLEX BUS - PROVISIONAL)   */
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
/* 3. OV2640 PARALLEL DVP CAMERA BUS (PROVISIONAL EXAMPLE MAPPING)           */
/* ========================================================================= */
/* WARNING: Example GPIOs only. Confirm against your physical ESP32-S3 board */
/* and OV2640 adapter before setting CONFIG_SENTRA_ENABLE_CAMERA=y.          */
/* Parallel DVP fails over long unshielded cables (>15 cm) at high XCLK.     */
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
/* 4. USER CONTROLS & DIAGNOSTIC PINS                                        */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_ACTION_BUTTON
#define BOARD_PIN_PTT_BUTTON            CONFIG_SENTRA_PIN_ACTION_BUTTON
#else
#define BOARD_PIN_PTT_BUTTON            5
#endif
#define BOARD_PIN_STATUS_LED            -1

/* ========================================================================= */
/* 5. RESERVED ESP32-S3 N16R8 PINS & COMPILE-TIME GUARD                      */
/* ========================================================================= */
/* GPIO 0, 3, 45, 46: Boot / JTAG / VDD_SPI strapping pins                   */
/* GPIO 19, 20: Native USB OTG D- / D+                                       */
/* GPIO 26..32: Quad SPI Flash                                               */
/* GPIO 33..37: Octal SPI PSRAM on ESP32-S3-N16R8 modules                    */
#define SENTRA_PIN_IS_N16R8_RESERVED(p) ( \
    (p) == 19 || (p) == 20 || \
    ((p) >= 26 && (p) <= 37) || \
    (p) == 45 || (p) == 46 \
)

#if SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_I2C_SDA) || SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_I2C_SCL)
#error "I2C SDA/SCL cannot use reserved ESP32-S3 N16R8 Flash/PSRAM/USB/Strapping pins (19,20,26-37,45,46)."
#endif

#if BOARD_PIN_VL53L0X_FWD_XSHUT >= 0 && SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_VL53L0X_FWD_XSHUT)
#error "VL53L0X XSHUT cannot use reserved ESP32-S3 N16R8 pins (19,20,26-37,45,46)."
#endif

#if BOARD_PIN_PTT_BUTTON >= 0 && SENTRA_PIN_IS_N16R8_RESERVED(BOARD_PIN_PTT_BUTTON)
#error "Action button cannot use reserved ESP32-S3 N16R8 pins (19,20,26-37,45,46)."
#endif

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_BOARD_PROFILE_H */
