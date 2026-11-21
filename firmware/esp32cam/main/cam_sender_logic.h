/**
 * @file cam_sender_logic.h
 * @brief Pure host-testable helper logic for SENTRA ESP32-CAM sender.
 */

#ifndef SENTRA_CAM_SENDER_LOGIC_H
#define SENTRA_CAM_SENDER_LOGIC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Format a unique per-boot session ID ("cam-<8hex>-<8hex>") so camera-only
 *        reboots never collide with stale pre-reboot frame sequence numbers.
 */
int sentra_cam_format_boot_session(uint32_t rnd_hi, uint32_t rnd_lo, char *out, size_t out_size);

/**
 * @brief Build "<backend>/api/device/frame?deviceId=<device_id>" safely stripping trailing slashes.
 */
int sentra_cam_build_frame_url(const char *backend_url, const char *device_id, char *out, size_t out_size);

/**
 * @brief Verify basic JPEG SOI (0xFF 0xD8), EOI (0xFF 0xD9), and size bounds.
 */
bool sentra_cam_validate_jpeg(const uint8_t *buf, size_t len);

/**
 * @brief Compute bounded exponential retry backoff (ms) for attempt index 0..N.
 */
uint32_t sentra_cam_retry_delay_ms(uint8_t attempt);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_CAM_SENDER_LOGIC_H */
