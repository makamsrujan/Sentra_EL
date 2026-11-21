/**
 * @file local_alerts.c
 * @brief Local Acoustic Alert Output Implementation (MAX98357A discrete mono amp or legacy WM8960).
 */

#include "local_alerts.h"
#include "sentra_config.h"
#include <math.h>
#include <string.h>

#ifdef ESP_PLATFORM
#include "i2s_audio.h"
#include "esp_log.h"
#else
#include "mock_idf.h"
#endif

#if defined(CONFIG_SENTRA_ENABLE_MAX98357A) || defined(CONFIG_SENTRA_ENABLE_WM8960)
#define SENTRA_SPEAKER_OUTPUT_ENABLED 1
#endif

static const char *TAG = "LOCAL_ALERTS";
static bool s_audio_ready = false;

void local_alerts_set_audio_ready(bool ready) {
#ifdef SENTRA_SPEAKER_OUTPUT_ENABLED
    s_audio_ready = ready;
#else
    (void)ready;
    s_audio_ready = false;
#endif
}

bool local_alerts_is_available(void) {
#ifdef SENTRA_SPEAKER_OUTPUT_ENABLED
    return s_audio_ready;
#else
    return false;
#endif
}

#if defined(SENTRA_SPEAKER_OUTPUT_ENABLED) && defined(ESP_PLATFORM)
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
#endif

esp_err_t local_alerts_play(sentra_local_alert_type_t alert_type) {
#if !defined(SENTRA_SPEAKER_OUTPUT_ENABLED) || !defined(ESP_PLATFORM)
    if (alert_type == SENTRA_ALERT_OBSTACLE_CLOSE) {
        ESP_LOGW(TAG, "LOCAL HAZARD: Forward obstacle threshold reached (speaker output disabled/host; silent).");
    } else if (alert_type == SENTRA_ALERT_DISCONNECTED) {
        ESP_LOGI(TAG, "Network disconnected (speaker output disabled/host; silent).");
    }
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (!s_audio_ready) {
        ESP_LOGW(TAG, "Alert %d suppressed: speaker output is not initialized.", (int)alert_type);
        return ESP_ERR_NOT_SUPPORTED;
    }

    i2s_audio_abort_playback();
    /* Conservative amplitude for small mono speakers driven by MAX98357A */
    const float safe_amplitude = 3500.0f;
    int16_t tone_buf[1024];

    switch (alert_type) {
        case SENTRA_ALERT_OBSTACLE_CLOSE: {
            ESP_LOGW(TAG, "LOCAL HAZARD: Forward obstacle detected! Playing double chirp.");
            size_t count1 = (size_t)(0.040f * TONE_SAMPLE_RATE);
            if (count1 > 1024) count1 = 1024;
            generate_sine_pcm(tone_buf, count1, 880.0f, safe_amplitude);
            i2s_audio_play((const uint8_t *)tone_buf, count1 * 2, TONE_SAMPLE_RATE);

            size_t silence_samples = (size_t)(0.025f * TONE_SAMPLE_RATE);
            if (silence_samples > 1024) silence_samples = 1024;
            memset(tone_buf, 0, silence_samples * 2);
            i2s_audio_play((const uint8_t *)tone_buf, silence_samples * 2, TONE_SAMPLE_RATE);

            size_t count2 = (size_t)(0.040f * TONE_SAMPLE_RATE);
            if (count2 > 1024) count2 = 1024;
            generate_sine_pcm(tone_buf, count2, 1175.0f, safe_amplitude);
            i2s_audio_play((const uint8_t *)tone_buf, count2 * 2, TONE_SAMPLE_RATE);
            break;
        }
        case SENTRA_ALERT_CLIFF_DROPOFF: {
            ESP_LOGW(TAG, "Cliff alert invoked without supported downward sensor.");
            return ESP_ERR_NOT_SUPPORTED;
        }
        case SENTRA_ALERT_DISCONNECTED: {
            size_t count = (size_t)(0.040f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 300.0f, safe_amplitude * 0.7f);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }
        case SENTRA_ALERT_MIC_ACTIVATED: {
            size_t count = (size_t)(0.035f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 660.0f, safe_amplitude * 0.6f);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }
        case SENTRA_ALERT_MIC_STOPPED: {
            size_t count = (size_t)(0.030f * TONE_SAMPLE_RATE);
            if (count > 1024) count = 1024;
            generate_sine_pcm(tone_buf, count, 440.0f, safe_amplitude * 0.5f);
            i2s_audio_play((const uint8_t *)tone_buf, count * 2, TONE_SAMPLE_RATE);
            break;
        }
    }
    return ESP_OK;
#endif
}
