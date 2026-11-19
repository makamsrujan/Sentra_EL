# SENTRA API simulator

This testbench uses the EXISTING authenticated and labeled `/api/device/simulate`
and `/api/device/simulate/frame` routes. It never claims to be physical hardware.

Start the backend with local-only operator credentials:

```bash
SENTRA_OPERATOR_TOKEN=local-test SENTRA_SIMULATOR_ENABLED=true npm run dev
```

Run the simulator from another terminal:

```bash
SENTRA_OPERATOR_TOKEN=local-test node simulator/esp32_sim.mjs
```

Verifies: simulated ToF and IMU telemetry, frame upload and device-status
source labeling. Does not verify: PCM audio, embedded wake word, Gemini,
physical device auth, camera cable or mobility safety. Never use production credentials.
