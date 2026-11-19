# SENTRA ESP32-S3 firmware — source status and build instructions

This repository contains a **pre-hardware** ESP-IDF **v5.3** project targeting an
**ESP32-S3 N16R8** (16 MB flash, 8 MB PSRAM). Source logic has been verified in
native C host tests and Express contract tests; physical silicon validation is
pending final hardware assembly.

## Finalized hardware architecture

- **Headband (wired harness to enclosure):**
  - `1 × OV2640` camera module
  - `1 × VL53L0X` forward Time-of-Flight sensor (default `0x29`, optional XSHUT)
  - `1 × GY-521 MPU6050` 6-axis IMU (`0x68`)
- **Bag-mounted enclosure:**
  - `1 × ESP32-S3 N16R8` + `5000 mAh` USB power bank
- **Optional expansions (Kconfig disabled by default; not required):**
  - `VL53L5CX` multizone depth sensor (`CONFIG_SENTRA_ENABLE_VL53L5CX=n`)
  - `WM8960` I2S audio codec (`CONFIG_SENTRA_ENABLE_WM8960=n`)

## Implemented in firmware source

- **Single forward VL53L0X driver (`vl53l0x.c/.h`)**: model ID probe (`0xC0 == 0xEE`),
  strict initialization & VHV/phase calibration error checks, single-shot &
  continuous ranging, `distance_mm / 10.0 = forwardDistanceCm`, invalid/out-of-range
  filtering (`>= 8190` / `< 20 mm`), timeout & I2C fault recovery, and
  disconnection detection with bounded periodic re-probe.
- **Modular local obstacle awareness (`obstacle_awareness.c/.h`)**: configurable
  critical/caution thresholds, hysteresis band, alert cooldown, and
  consecutive-invalid suppression, cleanly separated from optional audio output.
- **Thread-safe telemetry (`device_telemetry.c/.h`)**: mutex-protected state,
  real `forwardDistanceCm` & 6-axis `imu` payloads when valid, strict `null`
  for disconnected/unavailable sensors (downward ToF strictly `null`), and accurate
  `capabilities` + `sensorHealth`.
- **Optional WM8960 isolation (`local_alerts.c`, `i2s_audio.c`, `main.c`)**:
  cleanly disabled by default (`CONFIG_SENTRA_ENABLE_WM8960=n`), and degrades
  safely at runtime if codec init fails so telemetry, ToF, IMU, camera, and
  remote command polling continue uninterrupted.
- **Wi-Fi & HTTP client (`wifi_transport.c`, `audio_http.c`, `camera_driver.c`)**:
  exponential backoff reconnect, proper `HTTP_EVENT_ON_DATA` body accumulation
  for `/api/device/poll` & utterance uploads, mutex-guarded SCCB/framebuffer
  handling, and conservative `10 MHz` default XCLK (`CONFIG_SENTRA_CAM_XCLK_HZ`).

## Hardware & physical checks still required before powering

- Confirm exact ESP32-S3 board and OV2640 pinouts (`board_profile.h` mappings are
  **provisional**; avoid DevKitC-1 RGB LED conflict on GPIO 48 / 38 if present).
- Keep the OV2640 parallel DVP cable short (**<= ~15 cm**); long ribbon cables
  degrade high-speed parallel DVP integrity.
- Real I2C pull-ups, brownout behavior on USB power bank, and physical calibration
  on assembled silicon remain unverified until hardware arrives.

## Environment & Testing

Compile and run the native pre-hardware C test suite (`gcc`):

```sh
gcc -Wall -Wextra -Werror -DSENTRA_FIRMWARE_HOST_TEST \
  -Ifirmware/esp32s3/include -Ifirmware/esp32s3/tests \
  firmware/esp32s3/tests/test_firmware.c \
  firmware/esp32s3/src/vl53l0x.c \
  firmware/esp32s3/src/mpu6050.c \
  firmware/esp32s3/src/obstacle_awareness.c \
  firmware/esp32s3/src/local_alerts.c \
  firmware/esp32s3/src/device_telemetry.c \
  -lm -o /tmp/sentra_fw_test && /tmp/sentra_fw_test
```

Build firmware with **ESP-IDF v5.3**:

```sh
cd firmware/esp32s3
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
```

Set `SENTRA_ENABLE_CAMERA=y` only after verifying board pinout and cable length.
