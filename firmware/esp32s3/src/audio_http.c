/**
 * @file audio_http.c
 * @brief ESP32-S3 HTTP REST Client for Action Polling, Acknowledgments & Optional Audio Turns.
 */

#include "audio_http.h"
#include "sentra_config.h"
#include "sentra_nvs_config.h"
#include "camera_driver.h"
#include "i2s_audio.h"
#include "local_alerts.h"
#include "wifi_transport.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include "esp_heap_caps.h"

static const char *TAG = "AUDIO_HTTP";

typedef struct {
    char *buf;
    size_t capacity;
    size_t len;
} http_body_accum_t;

static esp_err_t http_body_event_handler(esp_http_client_event_t *evt) {
    if (evt->event_id == HTTP_EVENT_ON_DATA && evt->user_data && evt->data && evt->data_len > 0) {
        http_body_accum_t *acc = (http_body_accum_t *)evt->user_data;
        if (acc->capacity > 1 && acc->len < acc->capacity - 1) {
            size_t avail = (acc->capacity - 1) - acc->len;
            size_t copy_len = ((size_t)evt->data_len < avail) ? (size_t)evt->data_len : avail;
            memcpy(acc->buf + acc->len, evt->data, copy_len);
            acc->len += copy_len;
            acc->buf[acc->len] = '\0';
        }
    }
    return ESP_OK;
}

static esp_err_t post_action_ack(const sentra_runtime_config_t *cfg, const char **action_ids, int count) {
    if (!cfg || !action_ids || count <= 0) return ESP_OK;

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;
    cJSON_AddStringToObject(root, "deviceId", cfg->device_id);
    cJSON *arr = cJSON_AddArrayToObject(root, "actionIds");
    if (arr) {
        for (int i = 0; i < count; i++) {
            if (action_ids[i] && action_ids[i][0] != '\0') {
                cJSON_AddItemToArray(arr, cJSON_CreateString(action_ids[i]));
            }
        }
    }
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!json) return ESP_ERR_NO_MEM;

    char url[256];
    int len = snprintf(url, sizeof(url), "%s/api/device/ack", cfg->server_url);
    if (len < 0 || len >= (int)sizeof(url)) {
        cJSON_free(json);
        return ESP_ERR_INVALID_SIZE;
    }

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 5000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        cJSON_free(json);
        return ESP_ERR_NO_MEM;
    }
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Token", cfg->device_token);
    esp_http_client_set_post_field(client, json, strlen(json));

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK && esp_http_client_get_status_code(client) != 200) {
        err = ESP_FAIL;
    }
    esp_http_client_cleanup(client);
    cJSON_free(json);
    return err;
}

esp_err_t audio_http_upload_utterance(const uint8_t *wav_buffer, size_t wav_len, uint32_t sequence, sentra_http_utterance_result_t *out_result) {
    if (!local_alerts_is_available() || !i2s_audio_is_ready()) {
        return ESP_ERR_NOT_SUPPORTED;
    }
    if (!wav_buffer || wav_len == 0) return ESP_ERR_INVALID_ARG;
    if (!wifi_transport_is_connected()) return ESP_ERR_INVALID_STATE;

    sentra_runtime_config_t cfg = {0};
    sentra_nvs_config_get(&cfg);
    if (cfg.server_url[0] == '\0' || cfg.device_token[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    char url[256];
    int url_len = snprintf(url, sizeof(url), "%s/api/device/audio/utterance", cfg.server_url);
    if (url_len < 0 || url_len >= (int)sizeof(url)) return ESP_ERR_INVALID_SIZE;

    char seq_str[16];
    snprintf(seq_str, sizeof(seq_str), "%u", (unsigned)sequence);

    char *resp_buf = (char *)calloc(1, 1024);
    if (!resp_buf) return ESP_ERR_NO_MEM;
    http_body_accum_t accum = { .buf = resp_buf, .capacity = 1024, .len = 0 };

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 15000,
        .buffer_size = 1024,
        .event_handler = http_body_event_handler,
        .user_data = &accum,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        free(resp_buf);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "Content-Type", "audio/wav");
    esp_http_client_set_header(client, "X-Device-Id", cfg.device_id);
    esp_http_client_set_header(client, "X-Device-Token", cfg.device_token);
    esp_http_client_set_header(client, "X-Sequence", seq_str);
    esp_http_client_set_post_field(client, (const char *)wav_buffer, wav_len);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "Audio upload HTTP status: %d (%u bytes)", status_code, (unsigned)accum.len);

        if (status_code == 200 && out_result && accum.len > 0) {
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
        } else if (status_code != 200) {
            err = ESP_FAIL;
        }
    } else {
        ESP_LOGE(TAG, "Failed to upload audio: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    free(resp_buf);
    return err;
}

esp_err_t audio_http_fetch_and_play_reply(const char *reply_id) {
#ifndef CONFIG_SENTRA_ENABLE_WM8960
    (void)reply_id;
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (!local_alerts_is_available() || !i2s_audio_is_ready()) {
        return ESP_ERR_NOT_SUPPORTED;
    }
    if (!reply_id || reply_id[0] == 0) return ESP_ERR_INVALID_ARG;
    if (!wifi_transport_is_connected()) return ESP_ERR_INVALID_STATE;

    sentra_runtime_config_t cfg = {0};
    sentra_nvs_config_get(&cfg);

    char url[256];
    int n = snprintf(url, sizeof(url), "%s/api/device/audio/reply/%s?deviceId=%s",
                     cfg.server_url, reply_id, cfg.device_id);
    if (n < 0 || n >= (int)sizeof(url)) return ESP_ERR_INVALID_SIZE;

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 12000,
        .buffer_size = 2048,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return ESP_ERR_NO_MEM;

    esp_http_client_set_header(client, "X-Device-Id", cfg.device_id);
    esp_http_client_set_header(client, "X-Device-Token", cfg.device_token);

    esp_err_t result = esp_http_client_open(client, 0);
    if (result != ESP_OK) goto done;

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
        wav = (uint8_t *)malloc((size_t)content_length);
    }
    if (!wav) {
        ESP_LOGE(TAG, "Insufficient memory for %d-byte audio reply", content_length);
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

    free(wav);

done:
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return result;
#endif
}

esp_err_t audio_http_poll_and_execute_actions(void) {
    if (!wifi_transport_is_connected()) return ESP_ERR_INVALID_STATE;

    sentra_runtime_config_t cfg = {0};
    sentra_nvs_config_get(&cfg);
    if (cfg.server_url[0] == '\0' || cfg.device_token[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    char url[256];
    int len = snprintf(url, sizeof(url), "%s/api/device/poll?deviceId=%s", cfg.server_url, cfg.device_id);
    if (len < 0 || len >= (int)sizeof(url)) return ESP_ERR_INVALID_SIZE;

    char *resp_buf = (char *)calloc(1, 2048);
    if (!resp_buf) return ESP_ERR_NO_MEM;
    http_body_accum_t accum = { .buf = resp_buf, .capacity = 2048, .len = 0 };

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 5000,
        .event_handler = http_body_event_handler,
        .user_data = &accum,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        free(resp_buf);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "X-Device-Id", cfg.device_id);
    esp_http_client_set_header(client, "X-Device-Token", cfg.device_token);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status_code = esp_http_client_get_status_code(client);
        if (status_code != 200) {
            err = ESP_FAIL;
        } else if (accum.len > 0) {
            cJSON *root = cJSON_Parse(resp_buf);
            if (root) {
                cJSON *actions = cJSON_GetObjectItem(root, "actions");
                const char *ack_ids[16] = {0};
                int ack_count = 0;

                if (cJSON_IsArray(actions)) {
                    int count = cJSON_GetArraySize(actions);
                    for (int i = 0; i < count; i++) {
                        cJSON *act = cJSON_GetArrayItem(actions, i);
                        cJSON *act_id = cJSON_GetObjectItem(act, "id");
                        cJSON *act_type = cJSON_GetObjectItem(act, "type");
                        cJSON *payload = cJSON_GetObjectItem(act, "payload");
                        cJSON *replyId = cJSON_GetObjectItem(act, "audioReplyId");

                        if (cJSON_IsString(act_type)) {
                            if (strcmp(act_type->valuestring, "capture_frame") == 0 ||
                                strcmp(act_type->valuestring, "active_perception") == 0) {
                                sentra_nvs_request_immediate_frame(true);
                            } else if (strcmp(act_type->valuestring, "recalibrate_imu") == 0) {
                                sentra_nvs_request_imu_recalibration(true);
                            } else if (strcmp(act_type->valuestring, "config_update") == 0 && cJSON_IsObject(payload)) {
                                cJSON *tof_ms = cJSON_GetObjectItem(payload, "tofSampleIntervalMs");
                                cJSON *imu_ms = cJSON_GetObjectItem(payload, "imuSampleIntervalMs");
                                cJSON *frm_ms = cJSON_GetObjectItem(payload, "frameUploadIntervalMs");
                                cJSON *q_item = cJSON_GetObjectItem(payload, "jpegQuality");
                                cJSON *fs_item = cJSON_GetObjectItem(payload, "frameSize");
                                cJSON *caut = cJSON_GetObjectItem(payload, "proximityCautionCm");
                                cJSON *crit = cJSON_GetObjectItem(payload, "proximityCriticalCm");
                                sentra_nvs_config_update_tuning(
                                    cJSON_IsNumber(tof_ms) ? (uint32_t)tof_ms->valuedouble : 0,
                                    cJSON_IsNumber(imu_ms) ? (uint32_t)imu_ms->valuedouble : 0,
                                    cJSON_IsNumber(frm_ms) ? (uint32_t)frm_ms->valuedouble : 0,
                                    cJSON_IsNumber(q_item) ? (uint8_t)q_item->valuedouble : 0,
                                    cJSON_IsNumber(caut) ? (uint16_t)caut->valuedouble : 0,
                                    cJSON_IsNumber(crit) ? (uint16_t)crit->valuedouble : 0
                                );
                                if (cJSON_IsNumber(q_item)) {
                                    (void)camera_driver_set_quality((uint8_t)q_item->valuedouble);
                                }
                                if (cJSON_IsString(fs_item)) {
                                    if (strcmp(fs_item->valuestring, "QVGA") == 0) {
                                        (void)camera_driver_set_framesize(SENTRA_CAM_SIZE_QVGA);
                                    } else if (strcmp(fs_item->valuestring, "VGA") == 0) {
                                        (void)camera_driver_set_framesize(SENTRA_CAM_SIZE_VGA);
                                    } else if (strcmp(fs_item->valuestring, "SVGA") == 0) {
                                        (void)camera_driver_set_framesize(SENTRA_CAM_SIZE_SVGA);
                                    }
                                }
                            }
                        }

                        if (local_alerts_is_available() && cJSON_IsString(replyId) && strlen(replyId->valuestring) > 0) {
                            (void)audio_http_fetch_and_play_reply(replyId->valuestring);
                        }

                        if (cJSON_IsString(act_id) && ack_count < 16) {
                            ack_ids[ack_count++] = act_id->valuestring;
                        }
                    }
                }

                if (ack_count > 0) {
                    (void)post_action_ack(&cfg, ack_ids, ack_count);
                }
                cJSON_Delete(root);
            }
        }
    }

    esp_http_client_cleanup(client);
    free(resp_buf);
    return err;
}
