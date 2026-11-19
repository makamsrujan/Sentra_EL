/**
 * @file camera_driver.h
 * @brief ESP32-S3 OV2640 Parallel DVP Camera Module Driver
 *
 * Notice: High-speed parallel DVP signals (20 MHz PCLK/XCLK) degrade over long ribbon cables (>15cm).
 * Keep cable lengths short or use proper signal-integrity baffling when connecting headband to enclosure.
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

typedef enum {
    SENTRA_CAM_SIZE_QVGA = 0, /* 320x240 */
    SENTRA_CAM_SIZE_VGA  = 1, /* 640x480 */
    SENTRA_CAM_SIZE_SVGA = 2, /* 800x600 */
} sentra_cam_framesize_t;

typedef struct {
    uint8_t *buf;
    size_t len;
    size_t width;
    size_t height;
    int64_t timestamp_us;
} sentra_camera_frame_t;

esp_err_t camera_driver_init(void);
esp_err_t camera_driver_deinit(void);
esp_err_t camera_driver_set_quality(uint8_t jpeg_quality);
esp_err_t camera_driver_set_framesize(sentra_cam_framesize_t size);
bool camera_driver_is_psram_active(void);
bool camera_driver_is_ready(void);

esp_err_t camera_driver_capture(sentra_camera_frame_t *out_frame);
void camera_driver_release(sentra_camera_frame_t *frame);

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
