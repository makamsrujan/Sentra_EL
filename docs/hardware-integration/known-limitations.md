# Known limitations, as verified from this source tree

- **Physical hardware unverified:** Firmware (`vl53l0x.c`, `mpu6050.c`, `camera_driver.c`, `i2c_bus.c`, `sentra_nvs_config.c`) has been reviewed and host-unit tested on pure-C math/validation functions, but has not yet been compiled by ESP-IDF or flashed onto physical ESP32-S3 silicon locally.
- **Single forward ToF only on baseline hardware:** Only ONE forward-facing VL53L0X is present on the headband. There is NO downward drop-off ToF sensor and NO multizone VL53L5CX unless optionally installed and enabled (`CONFIG_SENTRA_ENABLE_VL53L5CX=y`). Accordingly, `downwardDropOffCapable` is `false` and SENTRA never claims step/cliff safety or obstacle-free walking paths.
- **6-axis IMU only (no magnetometer):** GY-521 (MPU6050) supplies accelerometer and gyroscope readings for head pitch and motion estimation, but has no magnetometer. Absolute compass heading (`imu.heading`) from the wearable stays `null` (browser compass is used only if phone orientation events are available).
- **Optional WM8960 audio:** Disabled by default (`CONFIG_SENTRA_ENABLE_WM8960=n`). When disabled, voice input/output runs primarily through the phone/browser companion (`Web Speech API` + `speechSynthesis`), while backend STT/TTS endpoints (`gemini-3.5-transcribe` / `gemini-3.8-flash-lite-tts`) remain ready for optional audio boards.
- **Foreground voice wake limitation:** "Hey SENTRA" continuous wake listening depends on an active foreground browser session (`SpeechRecognition`) and is not implemented offline on the ESP32-S3.
- **No battery fuel gauge on baseline bag enclosure:** The 5000 mAh USB power bank supplies 5 V USB power without I²C telemetry, so `batteryPercent` reports `null` unless optional power telemetry is added.
- **OV2640 ribbon & wiring integrity:** Headband-to-bag camera wiring length can introduce clock/signal attenuation; resolution/quality tuning (`QVGA`/`VGA`) is exposed in runtime config in case lower pixel clocks are required.
- **Visual-Inertial SLAM not implemented:** `SlamPoseContractPlaceholder` is exposed solely as a planned interface (`status: 'planned'`).
- **Gemini availability & latency:** Visual scene grounding depends on `GEMINI_API_KEY` and upstream model availability (`gemini-3.8-flash` / fallback `gemini-4-hydrogen`).
- **Not a medical or certified mobility device.**
