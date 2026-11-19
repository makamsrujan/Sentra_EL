#ifndef SENTRA_DEVICE_TELEMETRY_H
#define SENTRA_DEVICE_TELEMETRY_H
#include <stdbool.h>
void sentra_telemetry_set_camera_initialized(bool value);
void sentra_telemetry_set_imu_initialized(bool value);
void sentra_telemetry_task(void *argument);
#endif
