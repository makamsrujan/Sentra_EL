# SENTRA First Hardware Integration Acceptance Gates

Check boxes **only** after real recorded verification — never from code generation or simulator runs alone.

## Software, Backend Pairing & Host C Verification (Automated)
- [ ] `npm run lint` (`tsc --noEmit`) passes.
- [ ] `npm test` (including `tests/hardwarePairing.test.ts` and `tests/firmwareIntegration.test.ts`) passes.
- [ ] `npm run build` (Vite production build) passes.
- [ ] Native GCC `-Wall -Wextra -Werror` suites pass for S3 sensor profile, S3 discrete audio profile, and ESP32-CAM sender logic.
- [ ] Simulator HTTP smoke test (`node simulator/esp32_sim.mjs`) passes (simulated data only).
- [ ] Git diff confirms **zero frontend changes**.
- [ ] Both ESP-IDF v5.3 firmware targets (`firmware/esp32s3` as `esp32s3` and `firmware/esp32cam` as `esp32`) compile cleanly with ESP-IDF v5.3 (locally or in GitHub Actions).

## Physical Bench Verification (Pending Real Hardware)
- [ ] **Step 1 (S3):** Boot I²C scan detects `0x29` (VL53L0X) and `0x68` (MPU6050) on `SDA=GPIO4, SCL=GPIO40` with confirmed onboard XSHUT pull-up.
- [ ] **Step 1 (S3):** Stationary VL53L0X readings match measured distances (30 / 60 / 120 cm); invalid/absent readings report `null`/`unavailable`.
- [ ] **Step 1 (S3):** GY-521 calibrates at rest, responds to tilt, and keeps `heading: null`.
- [ ] **Step 2 (ESP32-CAM):** Local serial JPEG test produces valid `FF D8 ... FF D9` frames on the physical ESP-32S board.
- [ ] **Step 2 (ESP32-CAM):** Authenticated Wi-Fi JPEG uploads succeed using its own `deviceId` and `X-Device-Token`.
- [ ] **Step 3 (Pairing):** `SENTRA_CAMERA_PAIRINGS` pairs S3 + CAM across preview, visual analysis, and Live Voice; camera-only reboot resumes cleanly; offline/stale camera reports no live frame without fallback.
- [ ] **Step 4 (Audio — Optional):** INMP441 mic bench test verified first; speaker impedance and wattage confirmed **before** connecting speaker and testing MAX98357A tone playback.
