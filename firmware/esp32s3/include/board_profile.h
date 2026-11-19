/**
 * @file board_profile.h
 * @brief SENTRA Hardware Board Profile & Provisional Pinout Specification
 *
 * Microcontroller: ESP32-S3 N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM)
 * Notice: Pin assignments are PROVISIONAL and must be verified against the physical
 * board breakout and multimeter continuity check upon hardware arrival.
 */

#ifndef SENTRA_BOARD_PROFILE_H
#define SENTRA_BOARD_PROFILE_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SENTRA_BOARD_NAME               "ESP32-S3-N16R8-SENTRA-V1"
#define SENTRA_BOARD_PINOUT_STATUS      "PROVISIONAL_PENDING_CONTINUITY_CHECK"

/* ========================================================================= */
/* 1. SHARED I2C BUS (400 kHz Fast Mode)                                     */
/* ========================================================================= */
/* Devices on Bus:                                                           */
/* - Waveshare WM8960 Standalone Board: 0x1A                                 */
/* - VL53L0X Forward Distance Sensor:  0x30 (remapped via XSHUT)            */
/* - VL53L0X Ground Drop-off Sensor:   0x31 (remapped via XSHUT)            */
/* - MPU6050 6-DoF IMU:                0x68 (AD0 tied to GND)                */
/* - Optional INA219 Power Monitor:    0x40 (A0, A1 tied to GND)             */
#define BOARD_PIN_I2C_SDA               47
#define BOARD_PIN_I2C_SCL               48
#define BOARD_I2C_FREQUENCY_HZ          400000

/* Time-of-Flight Sensor Hardware Reset / XSHUT Pins */
#define BOARD_PIN_VL53L0X_FWD_XSHUT     21
#define BOARD_PIN_VL53L0X_DOWN_XSHUT    4

/* ========================================================================= */
/* 2. WAVESHARE WM8960 AUDIO CODEC (I2S DUPLEX BUS)                          */
/* ========================================================================= */
/* ESP32-S3 acts as I2S Master, WM8960 acts as I2S Slave                     */
#define BOARD_PIN_I2S_BCLK              41  /* Bit Clock (BCLK) */
#define BOARD_PIN_I2S_WS                42  /* Word Select / Frame Sync (LRC) */
#define BOARD_PIN_I2S_DOUT              2   /* Serial Data Out -> WM8960 DAC (Earphone) */
#define BOARD_PIN_I2S_DIN               1   /* Serial Data In  <- WM8960 ADC (Microphone) */
#define BOARD_PIN_I2S_MCLK              38  /* Master Clock (12.288 MHz or 256*fs) */

/* ========================================================================= */
/* 3. OV2640 PARALLEL DVP CAMERA BUS                                         */
/* ========================================================================= */
/* Warning: Parallel DVP signal integrity degrades over long cables (>15cm). */
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
#define BOARD_PIN_CAM_RESET             -1  /* Tied to 3.3V */

/* ========================================================================= */
/* 4. USER CONTROLS & DIAGNOSTIC BUTTONS                                     */
/* ========================================================================= */
#define BOARD_PIN_PTT_BUTTON            5   /* Push-to-Talk diagnostic button (Active Low) */
#define BOARD_PIN_STATUS_LED            -1  /* Optional onboard WS2812 or LED indicator */

/* ========================================================================= */
/* 5. PROTECTED / RESERVED PINS (DO NOT REASSIGN)                            */
/* ========================================================================= */
/* GPIO 0:  Boot strap pin / Download mode button                            */
/* GPIO 3:  Strapping pin (JTAG)                                             */
/* GPIO 45: Strapping pin (VDD_SPI voltage)                                  */
/* GPIO 46: Strapping pin (Boot log output)                                  */
/* GPIO 19: USB D- (Native USB-JTAG & Console)                               */
/* GPIO 20: USB D+ (Native USB-JTAG & Console)                               */
/* GPIO 33, 34, 35, 36, 37: Octal SPI Flash & PSRAM on N16R8 module!        */

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_BOARD_PROFILE_H */
