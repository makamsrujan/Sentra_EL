# Hardware arrival checklist

1. Obtain front/back photos of ESP32-S3, OV2640 breakout, WM8960 and ToF boards.
2. Identify exact part numbers and manufacturer pinout PDFs.
3. Confirm all signal pins are accessible on the ESP32 carrier.
4. Confirm 3.3V signal compatibility; never assume 5V is safe on GPIO.
5. Use a protected, sealed 5V USB power bank; do not modify or open it.
6. Build and flash a basic firmware image with no peripheral connections.
7. Add the WM8960 and headset; prove a quiet test tone and a genuine mic sample.
8. Add and test one VL53L0X, then the other with separate XSHUT control.
9. Add the MPU6050 and validate raw motion readings at rest.
10. Test the camera at a short connection first. Verify image transfer and freshness.
11. Try the intended headband-to-bag cable length only after short-cable success.
12. Combine modules while monitoring power, heat and Wi-Fi stability.
13. Confirm no warnings imply that an unmeasured path is safe.

Carry out mobility demonstrations only in controlled, supervised conditions.
