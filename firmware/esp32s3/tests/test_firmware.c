/**
 * @file test_firmware.c
 * @brief Native Host Unit Tests for SENTRA ESP32-S3 Firmware Modules (Simulated I2C & State)
 *
 * Covers all 12 pre-hardware verification cases using the actual firmware .c files:
 *   1. Valid VL53L0X measurements
 *   2. Invalid VL53L0X measurements (bad status / out-of-range)
 *   3. VL53L0X sensor initialization failure
 *   4. I2C communication failure
 *   5. VL53L0X sensor disconnection & recovery
 *   6. Distance unit conversion (mm / 10.0 == cm)
 *   7. Obstacle threshold transitions (NONE -> CAUTION -> CRITICAL)
 *   8. Alert hysteresis & cooldown + invalid suppression
 *   9. Optional WM8960 audio disabled
 *  10. Camera unavailable handling
 *  11. Wi-Fi disconnection behavior
 *  12. Telemetry JSON serialization (--dump-json prints payloads for backend contract test)
 */

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "mock_idf.h"
#include "vl53l0x.h"
#include "mpu6050.h"
#include "obstacle_awareness.h"
#include "local_alerts.h"
#include "board_profile.h"
#include "i2s_audio.h"
#include "battery_adc.h"
#include "device_telemetry.h"

/* ========================================================================= */
/* Mock HAL State (I2C register file for simulated VL53L0X at 0x29)          */
/* ========================================================================= */
typedef struct {
    bool connected;
    bool wrong_model_id;
    bool fail_next_xfer;
    bool never_ready_timeout;
    uint8_t model_id;
    uint8_t range_status_reg;
    uint16_t range_mm;
    int xshut_reset_count;
    int64_t now_us;
} mock_hal_t;

static mock_hal_t g_hal;

static void reset_hal(void) {
    memset(&g_hal, 0, sizeof(g_hal));
    g_hal.connected = true;
    g_hal.model_id = 0xEE;
    g_hal.range_status_reg = (11 << 3); /* Range Valid */
    g_hal.range_mm = 1200;
    g_hal.now_us = 1000000LL; /* 1000 ms */
}

int64_t esp_timer_get_time(void) {
    return g_hal.now_us;
}

void vTaskDelay(uint32_t ticks) {
    g_hal.now_us += (int64_t)ticks * 1000LL;
}

esp_err_t gpio_config(const gpio_config_t *pGPIOConfig) {
    (void)pGPIOConfig;
    return ESP_OK;
}

esp_err_t gpio_set_level(gpio_num_t gpio_num, uint32_t level) {
    (void)gpio_num;
    if (level == 0) g_hal.xshut_reset_count++;
    return ESP_OK;
}

esp_err_t sentra_i2c_write_reg8(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t value) {
    (void)bus;
    (void)reg;
    (void)value;
    if (!g_hal.connected || dev_addr != 0x29) return ESP_FAIL;
    if (g_hal.fail_next_xfer) {
        g_hal.fail_next_xfer = false;
        return ESP_FAIL;
    }
    return ESP_OK;
}

esp_err_t sentra_i2c_read_regs(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t *out_buf, size_t len) {
    (void)bus;
    if (!out_buf || len == 0) return ESP_ERR_INVALID_ARG;
    if (!g_hal.connected || dev_addr != 0x29) return ESP_FAIL;
    if (g_hal.fail_next_xfer) {
        g_hal.fail_next_xfer = false;
        return ESP_FAIL;
    }

    if (reg == 0xC0) {
        out_buf[0] = g_hal.wrong_model_id ? 0xAA : g_hal.model_id;
        return ESP_OK;
    }
    if (reg == 0x13) {
        out_buf[0] = g_hal.never_ready_timeout ? 0x00 : 0x04; /* data ready interrupt */
        return ESP_OK;
    }
    if (reg == 0x14) {
        out_buf[0] = g_hal.range_status_reg;
        return ESP_OK;
    }
    memset(out_buf, 0x01, len);
    return ESP_OK;
}

esp_err_t sentra_i2c_read_reg16(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint16_t *out_val_be) {
    (void)bus;
    if (!out_val_be) return ESP_ERR_INVALID_ARG;
    if (!g_hal.connected || dev_addr != 0x29) return ESP_FAIL;
    if (g_hal.fail_next_xfer) {
        g_hal.fail_next_xfer = false;
        return ESP_FAIL;
    }
    if (reg == (uint8_t)(0x14 + 10)) {
        *out_val_be = g_hal.range_mm;
        return ESP_OK;
    }
    *out_val_be = 512;
    return ESP_OK;
}

/* ========================================================================= */
/* 12 Pre-Hardware Test Cases                                                */
/* ========================================================================= */

static void test_1_valid_vl53l0x_measurement(void) {
    reset_hal();
    assert(vl53l0x_init_single(I2C_NUM_0, 21, 0x29) == ESP_OK);
    assert(vl53l0x_is_initialized() == true);
    assert(g_hal.xshut_reset_count == 1);

    g_hal.range_mm = 840;
    vl53l0x_reading_t r = {0};
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_OK);
    assert(r.valid == true);
    assert(r.out_of_range == false);
    assert(r.raw_mm == 840);
    assert(fabsf(r.distance_cm - 84.0f) < 0.01f);
    assert(r.status == VL53L0X_STATUS_OK);
}

static void test_2_invalid_and_out_of_range_measurements(void) {
    reset_hal();
    assert(vl53l0x_init_single(I2C_NUM_0, -1, 0x29) == ESP_OK);

    /* Case A: 8190 ST no-target sentinel */
    g_hal.range_mm = 8190;
    vl53l0x_reading_t r = {0};
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_OK);
    assert(r.valid == false);
    assert(r.out_of_range == true);
    assert(r.distance_cm == 0.0f);
    assert(r.status == VL53L0X_STATUS_OUT_OF_RANGE);

    /* Case B: bad hardware range status (sigma fail = status bits [6:3] = 4) */
    g_hal.range_mm = 500;
    g_hal.range_status_reg = (4 << 3);
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_OK);
    assert(r.valid == false);
    assert(r.status == VL53L0X_STATUS_INVALID_RANGE);

    /* Case C: physically impossible <20 mm noise */
    g_hal.range_status_reg = (11 << 3);
    g_hal.range_mm = 10;
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_OK);
    assert(r.valid == false);
    assert(r.status == VL53L0X_STATUS_INVALID_RANGE);
}

static void test_3_sensor_init_failure(void) {
    reset_hal();
    g_hal.connected = false;
    assert(vl53l0x_init_single(I2C_NUM_0, 21, 0x29) != ESP_OK);
    assert(vl53l0x_is_initialized() == false);

    reset_hal();
    g_hal.wrong_model_id = true;
    assert(vl53l0x_init_single(I2C_NUM_0, 21, 0x29) == ESP_ERR_INVALID_RESPONSE);
    assert(vl53l0x_is_initialized() == false);
}

static void test_4_i2c_communication_failure_and_timeout(void) {
    reset_hal();
    assert(vl53l0x_init_single(I2C_NUM_0, -1, 0x29) == ESP_OK);

    /* Timeout waiting for interrupt data ready */
    g_hal.never_ready_timeout = true;
    vl53l0x_reading_t r = {0};
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_ERR_TIMEOUT);
    assert(r.valid == false);
    assert(r.status == VL53L0X_STATUS_TIMEOUT);

    /* Transient single I2C error while sensor still responds to ping */
    g_hal.never_ready_timeout = false;
    g_hal.fail_next_xfer = true;
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) != ESP_OK);
    assert(r.valid == false);
    assert(r.status == VL53L0X_STATUS_I2C_ERROR);
    assert(vl53l0x_is_initialized() == true);
}

static void test_5_sensor_disconnection_and_recovery(void) {
    reset_hal();
    assert(vl53l0x_init_single(I2C_NUM_0, 21, 0x29) == ESP_OK);
    assert(vl53l0x_is_initialized() == true);

    /* Physically unplug VL53L0X */
    g_hal.connected = false;
    vl53l0x_reading_t r = {0};
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) != ESP_OK);
    assert(r.valid == false);
    assert(r.status == VL53L0X_STATUS_DISCONNECTED);
    assert(vl53l0x_is_initialized() == false);

    /* Subsequent reads fail fast until re-initialized */
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_ERR_INVALID_STATE);
    assert(r.status == VL53L0X_STATUS_UNINITIALIZED);

    /* Plug back in and recover */
    g_hal.connected = true;
    g_hal.range_mm = 370;
    assert(vl53l0x_init_single(I2C_NUM_0, 21, 0x29) == ESP_OK);
    assert(vl53l0x_read_validated(I2C_NUM_0, 0x29, &r) == ESP_OK);
    assert(r.valid == true);
    assert(fabsf(r.distance_cm - 37.0f) < 0.01f);
}

static void test_6_distance_unit_conversion(void) {
    assert(fabsf(vl53l0x_mm_to_cm(45) - 4.5f) < 0.001f);
    assert(fabsf(vl53l0x_mm_to_cm(450) - 45.0f) < 0.001f);
    assert(fabsf(vl53l0x_mm_to_cm(1234) - 123.4f) < 0.001f);
}

static void test_7_obstacle_threshold_transitions(void) {
    sentra_obstacle_tracker_t tracker;
    sentra_obstacle_tracker_init(&tracker);
    const sentra_obstacle_config_t cfg = {
        .critical_cm = 45,
        .caution_cm = 100,
        .hysteresis_cm = 10,
        .alert_cooldown_ms = 3000,
        .invalid_suppress_count = 3,
    };

    vl53l0x_reading_t r = { .valid = true, .distance_cm = 160.0f };
    sentra_obstacle_decision_t d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 1000);
    assert(d.current_level == SENTRA_OBSTACLE_NONE);
    assert(d.should_trigger_critical_alert == false);

    r.distance_cm = 85.0f;
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 1250);
    assert(d.current_level == SENTRA_OBSTACLE_CAUTION);
    assert(d.level_changed == true);
    assert(d.should_trigger_critical_alert == false);

    r.distance_cm = 38.0f;
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 1500);
    assert(d.current_level == SENTRA_OBSTACLE_CRITICAL);
    assert(d.should_trigger_critical_alert == true);
}

static void test_8_alert_hysteresis_cooldown_and_suppression(void) {
    sentra_obstacle_tracker_t tracker;
    sentra_obstacle_tracker_init(&tracker);
    const sentra_obstacle_config_t cfg = {
        .critical_cm = 45,
        .caution_cm = 100,
        .hysteresis_cm = 10,
        .alert_cooldown_ms = 3000,
        .invalid_suppress_count = 3,
    };

    /* Enter CRITICAL at 42 cm */
    vl53l0x_reading_t r = { .valid = true, .distance_cm = 42.0f };
    sentra_obstacle_decision_t d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 1000);
    assert(d.current_level == SENTRA_OBSTACLE_CRITICAL);
    assert(d.should_trigger_critical_alert == true);

    /* Move to 49 cm (above 45 enter, below 55 release): MUST remain CRITICAL due to hysteresis! */
    /* Also within 3000 ms cooldown -> do NOT re-trigger beep */
    r.distance_cm = 49.0f;
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 2000);
    assert(d.current_level == SENTRA_OBSTACLE_CRITICAL);
    assert(d.should_trigger_critical_alert == false);

    /* Cooldown expires at 4200 ms -> alerts once again while still CRITICAL */
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 4200);
    assert(d.current_level == SENTRA_OBSTACLE_CRITICAL);
    assert(d.should_trigger_critical_alert == true);

    /* Single invalid reading should be suppressed (does not flap CRITICAL -> UNKNOWN on 1 glitch) */
    vl53l0x_reading_t bad = { .valid = false, .status = VL53L0X_STATUS_TIMEOUT };
    d = sentra_obstacle_evaluate(&tracker, &bad, true, &cfg, 4500);
    assert(d.current_level == SENTRA_OBSTACLE_CRITICAL);
    assert(d.should_trigger_critical_alert == false);

    /* 3 consecutive invalid readings clear state safely to UNKNOWN */
    (void)sentra_obstacle_evaluate(&tracker, &bad, true, &cfg, 4750);
    d = sentra_obstacle_evaluate(&tracker, &bad, true, &cfg, 5000);
    assert(d.current_level == SENTRA_OBSTACLE_UNKNOWN);

    /* Re-enter CRITICAL at 40 cm, then move >= 55 cm to release to CAUTION, >= 110 cm to NONE */
    r.distance_cm = 40.0f;
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 8500);
    assert(d.current_level == SENTRA_OBSTACLE_CRITICAL);

    r.distance_cm = 56.0f;
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 8750);
    assert(d.current_level == SENTRA_OBSTACLE_CAUTION);

    r.distance_cm = 104.0f; /* below 110 exit threshold -> stays CAUTION */
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 9000);
    assert(d.current_level == SENTRA_OBSTACLE_CAUTION);

    r.distance_cm = 112.0f; /* >= 110 cm -> releases cleanly to NONE */
    d = sentra_obstacle_evaluate(&tracker, &r, true, &cfg, 9250);
    assert(d.current_level == SENTRA_OBSTACLE_NONE);
}

static void test_9_optional_audio_disabled(void) {
    local_alerts_set_audio_ready(false);
    assert(local_alerts_is_available() == false);
    assert(local_alerts_play(SENTRA_ALERT_OBSTACLE_CLOSE) == ESP_ERR_NOT_SUPPORTED);
    assert(local_alerts_play(SENTRA_ALERT_DISCONNECTED) == ESP_ERR_NOT_SUPPORTED);
#if defined(CONFIG_SENTRA_ENABLE_MAX98357A_AMP) || defined(CONFIG_SENTRA_ENABLE_MAX98357A)
    /* Discrete MAX98357A enables speaker output availability without WM8960 */
    local_alerts_set_audio_ready(true);
    assert(local_alerts_is_available() == true);
    local_alerts_set_audio_ready(false);
#else
    local_alerts_set_audio_ready(true);
    assert(local_alerts_is_available() == false);
#endif
}

static void test_10_camera_unavailable_telemetry(void) {
    char buf[1280];
    sentra_mpu_sample_t imu = {0};
    mpu6050_compute_sample_from_raw(0, 0, 16384, 0, 0, 0, NULL, &imu);

    sentra_telemetry_snapshot_t snap = {
        .device_id = "ESP32-S3-SENTRA-001",
        .firmware_version = "1.2.0-prehw",
        .sequence = 7,
        .uptime_ms = 5400,
        .camera_ready = false,
        .imu_ready = true,
        .forward_tof_ready = true,
        .wm8960_ready = false,
        .vl53l5cx_ready = false,
        .tof_fresh = true,
        .forward_reading = { .valid = true, .raw_mm = 620, .distance_cm = 62.0f, .status = VL53L0X_STATUS_OK },
        .obstacle_level = SENTRA_OBSTACLE_CAUTION,
        .imu_valid = imu.valid,
        .imu_calibrated = false,
        .imu_sample = imu,
    };

    int n = sentra_telemetry_build_json(&snap, buf, sizeof(buf));
    assert(n > 100);
    assert(strstr(buf, "\"camera\":false") != NULL);
    assert(strstr(buf, "\"camera\":\"unavailable\"") != NULL);
    assert(strstr(buf, "\"forwardDistanceCm\":62.0") != NULL);
    assert(strstr(buf, "\"downwardToF\":false") != NULL);
    assert(strstr(buf, "\"downwardDistanceMm\":null") != NULL);
    assert(strstr(buf, "\"audioOutput\":false") != NULL);
    assert(strstr(buf, "\"heading\":null") != NULL);
}

static void test_11_wifi_disconnection(void) {
    assert(sentra_telemetry_can_upload(false, "http://192.168.1.10:3000", "tok") == false);
    assert(sentra_telemetry_can_upload(true, "", "tok") == false);
    assert(sentra_telemetry_can_upload(true, "http://192.168.1.10:3000", "") == false);
    assert(sentra_telemetry_can_upload(true, "http://192.168.1.10:3000", "tok") == true);
}

static void test_12_telemetry_serialization_missing_and_valid(int dump_json) {
    char buf_valid[1280];
    char buf_missing[1280];

    sentra_mpu_calibration_t cal = { .calibrated = true };
    sentra_mpu_sample_t imu = {0};
    mpu6050_compute_sample_from_raw(500, 0, 16384, 12, -4, 2, &cal, &imu);

    sentra_telemetry_snapshot_t valid_snap = {
        .device_id = "ESP32-S3-SENTRA-001",
        .firmware_version = "1.2.0-prehw",
        .sequence = 42,
        .uptime_ms = 12345,
        .camera_ready = true,
        .imu_ready = true,
        .forward_tof_ready = true,
        .wm8960_ready = false,
        .vl53l5cx_ready = false,
        .tof_fresh = true,
        .forward_reading = { .valid = true, .raw_mm = 425, .distance_cm = vl53l0x_mm_to_cm(425), .status = VL53L0X_STATUS_OK },
        .obstacle_level = SENTRA_OBSTACLE_CRITICAL,
        .imu_valid = imu.valid,
        .imu_calibrated = true,
        .imu_sample = imu,
        .battery_voltage_valid = true,
        .battery_voltage_v = 3.92f,
    };
    assert(sentra_telemetry_build_json(&valid_snap, buf_valid, sizeof(buf_valid)) > 0);
    assert(strstr(buf_valid, "\"forwardDistanceCm\":42.5") != NULL);
    assert(strstr(buf_valid, "\"batteryVoltageV\":3.92") != NULL);
    assert(strstr(buf_valid, "\"forwardToF\":\"valid\"") != NULL);
    assert(strstr(buf_valid, "\"forwardToF\":true") != NULL);

    sentra_telemetry_snapshot_t missing_snap = {
        .device_id = "ESP32-S3-SENTRA-001",
        .firmware_version = "1.2.0-prehw",
        .sequence = 43,
        .uptime_ms = 14345,
        .camera_ready = false,
        .imu_ready = false,
        .forward_tof_ready = false,
        .wm8960_ready = false,
        .vl53l5cx_ready = false,
        .tof_fresh = false,
        .forward_reading = { .valid = false, .status = VL53L0X_STATUS_DISCONNECTED },
        .obstacle_level = SENTRA_OBSTACLE_UNKNOWN,
        .imu_valid = false,
        .imu_calibrated = false,
        .battery_voltage_valid = false,
        .battery_voltage_v = 0.0f,
    };
    assert(sentra_telemetry_build_json(&missing_snap, buf_missing, sizeof(buf_missing)) > 0);
    assert(strstr(buf_missing, "\"forwardDistanceCm\":null") != NULL);
    assert(strstr(buf_missing, "\"batteryVoltageV\":null") != NULL);
    assert(strstr(buf_missing, "\"imu\":null") != NULL);
    assert(strstr(buf_missing, "\"headPitchDeg\":null") != NULL);
    assert(strstr(buf_missing, "\"forwardToF\":false") != NULL);

    if (dump_json) {
        printf("JSON_VALID=%s\n", buf_valid);
        printf("JSON_MISSING=%s\n", buf_missing);
    }
}


static void test_13_discrete_audio_i2s_and_pin_profile(void) {
    /* Bench sensor profile constants */
    assert(BOARD_PIN_I2C_SDA == 4);
    assert(BOARD_PIN_I2C_SCL == 7);
    assert(BOARD_PIN_VL53L0X_FWD_XSHUT == -1);

    /* INMP441 24-bit MSB-aligned word -> clamped 16-bit PCM */
    assert(i2s_audio_convert_inmp441_sample(0) == 0);
    assert(i2s_audio_convert_inmp441_sample(16384 << 16) == 16384);
    assert(i2s_audio_convert_inmp441_sample(-(12000 << 16)) == -12000);
    assert(i2s_audio_convert_inmp441_sample(0x7FFFFFFF) == 32767);
    assert(i2s_audio_convert_inmp441_sample((int32_t)0x80000000U) == -32768);

    /* 16 kHz mono 16-bit PCM WAV header generation */
    uint8_t wav_hdr[44] = {0};
    i2s_audio_write_wav_header(wav_hdr, 32000, 16000, 1, 16);
    assert(memcmp(&wav_hdr[0], "RIFF", 4) == 0);
    assert(memcmp(&wav_hdr[8], "WAVE", 4) == 0);
    assert(memcmp(&wav_hdr[12], "fmt ", 4) == 0);
    assert(memcmp(&wav_hdr[36], "data", 4) == 0);
    assert(wav_hdr[22] == 1 && wav_hdr[23] == 0); /* 1 channel (mono) */
    assert(wav_hdr[34] == 16 && wav_hdr[35] == 0); /* 16 bits/sample */

    /* Telemetry reports audioOutput=true for discrete MAX98357A even when WM8960 is false */
    char buf[1280];
    sentra_telemetry_snapshot_t snap = {
        .device_id = "ESP32-S3-SENTRA-001",
        .firmware_version = "1.3.0-bench",
        .sequence = 50,
        .uptime_ms = 20000,
        .camera_ready = false,
        .imu_ready = true,
        .forward_tof_ready = true,
        .wm8960_ready = false,
        .audio_output_ready = true,
        .vl53l5cx_ready = false,
        .tof_fresh = true,
        .forward_reading = { .valid = true, .raw_mm = 700, .distance_cm = 70.0f, .status = VL53L0X_STATUS_OK },
        .obstacle_level = SENTRA_OBSTACLE_CAUTION,
        .imu_valid = false,
        .imu_calibrated = false,
    };
    assert(sentra_telemetry_build_json(&snap, buf, sizeof(buf)) > 100);
    assert(strstr(buf, "\"audioOutput\":true") != NULL);
    assert(strstr(buf, "\"camera\":false") != NULL);
}

static void test_14_battery_adc_voltage_reader(void) {
    /* Default ADC1 GPIO6 (ADC1_CH5) and 2:1 voltage divider scale */
    assert(BOARD_PIN_BATTERY_ADC == 6);
    assert(BOARD_BATTERY_ADC_SCALE_MILLI == 2000);

    /* Valid ESP32-S3 ADC1 GPIOs (1..10 -> CH0..CH9); ADC2 (>=11) rejected */
    assert(sentra_battery_adc_gpio_to_channel(1) == 0);
    assert(sentra_battery_adc_gpio_to_channel(6) == 5);
    assert(sentra_battery_adc_gpio_to_channel(10) == 9);
    assert(sentra_battery_adc_gpio_to_channel(0) == -1);
    assert(sentra_battery_adc_gpio_to_channel(-1) == -1);
    assert(sentra_battery_adc_gpio_to_channel(11) == -1);
    assert(sentra_battery_adc_gpio_to_channel(15) == -1);
    assert(sentra_battery_adc_gpio_to_channel(40) == -1);

    /* Fallback raw-to-mV linear scaling */
    int mid_mv = sentra_battery_adc_raw_to_mv(2048, 4095, 3100);
    assert(mid_mv >= 1549 && mid_mv <= 1551);
    assert(sentra_battery_adc_raw_to_mv(0, 4095, 3100) == 0);

    /* Valid 1S LiPo reading through 100k/100k (2:1) divider: 1960 mV pin -> 3.92 V */
    sentra_battery_reading_t r = {0};
    assert(sentra_battery_adc_mv_to_voltage(2589, 1960, 2000U, &r) == true);
    assert(r.valid == true);
    assert(r.pin_mv == 1960);
    assert(fabsf(r.voltage_v - 3.92f) < 0.01f);

    /* Valid 5V USB rail through 100k/100k (2:1) divider: 2480 mV pin -> 4.96 V */
    assert(sentra_battery_adc_mv_to_voltage(3276, 2480, 2000U, &r) == true);
    assert(r.valid == true);
    assert(fabsf(r.voltage_v - 4.96f) < 0.01f);

    /* Grounded / unwired pin (< 250 mV) must fail closed (valid=false -> null) */
    assert(sentra_battery_adc_mv_to_voltage(50, 40, 2000U, &r) == false);
    assert(r.valid == false);
    assert(r.voltage_v == 0.0f);

    /* Over-voltage pin (> 3350 mV) or invalid divider scale fails closed */
    assert(sentra_battery_adc_mv_to_voltage(4095, 3500, 2000U, &r) == false);
    assert(r.valid == false);
    assert(sentra_battery_adc_mv_to_voltage(2000, 1800, 500U, &r) == false);
    assert(r.valid == false);
    assert(sentra_battery_adc_mv_to_voltage(2000, 1800, 12000U, &r) == false);
    assert(r.valid == false);
}

int main(int argc, char **argv) {
    int dump_json = (argc > 1 && strcmp(argv[1], "--dump-json") == 0);

    test_1_valid_vl53l0x_measurement();
    test_2_invalid_and_out_of_range_measurements();
    test_3_sensor_init_failure();
    test_4_i2c_communication_failure_and_timeout();
    test_5_sensor_disconnection_and_recovery();
    test_6_distance_unit_conversion();
    test_7_obstacle_threshold_transitions();
    test_8_alert_hysteresis_cooldown_and_suppression();
    test_9_optional_audio_disabled();
    test_10_camera_unavailable_telemetry();
    test_11_wifi_disconnection();
    test_12_telemetry_serialization_missing_and_valid(dump_json);
    test_13_discrete_audio_i2s_and_pin_profile();
    test_14_battery_adc_voltage_reader();

    if (!dump_json) {
        printf("PASS: all 14 ESP32-S3 firmware pre-hardware unit tests passed.\n");
    }
    return 0;
}
