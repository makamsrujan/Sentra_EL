# SENTRA ESP32-S3 firmware — source status and build instructions

This repository contains a **pre-hardware** ESP-IDF project targeting an ESP32-S3
N16R8 (16 MB flash, 8 MB PSRAM). It is NOT a finished or validated navigation
device. The previous README overstated the implementation status.

## Implemented in firmware source

- ESP-IDF app entry point and WM8960 register/I2S programming.
- Short button-triggered WAV recording and authenticated audio upload.
- Bounded WAV response download and one-shot I2S playback.
- Wi-Fi station/reconnection source with local menuconfig settings.
- OV2640 JPEG camera capture and authenticated binary frame uploads
  (opt-in; firmware pinout has NOT been physically verified).
- Periodic authenticated telemetry to existing `/api/device/telemetry`.
  ToF/battery fields are intentionally null; MPU6050 data is emitted only after successful initialization and live reading.

## Not yet implemented or demonstrated

- Two functional VL53L0X ranging drivers and XSHUT address assignment.
- Real MPU6050 register reading is integrated into telemetry, but has not been
  checked on silicon. INA219 power sensing remains unimplemented.
- Hardware-independent sensor alerts from confirmed physical readings.
- Real always-listening / hands-free "Hey SENTRA" wake-word recognition;
  button-triggered WAV is the currently compiled firmware path.
- WM8960 microphone/headset electrical tests or volume calibration.
- Simultaneous camera, I2C, I2S and Wi-Fi physical reliability.
- Headband-to-bag OV2640 parallel cable integrity.
- Verified SLAM, safe autonomous navigation, or independent mobility.

The server and browser can support additional functionality, but that does
not imply the ESP32 firmware implements those features.

## Environment

Use ESP-IDF **v5.3** for the pinned CI configuration.
The ESP32 camera component is declared in `main/idf_component.yml`.

```sh
cd firmware/esp32s3
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
```

In menuconfig, configure a LOCAL development SSID, server origin,
registered device ID and the ONE-TIME provisioned device token.
The backend device must first be registered through the operator-controlled
registration endpoint. The firmware does not have an unauthenticated
auto-registration route.

**Do not commit `sdkconfig`, Wi-Fi passwords or device tokens.**
Build artifacts are ignored; compile locally rather than committing .bin files.

Set `SENTRA_ENABLE_CAMERA=y` **only after confirming the actual ESP32 board
revision, camera breakout, power rails, pinout and cable length**. The current
`board_profile.h` map is provisional and may conflict with board peripherals.

The current network upload client is designed for an isolated, trusted LAN.
Do not expose plaintext device tokens on an untrusted network; validated
TLS configuration is still required for an internet-exposed deployment.

## Backend endpoints used by this firmware

- POST `/api/device/telemetry`: periodically records device status and
  freshness, using `schemaVersion: 1`. Unknown ToF/IMU/battery values are null.
- POST `/api/device/frame`: raw `image/jpeg` with device ID, token and frame sequence.
- POST `/api/device/audio/utterance`: bounded WAV microphone capture.
- GET `/api/device/audio/reply/:replyId`: bounded PCM WAV playback.
- GET `/api/device/poll`: optional action retrieval.
- POST `/api/device/ack`: existing acknowledgment contract (still needs
  end-to-end device action verification).

**There is no GET `/api/device/heartbeat` endpoint.** Telemetry is the
connection heartbeat.

## Verification

GitHub Actions runs the JavaScript/TypeScript checks and a firmware
compiler job. Check the run for the EXACT target commit. A successful
ESP-IDF build shows that compiled source links; it does not exercise
physical sensors, camera pins or headset audio.

- [Hardware arrival and validation checklist](../../docs/hardware-integration/acceptance-checklist.md)
- [Known limitations](../../docs/hardware-integration/known-limitations.md)
- [Integration status](../../docs/hardware-integration/STATUS.md)
