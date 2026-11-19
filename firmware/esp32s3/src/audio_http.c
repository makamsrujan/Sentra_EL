/**
 * @file audio_http.c
 * @brief ESP32-S3 HTTP REST Implementation for Audio Utterance and Replies
 */

#include "audio_http.h"
#include "sentra_config.h"
#include "i2s_audio.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "cJSON.h"
#include <string.h>

static const char *TAG = "AUDIO_HTTP";

esp_err_t audio_http_upload_utterance(const uint8_t *wav_buffer, size_t wav_len, uint32_t sequence, sentra_http_utterance_result_t *out_result) {
    if (!wav_buffer || wav_len == 0) return ESP_ERR_INVALID_ARG;

    char url[128];
    snprintf(url, sizeof(url), "%s/api/device/audio/utterance", SENTRA_DEFAULT_SERVER_URL);

    char seq_str[16];
    snprintf(seq_str, sizeof(seq_str), "%u", (unsigned)sequence);

    char resp_buf[1024] = {0};
    int resp_len = 0;

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 15000,
        .buffer_size = 1024,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_FAIL;

    esp_http_client_set_header(client, "Content-Type", "audio/wav");
    esp_http_client_set_header(client, "X-Device-Id", SENTRA_DEVICE_ID);
    esp_http_client_set_header(client, "X-Device-Token", SENTRA_DEFAULT_DEVICE_TOKEN);
    esp_http_client_set_header(client, "X-Sequence", seq_str);

    esp_http_client_set_post_field(client, (const char *)wav_buffer, wav_len);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        resp_len = esp_http_client_read_response(client, resp_buf, sizeof(resp_buf) - 1);
        resp_buf[resp_len] = '\0';

        ESP_LOGI(TAG, "Audio upload HTTP status: %d", status_code);

        if (status_code == 200 && out_result) {
            cJSON *root = cJSON_Parse(resp_buf);
            if (root) {
                cJSON *ok = cJSON_GetObjectItem(root, "ok");
                cJSON *status = cJSON_GetObjectItem(root, "status");
                cJSON *wake = cJSON_GetObjectItem(root, "wakeDetected");
                cJSON *replyId = cJSON_GetObjectItem(root, "audioReplyId");

                out_result->ok = cJSON_IsTrue(ok);
                if (cJSON_IsString(status)) strncpy(out_result->status, status->valuestring, sizeof(out_result->status) - 1);
                out_result->wake_detected = cJSON_IsTrue(wake);
                if (cJSON_IsString(replyId)) strncpy(out_result->audio_reply_id, replyId->valuestring, sizeof(out_result->audio_reply_id) - 1);

                cJSON_Delete(root);
            }
        }
    } else {
        ESP_LOGE(TAG, "Failed to upload audio: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return err;
}

esp_err_t audio_http_fetch_and_play_reply(const char *reply_id) {
    if (!reply_id || strlen(reply_id) == 0) return ESP_ERR_INVALID_ARG;

    char url[160];
    snprintf(url, sizeof(url), "%s/api/device/audio/reply/%s?deviceId=%s",
             SENTRA_DEFAULT_SERVER_URL, reply_id, SENTRA_DEVICE_ID);

    ESP_LOGI(TAG, "Fetching spoken audio reply from %s...", url);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 10000,
        .buffer_size = 2048,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_FAIL;

    esp_http_client_set_header(client, "X-Device-Id", SENTRA_DEVICE_ID);
    esp_http_client_set_header(client, "X-Device-Token", SENTRA_DEFAULT_DEVICE_TOKEN);

    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open HTTP connection: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        return err;
    }

    int content_length = esp_http_client_fetch_headers(client);
    int status_code = esp_http_client_get_status_code(client);

    if (status_code != 200) {
        ESP_LOGE(TAG, "Reply fetch failed with HTTP %d", status_code);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Streaming audio reply (%d bytes) to I2S...", content_length);

    // Stream download chunks directly into I2S playback
    uint8_t chunk_buf[1024];
    int read_bytes = 0;
    bool is_first_chunk = true;

    while ((read_bytes = esp_http_client_read(client, (char *)chunk_buf, sizeof(chunk_buf))) > 0) {
        size_t offset = 0;
        // Skip 44-byte WAV header on first chunk
        if (is_first_chunk && read_bytes >= 44 && memcmp(chunk_buf, "RIFF", 4) == 0) {
            offset = 44;
            is_first_chunk = false;
        }

        if (read_bytes > offset) {
            i2s_audio_play(chunk_buf + offset, read_bytes - offset, SENTRA_AUDIO_PLAY_SAMPLE_RATE);
        }
    }

    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return ESP_OK;
}

esp_err_t audio_http_poll_and_execute_actions(void) {
    char url[160];
    snprintf(url, sizeof(url), "%s/api/device/poll?deviceId=%s", SENTRA_DEFAULT_SERVER_URL, SENTRA_DEVICE_ID);

    char resp_buf[2048] = {0};
    int resp_len = 0;

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 5000,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_FAIL;

    esp_http_client_set_header(client, "X-Device-Id", SENTRA_DEVICE_ID);
    esp_http_client_set_header(client, "X-Device-Token", SENTRA_DEFAULT_DEVICE_TOKEN);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        resp_len = esp_http_client_read_response(client, resp_buf, sizeof(resp_buf) - 1);
        resp_buf[resp_len] = '\0';

        cJSON *root = cJSON_Parse(resp_buf);
        if (root) {
            cJSON *actions = cJSON_GetObjectItem(root, "actions");
            if (cJSON_IsArray(actions)) {
                int count = cJSON_GetArraySize(actions);
                for (int i = 0; i < count; i++) {
                    cJSON *act = cJSON_GetArrayItem(actions, i);
                    cJSON *replyId = cJSON_GetObjectItem(act, "audioReplyId");
                    if (cJSON_IsString(replyId) && strlen(replyId->valuestring) > 0) {
                        audio_http_fetch_and_play_reply(replyId->valuestring);
                    }
                }
            }
            cJSON_Delete(root);
        }
    }

    esp_http_client_cleanup(client);
    return err;
}
