# SENTRA Two-Board Pinout Matrix

> **Verify against your physical silkscreen before applying power.** All logic signals are **3.3 V only** — never feed 5 V into ESP32-S3 or ESP32-CAM GPIO pins.

## Physical Mounting & Jumper Plan (Stationary Breadboard + Tethered Moving Sensors)

- **Stationary Breadboard (M-to-M jumpers):** ESP32-S3 N16R8, INMP441 mic, MAX98357A mono amp (+ speaker only after ohm/watt verification), optional GPIO 5 PTT button, and separate ESP32-CAM (power `5V`/`GND` only; **zero DVP wires** to ESP32-S3).
- **Moving Sensor Tether (Female-to-Male jumpers — Female on sensor pins, Male into breadboard):**
  - **GY-521 (MPU6050):** 5 F-to-M jumpers (`VCC -> 3.3V`, `GND -> GND`, `SDA -> GPIO4 hub`, `SCL -> GPIO40 hub`, `AD0 -> GND`).
  - **VL53L0X:** 4 F-to-M jumpers (`VIN -> 3.3V`, `GND -> GND`, `SDA -> GPIO4 hub`, `SCL -> GPIO40 hub`; keep leads <= 20–30 cm for reliable 100 kHz I²C).
- **Power rails:** Left rail = `3.3V` + `GND` (from ESP32-S3 `3V3`/`GND` for GY-521, VL53L0X, INMP441, and conservative initial MAX98357A bring-up). Right rail = `5V` + `GND` (common ground with left rail, dedicated to ESP32-CAM `5V` pin).

## 1. Board 1 — ESP32-S3 N16R8 Sensor Bench Profile (Step 1 — Active Default)

Defined in `firmware/esp32s3/sdkconfig.defaults` and `firmware/esp32s3/include/board_profile.h`:

| Peripheral | Signal | ESP32-S3 GPIO | Notes |
| --- | --- | --- | --- |
| Shared I²C Bus (100 kHz) | `SDA` | **GPIO 4** | Shared by VL53L0X (`0x29`) and GY-521 MPU6050 (`0x68`) |
| Shared I²C Bus (100 kHz) | `SCL` | **GPIO 40** | Verify onboard pull-ups (~4.7 kΩ–10 kΩ to 3.3 V) |
| GY-521 (MPU6050) | `AD0` | **GND** | Fixes 7-bit I²C address at `0x68` |
| GY-521 (MPU6050) | `VCC` / `GND` | `3.3V` / `GND` | Check whether your GY-521 has an LDO; 3.3 V logic required |
| VL53L0X (Forward ToF) | `XSHUT` | **-1 (unconnected)** | **ONLY** when single breakout has a confirmed onboard pull-up to 3.3 V; do not drive an unverified XSHUT pin |
| VL53L0X (Forward ToF) | `VIN` / `GND` | `3.3V` / `GND` | Single forward sensor only; no second/downward ToF |
| Optional Push-to-Talk | `PTT` | **GPIO 5** | Active-low with internal pull-up |

### ESP32-S3 N16R8 Reserved Pins (Compile-Time Guarded in `board_profile.h`)

- **GPIO 26–37:** Flash & Octal PSRAM (DO NOT USE)
- **GPIO 19–20:** Native USB D− / D+ (DO NOT USE)
- **GPIO 43–44:** UART0 TX / RX console (DO NOT USE)
- **GPIO 0, 3, 45, 46:** Strapping pins (avoid for peripherals)
- **GPIO 38 / 48:** Onboard RGB LED on many DevKitC-1 clones (avoid)

## 2. Board 1 — ESP32-S3 Discrete I²S Audio Profile (Step 4 — Disabled by Default)

Enabled only when `CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE=y` (zero conflict with Step 1 sensors or reserved pins; zero WM8960 dependency):

| Module | Signal | ESP32-S3 GPIO | Notes |
| --- | --- | --- | --- |
| **INMP441 Mic** (`I2S_NUM_0` RX) | `SCK` (BCLK) | **GPIO 14** | 16 kHz, 32-bit slot -> 16-bit PCM |
| **INMP441 Mic** | `WS` (LRCLK) | **GPIO 15** | Tie `L/R` pin on INMP441 to **GND** (Left channel) |
| **INMP441 Mic** | `SD` (DOUT) | **GPIO 16** | Data into ESP32-S3 |
| **INMP441 Mic** | `VDD` / `GND` | `3.3V` / `GND` | 3.3 V only |
| **MAX98357A Amp** (`I2S_NUM_1` TX) | `BCLK` | **GPIO 17** | Disabled by default until speaker rating verified |
| **MAX98357A Amp** | `LRC` (WS) | **GPIO 18** | Mono I²S TX; no MCLK or I²C needed |
| **MAX98357A Amp** | `DIN` | **GPIO 21** | Data out from ESP32-S3 |
| **MAX98357A Amp** | `VIN` / `GND` | `5V` or `3.3V` / `GND` | **Leave speaker disconnected** until ohm & watt ratings are verified |

## 3. Board 2 — Separate ESP32-CAM (Step 2 — AI-Thinker First-Candidate Profile)

Defined in `firmware/esp32cam/main/ai_thinker_pins.h`. **No DVP wires connect to the ESP32-S3.** The OV2640 ribbon remains on the ESP32-CAM board.

> **First-candidate notice:** This table matches standard AI-Thinker ESP32-CAM boards and has **not** yet been bench-verified against your specific ESP-32S clone. Verify with the local serial JPEG test first.

| Camera Signal | AI-Thinker Candidate GPIO |
| --- | --- |
| `PWDN` / `RESET` | `GPIO 32` / `-1` |
| `XCLK` | `GPIO 0` |
| `SIOD (SDA)` / `SIOC (SCL)` | `GPIO 26` / `GPIO 27` |
| `Y9..Y2` (D7..D0) | `35, 34, 39, 36, 21, 19, 18, 5` |
| `VSYNC` / `HREF` / `PCLK` | `25` / `23` / `22` |

Flashing header on ESP32-CAM: `U0T` (GPIO 1), `U0R` (GPIO 3), `GND`, `5V` (recommended for stable OV2640 + Wi-Fi current), and temporary `IO0 -> GND` jumper only while entering flash mode.

## 4. [LEGACY] Direct OV2640-to-S3 and WM8960 Profiles

Direct OV2640 DVP wiring to ESP32-S3 (`CONFIG_SENTRA_ENABLE_CAMERA`) and Waveshare WM8960 (`CONFIG_SENTRA_ENABLE_WM8960`) are **LEGACY / disabled by default** and are **not** used on the actual two-board hardware.
