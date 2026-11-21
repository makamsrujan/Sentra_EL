# SENTRA Two-Board Hardware Integration Diagnostics Checklist

Use this checklist in order during physical bring-up. Mark items passed only after real bench observation.

| # | Step / Subsystem | Verification Method | Expected Result |
| --- | --- | --- | --- |
| 1 | Backend & SQLite | `GET /api/health` | HTTP 200, `databaseAvailable: true`, `cameraPairings` shows `S3=CAM` |
| 2 | Separate Registration | Register `ESP32-S3-SENTRA-001` and `ESP32-CAM-SENTRA-001` via `POST /api/device/register` | Two distinct `X-Device-Token` values; cross-board token use returns HTTP `401` |
| 3 | S3 Boot I²C Scan | Flash `firmware/esp32s3` (`sdkconfig.defaults`) and inspect serial | Boot scan ACKs `0x29` (VL53L0X) and `0x68` (MPU6050) on `SDA=4, SCL=40` |
| 4 | S3 Stationary VL53L0X | Hold flat target at 30 cm, 60 cm, 120 cm; then point at open space / disconnect | Measured cm within bench tolerance; invalid/absent reports `null`/`UNAVAILABLE`, never `0 cm` or clear path |
| 5 | S3 Stationary MPU6050 | Keep still ~1.5 s at boot, then tilt 30° | `calibrated: true`, smooth pitch change, `heading: null` |
| 6 | S3 Disabled Modules | Confirm camera, WM8960, downward ToF, discrete audio disabled | `downwardToF: false`, `downwardDistanceMm: null`, clean boot loop |
| 7 | ESP32-CAM Local JPEG | Flash `firmware/esp32cam` with blank Wi-Fi/token and inspect serial | OV2640 initializes on AI-Thinker candidate profile and logs valid `FF D8 ... FF D9` JPEG sizes |
| 8 | ESP32-CAM Wi-Fi Upload | Configure own CAM ID + token and reflash | Serial logs `boot_session` + HTTP 200 on `POST /api/device/frame` |
| 9 | Paired UI & API Check | Open unchanged UI on S3 ID; check `GET /api/device/frame/latest?deviceId=ESP32-S3-SENTRA-001` | UI shows live JPEG + S3 sensors; headers show `X-Device-Id: ESP32-S3-SENTRA-001` and `X-Camera-Device-Id: ESP32-CAM-SENTRA-001` |
| 10 | Independent Board Health | Query `/api/device/status` separately for S3 ID and CAM ID | Each board reports its own independent connection & health status |
| 11 | Camera-Only Reboot | Reset ESP32-CAM while S3 stays online | New `X-Boot-Session` advances server sequence monotonically; preview resumes without stalling |
| 12 | Independent Disconnect | Unplug ESP32-CAM while S3 stays online (and vice versa) | Offline camera yields HTTP `404` / `NO_FRESH_IMAGE` while S3 ToF/IMU stay live; never falls back to another camera or simulator |
| 13 | Step 4 Audio (Optional) | Test INMP441 RMS alone first; keep speaker disconnected until rating verified | Phone/browser audio stays working fallback; speaker tested only after ohm/watt check |
