/**
 * @file battery_adc.h
 * @brief ESP32-S3 ADC1 Battery Voltage Reader (Wi-Fi Safe, Resistor Divider Scaled)
 *
 * Uses ESP32-S3 ADC1 (GPIO 1..10, default GPIO 6 / ADC1_CH5) which never
 * conflicts with Wi-Fi (unlike ADC2).
 *
 * HARDWARE SAFETY WARNING:
 *   ESP32-S3 ADC pins are rated for <= 3.3 V maximum. NEVER connect a raw
 *   1S LiPo (up to 4.2 V) or 5 V USB rail directly to the ADC GPIO.
 *   Always wire an external resistor voltage divider (e.g., 100 kOhm top +
 *   100 kOhm bottom = 2.0x ratio -> SENTRA_BATTERY_ADC_SCALE_MILLI=2000).
 */

#ifndef SENTRA_BATTERY_ADC_H
#define SENTRA_BATTERY_ADC_H

#include <stdbool.h>
#include <stdint.h>

#ifdef ESP_PLATFORM
#include "esp_err.h"
#elif defined(SENTRA_FIRMWARE_HOST_TEST)
#include "mock_idf.h"
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SENTRA_BATTERY_ADC_MIN_PIN_MV       250
#define SENTRA_BATTERY_ADC_MAX_PIN_MV       3350
#define SENTRA_BATTERY_ADC_MIN_VOLTAGE_V    0.50f
#define SENTRA_BATTERY_ADC_MAX_VOLTAGE_V    20.00f
#define SENTRA_BATTERY_ADC_DEFAULT_MAX_RAW  4095
#define SENTRA_BATTERY_ADC_DEFAULT_VREF_MV  3100

typedef struct {
    bool valid;
    int raw_adc;
    int pin_mv;
    float voltage_v;
} sentra_battery_reading_t;

/**
 * Pure-C helper: map an ESP32-S3 ADC1 GPIO (1..10) to ADC1 channel index (0..9).
 * Returns -1 for invalid or non-ADC1 GPIOs (including ADC2 pins 11..20).
 */
int sentra_battery_adc_gpio_to_channel(int gpio_num);

/**
 * Pure-C fallback conversion from 12-bit ADC raw sample to pin millivolts when
 * eFuse calibration is unavailable.
 */
int sentra_battery_adc_raw_to_mv(int raw_adc, int max_raw, int vref_mv);

/**
 * Pure-C conversion from measured divider pin millivolts to scaled battery voltage.
 * Returns true and populates *out with valid=true only when the reading falls
 * inside plausible physical bounds (prevents unwired/grounded pins emitting 0.00V).
 *
 * divider_scale_milli = round(((R_top + R_bottom) / R_bottom) * 1000)
 * Example: 100k / 100k divider -> 2000 (2.0x).
 */
bool sentra_battery_adc_mv_to_voltage(
    int raw_adc,
    int pin_mv,
    uint32_t divider_scale_milli,
    sentra_battery_reading_t *out
);

#ifdef ESP_PLATFORM
esp_err_t sentra_battery_adc_init(int gpio_num, uint32_t divider_scale_milli);
esp_err_t sentra_battery_adc_read(sentra_battery_reading_t *out);
bool sentra_battery_adc_is_ready(void);
#endif

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_BATTERY_ADC_H */
