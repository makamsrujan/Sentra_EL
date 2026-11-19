# SENTRA acceptance gates

- [ ] Exact development board and breakout schematics confirmed.
- [ ] GitHub application CI green on the final merge commit.
- [ ] GitHub ESP32 firmware CI green on the final merge commit.
- [ ] Operator registration and device token provisioning tested.
- [ ] Actual ESP32 Wi-Fi connects and telemetry remains fresh.
- [ ] OV2640 produces real frames, including at intended cable length.
- [ ] Two ToF sensors produce correctly addressed, validated real data.
- [ ] MPU6050 tilt reflects physical movement.
- [ ] Local alerts interrupt playback without any cloud connection.
- [ ] Actual headset mic captures intelligible audio.
- [ ] AI response plays through earphone exactly once.
- [ ] Hands-free "Hey SENTRA" is independently tested without a button.
- [ ] Wearable goal creation and updates appear in the app.
- [ ] Stale frames and disconnected sensors never imply a safe path.
- [ ] Battery and temperature operation verified with protected power.
- [ ] Supervised indoor demo; no independent walking claim.

Mark a checkbox only after a real recorded test, not based on generated code.
