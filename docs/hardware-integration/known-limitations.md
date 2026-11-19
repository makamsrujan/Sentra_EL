# Known limitations, as verified from this source tree

- No complete dual VL53L0X ranging path yet. MPU6050 register sampling\n  exists in source but is not validated on real hardware.
- The sensor safety loop has not been connected to genuine readings.
- No offline embedded "Hey SENTRA" detector; browser recognition is foreground
  and firmware currently records via a diagnostic button.
- A backend-generated speech action is not the same as verified headset playback.
- Camera acquisition depends on unverified GPIO and cable signal integrity.
- Firmware telemetry reports unavailable sensor/battery data as null.
- Device goals are synchronized via SSE while the backend is running;
  long-term durability of active goals needs further work.
- The simulator exercises backend API routes, not sensors or electronics.
- Gemini model availability and latency depend on live API access.
- Visual-Inertial SLAM and autonomous navigation are not implemented.
- Not a certified mobility or hazard-detection aid.
