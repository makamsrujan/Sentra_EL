# Build, configure and flash

Requires ESP-IDF v5.3 and a USB data cable suitable for the actual board.

```sh
cd firmware/esp32s3
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py -p YOUR_ACTUAL_SERIAL_PORT flash monitor
```

Menuconfig values are local. Never commit `sdkconfig`. Configure server and
device ID to match the existing backend. Register the device with an operator
and save the returned one-time token securely.

Test without camera enabled first; the GPIO map is not verified.
A build does not guarantee the camera or codec is connected. Treat repeated
reset loops and power faults as stop conditions and inspect the actual board.
