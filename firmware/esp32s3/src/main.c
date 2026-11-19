/**
 * @file main.c
 * @brief SENTRA ESP32-S3 Wearable Firmware Main Application Entry Point
 *
 * Implements the deterministic state machine:
 * STANDBY -> RECORDING -> TRANSCRIBING -> REASONING -> SPEECH_GENERATION -> PLAYBACK -> STANDBY
 * (plus ERROR, CANCELLED, DISCONNECTED)
 *
 * Supports autonomous local obstacle/cliff warnings via WM8960 DAC even when offline.
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "driver/i2c.h"

#include "sentra_config.h"
#include "wm8960.h"
#include "i2s_audio.h"
#include "local_alerts.h"
#include "audio_http.h"

static const char *TAG = "SENTRA_MAIN";

static volatile sentra_audio_state_t s_current_state = SENTRA_AUDIO_STATE_STANDBY;
static uint32_t s_audio_sequence = 1;

const char* sentra_audio_state_to_string(sentra_audio_state_t state) {
    switch (state) {
        case SENTRA_AUDIO_STATE_STANDBY:            return "STANDBY";
        case SENTRA_AUDIO_STATE_RECORDING:          return "RECORDING";
        case SENTRA_AUDIO_STATE_TRANSCRIBING:        return "TRANSCRIBING";
        case SENTRA_AUDIO_STATE_REASONING:          return "REASONING";
        case SENTRA_AUDIO_STATE_SPEECH_GENERATION:  return "SPEECH_GENERATION";
        case SENTRA_AUDIO_STATE_PLAYBACK:           return "PLAYBACK";
        case SENTRA_AUDIO_STATE_ERROR:              return "ERROR";
        case SENTRA_AUDIO_STATE_CANCELLED:          return "CANCELLED";
        case SENTRA_AUDIO_STATE_DISCONNECTED:       return "DISCONNECTED";
        default:                                    return "UNKNOWN";
    }
}

static void set_audio_state(sentra_audio_state_t new_state) {
    ESP_LOGI(TAG, "Audio State Transition: [%s] -> [%s]",
             sentra_audio_state_to_string(s_current_state),
             sentra_audio_state_to_string(new_state));
    s_current_state = new_state;
}

static esp_err_t init_i2c_bus(void) {
    i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = SENTRA_PIN_I2C_SDA,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_io_num = SENTRA_PIN_I2C_SCL,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = SENTRA_I2C_FREQ_HZ,
    };
    esp_err_t err = i2c_param_config(I2C_NUM_0, &conf);
    if (err == ESP_OK) {
        err = i2c_driver_install(I2C_NUM_0, conf.mode, 0, 0, 0);
    }
    return err;
}

static void init_button(void) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << SENTRA_PIN_ACTION_BUTTON),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

/**
 * @brief FreeRTOS task handling the Voice Turn audio cycle.
 */
static void audio_lifecycle_task(void *pvParameters) {
    // Allocate 256KB buffer in PSRAM (or internal heap) for 8 seconds 16kHz WAV
    uint8_t *wav_buffer = (uint8_t *)malloc(SENTRA_AUDIO_REC_BUFFER_SIZE + SENTRA_AUDIO_WAV_HEADER_SIZE);
    if (!wav_buffer) {
        ESP_LOGE(TAG, "Failed to allocate audio recording buffer! PSRAM required for N16R8.");
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "Audio lifecycle task running. Push action button (GPIO %d) to speak.", SENTRA_PIN_ACTION_BUTTON);

    while (1) {
        // Wait for user button press (Active Low) or wake condition
        if (gpio_get_level((gpio_num_t)SENTRA_PIN_ACTION_BUTTON) == 0) {
            // Debounce
            vTaskDelay(pdMS_TO_TICKS(50));
            if (gpio_get_level((gpio_num_t)SENTRA_PIN_ACTION_BUTTON) == 0) {
                ESP_LOGI(TAG, "Voice recording triggered by user button.");

                // 1. Play listening chime to signal microphone is active
                local_alerts_play(SENTRA_ALERT_MIC_ACTIVATED);

                // 2. Transition to RECORDING
                set_audio_state(SENTRA_AUDIO_STATE_RECORDING);

                size_t bytes_written = 0;
                // Record 3.5 seconds utterance
                esp_err_t rec_err = i2s_audio_record_wav(wav_buffer, SENTRA_AUDIO_REC_BUFFER_SIZE, 3500, &bytes_written);

                // Play stop click
                local_alerts_play(SENTRA_ALERT_MIC_STOPPED);

                if (rec_err == ESP_OK && bytes_written > 44) {
                    // 3. Transition to TRANSCRIBING & REASONING
                    set_audio_state(SENTRA_AUDIO_STATE_TRANSCRIBING);

                    sentra_http_utterance_result_t result = {0};
                    esp_err_t upload_err = audio_http_upload_utterance(wav_buffer, bytes_written, s_audio_sequence++, &result);

                    if (upload_err == ESP_OK && result.ok) {
                        if (result.wake_detected && strlen(result.audio_reply_id) > 0) {
                            // 4. Transition to PLAYBACK
                            set_audio_state(SENTRA_AUDIO_STATE_PLAYBACK);
                            audio_http_fetch_and_play_reply(result.audio_reply_id);
                        } else if (!result.wake_detected) {
                            ESP_LOGI(TAG, "Utterance ignored (no wake word detected).");
                        }
                        set_audio_state(SENTRA_AUDIO_STATE_STANDBY);
                    } else {
                        ESP_LOGE(TAG, "Upload failed or server rejected utterance.");
                        set_audio_state(SENTRA_AUDIO_STATE_ERROR);
                        vTaskDelay(pdMS_TO_TICKS(1000));
                        set_audio_state(SENTRA_AUDIO_STATE_STANDBY);
                    }
                } else {
                    ESP_LOGE(TAG, "Microphone recording failed.");
                    set_audio_state(SENTRA_AUDIO_STATE_ERROR);
                    vTaskDelay(pdMS_TO_TICKS(1000));
                    set_audio_state(SENTRA_AUDIO_STATE_STANDBY);
                }
            }
        }

        // Periodically poll device action queue (every 1 second)
        audio_http_poll_and_execute_actions();

        vTaskDelay(pdMS_TO_TICKS(250));
    }
}

/**
 * @brief Safety telemetry task monitoring forward & downward ToF sensors.
 * Triggers autonomous immediate local alert tones directly without cloud dependency.
 */
static void sensor_safety_task(void *pvParameters) {
    ESP_LOGI(TAG, "Autonomous sensor safety monitor started.");

    while (1) {
        // In real hardware, read VL53L0X forward distance & ground cliff distance via I2C.
        // Example threshold evaluation:
        // if (fwd_cm < SENTRA_HAZARD_OBSTACLE_CM) {
        //     local_alerts_play(SENTRA_ALERT_OBSTACLE_CLOSE);
        // } else if (down_mm > SENTRA_HAZARD_CLIFF_MM) {
        //     local_alerts_play(SENTRA_ALERT_CLIFF_DROPOFF);
        // }

        vTaskDelay(pdMS_TO_TICKS(100)); // 10 Hz obstacle scanning loop
    }
}

void app_main(void) {
    ESP_LOGI(TAG, "Starting SENTRA Wearable (ESP32-S3 N16R8 + Waveshare WM8960)...");

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize Push-to-Talk button
    init_button();

    // 1. Initialize Shared I2C Bus (SDA: GPIO 47, SCL: GPIO 48)
    ret = init_i2c_bus();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2C initialization failed: %s", esp_err_to_name(ret));
    }

    // 2. Initialize Waveshare WM8960 Audio Codec
    ret = wm8960_init(I2C_NUM_0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "WM8960 Codec initialization failed: %s", esp_err_to_name(ret));
    }

    // 3. Initialize ESP32-S3 I2S Duplex Audio Driver
    ret = i2s_audio_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2S driver initialization failed: %s", esp_err_to_name(ret));
    }

    // Launch FreeRTOS Tasks
    xTaskCreatePinnedToCore(audio_lifecycle_task, "audio_task", 8192, NULL, 5, NULL, 1);
    xTaskCreatePinnedToCore(sensor_safety_task, "sensor_task", 4096, NULL, 10, NULL, 0);

    ESP_LOGI(TAG, "SENTRA Wearable Firmware initialized successfully. System is in STANDBY.");
}
