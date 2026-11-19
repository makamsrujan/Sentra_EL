# SENTRA acceptance gates

Mark a checkbox only after a real recorded test — never solely from generated code or simulator runs.

## Software, Protocol & Host Tests
- [ ] GitHub application CI (`lint`, `vitest`, Vite build, `esp32_sim.mjs`) green on merge commit.
- [ ] GitHub ESP32 firmware CI (`espressif/esp-idf-ci-action` release-v5.3 `esp32s3`) green on merge commit.
- [ ] Operator registration and one-time `X-Device-Token` provisioning tested end-to-end.
- [ ] Live Gemini API verified via `POST /api/gemini/diagnostic` (`gemini-3.8-flash` / fallback).

## Physical Hardware Verification (Upon Assembly)
- [ ] Exact ESP32-S3 N16R8 board, OV2640 breakout, VL53L0X, and GY-521 wiring schematics matched to `Kconfig.projbuild` GPIO pins.
- [ ] ESP32-S3 PSRAM (`esp_psram_is_initialized()`) detected and Wi-Fi maintains fresh telemetry without watchdog resets.
- [ ] Single forward VL53L0X produces validated cm distances matching calibrated targets; sensor faults report `invalid`/`unavailable`.
- [ ] GY-521 MPU6050 stationary calibration completes cleanly and pitch reflects real head tilt (no fabricated compass heading).
- [ ] OV2640 captures valid JPEG frames at headband cable length and delivers them under fresh age thresholds.
- [ ] Bidirectional runtime config (`POST /api/device/config`) and remote commands (`CAPTURE_FRAME`, `RECALIBRATE_IMU`) execute and acknowledge (`POST /api/device/ack`).
- [ ] Disconnected sensors and stale camera frames (`> frameStaleMs`) never display as live observations or imply safe paths.
- [ ] Optional modules (`VL53L5CX`, `WM8960`) remain cleanly disabled/unavailable unless physically attached and enabled via Kconfig.
- [ ] Power stability and thermal behavior verified on the 5000 mAh bag-mounted USB power bank.
- [ ] Supervised indoor demonstration completed with explicit baseline forward-only sensing notice.
