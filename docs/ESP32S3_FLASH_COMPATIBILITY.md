# SENTRA V1 - ESP32-S3 Flash Compatibility

## Hardware
- ESP32-S3 N16R8
- 16 MB Flash
- 8 MB Octal PSRAM
- Observed flash JEDEC ID: 0x207018
- ESP-IDF version: v5.3.6

## Tested configuration
- Flash mode: DIO
- Flash frequency: 40 MHz
- XMC flash support: enabled
- PSRAM frequency: 80 MHz

## Observed boot issue
The ESP-IDF bootloader rejected the detected XMC
flash chip during initialization.

## Experimental workaround
The local ESP-IDF installation was modified in:

components/bootloader_support/bootloader_flash/src/bootloader_flash.c

The is_xmc_chip_strict() function was modified to
accept the observed family 0x70 and capacity 0x18,
while retaining the XMC manufacturer check.

## Validation status
- ESP32-S3 boot: passed
- PSRAM memory test: passed
- INMP441 basic audio capture: passed
- MPU motion sensing: passed in experimental mode
- VL53L0X distance sensing: pending

## Important limitations
This workaround is board-specific and experimental.
It is not a production-validated flash driver fix.

The local ESP-IDF modification is not automatically
included when cloning this repository.

Do not apply the workaround to other boards without
verifying their flash identification and compatibility.
