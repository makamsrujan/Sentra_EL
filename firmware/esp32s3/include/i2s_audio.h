/**
 * @file i2s_audio.h
 * @brief ESP32-S3 I2S Audio Driver supporting discrete INMP441 + MAX98357A (no WM8960)
 *        and legacy disabled-by-default WM8960 duplex mode.
 */

#ifndef SENTRA_I2S_AUDIO_H
#define SENTRA_I2S_AUDIO_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#ifdef ESP_PLATFORM
#include "esp_err.h"
#else
typedef int esp_err_t;
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Discrete INMP441 (I2S_NUM_0 RX) + MAX98357A (I2S_NUM_1 TX) independent init helpers */
esp_err_t i2s_audio_init_inmp441(void);
esp_err_t i2s_audio_init_max98357a(void);

/* Legacy WM8960 duplex init (only active when CONFIG_SENTRA_ENABLE_WM8960=y) */
esp_err_t i2s_audio_init(void);

bool i2s_audio_is_ready(void);
bool i2s_audio_mic_is_ready(void);
bool i2s_audio_speaker_is_ready(void);

/**
 * @brief Convert one raw 32-bit INMP441 I2S word (24-bit MSB-aligned) to clamped 16-bit PCM.
 */
int16_t i2s_audio_convert_inmp441_sample(int32_t raw_i2s_word);

/**
 * @brief Record microphone audio into a WAV buffer (16 kHz, Mono, 16-bit PCM).
 */
esp_err_t i2s_audio_record_wav(uint8_t *buffer, size_t max_buffer_size, uint32_t record_duration_ms, size_t *out_bytes_written);

/**
 * @brief Play PCM or WAV audio buffer through MAX98357A mono amp (or legacy WM8960).
 */
esp_err_t i2s_audio_play(const uint8_t *audio_data, size_t data_len, uint32_t sample_rate);

/**
 * @brief Play a short low-amplitude sine tone for MAX98357A speaker bench testing.
 *        Keep amplitude conservative (e.g., <= 3000) until speaker rating is confirmed.
 */
esp_err_t i2s_audio_play_bench_tone(uint32_t freq_hz, uint32_t duration_ms, int16_t amplitude);

void i2s_audio_abort_playback(void);
void i2s_audio_write_wav_header(uint8_t *header, uint32_t data_len, uint32_t sample_rate, uint16_t channels, uint16_t bits_per_sample);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_I2S_AUDIO_H */
