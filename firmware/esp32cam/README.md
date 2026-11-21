# SENTRA ESP32-CAM Sender Firmware (`firmware/esp32cam`)

Separate ESP-IDF v5.3 project targeting the **original ESP32 (`esp32`)** on an **AI-Thinker-style ESP32-CAM (`ESP-32S`)** module.

> **Verification status:** Compiled/verified as source + host unit tests for helper logic; **no physical ESP32-CAM board has been flashed in CI**. The AI-Thinker pinout in `main/ai_thinker_pins.h` is the **first candidate** profile pending physical bench confirmation on your exact clone.

## Key Design Rules
- Keep the OV2640 ribbon strictly on the ESP32-CAM board — **zero DVP wiring** between the ESP32-CAM and the ESP32-S3.
- Register the camera under its **own device ID** (default `ESP32-CAM-SENTRA-001`) and **own provisioned token** via `POST /api/device/register`. Never reuse the ESP32-S3 token.
- Each boot generates a fresh `X-Boot-Session` header so camera-only reboots never stall behind old pre-reboot frame sequence numbers.
- Keep Wi-Fi credentials, tokens, and `sdkconfig` out of Git (`.gitignore` excludes `firmware/esp32cam/sdkconfig*`).

## Power & Serial Flashing Checklist
1. Supply a clean **5V (>= 1A–2A)** rail to the ESP32-CAM **`5V` and `GND`** pins (avoid powering from 3.3V, which causes Wi-Fi brownouts). Add a 220–470 uF capacitor near `5V`/`GND` on the wearable harness.
2. Connect an **ESP32-CAM-MB** USB dock or a 3.3V USB-UART adapter (`U0R`←TX, `U0T`→RX, `GND`↔GND, and tie `GPIO0` to `GND` only while entering download mode).
3. Build, flash, and monitor:
   ```bash
   cd firmware/esp32cam
   idf.py set-target esp32
   idf.py menuconfig   # SENTRA ESP32-CAM Sender Configuration -> set Wi-Fi, backend URL, camera ID & token
   idf.py build
   idf.py -p /dev/ttyUSB0 flash monitor
   ```
   *(After flashing with a bare USB-UART adapter, remove the `GPIO0`-to-`GND` jumper and press Reset.)*

## First Local JPEG Bench Test (Before Wi-Fi)
1. Leave `SENTRA_CAM_WIFI_SSID` / `SENTRA_CAM_BACKEND_URL` / `SENTRA_CAM_DEVICE_TOKEN` empty on your very first flash.
2. Open `idf.py monitor` and confirm:
   - `OV2640 initialized successfully.`
   - `[LOCAL JPEG BENCH] Valid OV2640 JPEG captured: seq=1 len=... bytes (SOI/EOI OK)`
3. Once local capture passes, register `ESP32-CAM-SENTRA-001` on the backend, configure `menuconfig`, re-flash, and verify `Uploaded JPEG seq=... -> HTTP 200` and `GET /api/device/frame/status?deviceId=ESP32-CAM-SENTRA-001`.
