# Known Limitations (Actual Two-Board Hardware Baseline)

- **Not physically flashed or bench-tested in CI/sandbox:** All firmware builds here are validated via native GCC host C tests (and GitHub Actions ESP-IDF v5.3 CI jobs when run on GitHub). Local ESP-IDF cross-compilation and real silicon bench testing are still required on your bench.
- **AI-Thinker ESP32-CAM pinout is a first candidate:** Many ESP-32S camera clones match AI-Thinker pins, but exact pin compatibility must be verified with the local serial JPEG test before relying on the board.
- **Single forward VL53L0X only (no downward ToF):** `downwardDropOffCapable` is `false` and `downwardDistanceMm` is `null`. SENTRA cannot detect stairs, curbs, holes, or drop-offs and **never** claims a path is safe to walk.
- **6-axis IMU only (no magnetometer):** GY-521 (MPU6050) has no magnetometer; wearable `imu.heading` remains `null`.
- **Separate board health UI limitation (hard zero-frontend-change constraint):** Because the React frontend is intentionally unchanged, the UI does not show a separate ESP32-CAM settings field or dual-board health card. Configure pairings via `SENTRA_CAMERA_PAIRINGS` in `.env` and inspect each board independently via `GET /api/health`, `GET /api/device/status?deviceId=<id>`, and `X-Camera-Device-Id` headers (see `architecture.md`).
- **Unverified speaker & disabled discrete audio:** `INMP441` and `MAX98357A` support is compiled/guarded in a separate disabled-by-default profile and has **not** been bench-tested. Keep the speaker disconnected until impedance and wattage are confirmed; use phone/browser audio as the fallback.
- **Legacy S3 camera & WM8960:** Retained strictly disabled by default (`CONFIG_SENTRA_ENABLE_CAMERA=n`, `CONFIG_SENTRA_ENABLE_WM8960=n`).
- **No battery fuel gauge:** Sealed USB power banks do not expose I²C battery telemetry; `batteryPercent` stays `null`.
- **Foreground browser wake-word limitation:** "Hey SENTRA" requires an active foreground browser session.
- **Not a medical or certified mobility/navigation device.**
