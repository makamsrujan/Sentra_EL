# Step 4 — Discrete S3 Audio Bench Tests (INMP441 + MAX98357A, Disabled by Default)

> **Status:** Separate, disabled-by-default firmware profile. **Compiled in host C tests only — NOT physically bench-tested.** Phone/browser audio remains the primary working fallback. Do **not** assume embedded audio works because it compiles.

> **Speaker Safety Warning:** Keep the small speaker **physically disconnected** and keep `CONFIG_SENTRA_ENABLE_MAX98357A=n` until the speaker impedance (e.g., 4 Ω / 8 Ω) and continuous wattage rating are confirmed. Driving an undersized or wrong-impedance speaker from a Class-D amplifier can overheat or damage the speaker or power rail.

## Conflict-Free Pin Assignments (Zero WM8960 Dependency)

Checked at compile time in `firmware/esp32s3/include/board_profile.h` against Step 1 sensors (`GPIO4, GPIO40`), native USB (`19, 20`), UART0 (`43, 44`), Flash/Octal PSRAM (`26..37`), strapping (`0, 3, 45, 46`), and DevKitC-1 RGB LED (`38, 48`):

- **INMP441 Mic (`I2S_NUM_0` RX):** `SCK = GPIO14`, `WS = GPIO15`, `SD = GPIO16`, `L/R = GND`, `VDD = 3.3V`, `GND = GND`.
- **MAX98357A Amp (`I2S_NUM_1` TX mono):** `BCLK = GPIO17`, `LRC = GPIO18`, `DIN = GPIO21`, `VIN = 3.3V/5V`, `GND = GND` (no MCLK, no I²C, no WM8960).

## Bench Test A — INMP441 Microphone Capture Only (Speaker Disconnected)

1. Wire **only** the INMP441 (leave MAX98357A and speaker unwired).
2. Build with the audio bench overlay (`sdkconfig.defaults.audio_bench` enables `INMP441` while keeping `MAX98357A=n`):
   ```sh
   cd firmware/esp32s3
   rm -f sdkconfig
   idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.audio_bench" set-target esp32s3
   idf.py menuconfig   # Enable SENTRA Audio -> Run INMP441 mic RMS bench test at boot
   idf.py build
   idf.py -p YOUR_S3_SERIAL_PORT flash monitor
   ```
3. Observe serial output:
   - Confirm `INMP441` initializes cleanly while `WM8960` remains disabled.
   - Verify RMS amplitude stays low in a quiet room and rises cleanly without constant clipping (`32767`) when speaking ~20 cm away.
   - Confirm Step 1 I²C sensors (`VL53L0X` + `MPU6050`) continue running without stalls or I²C errors.

## Bench Test B — MAX98357A Mono Playback Only (After Speaker Rating Is Confirmed)

1. **Prerequisite:** Measure/confirm speaker DC resistance / rated impedance and wattage (compatible with MAX98357A output at your chosen `VIN` voltage and GAIN pin setting; using `3.3 V` supply limits peak output power conservatively during initial bring-up).
2. Enable `CONFIG_SENTRA_ENABLE_MAX98357A=y` and `CONFIG_SENTRA_AUDIO_BENCH_TEST_TONE=y` in `idf.py menuconfig`.
3. Flash and monitor serial logs:
   - Confirm a brief, low-amplitude (`<= 4000 / 32767`) 440 Hz test tone plays cleanly without distortion, speaker heating, or ESP32-S3 brownout resets.
   - Disable `CONFIG_SENTRA_AUDIO_BENCH_TEST_TONE` after verifying playback.
4. Keep browser/phone audio as the default operator path until both mic capture and speaker playback pass supervised bench checks.

## Full Integrated Wearable Overlay (After Speaker Rating & Bench Tests A + B Pass)

Once speaker impedance and wattage are confirmed and both standalone INMP441 and MAX98357A bench tests pass, build the full wearable S3 firmware (Step 1 sensors + INMP441 mic + MAX98357A mono speaker, zero WM8960):

```sh
cd firmware/esp32s3
rm -f sdkconfig
idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.wearable_full" set-target esp32s3
idf.py menuconfig   # Configure Wi-Fi, backend URL, S3 deviceId, and S3 X-Device-Token
idf.py build
idf.py -p YOUR_S3_SERIAL_PORT flash monitor
```

Pressing the GPIO 5 PTT button records from INMP441, sends `X-Audio-Trigger: ptt` + per-boot `X-Boot-Session` to `POST /api/device/audio/utterance`, downloads the generated WAV from `GET /api/device/audio/reply/:replyId`, and plays it strictly through MAX98357A + speaker.
