# Step 1 — S3 Sensor Bring-Up, I²C Scan, and Stationary Bench Test

**Actual hardware uses ONE forward VL53L0X ToF sensor (`0x29`) and ONE GY-521 MPU6050 6-axis IMU (`0x68`, AD0 low) on the ESP32-S3 N16R8 I²C bus (`SDA = GPIO4`, `SCL = GPIO40`, `100 kHz`, `XSHUT = -1`).**

## 1. Boot I²C Bus Scan Verification

On boot, `firmware/esp32s3` automatically executes `sentra_i2c_bus_scan()` across 7-bit addresses `0x08..0x77` and logs every ACK:

- Expected output with both breakouts wired:
  - `ACK at 0x29 (VL53L0X expected)`
  - `ACK at 0x68 (MPU6050 expected, AD0=LOW)`
- If `0x29` is missing: verify `3.3 V`, `GND`, `SDA=GPIO4`, `SCL=GPIO40`, and verify the VL53L0X breakout has an **onboard pull-up on XSHUT** (if your breakout lacks an onboard XSHUT pull-up, do **not** leave XSHUT floating — tie XSHUT through a verified 10 kΩ pull-up to 3.3 V or assign a verified GPIO in menuconfig).
- If `0x68` is missing (or `0x69` appears): verify GY-521 `AD0` is tied to `GND`.

## 2. Stationary Measured-Distance Bench Test (VL53L0X)

Monitor serial output (`idf.py -p PORT monitor`); every 2 s the firmware prints a `[BENCH]` summary line:

1. Verify `0xC0` model ID read (`0xEE`) succeeds at boot.
2. Place a flat, matte target perpendicular to the VL53L0X at **30 cm**, **60 cm**, and **120 cm** (measured with a ruler/tape).
3. Record reported `forwardDistanceCm` and compare against the physical measurement.
4. Aim into open space (> 2 m) or cover/disconnect the sensor briefly and confirm:
   - Out-of-range / invalid readings log `UNAVAILABLE` (and transmit `forwardDistanceCm: null`, `sensorHealth.forwardToF: "invalid"`).
   - Absent, invalid, or expired readings are **never** shown as `0 cm`, live, or evidence of a clear path.
5. Because **no downward ToF sensor is installed**, `downwardToF` is always `false` and `downwardDistanceMm` is always `null`. Never infer drop-off safety or safe walking paths.

## 3. Stationary IMU Bench Test (GY-521 MPU6050)

1. Hold the GY-521 stationary on a flat surface during boot (~1.5 s) so gyroscope bias calibration completes (`calibrated: true`).
2. Confirm rest acceleration magnitude is near `~9.81 m/s²` and gyro rates are near `0 deg/s`.
3. Tilt forward/backward by ~30° and confirm `pitch` changes smoothly in the expected direction.
4. Confirm `heading` stays `null` (MPU6050 has **no magnetometer** — never fabricate a compass heading).
