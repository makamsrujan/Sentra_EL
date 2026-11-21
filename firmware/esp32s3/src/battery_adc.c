/**
 * @file battery_adc.c
 * @brief ESP32-S3 ADC1 Battery Voltage Reader Implementation (ESP-IDF v5.3)
 */

#include "battery_adc.h"
#include <math.h>
#include <stddef.h>

int sentra_battery_adc_gpio_to_channel(int gpio_num) {
    /* ESP32-S3 ADC1 maps linearly: GPIO1=CH0 .. GPIO10=CH9. ADC2 (11..20) conflicts with Wi-Fi. */
    if (gpio_num < 1 || gpio_num > 10) {
        return -1;
    }
    return gpio_num - 1;
}

int sentra_battery_adc_raw_to_mv(int raw_adc, int max_raw, int vref_mv) {
    if (raw_adc <= 0 || max_raw <= 0 || vref_mv <= 0) {
        return 0;
    }
    if (raw_adc > max_raw) {
        raw_adc = max_raw;
    }
    int64_t mv = ((int64_t)raw_adc * (int64_t)vref_mv + (max_raw / 2)) / (int64_t)max_raw;
    return (int)mv;
}

bool sentra_battery_adc_mv_to_voltage(
    int raw_adc,
    int pin_mv,
    uint32_t divider_scale_milli,
    sentra_battery_reading_t *out
) {
    if (!out) {
        return false;
    }
    out->valid = false;
    out->raw_adc = raw_adc;
    out->pin_mv = pin_mv;
    out->voltage_v = 0.0f;

    if (divider_scale_milli < 1000U || divider_scale_milli > 10000U) {
        return false;
    }
    if (pin_mv < SENTRA_BATTERY_ADC_MIN_PIN_MV || pin_mv > SENTRA_BATTERY_ADC_MAX_PIN_MV) {
        return false;
    }

    float voltage_v = ((float)pin_mv * (float)divider_scale_milli) / 1000000.0f;
    if (!isfinite(voltage_v) ||
        voltage_v < SENTRA_BATTERY_ADC_MIN_VOLTAGE_V ||
        voltage_v > SENTRA_BATTERY_ADC_MAX_VOLTAGE_V) {
        return false;
    }

    out->valid = true;
    out->voltage_v = voltage_v;
    return true;
}

#ifdef ESP_PLATFORM

#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_log.h"

#ifdef ADC_ATTEN_DB_12
#define SENTRA_BATTERY_ADC_ATTEN ADC_ATTEN_DB_12
#else
#define SENTRA_BATTERY_ADC_ATTEN ADC_ATTEN_DB_11
#endif

#define SENTRA_BATTERY_ADC_SAMPLE_COUNT 16

static const char *TAG = "SENTRA_BATT_ADC";
static adc_oneshot_unit_handle_t s_adc_handle = NULL;
static adc_cali_handle_t s_cali_handle = NULL;
static adc_channel_t s_adc_channel = ADC_CHANNEL_5;
static uint32_t s_divider_scale_milli = 2000U;
static bool s_adc_ready = false;
static bool s_cali_enabled = false;

static bool init_calibration(adc_unit_t unit, adc_channel_t channel, adc_atten_t atten, adc_cali_handle_t *out_handle) {
    adc_cali_handle_t handle = NULL;
    esp_err_t ret = ESP_FAIL;

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cali_config = {
        .unit_id = unit,
        .chan = channel,
        .atten = atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ret = adc_cali_create_scheme_curve_fitting(&cali_config, &handle);
    if (ret == ESP_OK) {
        *out_handle = handle;
        ESP_LOGI(TAG, "ADC1 curve-fitting calibration enabled.");
        return true;
    }
#elif ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    adc_cali_line_fitting_config_t cali_config = {
        .unit_id = unit,
        .chan = channel,
        .atten = atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ret = adc_cali_create_scheme_line_fitting(&cali_config, &handle);
    if (ret == ESP_OK) {
        *out_handle = handle;
        ESP_LOGI(TAG, "ADC1 line-fitting calibration enabled.");
        return true;
    }
#endif

    ESP_LOGW(TAG, "ADC1 eFuse calibration unavailable (%s); using linear 3100 mV fallback.", esp_err_to_name(ret));
    return false;
}

esp_err_t sentra_battery_adc_init(int gpio_num, uint32_t divider_scale_milli) {
    if (s_adc_ready) {
        return ESP_OK;
    }

    int ch = sentra_battery_adc_gpio_to_channel(gpio_num);
    if (ch < 0) {
        ESP_LOGE(TAG, "GPIO%d is not a valid ESP32-S3 ADC1 pin (must be GPIO 1..10).", gpio_num);
        return ESP_ERR_INVALID_ARG;
    }
    if (divider_scale_milli < 1000U || divider_scale_milli > 10000U) {
        ESP_LOGE(TAG, "Invalid divider_scale_milli=%u (expected 1000..10000).", (unsigned)divider_scale_milli);
        return ESP_ERR_INVALID_ARG;
    }

    adc_oneshot_unit_init_cfg_t unit_cfg = {
        .unit_id = ADC_UNIT_1,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };
    esp_err_t err = adc_oneshot_new_unit(&unit_cfg, &s_adc_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_oneshot_new_unit(ADC_UNIT_1) failed: %s", esp_err_to_name(err));
        return err;
    }

    s_adc_channel = (adc_channel_t)ch;
    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten = SENTRA_BATTERY_ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    err = adc_oneshot_config_channel(s_adc_handle, s_adc_channel, &chan_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_oneshot_config_channel(GPIO%d/CH%d) failed: %s", gpio_num, ch, esp_err_to_name(err));
        adc_oneshot_del_unit(s_adc_handle);
        s_adc_handle = NULL;
        return err;
    }

    s_cali_enabled = init_calibration(ADC_UNIT_1, s_adc_channel, SENTRA_BATTERY_ADC_ATTEN, &s_cali_handle);
    s_divider_scale_milli = divider_scale_milli;
    s_adc_ready = true;

    ESP_LOGI(TAG, "Battery ADC1 ready on GPIO%d (ADC1_CH%d), divider_scale=%.3fx (NEVER exceed 3.3V at pin).",
             gpio_num, ch, (double)divider_scale_milli / 1000.0);
    return ESP_OK;
}

bool sentra_battery_adc_is_ready(void) {
    return s_adc_ready;
}

esp_err_t sentra_battery_adc_read(sentra_battery_reading_t *out) {
    if (!out) {
        return ESP_ERR_INVALID_ARG;
    }
    out->valid = false;
    out->raw_adc = 0;
    out->pin_mv = 0;
    out->voltage_v = 0.0f;

    if (!s_adc_ready || !s_adc_handle) {
        return ESP_ERR_INVALID_STATE;
    }

    int64_t raw_sum = 0;
    int valid_samples = 0;
    for (int i = 0; i < SENTRA_BATTERY_ADC_SAMPLE_COUNT; i++) {
        int sample = 0;
        if (adc_oneshot_read(s_adc_handle, s_adc_channel, &sample) == ESP_OK) {
            raw_sum += sample;
            valid_samples++;
        }
    }

    if (valid_samples < (SENTRA_BATTERY_ADC_SAMPLE_COUNT / 2)) {
        return ESP_FAIL;
    }

    int avg_raw = (int)(raw_sum / valid_samples);
    int pin_mv = 0;
    if (s_cali_enabled && s_cali_handle) {
        if (adc_cali_raw_to_voltage(s_cali_handle, avg_raw, &pin_mv) != ESP_OK) {
            pin_mv = sentra_battery_adc_raw_to_mv(
                avg_raw, SENTRA_BATTERY_ADC_DEFAULT_MAX_RAW, SENTRA_BATTERY_ADC_DEFAULT_VREF_MV
            );
        }
    } else {
        pin_mv = sentra_battery_adc_raw_to_mv(
            avg_raw, SENTRA_BATTERY_ADC_DEFAULT_MAX_RAW, SENTRA_BATTERY_ADC_DEFAULT_VREF_MV
        );
    }

    (void)sentra_battery_adc_mv_to_voltage(avg_raw, pin_mv, s_divider_scale_milli, out);
    return ESP_OK;
}

#endif /* ESP_PLATFORM */
