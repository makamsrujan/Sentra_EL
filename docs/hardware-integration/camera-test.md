# OV2640 acceptance

1. Confirm exact ESP32-S3 board and camera breakout GPIO assignments.
2. Verify camera power rail and logic voltage.
3. Enable `SENTRA_ENABLE_CAMERA` only after verifying the electrical map.
4. Initialize in JPEG mode at a low initial resolution.
5. Confirm an actual `esp_camera_fb_get()` frame and valid JPEG.
6. Upload to `POST /api/device/frame` using provisioned device token.
7. Check the Wearable Camera preview updates and stale-frame diagnostics.
8. Repeat at intended headband cable length. Long parallel-camera cables may fail.
9. Check simultaneous Wi-Fi, microphone, ToF and camera operation for conflicts.

A simulated JPEG or successful compilation does not prove camera capture.
