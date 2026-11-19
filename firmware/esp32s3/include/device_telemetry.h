#ifndef SENTRA_DEVICE_TELEMETRY_H
#define SENTRA_DEVICE_TELEMETRY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "mpu6050.h"
#include "obstacle_awareness.h"
#include "vl53l0x.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    const char *device_id;
    const char *firmware_version;
    uint32_t sequence;
    int64_t uptime_ms;

    bool camera_ready;
    bool imu_ready;
    bool forward_tof_ready;
    bool wm8960_ready;
    bool vl53l5cx_ready;

    bool tof_fresh;
    vl53l0x_reading_t forward_reading;
    sentra_obstacle_level_t obstacle_level;

    bool imu_valid;
    bool imu_calibrated;
    sentra_mpu_sample_t imu_sample;
} sentra_telemetry_snapshot_t;

/** Pure-C Express-compatible JSON serializer (host-testable & firmware-shared). */
int sentra_telemetry_build_json(const sentra_telemetry_snapshot_t *snap, char *out_buf, size_t out_buf_size);

/** Pure-C upload preflight check (true only when Wi-Fi connected and credentials present). */
bool sentra_telemetry_can_upload(bool wifi_connected, const char *server_url, const char *device_token);

void sentra_telemetry_init_sync(void);
void sentra_telemetry_set_camera_initialized(bool value);
void sentra_telemetry_set_imu_initialized(bool value);
void sentra_telemetry_set_forward_tof_initialized(bool value);
void sentra_telemetry_set_wm8960_initialized(bool value);
void sentra_telemetry_set_vl53l5cx_initialized(bool value);
void sentra_telemetry_update_forward_tof(const vl53l0x_reading_t *reading, sentra_obstacle_level_t obstacle_level);
void sentra_telemetry_task(void *argument);

#ifdef __cplusplus
}
#endif

#endif
