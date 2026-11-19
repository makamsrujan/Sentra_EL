# Sensors — acceptance and calibration

**Baseline hardware uses ONE forward VL53L0X ToF sensor and ONE GY-521 MPU6050 6-axis IMU on the headband.** Both drivers exist in `firmware/esp32s3/src/` (`vl53l0x.c`, `mpu6050.c`) and must be calibrated on real silicon after wiring.

- **VL53L0X (Single Forward ToF, default I²C `0x29`):**
  - Verify `0xC0` model ID read (`0xEE`) succeeds at boot.
  - Validate against flat matte targets at known distances (e.g. `30 cm`, `60 cm`, `120 cm`, `200 cm`) in indoor lighting.
  - Confirm `range_status` rejection drops out-of-range (`< 20 mm` or `> 4000 mm`) and dark/saturated errors (`status != 0/11`) instead of transmitting fake `0 cm` distances.
  - Tune experimental proximity thresholds (`proximityCautionCm`, `proximityCriticalCm`) via `/api/device/config` after testing field-of-view cone (`~25°`).
  - Because no downward ToF sensor is installed on baseline hardware, **never infer ground drop-off safety or safe walking paths** from forward VL53L0X readings.
- **GY-521 (MPU6050 6-Axis IMU, I²C `0x68`):**
  - Keep headband stationary during the first ~1.5 s after boot or after sending `RECALIBRATE_IMU` so gyroscope zero-rate bias calibration completes cleanly (`calibrated: true`).
  - Verify accelerometer gravity axis matches the physical headband mounting orientation and adjust pitch sign if inverted.
  - MPU6050 contains **no magnetometer** — never fabricate an absolute compass heading (`heading: null` always).
- **Optional Sensors (`VL53L5CX`, `WM8960`):**
  - Leave `CONFIG_SENTRA_ENABLE_VL53L5CX=n` and `CONFIG_SENTRA_ENABLE_WM8960=n` on baseline hardware so disabled modules never block boot or trigger false I²C faults.
- **Power Bank Telemetry:**
  - A sealed 5000 mAh USB power bank cannot report remaining percentage; keep `batteryPercent: null`.
