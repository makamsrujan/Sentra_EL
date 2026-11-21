# SENTRA ESP32-S3 Firmware — Step 1 Sensor Bring-Up & Step 4 Separate Audio Profile

This repository contains an ESP-IDF **v5.3** firmware project targeting an **ESP32-S3 N16R8** (16 MB flash, 8 MB Octal PSRAM). Pure-C sensor, telemetry, and discrete audio conversion helpers pass native GCC host tests; **physical ESP32-S3 flashing and bench testing are still required**.

## Actual Hardware Role (Board 1 of 2)

- **Active Step 1 Sensor Profile (`sdkconfig.defaults`):**
  - `1 × VL53L0X` forward-facing ToF sensor on I²C (`0x29`, `XSHUT = -1` **only** for a single breakout with a confirmed onboard pull-up).
  - `1 × GY-521 MPU6050` 6-axis IMU on the same I²C bus (`0x68`, AD0 tied low; no magnetometer so `heading` stays `null`).
  - Bench I²C pins: `SDA = GPIO4`, `SCL = GPIO40`, `100 kHz`.
  - **No downward ToF sensor:** `downwardToF` is always `false` and `downwardDistanceMm` is always `null`.
  - Direct S3 camera (`CONFIG_SENTRA_ENABLE_CAMERA=n`), legacy WM8960 (`CONFIG_SENTRA_ENABLE_WM8960=n`), and discrete I²S audio (`CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE=n`) stay **disabled by default**.
- **Separate Camera Board (Board 2):**
  - Camera capture runs on a separate **ESP32-CAM** board under [`firmware/esp32cam/`](../esp32cam/README.md) with zero DVP wiring to the ESP32-S3, paired in the backend via `SENTRA_CAMERA_PAIRINGS`.
- **Optional Step 4 Discrete Audio Profile (`sdkconfig.defaults.audio_bench`, Disabled by Default):**
  - `INMP441` I²S mic (`I2S_NUM_0` RX: `SCK=GPIO14, WS=GPIO15, SD=GPIO16`) + `MAX98357A` I²S mono amp (`I2S_NUM_1` TX: `BCLK=GPIO17, LRC=GPIO18, DIN=GPIO21`), with **zero dependency on WM8960**.
  - **Leave the speaker disconnected and `MAX98357A` disabled until speaker impedance and wattage are confirmed.** Phone/browser audio remains the fallback. See [`docs/hardware-integration/audio-bench-test.md`](../../docs/hardware-integration/audio-bench-test.md).

## Legacy Modules (Disabled by Default)

- `CONFIG_SENTRA_ENABLE_CAMERA` (direct OV2640 DVP attached to ESP32-S3) — **[LEGACY]**, disabled by default.
- `CONFIG_SENTRA_ENABLE_WM8960` (Waveshare WM8960 codec) — **[LEGACY]**, disabled by default.

## Step 1 Build, Flash, Serial Monitor & Bench Verification

```sh
cd firmware/esp32s3
idf.py set-target esp32s3
idf.py menuconfig   # Configure Wi-Fi, backend URL, S3 deviceId, and S3 X-Device-Token
idf.py build
idf.py -p YOUR_S3_SERIAL_PORT flash monitor
```

On boot, inspect serial output for:
1. **I²C bus scan:** `0x29` (VL53L0X) and `0x68` (MPU6050).
2. **Stationary `[BENCH]` readout (every 2 s):** compare VL53L0X readings against measured distances (30 / 60 / 120 cm), confirm invalid/out-of-range readings log `UNAVAILABLE` (never `0 cm` or clear path), and confirm MPU6050 rest calibration (`calibrated=true`, `heading=null`).

## Native GCC Host Unit Tests (Not a Physical Board Test)

```sh
# Default Step 1 sensor profile
gcc -Wall -Wextra -Werror -DSENTRA_FIRMWARE_HOST_TEST \
  -Ifirmware/esp32s3/include -Ifirmware/esp32s3/tests \
  firmware/esp32s3/tests/test_firmware.c \
  firmware/esp32s3/src/vl53l0x.c \
  firmware/esp32s3/src/mpu6050.c \
  firmware/esp32s3/src/obstacle_awareness.c \
  firmware/esp32s3/src/local_alerts.c \
  firmware/esp32s3/src/i2s_audio.c \
  firmware/esp32s3/src/device_telemetry.c \
  -lm -o /tmp/sentra_fw_test && /tmp/sentra_fw_test

# Step 4 discrete audio compile-time pin-conflict check
gcc -Wall -Wextra -Werror -DSENTRA_FIRMWARE_HOST_TEST \
  -DCONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE=1 \
  -DCONFIG_SENTRA_ENABLE_INMP441=1 \
  -DCONFIG_SENTRA_ENABLE_MAX98357A=1 \
  -Ifirmware/esp32s3/include -Ifirmware/esp32s3/tests \
  firmware/esp32s3/tests/test_firmware.c \
  firmware/esp32s3/src/vl53l0x.c \
  firmware/esp32s3/src/mpu6050.c \
  firmware/esp32s3/src/obstacle_awareness.c \
  firmware/esp32s3/src/local_alerts.c \
  firmware/esp32s3/src/i2s_audio.c \
  firmware/esp32s3/src/device_telemetry.c \
  -lm -o /tmp/sentra_fw_audio_test && /tmp/sentra_fw_audio_test
```
