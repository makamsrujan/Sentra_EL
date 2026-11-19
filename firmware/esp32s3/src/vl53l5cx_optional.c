/**
 * @file vl53l5cx_optional.c
 * @brief Optional VL53L5CX multizone depth sensor implementation.
 *
 * Kept strictly optional behind CONFIG_SENTRA_ENABLE_VL53L5CX=n.
 * When disabled or unequipped, reports unavailable without failing boot or telemetry.
 */

#include "vl53l5cx_optional.h"
#include <string.h>

#if defined(__has_include)
#  if __has_include("sdkconfig.h")
#    include "sdkconfig.h"
#  endif
#endif

bool vl53l5cx_optional_is_enabled(void) {
#ifdef CONFIG_SENTRA_ENABLE_VL53L5CX
    return true;
#else
    return false;
#endif
}

esp_err_t vl53l5cx_optional_init(i2c_port_t bus) {
    (void)bus;
#ifdef CONFIG_SENTRA_ENABLE_VL53L5CX
    /* Full ST VL53L5CX ULD firmware download over I2C is intentionally deferred
     * until physical module breakout is assembled. Do not report available unless
     * the ULD probe succeeds. */
    return ESP_ERR_NOT_SUPPORTED;
#else
    return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t vl53l5cx_optional_read(i2c_port_t bus, sentra_vl53l5cx_sample_t *out_sample) {
    (void)bus;
    if (out_sample) {
        memset(out_sample, 0, sizeof(*out_sample));
        out_sample->available = false;
    }
    return ESP_ERR_NOT_SUPPORTED;
}
