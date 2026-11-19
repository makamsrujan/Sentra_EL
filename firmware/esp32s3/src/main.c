/**
 * @file main.c
 * @brief SENTRA ESP32-S3 N16R8 Wearable Firmware Main Entry Point
 *
 * Finalized Baseline Hardware (Headband wired harness -> Bag enclosure):
 *   - 1 x OV2640 Camera (headband)
 *   - 1 x VL53L0X Forward ToF (headband)
 *   - 1 x GY-521 MPU6050 IMU (headband)
 * Optional Modules (Kconfig disabled by default; not required for operation):
 *   - Waveshare WM8960 Audio Codec (CONFIG_SENTRA_ENABLE_WM8960)
 *   - VL53L5CX Depth Sensor (CONFIG_SENTRA_ENABLE_VL53L5CX)
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "driver/gpio.h"

#include "sentra_config.h"
#include "sentra_nvs_config.h"
#include "i2c_bus.h"
#include "vl53l0x.h"
#include "vl53l5cx_optional.h"
#include "mpu6050.h"
#include "wm8960.h"
#include "i2s_audio.h"
#include "local_alerts.h"
#include "obstacle_awareness.h"
#include "audio_http.h"
#include "wifi_transport.h"
#include "camera_driver.h"
#include "device_telemetry.h"

static const char *TAG = "SENTRA_MAIN";

static volatile sentra_audio_state_t s_current_state = SENTRA_AUDIO_STATE_STANDBY;
static uint32_t s_audio_sequence = 1;
static volatile bool s_camera_ready = false;
static volatile bool s_forward_tof_ready = false;
static volatile bool s_imu_ready = false;
static volatile bool s_wm8960_ready = false;

const char* sentra_audio_state_to_string(sentra_audio_state_t state) {
    switch (state) {
        case SENTRA_AUDIO_STATE_STANDBY:           return "STANDBY";
        case SENTRA_AUDIO_STATE_RECORDING:         return "RECORDING";
        case SENTRA_AUDIO_STATE_TRANSCRIBING:      return "TRANSCRIBING";
        case SENTRA_AUDIO_STATE_REASONING:         return "REASONING";
        case SENTRA_AUDIO_STATE_SPEECH_GENERATION: return "SPEECH_GENERATION";
        case SENTRA_AUDIO_STATE_PLAYBACK:          return "PLAYBACK";
        case SENTRA_AUDIO_STATE_ERROR:             return "ERROR";
        case SENTRA_AUDIO_STATE_CANCELLED:         return "CANCELLED";
        case SENTRA_AUDIO_STATE_DISCONNECTED:      return "DISCONNECTED";
        default:                                   return "UNKNOWN";
    }
}

static void set_audio_state(sentra_audio_state_t new_state) {
    if (s_current_state != new_state) {
        ESP_LOGI(TAG, "Audio State Transition: [%s] -> [%s]",
                 sentra_audio_state_to_string(s_current_state),
                 sentra_audio_state_to_string(new_state));
        s_current_state = new_state;
    }
}

static void init_button(void) {
    if (SENTRA_PIN_ACTION_BUTTON < 0) return;
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << SENTRA_PIN_ACTION_BUTTON),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

#ifdef CONFIG_SENTRA_ENABLE_WM8960
static void audio_lifecycle_task(void *pvParameters) {
    (void)pvParameters;
    size_t alloc_size = SENTRA_AUDIO_REC_BUFFER_SIZE + SENTRA_AUDIO_WAV_HEADER_SIZE;
    uint8_t *wav_buffer = (uint8_t *)heap_caps_malloc(alloc_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!wav_buffer) {
        wav_buffer = (uint8_t *)malloc(alloc_size);
    }
    if (!wav_buffer) {
        ESP_LOGE(TAG, "Failed to allocate audio recording buffer; falling back to action poll.");
        for (;;) {
            if (wifi_transport_is_connected()) {
                (void)audio_http_poll_and_execute_actions();
            }
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }

    ESP_LOGI(TAG, "Optional WM8960 audio lifecycle task active (PTT GPIO %d).", SENTRA_PIN_ACTION_BUTTON);
    int64_t last_poll_ms = 0;

    while (1) {
        if (s_wm8960_ready && SENTRA_PIN_ACTION_BUTTON >= 0 &&
            gpio_get_level((gpio_num_t)SENTRA_PIN_ACTION_BUTTON) == 0) {
            vTaskDelay(pdMS_TO_TICKS(50));
            if (gpio_get_level((gpio_num_t)SENTRA_PIN_ACTION_BUTTON) == 0) {
                (void)local_alerts_play(SENTRA_ALERT_MIC_ACTIVATED);
                set_audio_state(SENTRA_AUDIO_STATE_RECORDING);

                size_t bytes_written = 0;
                esp_err_t rec_err = i2s_audio_record_wav(wav_buffer, SENTRA_AUDIO_REC_BUFFER_SIZE, 3500, &bytes_written);
                (void)local_alerts_play(SENTRA_ALERT_MIC_STOPPED);

                if (rec_err == ESP_OK && bytes_written > 44) {
                    set_audio_state(SENTRA_AUDIO_STATE_TRANSCRIBING);
                    sentra_http_utterance_result_t result = {0};
                    esp_err_t upload_err = audio_http_upload_utterance(wav_buffer, bytes_written, s_audio_sequence++, &result);
                    if (upload_err == ESP_OK && result.ok) {
                        if (result.wake_detected && strlen(result.audio_reply_id) > 0) {
                            set_audio_state(SENTRA_AUDIO_STATE_PLAYBACK);
                            (void)audio_http_fetch_and_play_reply(result.audio_reply_id);
                        }
                        set_audio_state(SENTRA_AUDIO_STATE_STANDBY);
                    } else {
                        set_audio_state(SENTRA_AUDIO_STATE_ERROR);
                        vTaskDelay(pdMS_TO_TICKS(1000));
                        set_audio_state(SENTRA_AUDIO_STATE_STANDBY);
                    }
                } else {
                    set_audio_state(SENTRA_AUDIO_STATE_ERROR);
                    vTaskDelay(pdMS_TO_TICKS(1000));
                    set_audio_state(SENTRA_AUDIO_STATE_STANDBY);
                }
            }
        }

        int64_t now_ms = esp_timer_get_time() / 1000;
        if (wifi_transport_is_connected() && (now_ms - last_poll_ms >= 1000)) {
            last_poll_ms = now_ms;
            (void)audio_http_poll_and_execute_actions();
        }
        vTaskDelay(pdMS_TO_TICKS(200));
    }
}
#endif

static void control_poll_task(void *pvParameters) {
    (void)pvParameters;
    ESP_LOGI(TAG, "Remote action/config poll task active (WM8960 audio %s).",
             s_wm8960_ready ? "ready" : "absent/disabled");
    for (;;) {
        if (wifi_transport_is_connected()) {
            (void)audio_http_poll_and_execute_actions();
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

/**
 * @brief Nonblocking local safety loop: acquires single forward VL53L0X + IMU recal,
 *        evaluates obstacle awareness with hysteresis, and dispatches optional local alerts.
 */
static void sensor_safety_task(void *pvParameters) {
    (void)pvParameters;
    sentra_obstacle_tracker_t obstacle_tracker;
    sentra_obstacle_tracker_init(&obstacle_tracker);

    uint8_t consecutive_tof_errors = 0;
    int64_t last_tof_reprobe_ms = 0;

    while (1) {
        sentra_runtime_config_t cfg = {0};
        sentra_nvs_config_get(&cfg);
        int64_t now_ms = esp_timer_get_time() / 1000;

        if (s_imu_ready && sentra_nvs_consume_imu_recalibration_request()) {
            ESP_LOGI(TAG, "Running remote IMU bias recalibration...");
            (void)sentra_mpu6050_calibrate(I2C_NUM_0, 40);
        }

#ifdef CONFIG_SENTRA_ENABLE_VL53L0X
        vl53l0x_reading_t reading = {0};
        reading.timestamp_ms = now_ms;

        if (s_forward_tof_ready) {
            esp_err_t err = vl53l0x_read_validated(I2C_NUM_0, SENTRA_VL53L0X_I2C_ADDR, &reading);
            if (err == ESP_OK) {
                consecutive_tof_errors = 0;
            } else {
                consecutive_tof_errors++;
                if (reading.status == VL53L0X_STATUS_DISCONNECTED || !vl53l0x_is_initialized() ||
                    consecutive_tof_errors >= 5) {
                    ESP_LOGW(TAG, "Forward VL53L0X fault/disconnect (err=%s); attempting recovery...",
                             esp_err_to_name(err));
                    bool recovered = (vl53l0x_init_single(I2C_NUM_0, SENTRA_PIN_TOF_FWD_XSHUT, SENTRA_VL53L0X_I2C_ADDR) == ESP_OK);
                    s_forward_tof_ready = recovered;
                    sentra_telemetry_set_forward_tof_initialized(recovered);
                    last_tof_reprobe_ms = now_ms;
                    consecutive_tof_errors = 0;
                }
            }
        } else if (sentra_i2c_bus_is_ready() && (now_ms - last_tof_reprobe_ms >= 5000)) {
            /* Bounded periodic re-probe if headband ToF cable was disconnected and later reattached */
            last_tof_reprobe_ms = now_ms;
            if (vl53l0x_init_single(I2C_NUM_0, SENTRA_PIN_TOF_FWD_XSHUT, SENTRA_VL53L0X_I2C_ADDR) == ESP_OK) {
                s_forward_tof_ready = true;
                sentra_telemetry_set_forward_tof_initialized(true);
                ESP_LOGI(TAG, "Forward VL53L0X reattached and initialized.");
            }
        }

        const sentra_obstacle_config_t eval_cfg = {
            .critical_cm = cfg.proximity_critical_cm,
            .caution_cm = cfg.proximity_caution_cm,
            .hysteresis_cm = SENTRA_HAZARD_HYSTERESIS_CM,
            .alert_cooldown_ms = SENTRA_ALERT_COOLDOWN_MS,
            .invalid_suppress_count = 3,
        };
        sentra_obstacle_decision_t decision = sentra_obstacle_evaluate(
            &obstacle_tracker, &reading, s_forward_tof_ready, &eval_cfg, now_ms
        );
        sentra_telemetry_update_forward_tof(&reading, decision.current_level);

        if (decision.should_trigger_critical_alert && local_alerts_is_available()) {
            (void)local_alerts_play(SENTRA_ALERT_OBSTACLE_CLOSE);
        }
#endif

        uint32_t interval = cfg.tof_sample_interval_ms >= 50 ? cfg.tof_sample_interval_ms : 250;
        vTaskDelay(pdMS_TO_TICKS(interval));
    }
}

static void camera_upload_task(void *argument) {
    (void)argument;
    uint32_t frame_sequence = 1;
    int64_t last_upload_ms = 0;

    for (;;) {
        sentra_runtime_config_t cfg = {0};
        sentra_nvs_config_get(&cfg);
        int64_t now_ms = esp_timer_get_time() / 1000;
        bool immediate = sentra_nvs_consume_immediate_frame_request();
        uint32_t interval_ms = cfg.frame_upload_interval_ms >= 250 ? cfg.frame_upload_interval_ms : 1200;

        if (camera_driver_is_ready() && wifi_transport_is_connected() &&
            cfg.device_token[0] != '\0' && cfg.server_url[0] != '\0' &&
            (immediate || (now_ms - last_upload_ms >= (int64_t)interval_ms))) {
            last_upload_ms = now_ms;
            sentra_camera_frame_t frame = {0};
            if (camera_driver_capture(&frame) == ESP_OK) {
                esp_err_t result = camera_driver_upload_frame(
                    &frame, cfg.server_url, cfg.device_id, cfg.device_token, frame_sequence++
                );
                camera_driver_release(&frame);
                if (result != ESP_OK) {
                    ESP_LOGW(TAG, "Camera JPEG upload unsuccessful: %s", esp_err_to_name(result));
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(150));
    }
}

void app_main(void) {
    ESP_LOGI(TAG, "Starting SENTRA Wearable Firmware %s (ESP32-S3 N16R8)...", SENTRA_FIRMWARE_VERSION);

    sentra_telemetry_init_sync();

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_ERROR_CHECK(sentra_nvs_config_load());
    sentra_runtime_config_t cfg = {0};
    sentra_nvs_config_get(&cfg);

    init_button();

    ret = sentra_i2c_bus_init(I2C_NUM_0, SENTRA_PIN_I2C_SDA, SENTRA_PIN_I2C_SCL, SENTRA_I2C_FREQ_HZ);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2C initialization failed: %s", esp_err_to_name(ret));
    }

#ifdef CONFIG_SENTRA_ENABLE_MPU6050
    if (ret == ESP_OK) {
        esp_err_t imu_status = sentra_mpu6050_init(I2C_NUM_0);
        s_imu_ready = (imu_status == ESP_OK);
        if (!s_imu_ready) ESP_LOGW(TAG, "MPU6050 unavailable: %s", esp_err_to_name(imu_status));
    }
#endif
    sentra_telemetry_set_imu_initialized(s_imu_ready);

#ifdef CONFIG_SENTRA_ENABLE_VL53L0X
    if (ret == ESP_OK) {
        esp_err_t tof_status = vl53l0x_init_single(I2C_NUM_0, SENTRA_PIN_TOF_FWD_XSHUT, SENTRA_VL53L0X_I2C_ADDR);
        s_forward_tof_ready = (tof_status == ESP_OK);
        if (!s_forward_tof_ready) {
            ESP_LOGW(TAG, "Forward VL53L0X unavailable: %s", esp_err_to_name(tof_status));
        }
    }
#endif
    sentra_telemetry_set_forward_tof_initialized(s_forward_tof_ready);

    /* Optional VL53L5CX remains unavailable unless explicitly built and probed */
    sentra_telemetry_set_vl53l5cx_initialized(vl53l5cx_optional_init(I2C_NUM_0) == ESP_OK);

#ifdef CONFIG_SENTRA_ENABLE_WM8960
    if (ret == ESP_OK && wm8960_init(I2C_NUM_0) == ESP_OK && i2s_audio_init() == ESP_OK) {
        s_wm8960_ready = true;
    } else {
        s_wm8960_ready = false;
        ESP_LOGW(TAG, "Optional WM8960 codec absent or init failed; continuing without hardware audio.");
    }
#else
    s_wm8960_ready = false;
    ESP_LOGI(TAG, "Optional WM8960 audio codec disabled (CONFIG_SENTRA_ENABLE_WM8960=n).");
#endif
    local_alerts_set_audio_ready(s_wm8960_ready);
    sentra_telemetry_set_wm8960_initialized(s_wm8960_ready);

    if (cfg.wifi_ssid[0] != '\0' && cfg.server_url[0] != '\0' && cfg.device_token[0] != '\0') {
        esp_err_t wifi_ret = wifi_transport_init();
        if (wifi_ret == ESP_OK) wifi_ret = wifi_transport_connect(cfg.wifi_ssid, cfg.wifi_password);
        if (wifi_ret != ESP_OK) ESP_LOGE(TAG, "Wi-Fi initialization failed: %s", esp_err_to_name(wifi_ret));
    } else {
        ESP_LOGW(TAG, "Wi-Fi/server credentials unset: configure via menuconfig or NVS 'sentra_cfg'.");
    }

#ifdef CONFIG_SENTRA_ENABLE_CAMERA
    esp_err_t cam_ret = camera_driver_init();
    s_camera_ready = (cam_ret == ESP_OK);
    if (!s_camera_ready) ESP_LOGW(TAG, "OV2640 camera unavailable: %s", esp_err_to_name(cam_ret));
#else
    ESP_LOGW(TAG, "OV2640 camera disabled until board pinout and DVP wiring are confirmed.");
#endif
    sentra_telemetry_set_camera_initialized(s_camera_ready);

#ifdef CONFIG_SENTRA_ENABLE_WM8960
    if (s_wm8960_ready) {
        xTaskCreatePinnedToCore(audio_lifecycle_task, "audio_task", 8192, NULL, 5, NULL, 1);
    } else {
        xTaskCreatePinnedToCore(control_poll_task, "poll_task", 6144, NULL, 4, NULL, 1);
    }
#else
    xTaskCreatePinnedToCore(control_poll_task, "poll_task", 6144, NULL, 4, NULL, 1);
#endif
    xTaskCreatePinnedToCore(sensor_safety_task, "sensor_task", 6144, NULL, 10, NULL, 0);
    xTaskCreatePinnedToCore(sentra_telemetry_task, "telemetry_task", 8192, NULL, 4, NULL, 0);
#ifdef CONFIG_SENTRA_ENABLE_CAMERA
    if (s_camera_ready) {
        xTaskCreatePinnedToCore(camera_upload_task, "camera_task", 6144, NULL, 4, NULL, 0);
    }
#endif

    ESP_LOGI(TAG, "SENTRA Firmware ready (VL53L0X=%s, MPU6050=%s, OV2640=%s, WM8960=%s).",
             s_forward_tof_ready ? "ON" : "OFF",
             s_imu_ready ? "ON" : "OFF",
             s_camera_ready ? "ON" : "OFF",
             s_wm8960_ready ? "ON" : "OFF");
}
