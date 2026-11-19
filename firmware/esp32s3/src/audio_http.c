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
#include <stdio.h>
#include <stdint.h>
#include "esp_heap_caps.h"

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

/* Download the complete bounded WAV into PSRAM, then play it once.
   The old code called i2s_audio_play() for EVERY HTTP chunk, which reset
   DMA and clipped speech at each network boundary. */
esp_err_t audio_http_fetch_and_play_reply(const char *reply_id) {
    if (!reply_id || reply_id[0] == 0) return ESP_ERR_INVALID_ARG;

    char url[256];
    int n = snprintf(url, sizeof(url), "%s/api/device/audio/reply/%s?deviceId=%s",
                     SENTRA_DEFAULT_SERVER_URL, reply_id, SENTRA_DEVICE_ID);
    if (n < 0 || n >= (int)sizeof(url)) return ESP_ERR_INVALID_SIZE;

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 12000,
        .buffer_size = 2048,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_ERR_NO_MEM;

    esp_http_client_set_header(client, "X-Device-Id", SENTRA_DEVICE_ID);
    esp_http_client_set_header(client, "X-Device-Token", SENTRA_DEFAULT_DEVICE_TOKEN);

    esp_err_t result = esp_http_client_open(client, 0);
    if (result != ESP_OK) goto done;

    /* The service sends Content-Length for generated audio. */
    int content_length = esp_http_client_fetch_headers(client);
    int http_status = esp_http_client_get_status_code(client);
    if (http_status != 200 || content_length < 44 || content_length > (1024 * 1024)) {
        ESP_LOGE(TAG, "Invalid audio reply: HTTP %d size %d", http_status, content_length);
        result = ESP_FAIL;
        goto done;
    }

    uint8_t *wav = (uint8_t *)heap_caps_malloc((size_t)content_length,
                                                MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!wav) {
        ESP_LOGE(TAG, "Insufficient PSRAM for %d-byte audio reply", content_length);
        result = ESP_ERR_NO_MEM;
        goto done;
    }

    size_t received = 0;
    while (received < (size_t)content_length) {
        int count = esp_http_client_read(client, (char *)wav + received,
                                         (int)((size_t)content_length - received));
        if (count <= 0) break;
        received += (size_t)count;
    }

    if (received != (size_t)content_length ||
        memcmp(wav, "RIFF", 4) != 0 || memcmp(wav + 8, "WAVE", 4) != 0 ||
        memcmp(wav + 12, "fmt ", 4) != 0 ||
        wav[20] != 1 || wav[21] != 0 || wav[22] != 1 || wav[23] != 0 ||
        wav[34] != 16 || wav[35] != 0 ||
        memcmp(wav + 36, "data", 4) != 0) {
        ESP_LOGE(TAG, "Downloaded speech is incomplete or is not mono PCM16 WAV");
        result = ESP_ERR_INVALID_RESPONSE;
    } else {
        uint32_t rate = ((uint32_t)wav[24]) | ((uint32_t)wav[25] << 8) |
                        ((uint32_t)wav[26] << 16) | ((uint32_t)wav[27] << 24);
        uint32_t data_size = ((uint32_t)wav[40]) | ((uint32_t)wav[41] << 8) |
                             ((uint32_t)wav[42] << 16) | ((uint32_t)wav[43] << 24);
        if ((rate != 24000 && rate != 16000) || data_size != received - 44) {
            ESP_LOGE(TAG, "Unexpected WAV rate/data length: %lu Hz, %lu bytes",
                     (unsigned long)rate, (unsigned long)data_size);
            result = ESP_ERR_INVALID_RESPONSE;
        } else {
            result = i2s_audio_play(wav, received, rate);
        }
    }

    heap_caps_free(wav);

done:
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return result;
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
