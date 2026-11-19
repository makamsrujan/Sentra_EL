/**
 * @file local_alerts.c
 * @brief Autonomous Offline Alert Tone Synthesis Implementation
 */

#include "local_alerts.h"
#include "i2s_audio.h"
#include "sentra_config.h"
#include "esp_log.h"
#include <math.h>
#include <string.h>

static const char *TAG = "LOCAL_ALERTS";

#define TONE_SAMPLE_RATE 24000
#define PI_F 3.14159265358979323846f

static void generate_sine_pcm(int16_t *buffer, size_t sample_count, float freq_hz, float amplitude) {
    for (size_t i = 0; i < sample_count; i++) {
        float t = (float)i / (float)TONE_SAMPLE_RATE;
        float attack_samples = 0.005f * TONE_SAMPLE_RATE;
        float decay_samples = 0.005f * TONE_SAMPLE_RATE;
        float env = 1.0f;
        if (i < attack_samples) {
            env = (float)i / attack_samples;
        } else if (i > sample_count - decay_samples) {
            env = (float)(sample_count - i) / decay_samples;
        }
        buffer[i] = (int16_t)(amplitude * env * sinf(2.0f * PI_F * freq_hz * t));
    }
}

esp_err_t local_alerts_play(sentra_local_alert_type_t alert_type) {
#ifndef CONFIG_SENTRA_ENABLE_WM8960
    if (alert_type == SENTRA_ALERT_OBSTACLE_CLOSE) {
        ESP_LOGW(TAG, "LOCAL HAZARD: Forward obstacle threshold reached (WM8960 disabled; silent mode).");
    } else if (alert_type == SENTRA_ALERT_DISCONNECTED) {
        ESP_LOGI(TAG, "Network disconnected (WM8960 disabled; silent mode).");
    }
    return ESP_ERR_NOT_SUPPORTED;
#else
    i2s_audio_abort_playback();

    const float safe_amplitude = 7500.0f;
    int16_t tone_buf[1024];

    switch (alert_type) {
        case SENTRA_ALERT_OBSTACLE_CLOSE: {
            ESP_LOGW(TAG, "LOCAL HAZARD: Forward obstacle detected! Playing double beep.");
            size_t count1 = (size_t)(0.080f * TONE_SAMPLE_RATE);
            if (count1 > 1024) count1 = 1024;
            generate_sine_pcm(tone_buf, count1, 880.0f, safe_amplitude);
            i2s_audio_play((const uint8_t *)tone_buf, count1 * 2, TONE_SAMPLE_RATE);

            memset(tone_buf, 0, (size_t)(0.040f * TONE_SAMPLE_RATE) * 2);
            i2s_audio_play((const uint8_t *)tone_buf, (size_t)(0.040f * TONE_SAMPLE_RATE) * 2, TONE_SAMPLE_RATE);

            size_t count2 = (size_t)(0.100f * TONE_SAMPLE_RATE);
            if (count2 > 1024) count2 = 1024;
            generate_sine_pcm(tone_buf, count2, 1175.0f, safe_amplitude);
            i2s_audio_play((const uint8_t *)tone_buf, count2 * 2, TONE_SAMPLE_RATE);
            break;
        }

        case SENTRA_ALERT_CLIFF_DROPOFF: {
            ESP_LOGW(TAG, "LOCAL HAZARD: Ground drop-off alert triggered.");
            size_t count = (size_t)(0.150f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 450.0f, safe_amplitude);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }

        case SENTRA_ALERT_DISCONNECTED: {
            size_t count = (size_t)(0.200f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 300.0f, safe_amplitude * 0.7f);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }

        case SENTRA_ALERT_MIC_ACTIVATED: {
            size_t count = (size_t)(0.060f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 660.0f, safe_amplitude * 0.6f);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }

        case SENTRA_ALERT_MIC_STOPPED: {
            size_t count = (size_t)(0.040f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 440.0f, safe_amplitude * 0.5f);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }
    }

    return ESP_OK;
#endif
}
