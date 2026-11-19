/**
 * @file i2s_audio.c
 * @brief ESP32-S3 I2S Duplex Driver Implementation for WM8960
 */

#include "i2s_audio.h"
#include "sentra_config.h"
#include "esp_log.h"
#include "driver/i2s.h"
#include <string.h>

static const char *TAG = "I2S_AUDIO";
static volatile bool s_playback_abort_requested = false;
static bool s_i2s_ready = false;

#define I2S_PORT_NUM (I2S_NUM_0)

bool i2s_audio_is_ready(void) {
    return s_i2s_ready;
}

esp_err_t i2s_audio_init(void) {
    if (s_i2s_ready) return ESP_OK;

    ESP_LOGI(TAG, "Initializing I2S port %d (BCLK=%d, WS=%d, DOUT=%d, DIN=%d, MCLK=%d)...",
             I2S_PORT_NUM, SENTRA_PIN_I2S_BCLK, SENTRA_PIN_I2S_WS,
             SENTRA_PIN_I2S_DOUT, SENTRA_PIN_I2S_DIN, SENTRA_PIN_I2S_MCLK);

    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX | I2S_MODE_RX),
        .sample_rate = SENTRA_AUDIO_REC_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 512,
        .use_apll = false,
        .tx_desc_auto_clear = true,
        .fixed_mclk = 0
    };

    i2s_pin_config_t pin_config = {
        .mck_io_num = SENTRA_PIN_I2S_MCLK,
        .bck_io_num = SENTRA_PIN_I2S_BCLK,
        .ws_io_num = SENTRA_PIN_I2S_WS,
        .data_out_num = SENTRA_PIN_I2S_DOUT,
        .data_in_num = SENTRA_PIN_I2S_DIN
    };

    esp_err_t ret = i2s_driver_install(I2S_PORT_NUM, &i2s_config, 0, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to install I2S driver: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = i2s_set_pin(I2S_PORT_NUM, &pin_config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to set I2S pins: %s", esp_err_to_name(ret));
        i2s_driver_uninstall(I2S_PORT_NUM);
        return ret;
    }

    i2s_set_clk(I2S_PORT_NUM, SENTRA_AUDIO_REC_SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(I2S_PORT_NUM);

    s_i2s_ready = true;
    ESP_LOGI(TAG, "I2S duplex driver initialized successfully.");
    return ESP_OK;
}

void i2s_audio_write_wav_header(uint8_t *header, uint32_t data_len, uint32_t sample_rate, uint16_t channels, uint16_t bits_per_sample) {
    uint32_t byte_rate = sample_rate * channels * (bits_per_sample / 8);
    uint16_t block_align = channels * (bits_per_sample / 8);
    uint32_t chunk_size = 36 + data_len;

    memcpy(&header[0], "RIFF", 4);
    header[4] = (uint8_t)(chunk_size & 0xFF);
    header[5] = (uint8_t)((chunk_size >> 8) & 0xFF);
    header[6] = (uint8_t)((chunk_size >> 16) & 0xFF);
    header[7] = (uint8_t)((chunk_size >> 24) & 0xFF);
    memcpy(&header[8], "WAVE", 4);

    memcpy(&header[12], "fmt ", 4);
    header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0; // Subchunk1Size (16 for PCM)
    header[20] = 1; header[21] = 0;                                  // AudioFormat (1 = PCM)
    header[22] = (uint8_t)(channels & 0xFF);
    header[23] = (uint8_t)((channels >> 8) & 0xFF);
    header[24] = (uint8_t)(sample_rate & 0xFF);
    header[25] = (uint8_t)((sample_rate >> 8) & 0xFF);
    header[26] = (uint8_t)((sample_rate >> 16) & 0xFF);
    header[27] = (uint8_t)((sample_rate >> 24) & 0xFF);
    header[28] = (uint8_t)(byte_rate & 0xFF);
    header[29] = (uint8_t)((byte_rate >> 8) & 0xFF);
    header[30] = (uint8_t)((byte_rate >> 16) & 0xFF);
    header[31] = (uint8_t)((byte_rate >> 24) & 0xFF);
    header[32] = (uint8_t)(block_align & 0xFF);
    header[33] = (uint8_t)((block_align >> 8) & 0xFF);
    header[34] = (uint8_t)(bits_per_sample & 0xFF);
    header[35] = (uint8_t)((bits_per_sample >> 8) & 0xFF);

    memcpy(&header[36], "data", 4);
    header[40] = (uint8_t)(data_len & 0xFF);
    header[41] = (uint8_t)((data_len >> 8) & 0xFF);
    header[42] = (uint8_t)((data_len >> 16) & 0xFF);
    header[43] = (uint8_t)((data_len >> 24) & 0xFF);
}

esp_err_t i2s_audio_record_wav(uint8_t *buffer, size_t max_buffer_size, uint32_t record_duration_ms, size_t *out_bytes_written) {
    if (!s_i2s_ready) return ESP_ERR_INVALID_STATE;
    if (!buffer || max_buffer_size <= SENTRA_AUDIO_WAV_HEADER_SIZE) return ESP_ERR_INVALID_ARG;
    if (record_duration_ms > 8000) record_duration_ms = 8000;

    size_t pcm_bytes_to_read = (SENTRA_AUDIO_REC_SAMPLE_RATE * 2 * record_duration_ms) / 1000;
    if (pcm_bytes_to_read + SENTRA_AUDIO_WAV_HEADER_SIZE > max_buffer_size) {
        pcm_bytes_to_read = max_buffer_size - SENTRA_AUDIO_WAV_HEADER_SIZE;
    }

    // Configure I2S clock for 16 kHz recording
    i2s_set_clk(I2S_PORT_NUM, SENTRA_AUDIO_REC_SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(I2S_PORT_NUM);

    // Read microphone PCM samples into buffer (offset by 44 bytes to leave room for WAV header)
    uint8_t *pcm_target = buffer + SENTRA_AUDIO_WAV_HEADER_SIZE;
    size_t total_read = 0;
    size_t chunk_bytes = 1024;

    while (total_read < pcm_bytes_to_read) {
        size_t to_read = (pcm_bytes_to_read - total_read > chunk_bytes) ? chunk_bytes : (pcm_bytes_to_read - total_read);
        size_t bytes_read = 0;
        esp_err_t ret = i2s_read(I2S_PORT_NUM, pcm_target + total_read, to_read, &bytes_read, pdMS_TO_TICKS(100));
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "i2s_read warning: %s", esp_err_to_name(ret));
            break;
        }
        total_read += bytes_read;
    }

    // Populate the 44-byte WAV header at the beginning of buffer
    i2s_audio_write_wav_header(buffer, total_read, SENTRA_AUDIO_REC_SAMPLE_RATE, 1, 16);

    if (out_bytes_written) {
        *out_bytes_written = total_read + SENTRA_AUDIO_WAV_HEADER_SIZE;
    }

    ESP_LOGI(TAG, "Recorded %u PCM bytes (%u total WAV bytes, %u ms).",
             (unsigned)total_read, (unsigned)(total_read + 44), (unsigned)record_duration_ms);
    return ESP_OK;
}

esp_err_t i2s_audio_play(const uint8_t *audio_data, size_t data_len, uint32_t sample_rate) {
    if (!s_i2s_ready) return ESP_ERR_INVALID_STATE;
    if (!audio_data || data_len == 0) return ESP_ERR_INVALID_ARG;

    s_playback_abort_requested = false;

    // Detect if buffer has a 44-byte WAV header and skip it to play raw PCM
    size_t pcm_offset = 0;
    if (data_len >= 44 && memcmp(audio_data, "RIFF", 4) == 0 && memcmp(audio_data + 8, "WAVE", 4) == 0) {
        pcm_offset = 44;
    }

    const uint8_t *pcm_ptr = audio_data + pcm_offset;
    size_t pcm_len = data_len - pcm_offset;

    // Set playback sample rate
    i2s_set_clk(I2S_PORT_NUM, sample_rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(I2S_PORT_NUM);

    size_t total_written = 0;
    size_t chunk_size = 1024;

    while (total_written < pcm_len) {
        if (s_playback_abort_requested) {
            ESP_LOGW(TAG, "Playback aborted by user interrupt or local obstacle alert.");
            break;
        }

        size_t to_write = (pcm_len - total_written > chunk_size) ? chunk_size : (pcm_len - total_written);
        size_t bytes_written = 0;
        esp_err_t ret = i2s_write(I2S_PORT_NUM, pcm_ptr + total_written, to_write, &bytes_written, pdMS_TO_TICKS(100));
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "i2s_write warning: %s", esp_err_to_name(ret));
            break;
        }
        total_written += bytes_written;
    }

    i2s_zero_dma_buffer(I2S_PORT_NUM);
    return ESP_OK;
}

void i2s_audio_abort_playback(void) {
    s_playback_abort_requested = true;
}
