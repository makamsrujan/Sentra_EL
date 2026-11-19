/**
 * @file i2s_audio.h
 * @brief ESP32-S3 I2S Audio Recording and Playback Driver for WM8960
 */

#ifndef SENTRA_I2S_AUDIO_H
#define SENTRA_I2S_AUDIO_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize ESP32-S3 I2S driver in duplex mode (Master).
 *
 * Configures BCLK (GPIO 41), WS (GPIO 42), DOUT (GPIO 2), DIN (GPIO 1), and MCLK (GPIO 38).
 */
esp_err_t i2s_audio_init(void);
bool i2s_audio_is_ready(void);

/**
 * @brief Record microphone audio into a WAV buffer (16 kHz, Mono, 16-bit PCM).
 *
 * Prepends a standard 44-byte RIFF/WAVE header to the recorded PCM samples.
 *
 * @param buffer Output buffer (must be at least 44 + bytes_to_record bytes)
 * @param max_buffer_size Maximum allocated size of output buffer
 * @param record_duration_ms Duration to record in milliseconds (max 8000)
 * @param out_bytes_written Actual total WAV bytes written (including header)
 * @return esp_err_t ESP_OK on success
 */
esp_err_t i2s_audio_record_wav(uint8_t *buffer, size_t max_buffer_size, uint32_t record_duration_ms, size_t *out_bytes_written);

/**
 * @brief Play PCM or WAV audio buffer through the WM8960 headphone DAC.
 *
 * @param audio_data Pointer to audio buffer (raw PCM or WAV)
 * @param data_len Length of buffer in bytes
 * @param sample_rate Sample rate (typically 24000 or 16000)
 * @return esp_err_t ESP_OK on success
 */
esp_err_t i2s_audio_play(const uint8_t *audio_data, size_t data_len, uint32_t sample_rate);

/**
 * @brief Abort any ongoing audio playback immediately.
 * Called when an obstacle alert triggers or user issues a STOP command.
 */
void i2s_audio_abort_playback(void);

/**
 * @brief Populate a 44-byte standard RIFF/WAVE header into buffer.
 */
void i2s_audio_write_wav_header(uint8_t *header, uint32_t data_len, uint32_t sample_rate, uint16_t channels, uint16_t bits_per_sample);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_I2S_AUDIO_H */
