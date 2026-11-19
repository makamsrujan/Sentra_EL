/**
 * @file camera_driver.h
 * @brief ESP32-S3 OV2640 Parallel DVP Camera Module Driver
 *
 * Notice: High-speed parallel DVP signals (20 MHz PCLK/XCLK) degrade over long ribbon cables (>15cm).
 * If mounting camera on head assembly and ESP32 in pocket/bag, co-locate ESP32-S3 near camera or use
 * shielded twisted differential cabling.
 */

#ifndef SENTRA_CAMERA_DRIVER_H
#define SENTRA_CAMERA_DRIVER_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t *buf;
    size_t len;
    size_t width;
    size_t height;
    int64_t timestamp_us;
} sentra_camera_frame_t;

/**
 * @brief Initialize the OV2640 camera using board_profile pins and PSRAM frame buffer.
 */
esp_err_t camera_driver_init(void);

/**
 * @brief Capture a single JPEG frame.
 *
 * @param out_frame Pointer to frame structure populated with buffer and length
 * @return esp_err_t ESP_OK on success
 */
esp_err_t camera_driver_capture(sentra_camera_frame_t *out_frame);

/**
 * @brief Release the captured frame buffer back to the camera driver.
 */
void camera_driver_release(sentra_camera_frame_t *frame);

/**
 * @brief Upload a captured JPEG frame to POST /api/device/frame
 *
 * @param frame Captured frame
 * @param server_url Base URL of server (e.g. "http://192.168.1.100:3000")
 * @param device_id Registered device ID
 * @param device_token Authentication token
 * @param sequence Incrementing frame sequence number
 * @return esp_err_t ESP_OK on HTTP 200
 */
esp_err_t camera_driver_upload_frame(
    const sentra_camera_frame_t *frame,
    const char *server_url,
    const char *device_id,
    const char *device_token,
    uint32_t sequence
);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_CAMERA_DRIVER_H */
