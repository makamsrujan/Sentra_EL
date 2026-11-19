# SENTRA — pre-hardware integration status

This document describes **source verified in this repository** and distinguishes what has been software/protocol-tested from what remains **unverified until physical ESP32-S3 assembly and flashing**. Hardware performance has not yet been measured on real silicon.

## Baseline Hardware Configuration

- **Headband:**
  - 1 × OV2640 camera
  - 1 × VL53L0X forward ToF sensor (single baseline unit; NO downward VL53L0X sensor)
  - 1 × GY-521 MPU6050 6-axis IMU (pitch/motion only; NO magnetometer compass heading)
- **Bag Enclosure:**
  - 1 × ESP32-S3 N16R8 (16 MB Flash, 8 MB PSRAM)
  - 1 × 5000 mAh USB power bank and supporting wiring
- **Optional (disabled by default via Kconfig):**
  - VL53L5CX multizone depth sensor (`CONFIG_SENTRA_ENABLE_VL53L5CX=n`)
  - Waveshare WM8960 I²S/I²C audio codec (`CONFIG_SENTRA_ENABLE_WM8960=n`)

## Implemented & Software-Verified Paths

- React/PWA companion app, Express gateway, SQLite persistence (`sentra.db`), and server-side Gemini integration (`gemini-3.8-flash` primary, `gemini-4-hydrogen` fallback).
- Device registration, token-authenticated telemetry (`POST /api/device/telemetry`), JPEG frame ingestion (`POST /api/device/frame`), bidirectional config/commands (`GET`/`POST /api/device/config`, `POST /api/device/command`, `GET /api/device/poll`, `POST /api/device/ack`), and SSE streaming.
- Shared TypeScript sensor fusion module (`evaluateSensorFusion`, `FusionAlertPrioritizer`) enforcing timestamp freshness, `valid | invalid | stale | unavailable` states, configurable experimental proximity thresholds, `downwardDropOffCapable: false` when baseline forward-only VL53L0X is active, and explicit Planned SLAM contract.
- ESP32-S3 firmware (`firmware/esp32s3/`) implementing mutex-protected I²C (`i2c_bus.c`), single forward VL53L0X driver (`vl53l0x.c`), GY-521 MPU6050 driver + stationary gyro calibration (`mpu6050.c`), optional VL53L5CX stub (`vl53l5cx_optional.c`), runtime NVS config (`sentra_nvs_config.c`), PSRAM-aware OV2640 driver (`camera_driver.c`), telemetry + command poll/ack loop (`device_telemetry.c`, `audio_http.c`, `main.c`). Pure-C sensor math/validation logic is unit-tested via host `gcc`.

## Not Yet Proven on Silicon

- Physical compilation & flashing on an actual ESP32-S3 N16R8 (check the GitHub Actions `esp32s3` job running `espressif/esp-idf-ci-action` for ELF compilation checks).
- Real I²C signal integrity, pin assignments, and headband-to-bag cable performance for OV2640, VL53L0X, and MPU6050.
- Physical OV2640 JPEG capture quality across candidate resolutions (QVGA/VGA/SVGA) and thermal/power behavior on the 5000 mAh bank.
- Optional WM8960 headset capture/playback and optional VL53L5CX multizone depth ranging (both disabled by default).
- Independent hands-free embedded "Hey SENTRA" wake-word detection (currently browser foreground Web Speech API; embedded wake word is not implemented).
- Real-world walking guidance, downward drop-off guarantees, SLAM localization, or certified obstacle safety.

## Hardware Arrival Sequence

1. Confirm board pinout and headband-to-bag cable continuity; verify provisional `Kconfig.projbuild` GPIO defaults match wiring.
2. Flash ESP32-S3 (`idf.py set-target esp32s3 && idf.py build flash monitor`) with Wi-Fi + NVS device credentials first.
3. Verify `GET /api/device/poll` and `POST /api/device/telemetry` connectivity over local Wi-Fi.
4. Validate single forward VL53L0X ranging against measured distances and tune experimental alert threshold via `POST /api/device/config`.
5. Validate GY-521 MPU6050 stationary calibration and pitch axis sign; trigger `RECALIBRATE_IMU` if orientation mounts differ.
6. Enable OV2640 (`CONFIG_SENTRA_ENABLE_CAMERA=y`) and validate short-cable vs headband-cable JPEG transfers & PSRAM allocation.
7. Run supervised, stationary indoor integration checks using the diagnostics checklist. SENTRA is not a certified mobility aid.

## Toolchain

- Node.js 22: `npm ci && npm run lint && npm test && npm run build`
- ESP-IDF v5.3: `idf.py set-target esp32s3 && idf.py build` inside `firmware/esp32s3`
- Simulator protocol check: `SENTRA_OPERATOR_TOKEN=local-test SENTRA_SIMULATOR_ENABLED=true npm run dev` and `SENTRA_OPERATOR_TOKEN=local-test node simulator/esp32_sim.mjs`
