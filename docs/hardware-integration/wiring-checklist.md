# Hardware Wiring & Bring-Up Checklist (Two-Board Baseline)

Follow this exact order. Do not wire everything at once.

## Step 1 — ESP32-S3 Sensor Bring-Up (No Camera, No Speaker)

1. Confirm board markings on your **ESP32-S3 N16R8** (16 MB Flash, 8 MB Octal PSRAM), **GY-521 (MPU6050)**, and **single VL53L0X** breakout.
2. Verify **3.3 V logic compatibility** and check that your VL53L0X breakout has an onboard pull-up resistor on `XSHUT` before leaving `XSHUT = -1` unconnected.
3. Flash `firmware/esp32s3` with the default bench profile (`sdkconfig.defaults`) **with no sensors connected first**; confirm clean boot, PSRAM init, and empty I²C scan on serial monitor.
4. Power off. Wire shared I²C bus: `SDA -> GPIO4`, `SCL -> GPIO40`, `3.3V`, `GND`. Tie GY-521 `AD0 -> GND` (`0x68`).
5. Power on and verify the boot I²C scan detects **`0x29` (VL53L0X)** and **`0x68` (MPU6050)**.
6. Run the stationary measured-distance and IMU bench test (see `sensor-calibration.md`).
7. Configure Wi-Fi + backend URL + S3 `deviceId` + provisioned `X-Device-Token` via `idf.py menuconfig` and confirm HTTP 200 on `POST /api/device/telemetry`.

## Step 2 — Separate ESP32-CAM Bring-Up (No DVP Wiring to S3)

8. Keep the OV2640 ribbon seated on the **ESP32-CAM (ESP-32S)** board. Do **not** run any camera wires to the ESP32-S3.
9. Connect a 3.3 V USB-to-TTL serial adapter (or ESP32-CAM-MB carrier) and supply stable 5 V power to `5V` / `GND` (weak 3.3 V USB-TTL regulators frequently cause brownout resets during Wi-Fi/camera init).
10. Flash `firmware/esp32cam` with blank Wi-Fi/token first and run the **local serial JPEG test** (see `camera-test.md`) to confirm the AI-Thinker candidate pinout produces valid `FF D8 ... FF D9` frames.
11. Register `ESP32-CAM-SENTRA-001` separately via `POST /api/device/register`, configure its own token in `idf.py menuconfig`, and confirm HTTP 200 on `POST /api/device/frame`.

## Step 3 — Backend Pairing Verification

12. Add `SENTRA_CAMERA_PAIRINGS="ESP32-S3-SENTRA-001=ESP32-CAM-SENTRA-001"` to `.env` and restart the backend.
13. Verify paired status, independent board health, independent disconnect, and camera-only reboot (see `diagnostics-checklist.md`).

## Step 4 — Optional Discrete Audio Bench Tests (Keep Speaker Disconnected Initially)

14. Keep phone/browser audio as the working fallback.
15. Test **INMP441** microphone capture alone first (`GPIO 14/15/16`, `L/R -> GND`) using `sdkconfig.defaults.audio_bench`.
16. **DO NOT connect the small speaker or enable MAX98357A until the speaker impedance (ohms) and power rating (watts) are verified.** See `audio-bench-test.md`.
