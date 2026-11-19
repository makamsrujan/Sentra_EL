/**
 * @file wm8960.h
 * @brief Waveshare WM8960 Audio Board Low-Level I2C Register Driver
 */

#ifndef SENTRA_WM8960_H
#define SENTRA_WM8960_H

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define WM8960_I2C_ADDR             0x1A

/* WM8960 Register Map (7-bit address, 9-bit value) */
#define WM8960_REG_LEFT_INPUT_VOL   0x00
#define WM8960_REG_RIGHT_INPUT_VOL  0x01
#define WM8960_REG_LOUT1_VOL        0x02  /* Left Headphone Volume */
#define WM8960_REG_ROUT1_VOL        0x03  /* Right Headphone Volume */
#define WM8960_REG_CLOCKING1        0x04
#define WM8960_REG_DAC_CONTROL1     0x05
#define WM8960_REG_DAC_CONTROL2     0x06
#define WM8960_REG_AUDIO_INTERFACE1 0x07
#define WM8960_REG_SAMPLE_RATE      0x08
#define WM8960_REG_AUDIO_INTERFACE2 0x09
#define WM8960_REG_LEFT_DAC_VOL     0x0A
#define WM8960_REG_RIGHT_DAC_VOL    0x0B
#define WM8960_REG_RESET            0x0F
#define WM8960_REG_LEFT_ADC_VOL     0x15
#define WM8960_REG_RIGHT_ADC_VOL    0x16
#define WM8960_REG_ALC1             0x11
#define WM8960_REG_ALC2             0x12
#define WM8960_REG_ALC3             0x13
#define WM8960_REG_NOISE_GATE       0x14
#define WM8960_REG_PWR_MGMT1        0x19
#define WM8960_REG_PWR_MGMT2        0x1A
#define WM8960_REG_PWR_MGMT3        0x2F
#define WM8960_REG_ADDITIONAL_CTRL1 0x17
#define WM8960_REG_ADDITIONAL_CTRL2 0x18
#define WM8960_REG_ADDITIONAL_CTRL3 0x1B
#define WM8960_REG_ADDITIONAL_CTRL4 0x30
#define WM8960_REG_LEFT_OUT_MIX     0x22
#define WM8960_REG_RIGHT_OUT_MIX    0x25

/**
 * @brief Initialize the Waveshare WM8960 codec via I2C.
 *
 * Configures power management, MICBIAS for headset electret microphone,
 * PGA microphone preamplifier gain, 16-bit I2S audio format, and
 * stereo headphone output stages (HP_L and HP_R).
 *
 * @param i2c_num I2C port number (e.g. I2C_NUM_0)
 * @return esp_err_t ESP_OK on success
 */
esp_err_t wm8960_init(int i2c_num);

/**
 * @brief Write 9-bit register value to WM8960.
 */
esp_err_t wm8960_write_reg(int i2c_num, uint8_t reg_addr, uint16_t reg_val);

/**
 * @brief Set Headphone output volume (0..100%).
 */
esp_err_t wm8960_set_headphone_volume(int i2c_num, uint8_t volume_pct);

/**
 * @brief Set Microphone PGA gain (0..100%).
 */
esp_err_t wm8960_set_mic_gain(int i2c_num, uint8_t gain_pct);

/**
 * @brief Mute or unmute DAC output.
 */
esp_err_t wm8960_set_dac_mute(int i2c_num, bool mute);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_WM8960_H */
