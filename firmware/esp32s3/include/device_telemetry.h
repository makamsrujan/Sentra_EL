#ifndef SENTRA_DEVICE_TELEMETRY_H
#define SENTRA_DEVICE_TELEMETRY_H

#include <stdbool.h>
#include "vl53l0x.h"

void sentra_telemetry_set_camera_initialized(bool value);
void sentra_telemetry_set_imu_initialized(bool value);
void sentra_telemetry_set_forward_tof_initialized(bool value);
void sentra_telemetry_set_wm8960_initialized(bool value);
void sentra_telemetry_set_vl53l5cx_initialized(bool value);
void sentra_telemetry_update_forward_tof(const vl53l0x_reading_t *reading);
void sentra_telemetry_task(void *argument);

#endif
