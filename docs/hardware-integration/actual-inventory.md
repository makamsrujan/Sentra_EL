# SENTRA — actual hardware inventory and integration contract

Status: **planning and compatibility verification; not proof of working hardware**.

## Fixed architecture

- **Headband:** OV2640 camera facing forward, one VL53L0X proximity sensor, GY-521 (MPU6050) motion sensor; reserve space for one VL53L5CX when obtained.
- **Bag-mounted enclosure:** ESP32-S3 N16R8, power bank, controller wiring and eventual WM8960 codec.
- **Phone / companion PWA and backend:** receive authenticated JPEG frames and timestamped sensor readings, invoke Gemini for requested scene interpretation, handle memory and conversational responses.
- **Audio:** initially use phone microphone and wired headset where supported; WM8960 wearable microphone/headset operation remains a separate future hardware milestone.
- The headband and bag box are connected by a **flexible, strain-relieved harness**. Camera parallel signals must be tested first with a short cable and then at intended length; do not assume long jumper wires work.

## Actual procurement status (reported 2026-11-19; confirm against photos)

| Part | Count | Status |
| --- | ---: | --- |
| ESP32-S3 N16R8 development board | 1 | Reported obtained |
| OV2640 camera or ESP32-CAM assembly | 1 | Reported obtained; **exact breakout/interface unknown** |
| VL53L0X ToF breakout | 1 | Reported obtained |
| GY-521 breakout containing MPU6050 | 1 | Reported obtained |
| 5000 mAh USB power bank | 1 | Reported obtained |
| Wired earphones with microphone | 1 | Reported obtained; headset connector/interface to verify |
| Enclosure, perfboard, hookup wires and connectors | As purchased | Reported obtained; inventory/voltage checks pending |
| VL53L5CX multizone depth breakout | 1 | Not yet obtained |
| WM8960 audio codec breakout | 1 | Not yet obtained |
| Flexible headband-to-box harness | 1 | Not yet obtained |

**Do not confuse an ESP32-CAM board with a directly attachable OV2640 breakout.** Record board markings, photographs, camera pinout, accessible GPIO and required power rails before assigning connections.

## Firmware-to-inventory corrections

1. The prototype has **one VL53L0X**, not two. Do not implement or require a second VL53L0X or XSHUT address remapping for this inventory.
2. VL53L5CX is a **different multizone sensor**; its driver and data contract must be separate from VL53L0X and optional until purchased.
3. Use actual hardware readings with timestamps, source identity and explicit unavailable/null fields. Never substitute simulator values as physical measurements.
4. Do not enable local obstacle alerts until real ranging, thresholds, stale-data behavior and fail-safe responses are validated under stationary, supervised tests.
5. Keep phone audio as a documented temporary fallback; do not claim hands-free wearable wake-word recognition without measured end-to-end evidence.
6. Keep all proposed pin assignments provisional until exact ESP32-S3 and camera boards are identified. Never wire from an unverified pinout.

## Phase-one acceptance checks

- [ ] Existing TypeScript lint, unit tests and production build pass.
- [ ] ESP-IDF firmware compiles for the selected board profile.
- [ ] Confirm board and OV2640 interface from photographs/markings.
- [ ] ESP32 joins trusted Wi-Fi and sends authenticated, real device heartbeat/telemetry.
- [ ] One VL53L0X returns valid distance data; disconnected/stale sensor shows unavailable.
- [ ] GY-521 supplies actual accelerometer/gyro samples.
- [ ] Camera produces a real JPEG through a verified short connection, then through tested harness length.
- [ ] Companion app distinguishes phone camera, wearable camera, stale frames and simulated readings.
- [ ] Phone voice and Gemini requests work end-to-end with errors surfaced clearly.
- [ ] Supervised, stationary demonstration passes without claiming autonomous safe navigation.

SENTRA is an experimental assistive prototype, not a certified navigation or obstacle-avoidance device.
