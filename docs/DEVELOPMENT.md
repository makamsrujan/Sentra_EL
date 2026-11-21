# SENTRA development workspace

## Repository layout

- Repository root: React/TypeScript PWA and Express backend. Keep `package.json`, `server.ts`, and existing application configuration at the root; moving them requires a separate tested migration.
- `firmware/esp32s3/`: independent ESP-IDF project for the ESP32-S3 N16R8 main controller.
- `firmware/esp32cam/`: independent ESP-IDF project for the ESP32-CAM OV2640 controller.
- `docs/`: architecture, hardware-integration notes, and setup instructions.

## Open in VS Code on macOS

1. Clone the repository, or pull the latest changes after the workspace PR is merged.
2. Open `sentra.code-workspace` using **File → Open Workspace from File**.
3. Install the recommended extensions, particularly **ESP-IDF** by Espressif.
4. Configure the ESP-IDF extension using your existing ESP-IDF v5.3.6 installation. Verify the actual IDF and Python paths on your Mac rather than assuming a default path.
5. For firmware build/flash commands, open the specific firmware folder in its own VS Code window (`firmware/esp32s3` first), set the target to `esp32s3`, and open an **ESP-IDF Terminal**. Do not run `idf.py` from a regular terminal without exporting the ESP-IDF environment.
6. Connect the ESP32-S3 using a data-capable USB cable, select the correct serial port, build, and only then flash. ESP32-CAM has a separate target and flashing process; do not select `esp32s3` for it.

## App commands

From the repository root, with a compatible Node.js version installed:

```bash
npm install
npm run lint
npm test
npm run build
npm run dev
```

These commands are documented workflows, not a claim that the current source passes all checks. Keep API keys in local environment files, never commit credentials.

## Safe Git workflow

Create a feature branch for each change, review `git status` before commits, and open a pull request against `main`. Do not delete CI workflows to suppress notifications; investigate or disable unwanted notifications in GitHub settings. Firmware build outputs, local `sdkconfig`, dependency installations, and secrets should remain untracked.

## Current hardware boundaries

The wearable is a prototype. The ESP32-S3 and ESP32-CAM are independent controllers, and the camera stream, Wi-Fi transport, microphone, amplifier, ToF and IMU functions require separate end-to-end verification on the actual boards. Do not describe unverified navigation as safety-critical obstacle detection.
