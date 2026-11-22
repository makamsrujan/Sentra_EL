/**
 * @file main.c
 * @brief SENTRA ESP32-S3 N16R8 Wearable Controller Main Entry Point
 *
 * Actual Two-Board Hardware Bring-Up:
 *   - Step 1 (Active by default): ESP32-S3 N16R8 + GY-521 MPU6050 (0x68, AD0 low)
 *     + ONE forward VL53L0X (0x29) on I2C SDA=GPIO4, SCL=GPIO40, XSHUT=-1.
 *   - Step 2 (Separate board): ESP32-CAM running firmware/esp32cam over Wi-Fi.
 *     Direct OV2640-to-S3 camera remains disabled (legacy).
 *   - Step 4 (Separate disabled-by-default profile): INMP441 I2S RX mic +
 *     MAX98357A mono I2S TX amp, with NO WM8960 dependency.
 */

#include <math.h>
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
#include "battery_adc.h"
#include "device_telemetry.h"

static const char *TAG = "SENTRA_MAIN";

static volatile sentra_audio_state_t s_current_state = SENTRA_AUDIO_STATE_STANDBY;
static uint32_t s_audio_sequence = 1;
static volatile bool s_camera_ready = false;
static volatile bool s_forward_tof_ready = false;
static volatile bool s_imu_ready = false;
static volatile bool s_wm8960_ready = false;
static volatile bool s_mic_ready = false;
static volatile bool s_speaker_ready = false;
static volatile bool s_battery_adc_ready = false;

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

#if defined(CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE) || defined(CONFIG_SENTRA_ENABLE_WM8960)
static void run_optional_audio_bench_tests(void) {
#ifdef CONFIG_SENTRA_AUDIO_BENCH_TEST_MIC
    if (s_mic_ready) {
        const size_t alloc_size = (SENTRA_AUDIO_REC_SAMPLE_RATE * 2) + SENTRA_AUDIO_WAV_HEADER_SIZE;
        uint8_t *buf = (uint8_t *)heap_caps_malloc(alloc_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!buf) buf = (uint8_t *)malloc(alloc_size);
        if (buf) {
            size_t wav_len = 0;
            ESP_LOGI(TAG, "[AUDIO BENCH] Recording 1000 ms sample from INMP441...");
            if (i2s_audio_record_wav(buf, alloc_size, 1000, &wav_len) == ESP_OK && wav_len > 44) {
                const int16_t *samples = (const int16_t *)(buf + 44);
                size_t count = (wav_len - 44) / 2;
                double sum_sq = 0.0;
                int32_t peak = 0;
                for (size_t i = 0; i < count; i++) {
                    int32_t v = samples[i];
                    if (abs(v) > peak) peak = abs(v);
                    sum_sq += (double)v * (double)v;
                }
                double rms = count > 0 ? sqrt(sum_sq / (double)count) : 0.0;
                ESP_LOGI(TAG, "[AUDIO BENCH] INMP441 capture complete: samples=%u, rms=%.1f, peak=%ld",
                         (unsigned)count, rms, (long)peak);
            } else {
                ESP_LOGW(TAG, "[AUDIO BENCH] INMP441 capture failed.");
            }
            free(buf);
        }
    }
#endif

#ifdef CONFIG_SENTRA_AUDIO_BENCH_TEST_TONE
    if (s_speaker_ready) {
        ESP_LOGI(TAG, "[AUDIO BENCH] Playing conservative 440 Hz tone (400 ms, amp=2500) on MAX98357A...");
        esp_err_t tone_err = i2s_audio_play_bench_tone(440, 400, 2500);
        ESP_LOGI(TAG, "[AUDIO BENCH] Tone playback result: %s", esp_err_to_name(tone_err));
    }
#endif
}

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

    ESP_LOGI(TAG, "Audio lifecycle task active (mic=%s, speaker=%s, PTT=GPIO%d).",
             s_mic_ready ? "ON" : "OFF", s_speaker_ready ? "ON" : "OFF", SENTRA_PIN_ACTION_BUTTON);
    int64_t last_poll_ms = 0;

    while (1) {
        if (s_mic_ready && SENTRA_PIN_ACTION_BUTTON >= 0 &&
            gpio_get_level((gpio_num_t)SENTRA_PIN_ACTION_BUTTON) == 0) {
            vTaskDelay(pdMS_TO_TICKS(50));
            if (gpio_get_level((gpio_num_t)SENTRA_PIN_ACTION_BUTTON) == 0) {
                if (s_speaker_ready) (void)local_alerts_play(SENTRA_ALERT_MIC_ACTIVATED);
                set_audio_state(SENTRA_AUDIO_STATE_RECORDING);

                size_t bytes_written = 0;
                esp_err_t rec_err = i2s_audio_record_wav(wav_buffer, SENTRA_AUDIO_REC_BUFFER_SIZE, 3500, &bytes_written);
                if (s_speaker_ready) (void)local_alerts_play(SENTRA_ALERT_MIC_STOPPED);

                if (rec_err == ESP_OK && bytes_written > 44) {
                    set_audio_state(SENTRA_AUDIO_STATE_TRANSCRIBING);
                    sentra_http_utterance_result_t result = {0};
                    esp_err_t upload_err = audio_http_upload_utterance(wav_buffer, bytes_written, s_audio_sequence++, &result);
                    if (upload_err == ESP_OK && result.ok) {
                        if (s_speaker_ready && strlen(result.audio_reply_id) > 0) {
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
    ESP_LOGI(TAG, "Remote action/config poll task active (embedded audio mic=%s speaker=%s).",
             s_mic_ready ? "ON" : "OFF", s_speaker_ready ? "ON" : "OFF");
    for (;;) {
        if (wifi_transport_is_connected()) {
            (void)audio_http_poll_and_execute_actions();
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void sensor_safety_task(void *pvParameters) {
    (void)pvParameters;
    sentra_obstacle_tracker_t obstacle_tracker;
    sentra_obstacle_tracker_init(&obstacle_tracker);

    uint8_t consecutive_tof_errors = 0;
    int64_t last_tof_reprobe_ms = 0;
    int64_t last_bench_log_ms = 0;

    while (1) {
        sentra_runtime_config_t cfg = {0};
        sentra_nvs_config_get(&cfg);
        int64_t now_ms = esp_timer_get_time() / 1000;

        if (s_imu_ready && sentra_nvs_consume_imu_recalibration_request()) {
            ESP_LOGI(TAG, "Running remote IMU bias recalibration...");
            (void)sentra_mpu6050_calibrate(I2C_NUM_0, 40);
        }

        vl53l0x_reading_t reading = {0};
        reading.timestamp_ms = now_ms;
        reading.status = VL53L0X_STATUS_UNINITIALIZED;
        reading.valid = false;

#ifdef CONFIG_SENTRA_ENABLE_VL53L0X
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

        /* Periodic stationary bench readout over serial monitor (never fabricates missing sensors) */
        if (now_ms - last_bench_log_ms >= 2000) {
            last_bench_log_ms = now_ms;
            sentra_mpu_sample_t imu_sample = {0};
            bool imu_ok = s_imu_ready && (sentra_mpu6050_read(I2C_NUM_0, &imu_sample) == ESP_OK) && imu_sample.valid;

            char tof_str[48];
            if (s_forward_tof_ready && reading.valid) {
                snprintf(tof_str, sizeof(tof_str), "%.1f cm (%u mm, valid)",
                         (double)reading.distance_cm, (unsigned)reading.raw_mm);
            } else {
                snprintf(tof_str, sizeof(tof_str), "UNAVAILABLE (%s)", vl53l0x_status_to_string(reading.status));
            }

            char batt_str[32];
            sentra_battery_reading_t batt_reading = {0};
            if (s_battery_adc_ready && sentra_battery_adc_read(&batt_reading) == ESP_OK && batt_reading.valid) {
                snprintf(batt_str, sizeof(batt_str), "%.2f V (pin %d mV)",
                         (double)batt_reading.voltage_v, batt_reading.pin_mv);
            } else {
                snprintf(batt_str, sizeof(batt_str), "UNAVAILABLE");
            }

            if (imu_ok) {
                ESP_LOGI(TAG, "[BENCH] VL53L0X: %s | MPU6050: pitch=%.1f deg motion=%.2f cal=%s | Batt: %s",
                         tof_str, (double)imu_sample.pitch_deg,
                         (double)imu_sample.motion_magnitude,
                         sentra_mpu6050_is_calibrated() ? "yes" : "no",
                         batt_str);
            } else {
                ESP_LOGI(TAG, "[BENCH] VL53L0X: %s | MPU6050: UNAVAILABLE | Batt: %s", tof_str, batt_str);
            }
        }

        uint32_t interval = cfg.tof_sample_interval_ms >= 50 ? cfg.tof_sample_interval_ms : 250;
        vTaskDelay(pdMS_TO_TICKS(interval));
    }
}

#ifdef CONFIG_SENTRA_ENABLE_CAMERA
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
#endif

void app_main(void) {
    ESP_LOGI(TAG, "Starting SENTRA S3 Sensor Controller %s (ESP32-S3 N16R8)...", SENTRA_FIRMWARE_VERSION);
    ESP_LOGI(TAG, "Bench I2C config: SDA=GPIO%d, SCL=GPIO%d, freq=%u Hz, VL53L0X_XSHUT=%d",
             SENTRA_PIN_I2C_SDA, SENTRA_PIN_I2C_SCL, (unsigned)SENTRA_I2C_FREQ_HZ, SENTRA_PIN_TOF_FWD_XSHUT);

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
    if (ret == ESP_OK) {
        (void)sentra_i2c_bus_scan(I2C_NUM_0);
    } else {
        ESP_LOGE(TAG, "I2C initialization failed: %s", esp_err_to_name(ret));
    }

#ifdef CONFIG_SENTRA_ENABLE_MPU6050
    if (ret == ESP_OK) {
        esp_err_t imu_status = sentra_mpu6050_init(I2C_NUM_0);
        s_imu_ready = (imu_status == ESP_OK);
        if (!s_imu_ready) ESP_LOGW(TAG, "MPU6050 (0x68) unavailable: %s", esp_err_to_name(imu_status));
    }
#endif
    sentra_telemetry_set_imu_initialized(s_imu_ready);

#ifdef CONFIG_SENTRA_ENABLE_VL53L0X
    if (ret == ESP_OK) {
        esp_err_t tof_status = vl53l0x_init_single(I2C_NUM_0, SENTRA_PIN_TOF_FWD_XSHUT, SENTRA_VL53L0X_I2C_ADDR);
        s_forward_tof_ready = (tof_status == ESP_OK);
        if (!s_forward_tof_ready) {
            ESP_LOGW(TAG, "Forward VL53L0X (0x%02X) unavailable: %s",
                     SENTRA_VL53L0X_I2C_ADDR, esp_err_to_name(tof_status));
        }
    }
#endif
    sentra_telemetry_set_forward_tof_initialized(s_forward_tof_ready);
    sentra_telemetry_set_vl53l5cx_initialized(vl53l5cx_optional_init(I2C_NUM_0) == ESP_OK);

#ifdef CONFIG_SENTRA_ENABLE_BATTERY_ADC
    {
        esp_err_t batt_status = sentra_battery_adc_init(SENTRA_PIN_BATTERY_ADC, SENTRA_BATTERY_ADC_SCALE_MILLI);
        s_battery_adc_ready = (batt_status == ESP_OK);
        if (!s_battery_adc_ready) {
            ESP_LOGW(TAG, "Battery ADC (GPIO%d) unavailable: %s",
                     SENTRA_PIN_BATTERY_ADC, esp_err_to_name(batt_status));
        }
    }
#endif
    sentra_telemetry_set_battery_adc_initialized(s_battery_adc_ready);

#ifdef CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE
    ESP_LOGI(TAG, "Separate discrete I2S audio profile enabled (no WM8960).");
#ifdef CONFIG_SENTRA_ENABLE_INMP441_MIC
    s_mic_ready = (i2s_audio_init_inmp441() == ESP_OK);
#endif
#ifdef CONFIG_SENTRA_ENABLE_MAX98357A_AMP
    s_speaker_ready = (i2s_audio_init_max98357a() == ESP_OK);
#endif
    s_wm8960_ready = false;
    run_optional_audio_bench_tests();
#elif defined(CONFIG_SENTRA_ENABLE_WM8960)
    if (ret == ESP_OK && wm8960_init(I2C_NUM_0) == ESP_OK && i2s_audio_init() == ESP_OK) {
        s_wm8960_ready = true;
        s_mic_ready = true;
        s_speaker_ready = true;
    } else {
        s_wm8960_ready = false;
        ESP_LOGW(TAG, "[LEGACY] WM8960 codec absent or init failed; continuing without hardware audio.");
    }
#else
    s_wm8960_ready = false;
    s_mic_ready = false;
    s_speaker_ready = false;
    ESP_LOGI(TAG, "Embedded audio disabled by default (phone/browser audio fallback active).");
#endif
    local_alerts_set_audio_ready(s_speaker_ready);
    sentra_telemetry_set_wm8960_initialized(s_wm8960_ready);
    sentra_telemetry_set_audio_output_initialized(s_speaker_ready);

    if (cfg.wifi_ssid[0] != '\0' && cfg.server_url[0] != '\0' && cfg.device_token[0] != '\0') {
        esp_err_t wifi_ret = wifi_transport_init();
        if (wifi_ret == ESP_OK) wifi_ret = wifi_transport_connect(cfg.wifi_ssid, cfg.wifi_password);
        if (wifi_ret != ESP_OK) ESP_LOGE(TAG, "Wi-Fi initialization failed: %s", esp_err_to_name(wifi_ret));
    } else {
        ESP_LOGW(TAG, "Wi-Fi/server credentials unset: running local serial bench mode (configure menuconfig or NVS 'sentra_cfg').");
    }

#ifdef CONFIG_SENTRA_ENABLE_CAMERA
    esp_err_t cam_ret = camera_driver_init();
    s_camera_ready = (cam_ret == ESP_OK);
    if (!s_camera_ready) ESP_LOGW(TAG, "[LEGACY] Direct OV2640 camera unavailable: %s", esp_err_to_name(cam_ret));
#else
    ESP_LOGI(TAG, "Direct S3 camera disabled (separate ESP32-CAM runs firmware/esp32cam over Wi-Fi).");
#endif
    sentra_telemetry_set_camera_initialized(s_camera_ready);

#if defined(CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE) || defined(CONFIG_SENTRA_ENABLE_WM8960)
    if (s_mic_ready || s_speaker_ready) {
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

    ESP_LOGI(TAG, "SENTRA S3 ready (VL53L0X=%s, MPU6050=%s, BattADC=%s, INMP441=%s, MAX98357A=%s, LegacyCam=%s, LegacyWM8960=%s).",
             s_forward_tof_ready ? "ON" : "OFF",
             s_imu_ready ? "ON" : "OFF",
             s_battery_adc_ready ? "ON" : "OFF",
             s_mic_ready ? "ON" : "OFF",
             s_speaker_ready ? "ON" : "OFF",
             s_camera_ready ? "ON" : "OFF",
             s_wm8960_ready ? "ON" : "OFF");
}
