# SENTRA — Actual Hardware Inventory and Integration Contract

Status: **Two-board hardware alignment prepared in code/docs; physical bench verification pending**.

## Actual Physical Hardware Inventory

| Part | Count | Role in First Hardware Integration | Status |
| --- | ---: | --- | --- |
| **ESP32-S3 N16R8** (16 MB Flash, 8 MB Octal PSRAM) | 1 | Main sensor controller (I²C ToF + IMU, telemetry, future discrete I²S audio) | Ready for Step 1 bring-up (not yet flashed here) |
| **GY-521 (MPU6050)** 6-axis IMU breakout | 1 | Head tilt / motion on S3 I²C (`0x68`, AD0 low); no magnetometer | Ready for Step 1 bench test |
| **VL53L0X** forward ToF breakout | 1 | Single forward proximity sensor on S3 I²C (`0x29`, onboard XSHUT pull-up required for `XSHUT = -1`) | Ready for Step 1 bench test |
| **ESP32-CAM (ESP-32S module, AI-Thinker-style layout)** | 1 | Dedicated Wi-Fi JPEG sender (`firmware/esp32cam/`); ribbon stays on board, **no DVP wiring to S3** | First-candidate AI-Thinker profile ready; clone pinout to verify on bench |
| **INMP441** I²S MEMS microphone | 1 | Step 4 separate disabled-by-default S3 audio capture (`I2S_NUM_0` RX) | Firmware source compiled on host only; bench test pending |
| **MAX98357A** I²S mono Class-D amplifier | 1 | Step 4 separate disabled-by-default S3 mono playback (`I2S_NUM_1` TX) | Disabled by default until speaker rating verified |
| **Small speaker** (impedance & wattage unverified) | 1 | **KEEP DISCONNECTED** until ohm & watt ratings are measured/verified | Blocked on rating confirmation |
| **5000 mAh USB power bank** | 1 | Power source (no I²C fuel gauge → `batteryPercent: null`) | Verify rail stability under load |
| **Phone / browser companion** | 1 | Companion PWA + fallback voice/audio I/O | Active fallback for audio |

### Parts NOT Present (Legacy / Absent)

- **No direct OV2640-to-ESP32-S3 DVP camera wiring:** Direct S3 camera code is retained only behind `CONFIG_SENTRA_ENABLE_CAMERA=n` as **[LEGACY]**.
- **No WM8960 audio codec:** WM8960 code is retained only behind `CONFIG_SENTRA_ENABLE_WM8960=n` as **[LEGACY]**.
- **No downward VL53L0X or VL53L5CX:** There is **no downward drop-off detection**. `downwardToF` stays `false` and `downwardDistanceMm` stays `null`.

## Core Safety & Data Honesty Rules

1. **One forward VL53L0X only:** Never fabricate downward drop-off safety or safe-to-walk claims.
2. **Absent, invalid, or expired readings are never live:** Disconnected sensors emit `null` and `invalid`/`unavailable`, never `0 cm` or "clear path".
3. **Separate identities:** ESP32-S3 and ESP32-CAM must each be registered with their own `deviceId` and `X-Device-Token`.
4. **No silent fallback:** When a paired ESP32-CAM is offline or stale, the backend reports no live frame and never falls back to another camera or simulator image.
5. **Speaker safety:** Do not attach the unverified speaker to MAX98357A until impedance and power rating are confirmed.

SENTRA is an experimental assistive prototype, not a certified navigation or obstacle-avoidance device.
