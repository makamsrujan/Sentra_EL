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
| **Push-to-Talk (PTT) Button** | Momentary tactile push button (optional in Stage 1, used in Stage 3–4) | Hold to record from INMP441, release to send `X-Audio-Trigger: ptt` | Stationary breadboard | `GPIO5` ↔ `GND` (active-low internal pull-up) |

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
| **`L/R`** | Breadboard **`GND` rail** | Mono Left channel (`I2S_STD_SLOT_LEFT`) | Must be tied to `GND` (not left floating) |
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
| **Pin A** | ESP32-S3 **`GPIO5`** | `BOARD_PIN_PTT_BUTTON` (`5`) | Hold to capture INMP441 WAV; release uploads with `X-Audio-Trigger: ptt` + `X-Boot-Session` to backend **`gemini-3.8-live`** bridge |
| **Pin B** | Breadboard **`GND` rail** | — | Active-low closure |

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

4. **Place and Power the Stationary ESP32-CAM (Zone D — Isolated):**
   - Seat the **ESP32-CAM** on an isolated section (or its own mini breadboard) with the OV2640 ribbon kept firmly latched in its onboard connector and angled clear of wires.
   - Feed **`5V` (≥ 1 A)** and **`GND`** strictly from an isolated `5V` rail or separate USB power supply (never from the S3 `3V3` pin).
   - Confirm **zero** signal wires run between the ESP32-CAM and ESP32-S3, and confirm `IO0` is **not** grounded during normal operation.
   - *(Tip: If you flash the ESP32-CAM with an ESP32-CAM-MB USB base, simply lift the ESP32-CAM off the breadboard, flash it on the MB base, then re-seat it into the `5V`/`GND` breadboard socket for run mode.)*

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

## 5. ESP32-S3 N16R8 Complete GPIO Allocation & Reserved Pins

### Used GPIOs (Verified Conflict-Free by Compile-Time `#error` Guards)

| ESP32-S3 GPIO | Peripheral | Signal | Notes |
| --- | --- | --- | --- |
| **`GPIO4`** | GY-521 + VL53L0X | I²C `SDA` | Shared 100 kHz bus |
| **`GPIO5`** | PTT Button | `PTT` (active-low) | Internal pull-up |
| **`GPIO14`** | INMP441 | `I2S_NUM_0` `SCK` | Mic bit clock |
| **`GPIO15`** | INMP441 | `I2S_NUM_0` `WS` | Mic word select |
| **`GPIO16`** | INMP441 | `I2S_NUM_0` `SD` | Mic data in |
| **`GPIO17`** | MAX98357A | `I2S_NUM_1` `BCLK` | Amp bit clock |
| **`GPIO18`** | MAX98357A | `I2S_NUM_1` `LRC` | Amp word clock |
| **`GPIO21`** | MAX98357A | `I2S_NUM_1` `DIN` | Amp data out |
| **`GPIO40`** | GY-521 + VL53L0X | I²C `SCL` | Shared 100 kHz bus |

### Reserved ESP32-S3 N16R8 Pins — DO NOT USE

Enforced by `SENTRA_PIN_IS_N16R8_RESERVED(p)` in `firmware/esp32s3/include/board_profile.h`:

- **`GPIO 0, 3, 45, 46`** — Boot / JTAG / `VDD_SPI` strapping pins
- **`GPIO 19, 20`** — Native USB OTG `D-` / `D+`
- **`GPIO 26–32`** — Internal Quad SPI Flash
- **`GPIO 33–37`** — Internal 8 MB Octal SPI PSRAM (N16R8)
- **`GPIO 43, 44`** — `UART0` TX/RX serial monitor

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
4. **Stage 4 — Add MAX98357A + Verified Speaker:** Confirm speaker impedance (4 Ω or 8 Ω) and wattage rating, wire `MAX98357A` (`GPIO17/18/21`, `VIN=3.3V`) and speaker `+`/`-`. Build/flash with `sdkconfig.defaults;sdkconfig.defaults.wearable_full`, hold PTT to speak, release, and verify the **`gemini-3.8-live`** voice reply plays through the speaker.
