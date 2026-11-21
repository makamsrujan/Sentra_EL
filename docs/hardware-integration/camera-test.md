# ESP32-CAM Bring-Up & First Local JPEG Bench Test

> **Architecture note:** First hardware integration uses a **separate ESP32-CAM (ESP-32S module)** running `firmware/esp32cam/`. Direct OV2640-to-ESP32-S3 DVP wiring is **[LEGACY]** and disabled (`CONFIG_SENTRA_ENABLE_CAMERA=n`).

## Part A — First Local JPEG Test (No Wi-Fi Required)

1. Seat the OV2640 ribbon securely on the ESP32-CAM board. Confirm zero wires go to the ESP32-S3.
2. Connect a 3.3 V USB-TTL adapter (or ESP32-CAM-MB) and a solid 5 V power supply.
3. Build and flash `firmware/esp32cam` with **default (blank) Wi-Fi/token settings** (`idf.py set-target esp32 && idf.py build flash monitor`).
4. Remove `IO0 -> GND`, press RESET, and observe serial logs:
   - Confirm `AI-Thinker-compatible (FIRST CANDIDATE — verify clone)` initializes OV2640 without `ESP_ERR_NOT_FOUND` or `FB-OVF` resets.
   - Confirm local test frames log `[LOCAL_JPEG_TEST] frame=#N size=... bytes valid_soi_eoi=YES`.
   - If init fails, double-check power rail (5 V), ribbon seating, and whether your specific ESP-32S clone differs from standard AI-Thinker pins (update via `idf.py menuconfig`).

## Part B — Authenticated Wi-Fi Upload & Reboot Safety Test

5. Register the camera separately with the backend:
   ```bash
   curl -s -X POST http://localhost:3000/api/device/register \
     -H "Content-Type: application/json" \
     -H "X-Operator-Token: $SENTRA_OPERATOR_TOKEN" \
     -d '{"deviceId":"ESP32-CAM-SENTRA-001","name":"SENTRA ESP32-CAM","capabilities":{"camera":true,"forwardToF":false,"downwardToF":false,"imu":false,"audioOutput":false}}'
   ```
6. Save the returned `provisionedToken` and configure Wi-Fi + backend URL + `ESP32-CAM-SENTRA-001` + token in `firmware/esp32cam` via `idf.py menuconfig`. Reflash.
7. Confirm serial logs show Wi-Fi IP, a unique `boot_session=cam-...`, and HTTP 200 uploads to `POST /api/device/frame?deviceId=ESP32-CAM-SENTRA-001`.
8. **Camera-only reboot test:** Leave the ESP32-S3 running, press RESET on the ESP32-CAM only, and verify:
   - ESP32-CAM logs a new `boot_session` and resets client `X-Frame-Sequence` to `1`.
   - Backend `X-Frame-Sequence` continues advancing monotonically and `GET /api/device/frame/latest?deviceId=ESP32-S3-SENTRA-001` serves fresh post-reboot frames immediately.
9. **Disconnect test:** Unplug ESP32-CAM power while S3 stays online; confirm after `SENTRA_HEARTBEAT_TIMEOUT_MS` that `GET /api/device/frame/latest?deviceId=ESP32-S3-SENTRA-001` returns HTTP `404` while S3 telemetry remains connected.

A simulated JPEG or successful build does **not** prove physical camera capture.

---

## [LEGACY] Direct OV2640 on ESP32-S3

Retained only behind `CONFIG_SENTRA_ENABLE_CAMERA=n` in `firmware/esp32s3/`. Do not enable on the two-board baseline.
