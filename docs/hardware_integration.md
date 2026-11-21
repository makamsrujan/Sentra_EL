# SENTRA Two-Board Hardware Integration & Wiring Guide

> **Verification Status Notice**
> - **Firmware & Backend Contracts:** Pin mappings, compile-time GPIO conflict guards (`firmware/esp32s3/include/board_profile.h`), Kconfig overlays (`sdkconfig.defaults`, `sdkconfig.defaults.audio_bench`, `sdkconfig.defaults.wearable_full`), ESP32-CAM first-candidate pin profile (`firmware/esp32cam/main/ai_thinker_pins.h`), and backend pairing (`SENTRA_CAMERA_PAIRINGS`, `gemini-3.8-live`) are defined and host-tested.
> - **Physical Bench Testing:** **Not yet physically bench-verified on real boards.** Treat the ESP32-CAM AI-Thinker pinout as the first-candidate profile for your clone, leave the speaker disconnected until its impedance (Ω) and wattage (W) are confirmed, and bring up hardware in the 4-stage order below.
> - **Capability Boundaries:** This hardware provides **single-beam forward distance (VL53L0X) + IMU motion (MPU6050) + paired camera + wearable voice assistance only**. It does **not** provide downward drop-off/cliff detection, autonomous navigation, or safe-to-walk guarantees.

---

## 1. Hardware Bill of Materials (Active vs. Excluded)

### Active Components

| Component | Model / Variant | Role | Mounting | Firmware Target / Bus |
| --- | --- | --- | --- | --- |
| **Main Controller** | **ESP32-S3 N16R8** (16 MB Flash, 8 MB Octal PSRAM) | Telemetry, I²C sensors, discrete I²S audio (INMP441 + MAX98357A), PTT trigger, Wi-Fi upload | Stationary breadboard | `firmware/esp32s3` (`esp32s3`) |
| **Camera Node** | **ESP32-CAM (ESP-32S module, AI-Thinker-style layout)** + onboard OV2640 ribbon | Standalone Wi-Fi JPEG capture & upload to `POST /api/device/frame` with its own device ID & token | Separate module (power only; ribbon stays on board) | `firmware/esp32cam` (`esp32`) |
| **IMU Sensor** | **GY-521 (MPU6050)** | 6-axis accelerometer + gyroscope (motion / tilt / heading deltas) | Tethered moving sensor via **Female-to-Male (F-to-M)** jumpers | Shared I²C (`0x68`, `AD0 = GND`) |
| **Forward Distance Sensor** | **VL53L0X** (exactly one forward sensor breakout) | Single-beam forward Time-of-Flight (ToF) ranging | Tethered moving sensor via **Female-to-Male (F-to-M)** jumpers | Shared I²C (`0x29`, `XSHUT = -1`*) |
| **Microphone** | **INMP441** omnidirectional MEMS I²S mic | 16 kHz mono 16-bit PCM voice capture (wearable input) | Stationary breadboard | `I2S_NUM_0` RX (`GPIO14/15/16`) |
| **Audio Amplifier** | **MAX98357A** mono Class-D I²S amp | 24 kHz mono WAV playback (`gemini-3.8-live` replies & alerts) | Stationary breadboard | `I2S_NUM_1` TX (`GPIO17/18/21`) |
| **Speaker** | Small mono speaker (**impedance Ω & wattage W unverified**) | Wearable voice output | Connected to MAX98357A `+`/`-` **only after rating is verified** | Bridged Class-D out (never ground either lead) |
| **Push-to-Talk (PTT) Button** | Momentary tactile push button (optional in Stage 1, used in Stage 3–4) | Debounced press starts a 3.5 s INMP441 recording and uploads with `X-Audio-Trigger: ptt` | Stationary breadboard | `GPIO5` ↔ `GND` (active-low internal pull-up) |

*\*`XSHUT = -1` is valid **only** on a single VL53L0X breakout with a confirmed onboard pull-up resistor to `3.3V`/`2.8V`. Do not drive an unverified `XSHUT` pin.*

### Explicitly Excluded Hardware (Legacy / Not Used)

- **No WM8960 audio codec** — legacy WM8960 code paths remain disabled (`CONFIG_SENTRA_ENABLE_WM8960=n`). Wearable audio runs strictly through `INMP441` + `MAX98357A` + speaker.
- **No direct OV2640-to-ESP32-S3 DVP camera wiring** — `CONFIG_SENTRA_ENABLE_CAMERA=n` on the S3. Zero data/control wires run between the ESP32-CAM and ESP32-S3.
- **No downward ToF sensor** — only one forward `VL53L0X` is wired and enabled.

---

## 2. System Topology & Physical Layout

```text
+-------------------------------------------------------------------+
|                     STATIONARY BREADBOARD                         |
|                                                                   |
|  [3.3V Rail] <--- ESP32-S3 N16R8 3V3                              |
|  [GND  Rail] <--- ESP32-S3 N16R8 GND                              |
|                                                                   |
|  +-----------------------+     +----------------------------+     |
|  |   ESP32-S3 N16R8      |     |  INMP441 (I2S_NUM_0 RX)    |     |
|  |  GPIO14 (SCK)  -------+---->|  SCK                       |     |
|  |  GPIO15 (WS)   -------+---->|  WS          VDD -> 3.3V   |     |
|  |  GPIO16 (SD)   <------+-----|  SD          GND -> GND    |     |
|  |                       |     |              L/R -> GND    |     |
|  |                       |     +----------------------------+     |
|  |                       |                                        |
|  |                       |     +----------------------------+     |
|  |  GPIO17 (BCLK) -------+---->|  MAX98357A (I2S_NUM_1 TX)  |     |
|  |  GPIO18 (LRC)  -------+---->|  LRC         VIN -> 3.3V*  |     |
|  |  GPIO21 (DIN)  -------+---->|  DIN         GND -> GND    |     |
|  |                       |     |  (+ / -) -> [Speaker]**    |     |
|  |                       |     +----------------------------+     |
|  |                       |                                        |
|  |  GPIO5  (PTT)  -------+----> [Tactile Switch] ----> GND        |
|  |                       |                                        |
|  |  GPIO4  (SDA)  -------+----> Breadboard SDA Hub Row            |
|  |  GPIO40 (SCL)  -------+----> Breadboard SCL Hub Row            |
|  +-----------------------+           |            |               |
+--------------------------------------|------------|---------------+
                                       |  F-to-M    |  F-to-M
                                       |  Jumpers   |  Jumpers
                                       | (<=25 cm)  | (<=25 cm)
                                       v            v
                      +--------------------+  +--------------------+
                      | GY-521 (MPU6050)   |  | VL53L0X (Forward)  |
                      | Addr: 0x68         |  | Addr: 0x29         |
                      | VCC -> 3.3V        |  | VIN -> 3.3V        |
                      | GND -> GND         |  | GND -> GND         |
                      | SDA -> GPIO4       |  | SDA -> GPIO4       |
                      | SCL -> GPIO40      |  | SCL -> GPIO40      |
                      | AD0 -> GND         |  | XSHUT -> NC***     |
                      +--------------------+  +--------------------+
                       (Moving / Mounted)      (Moving / Mounted)

+-------------------------------------------------------------------+
|              SEPARATE BOARD — NO WIRES TO ESP32-S3                |
|                                                                   |
|  Dedicated 5V (>=1A) ---> [5V]  ESP32-CAM (ESP-32S AI-Thinker)    |
|  Power GND           ---> [GND] OV2640 ribbon stays on board      |
|                                 Uploads JPEG via Wi-Fi to backend |
+-------------------------------------------------------------------+
*  Start MAX98357A VIN at 3.3V for lower, safer initial speaker output.
** Leave speaker disconnected until impedance (Ohm) and wattage (W) are verified.
***Leave XSHUT unconnected ONLY if breakout has a confirmed onboard pull-up.
```

---

## 3. Precise Pin-to-Pin Wiring Tables & Diagrams

### 3.1 Breadboard Power Distribution (Wire First, Power Disconnected)

| Source Pin | Destination | Wire Type | Notes |
| --- | --- | --- | --- |
| ESP32-S3 **`3V3`** | Breadboard **`+` (3.3V) rail** | Male-to-Male | Powers GY-521, VL53L0X, INMP441, and initial MAX98357A bench power |
| ESP32-S3 **`GND`** | Breadboard **`-` (GND) rail** | Male-to-Male | Shared ground reference for all S3 peripherals |

> Never power the **INMP441** from `5V` (3.3V maximum). Never power the **ESP32-CAM** from the ESP32-S3's `3V3` regulator (it requires a dedicated `5V`, ≥ 1 A supply to avoid Wi-Fi/camera brownouts).

---

### 3.2 Tethered Moving Sensors — Shared I²C Bus (`100 kHz`, Female-to-Male Jumpers)

Reserve two breadboard tie-point rows as your **SDA hub (`GPIO4`)** and **SCL hub (`GPIO40`)**. Plug the **female** end of each jumper onto the sensor header pins and the **male** end into the breadboard rails/hub rows.

```text
ESP32-S3 N16R8          Breadboard Hubs           Tethered Sensors (F-to-M)
--------------          ---------------           -------------------------
  3V3  -------------->  [3.3V Rail] ---+--------> GY-521 VCC
                                       +--------> VL53L0X VIN

  GND  -------------->  [GND  Rail] ---+--------> GY-521 GND
                                       +--------> GY-521 AD0   (locks 0x68)
                                       +--------> VL53L0X GND

  GPIO4  ------------>  [SDA  Row ] ---+--------> GY-521 SDA
                                       +--------> VL53L0X SDA

  GPIO40 ------------>  [SCL  Row ] ---+--------> GY-521 SCL
                                       +--------> VL53L0X SCL
```

#### GY-521 (MPU6050) — I²C Address `0x68`

| GY-521 Pin (Female End) | ESP32-S3 / Breadboard (Male End) | Kconfig / Firmware Symbol | Notes |
| --- | --- | --- | --- |
| **`VCC`** | Breadboard **`3.3V` rail** | — | Keeps I²C pull-ups at safe 3.3V logic |
| **`GND`** | Breadboard **`GND` rail** | — | Common ground |
| **`SDA`** | ESP32-S3 **`GPIO4`** (SDA hub) | `CONFIG_SENTRA_PIN_I2C_SDA=4` | Shared I²C data |
| **`SCL`** | ESP32-S3 **`GPIO40`** (SCL hub) | `CONFIG_SENTRA_PIN_I2C_SCL=40` | Shared I²C clock |
| **`AD0`** | Breadboard **`GND` rail** | `MPU6050_I2C_ADDR=0x68` | Required so address stays `0x68` |
| `XDA`, `XCL`, `INT` | *Not connected* | — | Unused |

#### VL53L0X (Single Forward ToF) — I²C Address `0x29`

| VL53L0X Pin (Female End) | ESP32-S3 / Breadboard (Male End) | Kconfig / Firmware Symbol | Notes |
| --- | --- | --- | --- |
| **`VIN`** (or `VCC`) | Breadboard **`3.3V` rail** | — | Power |
| **`GND`** | Breadboard **`GND` rail** | — | Common ground |
| **`SDA`** | ESP32-S3 **`GPIO4`** (SDA hub) | `CONFIG_SENTRA_PIN_I2C_SDA=4` | Shared I²C data |
| **`SCL`** | ESP32-S3 **`GPIO40`** (SCL hub) | `CONFIG_SENTRA_PIN_I2C_SCL=40` | Shared I²C clock |
| **`XSHUT`** | *Not connected* | `CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT=-1` | Valid only with confirmed onboard pull-up; if missing, pull to `3.3V` via 10 kΩ |
| `GPIO1` | *Not connected* | — | Unused |

> **F-to-M Cabling Notes:** Keep tethered I²C leads ≤ 20–30 cm (do not daisy-chain multiple jumpers), bundle the wires cleanly so movement does not loosen pins, and verify both `0x29` and `0x68` appear in the boot I²C scan log.

---

### 3.3 INMP441 I²S Microphone (`I2S_NUM_0` RX — Stationary Breadboard)

```text
ESP32-S3 N16R8                      INMP441 Breakout
--------------                      ----------------
  3V3 (Rail)  ------------------->  VDD  (3.3V ONLY)
  GND (Rail)  ---+--------------->  GND
                 +--------------->  L/R  (GND = Left mono slot)
  GPIO14      ------------------->  SCK  (BCLK)
  GPIO15      ------------------->  WS   (LRCLK)
  GPIO16      <-------------------  SD   (Data Out)
```

| INMP441 Pin | ESP32-S3 / Breadboard | Kconfig / Firmware Symbol | Notes |
| --- | --- | --- | --- |
| **`VDD`** | Breadboard **`3.3V` rail** | — | Strictly 3.3V (5V damages module) |
| **`GND`** | Breadboard **`GND` rail** | — | Ground |
| **`L/R`** | Breadboard **`GND` rail** | Mono Left channel (`I2S_CHANNEL_FMT_ONLY_LEFT`) | Must be tied to `GND` (not left floating) |
| **`SCK`** | ESP32-S3 **`GPIO14`** | `CONFIG_SENTRA_PIN_INMP441_SCK=14` | Bit clock |
| **`WS`** | ESP32-S3 **`GPIO15`** | `CONFIG_SENTRA_PIN_INMP441_WS=15` | Word select |
| **`SD`** | ESP32-S3 **`GPIO16`** | `CONFIG_SENTRA_PIN_INMP441_SD=16` | Serial audio data into S3 |

---

### 3.4 MAX98357A I²S Mono Amplifier (`I2S_NUM_1` TX — Stationary Breadboard)

```text
ESP32-S3 N16R8                      MAX98357A Breakout
--------------                      ------------------
  3V3 (Rail)  ------------------->  VIN   (3.3V initial safe power)
  GND (Rail)  ------------------->  GND
  GPIO17      ------------------->  BCLK
  GPIO18      ------------------->  LRC
  GPIO21      ------------------->  DIN
                                    GAIN  -> Floating (9 dB) or 100k to GND (3 dB)
                                    SD    -> Floating (enabled, L+R/2 mix)
                                    (+)   -> [DISCONNECTED until speaker verified]
                                    (-)   -> [DISCONNECTED until speaker verified]
```

| MAX98357A Pin | ESP32-S3 / Breadboard | Kconfig / Firmware Symbol | Notes |
| --- | --- | --- | --- |
| **`VIN`** | Breadboard **`3.3V` rail** (initial) | — | Lower safe output power while testing |
| **`GND`** | Breadboard **`GND` rail** | — | Ground |
| **`BCLK`** | ESP32-S3 **`GPIO17`** | `CONFIG_SENTRA_PIN_MAX98357A_BCLK=17` | Bit clock |
| **`LRC`** | ESP32-S3 **`GPIO18`** | `CONFIG_SENTRA_PIN_MAX98357A_LRC=18` | Left/right clock |
| **`DIN`** | ESP32-S3 **`GPIO21`** | `CONFIG_SENTRA_PIN_MAX98357A_DIN=21` | Audio data out from S3 |
| **`GAIN`** | Floating (9 dB) or 100 kΩ to `GND` (3 dB) | — | Use lower gain first |
| **`SD`** | Floating (internal pull-up enables output) | — | Do not tie to `GND` |
| **`+` / `-`** | **Leave speaker disconnected until verified** | — | Bridged Class-D: **never** connect `+` or `-` to `GND` |

---

### 3.5 Push-to-Talk (PTT) Button (Active-Low — Stationary Breadboard)

```text
ESP32-S3 N16R8                      Momentary Tactile Button
--------------                      ------------------------
  GPIO5       ------------------->  Switch Pin A (internal pull-up enabled)
  GND (Rail)  ------------------->  Switch Pin B (diagonally opposite leg on 4-pin switch)
```

| Button Pin | ESP32-S3 / Breadboard | Firmware Symbol | Behavior |
| --- | --- | --- | --- |
| **Pin A** | ESP32-S3 **`GPIO5`** | `CONFIG_SENTRA_PIN_ACTION_BUTTON=5` / `BOARD_PIN_PTT_BUTTON` (`5`) | Debounced press (50 ms low) records 3.5 s INMP441 WAV and uploads with `X-Audio-Trigger: ptt` + `X-Boot-Session` to backend **`gemini-3.8-live`** bridge |
| **Pin B** | Breadboard **`GND` rail** | — | Active-low closure |

---

### 3.5a Battery Voltage Monitor (`ADC1_CH5` on `GPIO6` — Stationary Breadboard Voltage Divider)

> **CRITICAL PIN VOLTAGE WARNING:** ESP32-S3 GPIOs are rated for **`3.3V` maximum**. **NEVER** wire a raw 1S LiPo (`3.0–4.2V`) or `5V` USB rail directly to `GPIO6`. Always use an external resistor voltage divider (e.g., two `100 kΩ` resistors = `2:1` ratio) so the voltage at `GPIO6` stays safely below `3.3V`.

```text
  VBAT (+) ---[ R1 = 100 kOhm ]---+---[ R2 = 100 kOhm ]---> GND (Rail)
                                  |
                                  +---> ESP32-S3 GPIO6 (ADC1_CH5, Wi-Fi safe)
                                        (Optional 100 nF cap from GPIO6 to GND for noise filtering)
```

| Node | ESP32-S3 / Breadboard | Firmware Symbol | Notes |
| --- | --- | --- | --- |
| **Divider Midpoint** | ESP32-S3 **`GPIO6`** (`ADC1_CH5`) | `CONFIG_SENTRA_ENABLE_BATTERY_ADC=y`, `CONFIG_SENTRA_PIN_BATTERY_ADC=6` | Wi-Fi safe ADC1 pin; unwired/grounded pin (`< 0.25V`) reports `batteryVoltageV: null` |
| **Divider Scale** | `R1 = 100 kΩ`, `R2 = 100 kΩ` (`2.0×`) | `CONFIG_SENTRA_BATTERY_ADC_SCALE_MILLI=2000` | Adjust to `round(((R1 + R2) / R2) * 1000)` in `menuconfig` if using different resistor values |

---

### 3.6 Separate Board — ESP32-CAM (`ESP-32S`, AI-Thinker Candidate Profile)

Keep the OV2640 ribbon strictly on the ESP32-CAM board. **No GPIO wires connect between the ESP32-CAM and the ESP32-S3.**

#### Flashing Wiring (External 3.3V USB-UART Adapter, e.g., CP2102/FTDI)

*(Skip this table if using an ESP32-CAM-MB USB programming base.)*

```text
3.3V USB-UART Adapter               ESP32-CAM (ESP-32S)
---------------------               -------------------
  5V          ------------------->  5V
  GND         ---+--------------->  GND
                 +---[FLASH ONLY]-> IO0  (REMOVE jumper after flashing!)
  TX          ------------------->  U0R  (GPIO3)
  RX          <-------------------  U0T  (GPIO1)
```

| USB-UART Pin | ESP32-CAM Pin | Notes |
| --- | --- | --- |
| **`5V`** | **`5V`** | Stable 5V / ≥ 500 mA during flashing |
| **`GND`** | **`GND`** | Common ground |
| **`TX`** | **`U0R`** (`GPIO3`) | Crossed TX → RX |
| **`RX`** | **`U0T`** (`GPIO1`) | Crossed RX → TX |
| *(Temp jumper)* | **`IO0` ↔ `GND`** | Connect only to enter flash bootloader; **disconnect and press `RST`** to run |

#### Normal Run Power Wiring

| Power Source | ESP32-CAM Pin | Notes |
| --- | --- | --- |
| Dedicated **`5V`** supply (≥ 1 A) | **`5V`** | Independent USB power or dedicated 5V rail (not S3 `3V3`) |
| Supply **`GND`** | **`GND`** | Tie to breadboard `GND` only if sharing a common 5V PSU |
| `IO0` | *Floating (unconnected)* | Must not be grounded in run mode |

#### Onboard AI-Thinker OV2640 Pin Map (`firmware/esp32cam/main/ai_thinker_pins.h` — Internal Reference Only)

These pins are **already routed on the ESP32-CAM PCB**; do not wire them externally:

| Signal | GPIO | Signal | GPIO | Signal | GPIO |
| --- | --- | --- | --- | --- | --- |
| `PWDN` | `32` | `SIOD (SDA)` | `26` | `VSYNC` | `25` |
| `RESET` | `-1` | `SIOC (SCL)` | `27` | `HREF` | `23` |
| `XCLK` | `0` | `PCLK` | `22` | `FLASH_LED` | `4` |
| `D0 (Y2)` | `5` | `D1 (Y3)` | `18` | `D2 (Y4)` | `19` |
| `D3 (Y5)` | `21` | `D4 (Y6)` | `36` | `D5 (Y7)` | `39` |
| `D6 (Y8)` | `34` | `D7 (Y9)` | `35` | — | — |

---

## 4. Breadboard Assembly Guide (Stationary Board vs. Mobile F-to-M Sensors)

Because the **breadboard stays stationary** while the **GY-521 (MPU6050)** and **VL53L0X** move, organize the breadboard into clear stationary zones and terminate both moving sensors into a dedicated **I²C break-out hub** using **Female-to-Male (F-to-M)** jumper cables.

### 4.1 Top-Down Breadboard Zoning Map

> **Devkit Width Tip:** Many ESP32-S3 N16R8 devkits are wide enough to cover almost all rows of a single standard 830-point breadboard. Snap **two breadboards side-by-side** (remove one power rail between them) so the S3 straddles the seam with 3–4 open tie-points exposed on **both** sides.

```text
==========================================================================
 TOP POWER RAIL (3.3V ONLY):   [+] 3.3V from ESP32-S3 3V3   [-] S3 GND
==========================================================================

  [ ZONE A: ESP32-S3 N16R8 ]      [ ZONE B: STATIONARY AUDIO & PTT ]
  +------------------------+      +--------------+   +---------------+
  | (USB-C facing left     |      |   INMP441    |   |   MAX98357A   |
  |  edge for flashing)    |      | VDD->3.3V    |   | VIN->3.3V*    |
  |                        |      | GND,L/R->GND |   | GND->GND      |
  |  GPIO4  --+            |      | SCK<-GPIO14  |   | BCLK<-GPIO17  |
  |  GPIO40 --+--+         |      | WS <-GPIO15  |   | LRC <-GPIO18  |
  |  GPIO5  --+--+---+     |      | SD ->GPIO16  |   | DIN <-GPIO21  |
  +-----------+--+---+-----+      +--------------+   | (+/-) OPEN**  |
              |  |   |                               +---------------+
              |  |   +---> [ PTT Button ] across center trench -> GND
              |  |
  [ ZONE C: I2C SENSOR HUB ]   (Front edge — easy plug-in for F-to-M leads)
  Row X (SDA Hub): [GPIO4 jumper] [GY-521 SDA male] [VL53L0X SDA male] [ ]
  Row Y (SCL Hub): [GPIO40 jumper][GY-521 SCL male] [VL53L0X SCL male] [ ]
                                         |                 |
                          (Strain-relief anchor at breadboard edge)
                                         |                 |
                        5-wire F-to-M    v                 v  4-wire F-to-M
                        (20-30 cm)  [GY-521 MPU6050]  [VL53L0X Forward]
                                     (Mobile / Free)   (Mobile / Free)

==========================================================================
 ISOLATED BOTTOM RAIL (5V ONLY — NEVER BRIDGE TO TOP 3.3V RAIL!):
   [+] Dedicated 5V (>=1A)    [-] 5V Supply GND
==========================================================================

  [ ZONE D: SEPARATE ESP32-CAM (ESP-32S) — POWER ONLY ]
  +--------------------------------------------------------------------+
  | Seated on an isolated section (or separate mini breadboard)        |
  | OV2640 ribbon stays plugged into ESP32-CAM and faces outward       |
  | 5V  <--- Bottom 5V Rail   |  GND <--- Bottom GND Rail              |
  | IO0 <--- Open in run mode |  ZERO data wires to ESP32-S3!          |
  +--------------------------------------------------------------------+
```

---

### 4.2 Stationary Breadboard Connections (Male-to-Male Jumpers)

Assemble all stationary modules first **with all USB / power cables unplugged**:

1. **Establish the `3.3V` and `GND` Rails (Top Rail Only):**
   - Seat the **ESP32-S3 N16R8** with its USB-C port facing the outer edge of the breadboard so plugging/unplugging USB never flexes neighboring jumpers.
   - Run one short Male-to-Male jumper from ESP32-S3 **`3V3`** to the top **`+` rail**, and one from ESP32-S3 **`GND`** to the top **`-` rail**.
   - Keep this rail strictly `3.3V`. Do **not** connect any `5V` supply to it.

2. **Seat and Wire the Stationary Audio Modules (`INMP441`, `MAX98357A`, PTT Button):**
   - **INMP441 Microphone:** Press its 6-pin header straight into 6 adjacent breadboard columns. Leave the MEMS acoustic port hole unobstructed and place it away from the amplifier/speaker to avoid acoustic feedback.
     - Wire short M-to-M jumpers: `VDD → 3.3V rail`, `GND → GND rail`, `L/R → GND rail`, `SCK → GPIO14`, `WS → GPIO15`, `SD → GPIO16`.
   - **MAX98357A Amplifier:** Press its 7-pin header into 7 adjacent columns on the opposite end of the audio zone.
     - Wire short M-to-M jumpers: `VIN → 3.3V rail` (initial safe lower power), `GND → GND rail`, `BCLK → GPIO17`, `LRC → GPIO18`, `DIN → GPIO21`.
     - Leave `SD` floating (enabled) and leave `GAIN` floating (9 dB) or tied to `GND` via `100 kΩ` (3 dB).
     - **Leave the speaker terminals (`+` / `-`) unconnected** until speaker impedance (Ω) and wattage (W) are confirmed.
   - **Push-to-Talk (PTT) Button:** Straddle a momentary tactile push button across the breadboard center trench. Wire one leg to **`GPIO5`** and the diagonally opposite leg to the **`GND` rail**.

3. **Create the Dedicated I²C Sensor Hub (Zone C):**
   - Pick two adjacent unused rows near the edge of the breadboard where the mobile sensor cables will exit.
   - Run one M-to-M jumper from ESP32-S3 **`GPIO4`** into the **SDA Hub row**, and one from **`GPIO40`** into the **SCL Hub row**.
   - Keeping a dedicated hub row lets you plug/unplug the moving sensors cleanly without stressing the ESP32-S3 header pins.

4. **Place and Power the Separate ESP32-CAM (Zone D — Isolated, or Off-Breadboard):**
   - **Recommended for aiming:** Keep the **ESP32-CAM off the breadboard** on an **ESP32-CAM-MB** USB base (or tethered via short `5V`/`GND` F-to-M jumpers to an isolated `5V` ≥ 1 A supply) so the OV2640 lens can point forward alongside your mobile sensors instead of pointing straight up.
   - **Temporary bench option:** If you seat the ESP32-CAM on an isolated breadboard section during initial flashing, keep the OV2640 ribbon firmly latched and clear of wires, feed **`5V` (≥ 1 A)** and **`GND`** strictly from an isolated `5V` rail (never from the S3 `3V3` pin), confirm **zero** signal wires run to the ESP32-S3, and confirm `IO0` is **not** grounded in run mode.

---

### 4.3 Mobile Sensor Connections (`GY-521 MPU6050` & `VL53L0X` via Female-to-Male Jumpers)

All component headers have male pins, so using **Female-to-Male (F-to-M) ribbon jumper wires** lets both sensors move freely while staying reliably tied to the stationary breadboard:

#### Harness 1 — Mobile `GY-521 (MPU6050)` (5-Wire F-to-M Bundle)
1. Peel off a **5-wire strip** from a Female-to-Male Dupont ribbon (20–30 cm length; keep the wires joined together as a flat ribbon for durability).
2. Press the **5 female sockets** squarely onto the GY-521 male header pins: `VCC`, `GND`, `SCL`, `SDA`, and `AD0` (skip `XDA`, `XCL`, `INT`).
3. Plug the **5 male pins** into the stationary breadboard:
   - `VCC` → **Top `3.3V` rail**
   - `GND` → **Top `GND` rail**
   - `AD0` → **Top `GND` rail** *(locks I²C address to `0x68`)*
   - `SDA` → **SDA Hub row (`GPIO4`)**
   - `SCL` → **SCL Hub row (`GPIO40`)**

#### Harness 2 — Mobile `VL53L0X` Forward ToF (4-Wire F-to-M Bundle)
1. Peel off a **4-wire strip** from a Female-to-Male Dupont ribbon (20–30 cm length).
2. Press the **4 female sockets** squarely onto the VL53L0X male header pins: `VIN` (or `VCC`), `GND`, `SCL`, and `SDA` (leave `XSHUT` and `GPIO1` disconnected on a single breakout with a confirmed onboard pull-up).
3. Plug the **4 male pins** into the stationary breadboard right beside the GY-521 connections:
   - `VIN` → **Top `3.3V` rail**
   - `GND` → **Top `GND` rail**
   - `SDA` → **SDA Hub row (`GPIO4`)**
   - `SCL` → **SCL Hub row (`GPIO40`)**

#### Mechanical & Signal-Integrity Rules for Mobile F-to-M Harnesses
- **Keep cable length ≤ 20–30 cm:** Do not chain multiple jumper cables end-to-end; extra length increases bus capacitance and introduces intermittent connections during movement.
- **Add strain relief at the breadboard edge:** Tape or zip-tie both F-to-M ribbons gently to the edge of the breadboard (or enclosure) with a small service loop so moving the sensors pulls against the anchor instead of pulling male pins out of the breadboard sockets.
- **Check pin tightness on the moving ends:** If any female Dupont housing slides loosely on the GY-521 or VL53L0X header pins, replace that jumper before powering up — intermittent I²C `SDA`/`SCL` contact during motion will cause sensor timeouts (`absent`/`expired` readings).
- **Orientation & optical clearance:** Point the VL53L0X emitter/receiver window straight forward with no tape or wires crossing its field of view, and mount the GY-521 flat against your moving mount while noting its silkscreen `X`/`Y`/`Z` axis arrows.
- **Pre-power check:** Before plugging in USB, verify `3.3V` and `GND` are not shorted, confirm `5V` is isolated from the `3.3V` rail, and gently wiggle both mobile harnesses to verify every male pin stays firmly seated in the breadboard.

---

## 5. Master GPIO-to-Pin Mapping Table & S3 I²C Firmware Settings

### 5.1 Complete GPIO-to-Pin Mapping (All Hardware Components)

All ESP32-S3 GPIO assignments below are validated against reserved N16R8 pins and bus collisions at compile time in `firmware/esp32s3/include/board_profile.h`.

| Hardware Component | Component Pin | Controller Pin / Rail | Bus / Interface | Firmware Kconfig / Macro | Wiring Style | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **GY-521 (MPU6050)** | `VCC` | S3 `3V3` rail | Power (`3.3V`) | `CONFIG_SENTRA_ENABLE_MPU6050=y` | F-to-M (mobile) | 3.3V logic safe |
| **GY-521 (MPU6050)** | `GND` | S3 `GND` rail | Ground | — | F-to-M (mobile) | Common ground |
| **GY-521 (MPU6050)** | `SDA` | **ESP32-S3 `GPIO4`** | Shared I²C (`0x68`) | `CONFIG_SENTRA_PIN_I2C_SDA=4` | F-to-M → SDA Hub | 100 kHz bus |
| **GY-521 (MPU6050)** | `SCL` | **ESP32-S3 `GPIO40`** | Shared I²C (`0x68`) | `CONFIG_SENTRA_PIN_I2C_SCL=40` | F-to-M → SCL Hub | 100 kHz bus |
| **GY-521 (MPU6050)** | `AD0` | S3 `GND` rail | Address strap | `0x68` (AD0 low) | F-to-M (mobile) | Locks address to `0x68` |
| **VL53L0X (Forward ToF)** | `VIN` / `VCC` | S3 `3V3` rail | Power (`3.3V`) | `CONFIG_SENTRA_ENABLE_VL53L0X=y` | F-to-M (mobile) | Single forward sensor only |
| **VL53L0X (Forward ToF)** | `GND` | S3 `GND` rail | Ground | — | F-to-M (mobile) | Common ground |
| **VL53L0X (Forward ToF)** | `SDA` | **ESP32-S3 `GPIO4`** | Shared I²C (`0x29`) | `CONFIG_SENTRA_PIN_I2C_SDA=4` | F-to-M → SDA Hub | Shared with MPU6050 |
| **VL53L0X (Forward ToF)** | `SCL` | **ESP32-S3 `GPIO40`** | Shared I²C (`0x29`) | `CONFIG_SENTRA_PIN_I2C_SCL=40` | F-to-M → SCL Hub | Shared with MPU6050 |
| **VL53L0X (Forward ToF)** | `XSHUT` | *Not connected* | Shutdown | `CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT=-1` | None | Only if breakout has onboard pull-up |
| **INMP441 Mic** | `VDD` | S3 `3V3` rail | Power (`3.3V` only) | `CONFIG_SENTRA_ENABLE_INMP441_MIC=y` | M-to-M (breadboard) | Never apply `5V` |
| **INMP441 Mic** | `GND` | S3 `GND` rail | Ground | — | M-to-M (breadboard) | Common ground |
| **INMP441 Mic** | `L/R` | S3 `GND` rail | Channel select | `I2S_CHANNEL_FMT_ONLY_LEFT` | M-to-M (breadboard) | Selects Left mono slot |
| **INMP441 Mic** | `SCK` | **ESP32-S3 `GPIO14`** | `I2S_NUM_0` RX | `CONFIG_SENTRA_PIN_INMP441_SCK=14` | M-to-M (breadboard) | Bit clock (`BCLK`) |
| **INMP441 Mic** | `WS` | **ESP32-S3 `GPIO15`** | `I2S_NUM_0` RX | `CONFIG_SENTRA_PIN_INMP441_WS=15` | M-to-M (breadboard) | Word select (`LRCLK`) |
| **INMP441 Mic** | `SD` | **ESP32-S3 `GPIO16`** | `I2S_NUM_0` RX | `CONFIG_SENTRA_PIN_INMP441_SD=16` | M-to-M (breadboard) | Serial mic data in |
| **MAX98357A Amp** | `VIN` | S3 `3V3` rail (initial) | Power (`3.3V` start) | `CONFIG_SENTRA_ENABLE_MAX98357A_AMP=y` | M-to-M (breadboard) | Lower initial bench power |
| **MAX98357A Amp** | `GND` | S3 `GND` rail | Ground | — | M-to-M (breadboard) | Common ground |
| **MAX98357A Amp** | `BCLK` | **ESP32-S3 `GPIO17`** | `I2S_NUM_1` TX | `CONFIG_SENTRA_PIN_MAX98357A_BCLK=17` | M-to-M (breadboard) | Bit clock |
| **MAX98357A Amp** | `LRC` | **ESP32-S3 `GPIO18`** | `I2S_NUM_1` TX | `CONFIG_SENTRA_PIN_MAX98357A_LRC=18` | M-to-M (breadboard) | Word clock |
| **MAX98357A Amp** | `DIN` | **ESP32-S3 `GPIO21`** | `I2S_NUM_1` TX | `CONFIG_SENTRA_PIN_MAX98357A_DIN=21` | M-to-M (breadboard) | Serial audio data out |
| **MAX98357A Amp** | `SD` / `GAIN` | Floating (`GAIN`: optional `100 kΩ` to `GND`) | Amp control | — | None / 100 kΩ | Do not ground `SD` |
| **Speaker (Unverified)** | `+` / `-` | MAX98357A `+` / `-` | Bridged Class-D | — | **Disconnected until verified** | Verify Ω & W first; never ground leads |
| **PTT Tactile Button** | Pin A / Pin B | **ESP32-S3 `GPIO5`** / `GND` rail | Active-low GPIO | `CONFIG_SENTRA_PIN_ACTION_BUTTON=5` | M-to-M (breadboard) | Internal pull-up; press triggers 3.5 s capture (`X-Audio-Trigger: ptt`) |
| **Battery Voltage Divider** | Divider midpoint | **ESP32-S3 `GPIO6`** (`ADC1_CH5`) | `ADC1` (Wi-Fi safe) | `CONFIG_SENTRA_PIN_BATTERY_ADC=6` / `SCALE_MILLI=2000` | Breadboard `100 kΩ / 100 kΩ` | **Never exceed `3.3V` at `GPIO6`**; reports `batteryVoltageV` (`null` if unwired) |
| **ESP32-CAM (Run Mode)** | `5V` / `GND` | Dedicated `5V` (≥ 1 A) / `GND` | Wi-Fi HTTP (`esp32`) | `firmware/esp32cam` | Power only (**0 wires to S3**) | Pairs with S3 in backend via `SENTRA_CAMERA_PAIRINGS` |
| **ESP32-CAM (Flash Mode)** | `U0R` / `U0T` / `IO0` | USB-UART `TX` / `RX` / temp `GND` | UART0 Flash | `GPIO3` / `GPIO1` / `GPIO0` | Flash cable only | Remove `IO0 ↔ GND` after flashing & press `RST` |

---

### 5.2 ESP32-S3 I²C (`SDA` / `SCL`) Firmware Settings (`sdkconfig.defaults` & `i2c_bus.c`)

Both the **GY-521 (MPU6050)** and the single forward **VL53L0X** operate on the ESP32-S3's shared I²C master controller using the exact parameters below:

```ini
# firmware/esp32s3/sdkconfig.defaults
CONFIG_SENTRA_ENABLE_VL53L0X=y
CONFIG_SENTRA_VL53L0X_ADDR=0x29
CONFIG_SENTRA_ENABLE_MPU6050=y
CONFIG_SENTRA_PIN_I2C_SDA=4
CONFIG_SENTRA_PIN_I2C_SCL=40
CONFIG_SENTRA_I2C_FREQ_HZ=100000
CONFIG_SENTRA_PIN_VL53L0X_FWD_XSHUT=-1
```

| I²C Parameter | Configured Value | Firmware Source | Purpose / Constraint |
| --- | --- | --- | --- |
| **SDA GPIO** | **`GPIO4`** | `CONFIG_SENTRA_PIN_I2C_SDA` | Conflict-free with N16R8 Flash/PSRAM, USB, UART0, and discrete I²S |
| **SCL GPIO** | **`GPIO40`** | `CONFIG_SENTRA_PIN_I2C_SCL` | Conflict-free with N16R8 Flash/PSRAM, USB, UART0, and discrete I²S |
| **Bus Speed** | **`100000` Hz (100 kHz)** | `CONFIG_SENTRA_I2C_FREQ_HZ` | Standard-mode clock chosen for clean signal integrity over 20–30 cm F-to-M jumpers |
| **Internal Pull-Ups** | **`GPIO_PULLUP_ENABLE`** on `SDA` & `SCL` | `firmware/esp32s3/src/i2c_bus.c` | Enabled in driver alongside breakout board pull-up resistors |
| **VL53L0X Address** | **`0x29`** | `CONFIG_SENTRA_VL53L0X_ADDR` / `BOARD_ADDR_VL53L0X_FWD` | Single forward ToF sensor; `XSHUT = -1` assumes onboard pull-up |
| **MPU6050 Address** | **`0x68`** | `AD0` tied to `GND` (`i2c_bus.c` boot scan) | If `AD0` floats or is tied high, MPU6050 shifts to `0x69` and will not match |
| **Boot I²C Scan** | Scans `0x08–0x77` at startup | `i2c_bus.c` | Logs `VL53L0X@0x29=FOUND/MISSING` and `MPU6050@0x68=FOUND/MISSING` before telemetry starts |

> **Fail-Closed Sensor Rule:** Absent, invalid, or expired VL53L0X/MPU6050 readings are never promoted as live or clear-path evidence. If either address is missing on the boot I²C scan, inspect the F-to-M jumpers (`SDA=GPIO4`, `SCL=GPIO40`, `AD0=GND`, and VL53L0X `XSHUT` pull-up) before continuing.

---

### 5.3 Reserved ESP32-S3 N16R8 Pins — DO NOT USE

Enforced by `SENTRA_PIN_IS_N16R8_RESERVED(p)` in `firmware/esp32s3/include/board_profile.h`:

- **`GPIO 0, 3, 45, 46`** — Boot / JTAG / `VDD_SPI` strapping pins
- **`GPIO 19, 20`** — Native USB OTG `D-` / `D+`
- **`GPIO 26–32`** — Internal Quad SPI Flash
- **`GPIO 33–37`** — Internal 8 MB Octal SPI PSRAM (N16R8)
- **`GPIO 43, 44`** — `UART0` TX/RX serial monitor
- **Also avoid `GPIO 38 / 48`:** Connected to the onboard RGB LED on many ESP32-S3-DevKitC-1 clones.

---

## 6. Firmware Build Profiles & Backend Pairing Compatibility

| Stage | Firmware Project | Build Overlay (`SDKCONFIG_DEFAULTS`) | Active Hardware |
| --- | --- | --- | --- |
| **Stage 1: S3 Sensors** | `firmware/esp32s3` | `sdkconfig.defaults` | I²C `GPIO4/40`, `MPU6050 (0x68)`, `VL53L0X (0x29, XSHUT=-1)`; audio & S3 camera OFF |
| **Stage 2: ESP32-CAM** | `firmware/esp32cam` | `sdkconfig.defaults` | AI-Thinker candidate JPEG capture + local serial test + Wi-Fi upload (`X-Boot-Session`) |
| **Stage 3: Mic Bench** | `firmware/esp32s3` | `sdkconfig.defaults;sdkconfig.defaults.audio_bench` | Stage 1 sensors + `INMP441` (`GPIO14/15/16`) + PTT (`GPIO5`); speaker OFF |
| **Stage 4: Full Wearable** | `firmware/esp32s3` | `sdkconfig.defaults;sdkconfig.defaults.wearable_full` | Stage 1 sensors + `INMP441` + `MAX98357A` (`GPIO17/18/21`) + PTT (`GPIO5`) → `gemini-3.8-live` |

### Backend Pairing Configuration (`.env`, Never Commit Secrets)

Register **separate** device IDs and tokens for the ESP32-S3 and ESP32-CAM, then pair them on the backend:

```bash
SENTRA_CAMERA_PAIRINGS="ESP32-S3-SENTRA-001=ESP32-CAM-SENTRA-001"
SENTRA_LIVE_MODEL="gemini-3.8-live"
```

---

## 7. Safe 4-Stage Bring-Up Checklist

1. **Stage 1 — S3 + Tethered I²C Sensors Only:** Wire only `3.3V`, `GND`, `GY-521`, and `VL53L0X`. Flash `firmware/esp32s3` with `sdkconfig.defaults`. Confirm boot I²C scan detects **`0x29`** and **`0x68`**, then verify stationary `[BENCH]` distance (measured with a ruler) and IMU tilt changes.
2. **Stage 2 — Separate ESP32-CAM:** Flash `firmware/esp32cam` separately. Run the local serial JPEG capture test first, then verify authenticated frame uploads to `POST /api/device/frame` and backend pairing via `SENTRA_CAMERA_PAIRINGS`.
3. **Stage 3 — Add INMP441 Mic + PTT (Speaker Still Disconnected):** Wire `INMP441` (`GPIO14/15/16`, `L/R=GND`, `VDD=3.3V`) and PTT (`GPIO5 ↔ GND`). Build/flash with `sdkconfig.defaults;sdkconfig.defaults.audio_bench` and confirm non-zero mic RMS levels in serial logs.
4. **Stage 4 — Add MAX98357A + Verified Speaker:** Confirm speaker impedance (4 Ω or 8 Ω) and wattage rating, wire `MAX98357A` (`GPIO17/18/21`, `VIN=3.3V`) and speaker `+`/`-`. Build/flash with `sdkconfig.defaults;sdkconfig.defaults.wearable_full`, press PTT to start a 3.5 s recording, speak your question, and verify the **`gemini-3.8-live`** voice reply plays through the speaker.

---

## 8. Firmware Flashing Procedures, ESP-IDF v5.3 Environment & Power-On Sequence

> **Reminder:** Never commit generated `sdkconfig` files, Wi-Fi passwords, or provisioned `X-Device-Token` secrets to Git (they are excluded by `.gitignore`). Flash and verify each board on its own target — **`esp32s3`** for the main controller and **`esp32`** for the separate ESP32-CAM.

### 8.1 Required ESP-IDF v5.3 Environment Configuration

Both firmware projects target **ESP-IDF `release/v5.3`** (matching `.github/workflows/verify.yml`):

1. **Install & Export ESP-IDF v5.3** in every new terminal session before running `idf.py`:
   ```bash
   # Linux / macOS
   source "$HOME/esp/esp-idf/export.sh"

   # Windows (ESP-IDF 5.3 PowerShell or CMD)
   # $HOME\esp\esp-idf\export.ps1

   # Confirm version (must report v5.3.x)
   idf.py --version
   ```
2. **USB Serial Drivers & Permissions:**
   - Ensure CP210x / CH340 drivers (for USB-UART adapters or ESP32-CAM-MB) and native USB-Serial/JTAG support (for ESP32-S3) are available.
   - On Linux, verify your user is in the `dialout` (or `uucp`) group so `/dev/ttyACM*` and `/dev/ttyUSB*` are writable.
3. **Target-Specific `sdkconfig.defaults` Requirements (Pre-Configured in Repo):**

| Parameter | ESP32-S3 (`firmware/esp32s3/sdkconfig.defaults`) | ESP32-CAM (`firmware/esp32cam/sdkconfig.defaults`) |
| --- | --- | --- |
| **IDF Target** | `CONFIG_IDF_TARGET="esp32s3"` | `CONFIG_IDF_TARGET="esp32"` |
| **Flash Size** | `CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y` (N16R8) | `CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y` |
| **PSRAM Mode** | `CONFIG_SPIRAM=y`, `CONFIG_SPIRAM_MODE_OCT=y`, `CONFIG_SPIRAM_SPEED_80M=y` | `CONFIG_SPIRAM=y`, `CONFIG_SPIRAM_USE_MALLOC=y`, `CONFIG_SPIRAM_IGNORE_NOTFOUND=y` |
| **TLS Root CAs** | `CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y` | `CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y` |
| **Default Device ID** | `ESP32-S3-SENTRA-001` | `ESP32-CAM-SENTRA-001` *(must remain distinct from S3)* |
| **Disabled Legacy / Defaults** | `CAMERA=n`, `WM8960=n`, `AUDIO_I2S_DISCRETE=n`, `VL53L5CX=n` | `ENABLE_FLASH_LED=n` (avoids glare & power brownouts) |

4. **Pre-Register Both Boards on the Backend Before Flashing Wi-Fi Credentials:**
   Register `ESP32-S3-SENTRA-001` and `ESP32-CAM-SENTRA-001` separately via `POST /api/device/register` (using `X-Operator-Token`) to obtain two **independent** `provisionedToken` values, and set `SENTRA_CAMERA_PAIRINGS="ESP32-S3-SENTRA-001=ESP32-CAM-SENTRA-001"` in `.env`.

---

### 8.2 Flashing Procedure — ESP32-S3 N16R8 (`firmware/esp32s3`)

#### A. Stage 1 — Sensor Bench Firmware (Default Profile)

```bash
cd firmware/esp32s3
rm -f sdkconfig
idf.py set-target esp32s3
idf.py menuconfig
```

In **`SENTRA firmware configuration`**, configure:
- `SENTRA_WIFI_SSID` and `SENTRA_WIFI_PASSWORD` *(leave blank only if doing an offline serial I²C/[BENCH] test first)*
- `SENTRA_BACKEND_URL` (e.g., `http://<LAN_IP>:3000` or your `https://` backend origin)
- `SENTRA_DEVICE_ID` (`ESP32-S3-SENTRA-001`)
- `SENTRA_DEVICE_TOKEN` *(the S3's own provisioned token)*
- Confirm under **Step 1: S3 Bench Sensors**: `SDA=4`, `SCL=40`, `I2C_FREQ_HZ=100000`, `VL53L0X_ADDR=0x29`, `VL53L0X_FWD_XSHUT=-1`.

Build, flash, and monitor:

```bash
idf.py build
idf.py -p <S3_SERIAL_PORT> flash monitor
```

*(If auto-reset into download mode fails, hold `BOOT`, tap `RST`, release `BOOT`, and re-run `idf.py -p <S3_SERIAL_PORT> flash`.)*

Verify in serial logs:
- 8 MB Octal PSRAM initializes without error.
- Boot I²C scan reports **`0x29` (VL53L0X)** and **`0x68` (MPU6050)**.
- `[BENCH]` readouts report valid distances (and `UNAVAILABLE` / `null` when out of range) plus `calibrated: true` for IMU with `heading: null`.
- Once Wi-Fi and token are configured, telemetry uploads return HTTP `200` on `POST /api/device/telemetry`.

#### B. Stage 3 & Stage 4 — Audio Overlays (Only After Stage 1 Passes)

- **Stage 3 (INMP441 Mic Bench Only — Speaker Still Disconnected):**
  ```bash
  cd firmware/esp32s3
  rm -f sdkconfig
  idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.audio_bench" set-target esp32s3
  idf.py menuconfig   # Re-enter Wi-Fi/backend/token; optionally enable SENTRA_AUDIO_BENCH_TEST_MIC
  idf.py build
  idf.py -p <S3_SERIAL_PORT> flash monitor
  ```
- **Stage 4 (Full Wearable — ONLY After Speaker Impedance Ω & Wattage W Are Confirmed):**
  ```bash
  cd firmware/esp32s3
  rm -f sdkconfig
  idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.wearable_full" set-target esp32s3
  idf.py menuconfig   # Re-enter Wi-Fi/backend/token; confirm MAX98357A pins 17/18/21
  idf.py build
  idf.py -p <S3_SERIAL_PORT> flash monitor
  ```

---

### 8.3 Flashing Procedure — Separate ESP32-CAM (`firmware/esp32cam`)

> **Target Warning:** `firmware/esp32cam` targets the original **`esp32`** chip — **do not** run `set-target esp32s3`.

#### Pass 1 — Local Serial JPEG Verification (No Wi-Fi / No Token First)

1. Connect the ESP32-CAM via an **ESP32-CAM-MB** USB base, or wire a 3.3V USB-UART adapter (`5V`, `GND`, `TX → U0R`, `RX → U0T`) and connect the temporary **`IO0 ↔ GND`** jumper, then tap **`RST`**.
2. Build and flash with default (blank) Wi-Fi/token settings:
   ```bash
   cd firmware/esp32cam
   rm -f sdkconfig
   idf.py set-target esp32
   idf.py build
   idf.py -p <CAM_SERIAL_PORT> flash
   ```
3. **Remove the `IO0 ↔ GND` jumper** (skip if using ESP32-CAM-MB auto-reset), press **`RST`**, and open the serial monitor:
   ```bash
   idf.py -p <CAM_SERIAL_PORT> monitor
   ```
4. Confirm OV2640 initializes on the AI-Thinker first-candidate profile and logs `[LOCAL_JPEG_TEST]` frames with `valid_soi_eoi=YES` (`FF D8 ... FF D9`) and no brownout resets.

#### Pass 2 — Authenticated Wi-Fi JPEG Upload

1. Open menuconfig and navigate to **`SENTRA ESP32-CAM Sender Configuration`**:
   ```bash
   idf.py menuconfig
   ```
   Configure:
   - `SENTRA_CAM_WIFI_SSID` and `SENTRA_CAM_WIFI_PASSWORD`
   - `SENTRA_CAM_BACKEND_URL` (same backend origin as the S3)
   - `SENTRA_CAM_DEVICE_ID` (`ESP32-CAM-SENTRA-001` — distinct from S3)
   - `SENTRA_CAM_DEVICE_TOKEN` *(the ESP32-CAM's own provisioned token — never reuse the S3 token)*
   - Keep `SENTRA_CAM_FRAMESIZE_QVGA` (`320x240`) and `SENTRA_CAM_ENABLE_FLASH_LED=n` for initial bench bring-up.
2. Reconnect `IO0 ↔ GND` (if using USB-UART), tap `RST`, and flash:
   ```bash
   idf.py build
   idf.py -p <CAM_SERIAL_PORT> flash
   ```
3. Remove `IO0 ↔ GND`, press `RST`, and confirm in `idf.py -p <CAM_SERIAL_PORT> monitor` that the board obtains a Wi-Fi IP, logs a fresh `boot_session=cam-...`, and receives HTTP `200` on `POST /api/device/frame?deviceId=ESP32-CAM-SENTRA-001`.

---

### 8.4 Exact Post-Wiring Power-On Sequence

After completing all physical wiring and flashing both boards, **always power on the system in this exact order**:

1. **Step 0 — Pre-Power Dead-Circuit Check (All Power Disconnected):**
   - Visually verify (or continuity-check with a multimeter) that the breadboard **`3.3V` rail and `GND` rail are not shorted**.
   - Verify the **ESP32-CAM `5V` supply is completely isolated** from the breadboard `3.3V` rail and that **zero data wires** link the ESP32-CAM to the ESP32-S3.
   - Verify **`INMP441 VDD` is on `3.3V` only** (never `5V`) and **`L/R` is tied to `GND`**.
   - Verify **ESP32-CAM `IO0` is open/ungrounded** (run mode).
   - Verify the **speaker remains disconnected** from `MAX98357A + / -` unless its impedance (Ω) and wattage (W) have already been confirmed for Stage 4.
   - Verify both mobile F-to-M sensor harnesses (`GY-521` and `VL53L0X`) are firmly seated, strain-relieved, and resting flat/stationary for boot calibration.

2. **Step 1 — Start the SENTRA Backend Server First:**
   - Ensure `.env` includes `SENTRA_CAMERA_PAIRINGS="ESP32-S3-SENTRA-001=ESP32-CAM-SENTRA-001"`, both device IDs are registered, and the backend is running.
   - Verify readiness before energizing either board:
     ```bash
     curl -s http://localhost:3000/api/health
     ```
     Confirm `databaseAvailable: true` and `"ESP32-S3-SENTRA-001": "ESP32-CAM-SENTRA-001"` in `cameraPairings`.

3. **Step 2 — Power On Board 1: ESP32-S3 N16R8 (+ Breadboard `3.3V` Rail & Mobile Sensors):**
   - Plug USB-C power into the **ESP32-S3 N16R8**. This energizes the `3.3V` rail, `GY-521 (MPU6050)`, `VL53L0X`, and stationary S3 audio modules simultaneously.
   - **Keep the `GY-521 (MPU6050)` completely still for ~2 seconds** immediately after power-on so gyroscope bias calibration completes cleanly (`calibrated: true`).
   - Wait for confirmation that the S3 sensor controller is healthy and streaming before powering the camera:
     - Boot I²C scan detects `0x29` and `0x68` (if monitoring over USB).
     - `GET /api/device/status?deviceId=ESP32-S3-SENTRA-001` reports `connected: true` with live `forwardDistanceCm` and IMU telemetry.

4. **Step 3 — Power On Board 2: Separate ESP32-CAM (Dedicated `5V`, ≥ 1 A Supply):**
   - Connect the dedicated **`5V` (≥ 1 A)** power source to the **ESP32-CAM** (via its ESP32-CAM-MB USB cable or isolated `5V`/`GND` supply — never from the S3 `3V3` pin).
   - Allow 3–5 seconds for OV2640 init, Wi-Fi join, and initial `X-Boot-Session` JPEG upload.
   - Verify independent health and backend pairing:
     - `GET /api/device/status?deviceId=ESP32-CAM-SENTRA-001` reports `connected: true` and `frameAvailable: true`.
     - `GET /api/device/frame/status?deviceId=ESP32-S3-SENTRA-001` reports `frameAvailable: true`, `stale: false`, and `connectionStatus: "hardware"`.
     - `GET /api/device/frame/latest?deviceId=ESP32-S3-SENTRA-001` returns HTTP `200` (`image/jpeg`) with headers `X-Device-Id: ESP32-S3-SENTRA-001` and `X-Camera-Device-Id: ESP32-CAM-SENTRA-001`.

5. **Step 4 — Open the SENTRA Companion Web App:**
   - Open the web app and select `ESP32-S3-SENTRA-001` to view combined S3 sensor telemetry and paired ESP32-CAM frames (and test PTT voice turns once Stage 3/4 audio is enabled).

#### Safe Power-Down Order (Reverse)
1. Disconnect **ESP32-CAM `5V` power** first.
2. Disconnect **ESP32-S3 USB-C power** second.
3. Only modify breadboard jumpers, mobile F-to-M sensor leads, or speaker connections once **both** boards are completely unpowered.

