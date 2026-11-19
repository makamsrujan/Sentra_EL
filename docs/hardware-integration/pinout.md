# Provisional pinout — DO NOT WIRE SOLELY FROM THIS PAGE

The proposed GPIO numbers in `firmware/esp32s3/include/board_profile.h`
are only a planning matrix. They are **not** a verified electrical wiring diagram.
The ESP32-S3-N16R8 module, DevKitC header layout and each breakout revision must
be checked against manufacturer schematics and actual accessible headers.

Signal groups to verify:

| Subsystem | Required signals | High-risk check |
|---|---|---|
| OV2640 | D0–D7, XCLK, PCLK, HREF, VSYNC, SCCB, PWDN | Camera breakout pin mapping; short/tested cable |
| WM8960 | I²C control, I²S BCLK/WS/DIN/DOUT/MCLK, 3.3V/GND | Exact standalone Audio Board header and clocks |
| 2 × VL53L0X | SDA/SCL, separate XSHUT | Address collision at default 0x29 |
| MPU6050 | SDA/SCL | Shared bus voltage, AD0 address |
| INA219 (optional) | SDA/SCL, sense terminals | Power measurement only; not power bank state of charge |
| Headset | Four-contact 3.5mm TRRS | CTIA/OMTP pin order, microphone bias, safe volume |

Do not use ESP32-S3 flash/PSRAM-reserved pins, native USB pins, or
strapping pins without a verified reason. Confirm power and logic voltages
from the exact module documentation before connecting anything.
