# Build, Configure, and Flash (Two-Board ESP-IDF v5.3)

Requires **ESP-IDF v5.3** installed locally. Never commit generated `sdkconfig` files, Wi-Fi passwords, or device tokens to Git.

## 1. Board 1 — ESP32-S3 N16R8 Sensor Bench Firmware (`firmware/esp32s3`)

`firmware/esp32s3/sdkconfig.defaults` sets the reproducible Step 1 bench profile (`16 MB` flash, Octal PSRAM, `SDA=GPIO4`, `SCL=GPIO40`, `XSHUT=-1`, `VL53L0X=0x29`, `MPU6050=0x68`, camera/WM8960/discrete-audio disabled).

```sh
cd firmware/esp32s3
idf.py set-target esp32s3
idf.py menuconfig   # Set Wi-Fi SSID/password, backend URL, S3 deviceId, and provisioned X-Device-Token
idf.py build
idf.py -p YOUR_S3_SERIAL_PORT flash monitor
```

To inspect serial I²C scan and stationary `[BENCH]` readouts **before** configuring Wi-Fi, you can build and flash directly from `sdkconfig.defaults` with blank Wi-Fi credentials.

### Optional Step 4 Audio Bench Overlay (INMP441 Only — MAX98357A Still Disabled)

```sh
cd firmware/esp32s3
rm -f sdkconfig
idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.audio_bench" set-target esp32s3
idf.py menuconfig   # Enable CONFIG_SENTRA_AUDIO_BENCH_TEST_MIC for standalone mic RMS log
idf.py build
idf.py -p YOUR_S3_SERIAL_PORT flash monitor
```

## 2. Board 2 — Separate ESP32-CAM Sender (`firmware/esp32cam`)

Targets the original **ESP32** (`esp32`), NOT `esp32s3`.

```sh
cd firmware/esp32cam
idf.py set-target esp32
# First local JPEG test: build & flash without setting Wi-Fi/token first
idf.py build
# Hold/jumper IO0 to GND, tap RESET, then flash:
idf.py -p YOUR_CAM_SERIAL_PORT flash
# Remove IO0-to-GND jumper, tap RESET, then open monitor:
idf.py -p YOUR_CAM_SERIAL_PORT monitor
```

Once local JPEG capture succeeds on serial monitor, run `idf.py menuconfig` under **SENTRA ESP32-CAM Sender Configuration** to set Wi-Fi credentials, backend URL, its own `deviceId` (e.g. `ESP32-CAM-SENTRA-001`), and its own provisioned `X-Device-Token`, then rebuild and flash.

> **Do not reuse the ESP32-S3 device ID or token on the ESP32-CAM.** Register each board separately via `POST /api/device/register`.
