# SENTRA Hardware Integration Readiness Status

Status: **Pre-hardware integration prepared on branch (code + host/backend tests verified; physical bench testing pending)**.

> **Important distinction:** Automated TypeScript, Express, Vitest, and native GCC host C checks validate software contracts and pure-C logic only. **No real ESP32-S3 or ESP32-CAM board has been flashed or bench-tested in this environment.** SENTRA is an experimental assistive prototype — it does **not** perform downward drop-off detection, autonomous navigation, or safe-to-walk verification.

## Actual Two-Board Hardware Baseline

1. **Main Controller (ESP32-S3 N16R8 — 16 MB Flash, 8 MB Octal PSRAM):**
   - **1 × GY-521 (MPU6050)** 6-axis IMU on I²C (`0x68`, AD0 low).
   - **1 × VL53L0X** forward-facing single-point ToF on the same I²C bus (`0x29`, `XSHUT = -1` only when onboard pull-up is confirmed).
   - Bench I²C pins in `firmware/esp32s3/sdkconfig.defaults`: `SDA = GPIO4`, `SCL = GPIO40`, `100 kHz`.
   - Direct S3 camera (`CONFIG_SENTRA_ENABLE_CAMERA=n`), legacy WM8960 (`CONFIG_SENTRA_ENABLE_WM8960=n`), and discrete I²S audio (`CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE=n`) stay **disabled by default**.
   - **No downward ToF sensor.** `downwardToF` remains `false` and `downwardDistanceMm` remains `null`.
2. **Separate Camera Board (ESP32-CAM, ESP-32S module):**
   - Separate ESP-IDF v5.3 project under `firmware/esp32cam/` targeting `esp32`.
   - Uses the **AI-Thinker pin profile as a first candidate** (not yet bench-verified against the physical clone).
   - The OV2640 ribbon remains on the ESP32-CAM board — **zero DVP wiring** between the ESP32-CAM and ESP32-S3.
   - Authenticates with its **own** registered `deviceId` (e.g., `ESP32-CAM-SENTRA-001`) and `X-Device-Token`, uploads JPEGs to `POST /api/device/frame`, and sends `X-Boot-Session` so camera-only reboots never stall frame sequence numbers.
3. **Backend-Only Pairing (Zero Frontend Changes):**
   - Operator sets `SENTRA_CAMERA_PAIRINGS="ESP32-S3-SENTRA-001=ESP32-CAM-SENTRA-001"` in `.env`.
   - The unchanged UI continues selecting `ESP32-S3-SENTRA-001`; the backend routes frame status, latest JPEG, visual analysis, and Live Voice wearable frames to the paired ESP32-CAM while keeping sensor telemetry, camera health, and auth independent.
   - If the paired camera is offline or stale, the backend reports no live frame (HTTP `404` / `410` / `NO_FRESH_IMAGE`) and **never** falls back to another camera or simulator image.
4. **Discrete Audio (Separate Disabled-by-Default Profile):**
   - `INMP441` I²S mic (`I2S_NUM_0` RX) + `MAX98357A` I²S mono amp (`I2S_NUM_1` TX) on conflict-free GPIOs, with zero dependency on WM8960.
   - Phone/browser audio remains the active fallback. Keep the small speaker physically disconnected and `MAX98357A` disabled until speaker impedance and wattage are confirmed.

## Ordered Bring-Up Sequence

1. **Step 1 — S3 Sensor Bring-Up:** Flash `firmware/esp32s3` with `sdkconfig.defaults`, verify serial boot I²C scan (`0x29` + `0x68`), run stationary measured-distance and IMU bench checks, then register `ESP32-S3-SENTRA-001` and verify live telemetry.
2. **Step 2 — ESP32-CAM Bring-Up:** Flash `firmware/esp32cam`, run a **first local JPEG capture test** (blank Wi-Fi/token) over serial, verify AI-Thinker pin compatibility, then register `ESP32-CAM-SENTRA-001` with its own token and verify Wi-Fi JPEG uploads.
3. **Step 3 — Backend Pairing Verification:** Set `SENTRA_CAMERA_PAIRINGS`, restart backend, verify each board independently via API (`/api/health`, `/api/device/status`, `/api/device/frame/status`, `/api/device/frame/latest`), and test independent disconnect and camera-only reboot.
4. **Step 4 — Discrete Audio Bench Tests (Optional / Later):** Test `INMP441` capture alone first using `sdkconfig.defaults.audio_bench`. Only connect the speaker and enable `MAX98357A` after confirming speaker impedance and wattage.

## Toolchain Commands

- Application checks (Node.js 22): `npm ci && npm run lint && npm test && npm run build`
- ESP32-S3 firmware (ESP-IDF v5.3): `cd firmware/esp32s3 && idf.py set-target esp32s3 && idf.py build`
- ESP32-CAM firmware (ESP-IDF v5.3): `cd firmware/esp32cam && idf.py set-target esp32 && idf.py build`
- Simulator smoke test (labeled simulated data only): `SENTRA_OPERATOR_TOKEN=local-test SENTRA_SIMULATOR_ENABLED=true npm run dev` + `SENTRA_OPERATOR_TOKEN=local-test node simulator/esp32_sim.mjs`
