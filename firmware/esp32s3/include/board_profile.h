/**
 * @file board_profile.h
 * @brief SENTRA Hardware Board Profile & Provisional Pinout Specification
 *
 * Microcontroller: ESP32-S3 N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM)
 * Baseline Headband Hardware:
 *   - 1 x OV2640 Camera Module
 *   - 1 x VL53L0X Forward ToF Sensor (default 0x29, optional XSHUT)
 *   - 1 x GY-521 MPU6050 6-DoF IMU (0x68)
 * Optional Modules (disabled by default):
 *   - Waveshare WM8960 Audio Codec (0x1A)
 *   - VL53L5CX Depth Sensor (0x29 / remapped)
 *
 * Notice: Pin assignments are PROVISIONAL and must be verified against the physical
 * board breakout and multimeter continuity check before flashing/powering.
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
#define SENTRA_BOARD_PINOUT_STATUS      "PROVISIONAL_PENDING_CONTINUITY_CHECK"

/* ========================================================================= */
/* 1. SHARED I2C BUS (400 kHz Fast Mode)                                     */
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
/* 2. OPTIONAL WAVESHARE WM8960 AUDIO CODEC (I2S DUPLEX BUS)                 */
/* ========================================================================= */
#define BOARD_PIN_I2S_BCLK              41
#define BOARD_PIN_I2S_WS                42
#define BOARD_PIN_I2S_DOUT              2
#define BOARD_PIN_I2S_DIN               1
#define BOARD_PIN_I2S_MCLK              38

/* ========================================================================= */
/* 3. OV2640 PARALLEL DVP CAMERA BUS (PROVISIONAL)                           */
/* ========================================================================= */
/* Warning: Parallel DVP signal integrity degrades over long ribbon cables (>15cm). */
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
/* 4. USER CONTROLS & DIAGNOSTIC BUTTONS                                     */
/* ========================================================================= */
#ifdef CONFIG_SENTRA_PIN_ACTION_BUTTON
#define BOARD_PIN_PTT_BUTTON            CONFIG_SENTRA_PIN_ACTION_BUTTON
#else
#define BOARD_PIN_PTT_BUTTON            5
#endif
#define BOARD_PIN_STATUS_LED            -1

/* ========================================================================= */
/* 5. PROTECTED / RESERVED PINS (DO NOT REASSIGN)                            */
/* ========================================================================= */
/* GPIO 0, 3, 45, 46: Boot / JTAG strapping pins                             */
/* GPIO 19, 20: Native USB D- / D+                                           */
/* GPIO 33, 34, 35, 36, 37: Octal SPI Flash & PSRAM on N16R8 module          */

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_BOARD_PROFILE_H */
