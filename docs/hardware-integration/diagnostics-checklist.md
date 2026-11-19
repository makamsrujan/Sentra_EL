# SENTRA Hardware Integration Readiness & Diagnostics Checklist

Use this step-by-step verification procedure when bringing up the physical ESP32-S3 wearable with the SENTRA companion app:

| # | Subsystem | Verification Method | Expected Result |
| --- | --- | --- | --- |
| 1 | Backend & SQLite | Open Settings -> Re-check Health (`GET /api/health`) | HTTP 200, SQLite WAL `databaseAvailable: true`, no crash |
| 2 | Operator & Device Token | Configure `SENTRA_OPERATOR_TOKEN`, register via Settings or `/api/device/register` | Unique `X-Device-Token` returned; unauthenticated `/telemetry` returns 401 |
| 3 | Wi-Fi & Telemetry Auth | Boot ESP32-S3 with NVS/menuconfig SSID + token | Serial log shows Wi-Fi IP + HTTP 200 on `/api/device/telemetry` |
| 4 | Forward VL53L0X | Hold hand at 35 cm and 120 cm in front of headband | Dashboard shows ~35 cm (Critical `< 45 cm`), ~120 cm (Clear); no fake `0 cm` |
| 5 | GY-521 MPU6050 | Keep headband still at boot or send `RECALIBRATE_IMU` command | `MPU6050` health `valid` & `calibrated`, pitch changes smoothly, heading stays `null` |
| 6 | Optional Modules | Keep `VL53L5CX` and `WM8960` disabled in Kconfig | Capabilities & health report `unavailable`; boot & loop stay healthy |
| 7 | OV2640 Camera & PSRAM | Enable camera in Kconfig (`QVGA`/`VGA`); open Wearable Camera | PSRAM detected (`esp_psram_is_initialized()`), JPEG `FF D8` stream `LIVE` `< 5s` age |
| 8 | Stale & Offline Guards | Unplug headband Wi-Fi power for >6s | Telemetry marks `stale`/`Disconnected`, frames mark `STALE`, no safe-path claim |
| 9 | Gemini Visual Analysis | Run Verify Gemini API (`POST /api/gemini/diagnostic`) then ask scene query | Uses `gemini-3.8-flash` (or `gemini-4-hydrogen` fallback); rejects stale frames with `NO_FRESH_IMAGE` |
| 10 | "Hey SENTRA" Voice | Tap Enable Mic -> say "Hey SENTRA, describe ahead" | Spoken answer grounded in fresh OV2640 frame + VL53L0X reading |
| 11 | Contextual Memory & Goals | Save landmark note & say "Find my keys" | Goals + memories persist across page refresh in SQLite |
| 12 | Bidirectional Control | Trigger `CAPTURE_FRAME` & config update in Settings | Firmware picks up via `/api/device/poll`, executes, and clears via `/api/device/ack` |
