/**
 * @file cam_sender_logic.c
 * @brief Pure host-testable helper logic for SENTRA ESP32-CAM sender.
 */

#include "cam_sender_logic.h"

#include <stdio.h>
#include <string.h>

#define SENTRA_CAM_MIN_JPEG_BYTES 16U
#define SENTRA_CAM_MAX_JPEG_BYTES (512U * 1024U)

int sentra_cam_format_boot_session(uint32_t rnd_hi, uint32_t rnd_lo, char *out, size_t out_size) {
    if (!out || out_size < 22) return -1;
    int written = snprintf(out, out_size, "cam-%08lx-%08lx",
                           (unsigned long)rnd_hi, (unsigned long)rnd_lo);
    if (written < 0 || (size_t)written >= out_size) return -1;
    return written;
}

int sentra_cam_build_frame_url(const char *backend_url, const char *device_id, char *out, size_t out_size) {
    if (!backend_url || !device_id || !out || out_size == 0) return -1;
    size_t base_len = strlen(backend_url);
    while (base_len > 0 && backend_url[base_len - 1] == '/') {
        base_len--;
    }
    if (base_len == 0 || device_id[0] == '\0') return -1;
    int written = snprintf(out, out_size, "%.*s/api/device/frame?deviceId=%s",
                           (int)base_len, backend_url, device_id);
    if (written < 0 || (size_t)written >= out_size) return -1;
    return written;
}

bool sentra_cam_validate_jpeg(const uint8_t *buf, size_t len) {
    if (!buf || len < SENTRA_CAM_MIN_JPEG_BYTES || len > SENTRA_CAM_MAX_JPEG_BYTES) {
        return false;
    }
    if (buf[0] != 0xFF || buf[1] != 0xD8) {
        return false;
    }
    if (buf[len - 2] != 0xFF || buf[len - 1] != 0xD9) {
        return false;
    }
    return true;
}

uint32_t sentra_cam_retry_delay_ms(uint8_t attempt) {
    uint32_t delay = 400U;
    for (uint8_t i = 0; i < attempt && delay < 3000U; i++) {
        delay *= 2U;
    }
    return delay > 3000U ? 3000U : delay;
}
