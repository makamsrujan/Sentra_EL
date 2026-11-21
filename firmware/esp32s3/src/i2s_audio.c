/**
 * @file i2s_audio.c
 * @brief ESP32-S3 I2S Audio Driver:
 *   - Separate discrete profile: INMP441 I2S RX mic (I2S_NUM_0, 32-bit -> 16-bit PCM)
 *     + MAX98357A mono I2S TX amp (I2S_NUM_1, 16-bit mono), NO WM8960 / NO MCLK / NO I2C.
 *   - Legacy WM8960 duplex profile retained strictly behind CONFIG_SENTRA_ENABLE_WM8960.
 */

#include "i2s_audio.h"
#include "sentra_config.h"
#include <math.h>
#include <string.h>

int16_t i2s_audio_convert_inmp441_sample(int32_t raw_i2s_word) {
    /* INMP441 shifts 24-bit signed audio in bits [31:8]; shifting right by 14 preserves
     * usable conversational gain while clamping safely into int16_t bounds. */
    int32_t scaled = raw_i2s_word >> 14;
    if (scaled > 32767) return 32767;
    if (scaled < -32768) return -32768;
    return (int16_t)scaled;
}

void i2s_audio_write_wav_header(uint8_t *header, uint32_t data_len, uint32_t sample_rate, uint16_t channels, uint16_t bits_per_sample) {
    if (!header) return;
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
    header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
    header[20] = 1; header[21] = 0;
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

#ifdef ESP_PLATFORM

#include "esp_log.h"
#include "driver/i2s.h"

static const char *TAG = "I2S_AUDIO";
static volatile bool s_playback_abort_requested = false;
static bool s_mic_ready = false;
static bool s_speaker_ready = false;

#define I2S_MIC_PORT     (I2S_NUM_0)
#define I2S_SPEAKER_PORT (I2S_NUM_1)
#define I2S_LEGACY_PORT  (I2S_NUM_0)

bool i2s_audio_mic_is_ready(void) {
    return s_mic_ready;
}

bool i2s_audio_speaker_is_ready(void) {
    return s_speaker_ready;
}

bool i2s_audio_is_ready(void) {
    return s_speaker_ready || s_mic_ready;
}

esp_err_t i2s_audio_init_inmp441(void) {
#ifdef CONFIG_SENTRA_ENABLE_INMP441_MIC
    if (s_mic_ready) return ESP_OK;

    ESP_LOGI(TAG, "Initializing INMP441 I2S RX mic on port %d (SCK=%d, WS=%d, SD=%d, no WM8960)...",
             (int)I2S_MIC_PORT, SENTRA_PIN_INMP441_SCK, SENTRA_PIN_INMP441_WS, SENTRA_PIN_INMP441_SD);

    i2s_config_t rx_cfg = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = SENTRA_AUDIO_REC_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 6,
        .dma_buf_len = 256,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0,
    };

    i2s_pin_config_t rx_pins = {
        .mck_io_num = I2S_PIN_NO_CHANGE,
        .bck_io_num = SENTRA_PIN_INMP441_SCK,
        .ws_io_num = SENTRA_PIN_INMP441_WS,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = SENTRA_PIN_INMP441_SD,
    };

    esp_err_t ret = i2s_driver_install(I2S_MIC_PORT, &rx_cfg, 0, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "INMP441 i2s_driver_install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = i2s_set_pin(I2S_MIC_PORT, &rx_pins);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "INMP441 i2s_set_pin failed: %s", esp_err_to_name(ret));
        i2s_driver_uninstall(I2S_MIC_PORT);
        return ret;
    }

    i2s_zero_dma_buffer(I2S_MIC_PORT);
    s_mic_ready = true;
    ESP_LOGI(TAG, "INMP441 I2S RX initialized (L/R must be tied to GND for Left channel).");
    return ESP_OK;
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t i2s_audio_init_max98357a(void) {
#ifdef CONFIG_SENTRA_ENABLE_MAX98357A_AMP
    if (s_speaker_ready) return ESP_OK;

    ESP_LOGI(TAG, "Initializing MAX98357A I2S TX mono amp on port %d (BCLK=%d, LRC=%d, DIN=%d, no WM8960)...",
             (int)I2S_SPEAKER_PORT, SENTRA_PIN_MAX98357A_BCLK, SENTRA_PIN_MAX98357A_LRC, SENTRA_PIN_MAX98357A_DIN);

    i2s_config_t tx_cfg = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
        .sample_rate = SENTRA_AUDIO_PLAY_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 512,
        .use_apll = false,
        .tx_desc_auto_clear = true,
        .fixed_mclk = 0,
    };

    i2s_pin_config_t tx_pins = {
        .mck_io_num = I2S_PIN_NO_CHANGE,
        .bck_io_num = SENTRA_PIN_MAX98357A_BCLK,
        .ws_io_num = SENTRA_PIN_MAX98357A_LRC,
        .data_out_num = SENTRA_PIN_MAX98357A_DIN,
        .data_in_num = I2S_PIN_NO_CHANGE,
    };

    esp_err_t ret = i2s_driver_install(I2S_SPEAKER_PORT, &tx_cfg, 0, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "MAX98357A i2s_driver_install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = i2s_set_pin(I2S_SPEAKER_PORT, &tx_pins);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "MAX98357A i2s_set_pin failed: %s", esp_err_to_name(ret));
        i2s_driver_uninstall(I2S_SPEAKER_PORT);
        return ret;
    }

    i2s_zero_dma_buffer(I2S_SPEAKER_PORT);
    s_speaker_ready = true;
    ESP_LOGI(TAG, "MAX98357A I2S TX initialized (ensure speaker impedance/wattage verified before audio).");
    return ESP_OK;
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t i2s_audio_init(void) {
#ifdef CONFIG_SENTRA_ENABLE_WM8960
    if (s_mic_ready && s_speaker_ready) return ESP_OK;

    ESP_LOGI(TAG, "[LEGACY] Initializing WM8960 I2S duplex port %d (BCLK=%d, WS=%d, DOUT=%d, DIN=%d, MCLK=%d)...",
             (int)I2S_LEGACY_PORT, SENTRA_PIN_I2S_BCLK, SENTRA_PIN_I2S_WS,
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
        .fixed_mclk = 0,
    };

    i2s_pin_config_t pin_config = {
        .mck_io_num = SENTRA_PIN_I2S_MCLK,
        .bck_io_num = SENTRA_PIN_I2S_BCLK,
        .ws_io_num = SENTRA_PIN_I2S_WS,
        .data_out_num = SENTRA_PIN_I2S_DOUT,
        .data_in_num = SENTRA_PIN_I2S_DIN,
    };

    esp_err_t ret = i2s_driver_install(I2S_LEGACY_PORT, &i2s_config, 0, NULL);
    if (ret != ESP_OK) return ret;

    ret = i2s_set_pin(I2S_LEGACY_PORT, &pin_config);
    if (ret != ESP_OK) {
        i2s_driver_uninstall(I2S_LEGACY_PORT);
        return ret;
    }

    i2s_set_clk(I2S_LEGACY_PORT, SENTRA_AUDIO_REC_SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(I2S_LEGACY_PORT);
    s_mic_ready = true;
    s_speaker_ready = true;
    return ESP_OK;
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t i2s_audio_record_wav(uint8_t *buffer, size_t max_buffer_size, uint32_t record_duration_ms, size_t *out_bytes_written) {
    if (!s_mic_ready) return ESP_ERR_INVALID_STATE;
    if (!buffer || max_buffer_size <= SENTRA_AUDIO_WAV_HEADER_SIZE) return ESP_ERR_INVALID_ARG;
    if (record_duration_ms > 8000) record_duration_ms = 8000;

    size_t pcm_bytes_to_read = (SENTRA_AUDIO_REC_SAMPLE_RATE * 2 * record_duration_ms) / 1000;
    if (pcm_bytes_to_read + SENTRA_AUDIO_WAV_HEADER_SIZE > max_buffer_size) {
        pcm_bytes_to_read = max_buffer_size - SENTRA_AUDIO_WAV_HEADER_SIZE;
    }
    size_t total_samples_target = pcm_bytes_to_read / 2;

    int16_t *pcm16_out = (int16_t *)(buffer + SENTRA_AUDIO_WAV_HEADER_SIZE);
    size_t samples_written = 0;

#ifdef CONFIG_SENTRA_ENABLE_INMP441_MIC
    i2s_zero_dma_buffer(I2S_MIC_PORT);
    int32_t raw32_chunk[256];

    while (samples_written < total_samples_target) {
        size_t want_samples = total_samples_target - samples_written;
        if (want_samples > 256) want_samples = 256;
        size_t bytes_read = 0;
        esp_err_t ret = i2s_read(I2S_MIC_PORT, raw32_chunk, want_samples * sizeof(int32_t), &bytes_read, pdMS_TO_TICKS(150));
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "INMP441 i2s_read warning: %s", esp_err_to_name(ret));
            break;
        }
        size_t got_samples = bytes_read / sizeof(int32_t);
        for (size_t i = 0; i < got_samples; i++) {
            pcm16_out[samples_written++] = i2s_audio_convert_inmp441_sample(raw32_chunk[i]);
        }
        if (got_samples == 0) break;
    }
#elif defined(CONFIG_SENTRA_ENABLE_WM8960)
    i2s_set_clk(I2S_LEGACY_PORT, SENTRA_AUDIO_REC_SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(I2S_LEGACY_PORT);
    uint8_t *pcm_target = buffer + SENTRA_AUDIO_WAV_HEADER_SIZE;
    size_t total_read = 0;
    while (total_read < pcm_bytes_to_read) {
        size_t to_read = (pcm_bytes_to_read - total_read > 1024) ? 1024 : (pcm_bytes_to_read - total_read);
        size_t bytes_read = 0;
        esp_err_t ret = i2s_read(I2S_LEGACY_PORT, pcm_target + total_read, to_read, &bytes_read, pdMS_TO_TICKS(100));
        if (ret != ESP_OK || bytes_read == 0) break;
        total_read += bytes_read;
    }
    samples_written = total_read / 2;
#else
    (void)pcm16_out;
    return ESP_ERR_NOT_SUPPORTED;
#endif

    size_t total_pcm_bytes = samples_written * sizeof(int16_t);
    i2s_audio_write_wav_header(buffer, (uint32_t)total_pcm_bytes, SENTRA_AUDIO_REC_SAMPLE_RATE, 1, 16);
    if (out_bytes_written) {
        *out_bytes_written = total_pcm_bytes + SENTRA_AUDIO_WAV_HEADER_SIZE;
    }
    ESP_LOGI(TAG, "Recorded %u PCM bytes (%u total WAV bytes, %u ms).",
             (unsigned)total_pcm_bytes, (unsigned)(total_pcm_bytes + 44), (unsigned)record_duration_ms);
    return ESP_OK;
}

esp_err_t i2s_audio_play(const uint8_t *audio_data, size_t data_len, uint32_t sample_rate) {
    if (!s_speaker_ready) return ESP_ERR_INVALID_STATE;
    if (!audio_data || data_len == 0) return ESP_ERR_INVALID_ARG;

    s_playback_abort_requested = false;

    size_t pcm_offset = 0;
    if (data_len >= 44 && memcmp(audio_data, "RIFF", 4) == 0 && memcmp(audio_data + 8, "WAVE", 4) == 0) {
        pcm_offset = 44;
    }

    const uint8_t *pcm_ptr = audio_data + pcm_offset;
    size_t pcm_len = data_len - pcm_offset;

#ifdef CONFIG_SENTRA_ENABLE_MAX98357A_AMP
    const i2s_port_t tx_port = I2S_SPEAKER_PORT;
#elif defined(CONFIG_SENTRA_ENABLE_WM8960)
    const i2s_port_t tx_port = I2S_LEGACY_PORT;
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif

    i2s_set_clk(tx_port, sample_rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(tx_port);

    size_t total_written = 0;
    const size_t chunk_size = 1024;
    while (total_written < pcm_len) {
        if (s_playback_abort_requested) {
            ESP_LOGW(TAG, "Playback aborted by user interrupt or local obstacle alert.");
            break;
        }
        size_t to_write = (pcm_len - total_written > chunk_size) ? chunk_size : (pcm_len - total_written);
        size_t bytes_written = 0;
        esp_err_t ret = i2s_write(tx_port, pcm_ptr + total_written, to_write, &bytes_written, pdMS_TO_TICKS(100));
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "i2s_write warning: %s", esp_err_to_name(ret));
            break;
        }
        total_written += bytes_written;
    }

    i2s_zero_dma_buffer(tx_port);
    return ESP_OK;
}

esp_err_t i2s_audio_play_bench_tone(uint32_t freq_hz, uint32_t duration_ms, int16_t amplitude) {
    if (!s_speaker_ready) return ESP_ERR_INVALID_STATE;
    if (freq_hz < 100 || freq_hz > 4000 || duration_ms == 0 || duration_ms > 2000) {
        return ESP_ERR_INVALID_ARG;
    }
    if (amplitude > 4000) amplitude = 4000; /* Cap bench test amplitude for unverified small speaker safety */
    if (amplitude < 0) amplitude = 0;

    const uint32_t sample_rate = 16000;
    const size_t total_samples = (size_t)((sample_rate * duration_ms) / 1000);
    int16_t chunk[256];

#ifdef CONFIG_SENTRA_ENABLE_MAX98357A_AMP
    const i2s_port_t tx_port = I2S_SPEAKER_PORT;
#elif defined(CONFIG_SENTRA_ENABLE_WM8960)
    const i2s_port_t tx_port = I2S_LEGACY_PORT;
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif

    i2s_set_clk(tx_port, sample_rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
    i2s_zero_dma_buffer(tx_port);

    size_t idx = 0;
    while (idx < total_samples) {
        size_t count = total_samples - idx;
        if (count > 256) count = 256;
        for (size_t i = 0; i < count; i++) {
            double t = (double)(idx + i) / (double)sample_rate;
            chunk[i] = (int16_t)((double)amplitude * sin(2.0 * 3.141592653589793 * (double)freq_hz * t));
        }
        size_t written = 0;
        esp_err_t ret = i2s_write(tx_port, chunk, count * sizeof(int16_t), &written, pdMS_TO_TICKS(150));
        if (ret != ESP_OK) return ret;
        idx += count;
    }

    i2s_zero_dma_buffer(tx_port);
    return ESP_OK;
}

void i2s_audio_abort_playback(void) {
    s_playback_abort_requested = true;
}

#endif /* ESP_PLATFORM */
