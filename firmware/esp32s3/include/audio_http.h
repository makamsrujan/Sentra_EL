/**
 * @file audio_http.h
 * @brief ESP32-S3 HTTP Client for Audio Utterance Upload and Reply Playback
 */

#ifndef SENTRA_AUDIO_HTTP_H
#define SENTRA_AUDIO_HTTP_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool ok;
    char turn_id[48];
    char status[32];
    bool wake_detected;
    char audio_reply_id[48];
} sentra_http_utterance_result_t;

/**
 * @brief Upload a recorded WAV buffer to /api/device/audio/utterance
 *
 * @param wav_buffer Pointer to WAV buffer (including 44-byte header)
 * @param wav_len Total length of WAV buffer
 * @param sequence Recording sequence counter
 * @param out_result Output struct populated with server response
 * @return esp_err_t ESP_OK on HTTP 200/204
 */
esp_err_t audio_http_upload_utterance(const uint8_t *wav_buffer, size_t wav_len, uint32_t sequence, sentra_http_utterance_result_t *out_result);

/**
 * @brief Fetch and play an audio reply from /api/device/audio/reply/:replyId
 *
 * @param reply_id The reply ID returned by utterance or action poll
 * @return esp_err_t ESP_OK on successful download and playback
 */
esp_err_t audio_http_fetch_and_play_reply(const char *reply_id);

/**
 * @brief Poll /api/device/poll for pending wearable actions and process speech actions.
 */
esp_err_t audio_http_poll_and_execute_actions(void);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_AUDIO_HTTP_H */
