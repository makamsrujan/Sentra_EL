# SENTRA — pre-hardware integration status

This document describes **source available in this repository**, not an AI agent's
prior completion report. Hardware performance has not been measured.

## Existing verified-in-source paths

- React/PWA companion app, Express gateway, SQLite, Gemini integration.
- Device registration, token-authenticated telemetry and JPEG frame APIs.
- Browser voice, wearable voice-turn endpoints, optional TTS, action polling.
- ESP-IDF WM8960/I2S code, Wi-Fi transport source and OV2640 driver source.

## Not yet proven

- Compilation of the complete ESP-IDF firmware. Check the GitHub Actions
  `esp32s3` job (runs without physical hardware); don't claim success without a green run.
- Physical WM8960 microphone capture and headset playback.
- Dual VL53L0X ranging, XSHUT remapping, ground-change calibration.
- MPU6050 register-reading code is present but requires physical validation;
  optional INA219 power sensing is not implemented.
- Standalone, fully integrated hands-free "Hey SENTRA".
- Reliable camera capture across the intended headband-to-bag cable.
- Independent real-world walking guidance, SLAM or certified obstacle safety.

## Pre-hardware acceptance gates

1. Application job passes lint, unit tests and Vite production build.
2. ESP32-S3 firmware job produces an ELF with all referenced source compiled.
3. Virtual device performs authenticated telemetry, JPEG transfer, audio reply
   download and action acknowledgment against the actual backend.
4. All observations carry source (hardware, simulator, browser) and freshness.
5. Record exact board and camera breakout part numbers before fixing GPIO pins.

## Hardware arrival test sequence

1. Photograph the specific ESP32-S3 board, camera breakout and WM8960 board.
2. Verify logic voltage, headers, power requirements and provisional GPIO layout.
3. Flash ESP32-S3 with **only** the basic board + Wi-Fi first.
4. Prove WM8960 beep and microphone recording at low earphone volume.
5. Test each VL53L0X separately; then test XSHUT addressing together.
6. Test MPU6050 and optional power monitor (do not fabricate battery percentage).
7. Test OV2640 using a short cable, then at actual headband cable length.
8. Integrate modules and check for I²C, I²S, PSRAM and GPIO conflicts.
9. Demonstrate supervised, stationary test scenarios. SENTRA is not a mobility aid.

## Toolchain

- Node.js 22 and `npm ci && npm run lint && npm test && npm run build`.
- ESP-IDF v5.3; run `idf.py set-target esp32s3 && idf.py build`
  inside `firmware/esp32s3`.
- Camera dependency is managed via `main/idf_component.yml`.
- Use `idf.py menuconfig` for local settings; never commit credentials.
