# SENTRA intended architecture

```mermaid
flowchart TD
  H["Headband: camera + 2 ToF + MPU6050"] --> E["ESP32-S3 N16R8 in bag"]
  MIC["Single-ear TRRS headset mic"] --> CODEC["WM8960 codec"]
  CODEC <--> E
  E -->|"Authenticated JSON + JPEG + WAV"| B["Existing Express server"]
  B --> G["Gemini cloud inference (optional)"]
  B --> DB[("SQLite event/memory store")]
  B --> UI["React/PWA companion"]
  B -->|"Speech audio / action IDs"| E
  E --> A["Local alerts (future verified ToF firmware)"]
```

**Current source status:** Wi-Fi, camera, backend, and audio source exist, but
some hardware acquisition paths remain incomplete. Browser speech is foreground
only. The system is not validated for independent walking.
