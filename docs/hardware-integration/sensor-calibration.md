# Sensors — acceptance and calibration

**Current firmware does not yet provide real dual VL53L0X readings.** The
calibration below is required after a verified driver is integrated.

- Each ToF must be tested independently at a stationary, known object.
- For both sensors on one bus, hold one XSHUT low, change the first sensor's
  I²C address, then enable/address the second. Check for startup collisions.
- Validate measurement status and signal quality, not just raw distance.
- Document mounting angle, sensor offsets, reflective-surface failures,
  ambient light and measurement limits.
- Downward distance changes are NOT equivalent to certain step/pothole detection.
- MPU6050 has no magnetometer; absolute compass heading is unavailable.
- INA219 can measure voltage/current in its actual measurement path but
  does not reveal a sealed power bank's remaining battery percentage.

Keep hazard-alert logic disabled until genuine readings and real failures
have been tested; never substitute simulated values on physical hardware.
