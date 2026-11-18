# SENTRA (Sentra_EL)

> **Spatially Intelligent, Voice-First Assistive Wearable & Companion Application**

SENTRA is a Phase-2 assistive prototype built to pair an ESP32-S3 wearable headband/sensor unit with a voice-first companion web application. The wearable handles local distance/drop-off sensing and immediate proximity alerts, while the companion web app provides live camera or wearable frame viewing, optional Google Gemini visual analysis, device telemetry monitoring, SQLite-backed event history, contextual memory, and diagnostics.

---

## Architecture Overview

| Layer | Implementation | Responsibility |
|---|---|---|
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS v4, D3 | Voice/text controls, live `MediaDevices` camera stream, ESP32-S3 JPEG preview, `object-fit: cover` bounding-box overlays, D3 polar bearing plot, analytics charts, and diagnostics |
| **Backend Server** | Express.js (`server.ts`, Node.js 22) | Hardware telemetry gateway, authenticated JPEG frame store, SSE stream (`/api/device/stream`), SQLite persistence (`node:sqlite` WAL mode), and Gemini proxy |
| **AI Service** | `@google/genai` (`server/geminiService.ts`) | Server-side multimodal vision-language analysis (`SENTRA_GEMINI_MODEL`, default `gemini-4-hydrogen` with `gemini-3.1-flash-lite` fallback) and strict JSON schema output |
| **Database** | SQLite (`node:sqlite` `DatabaseSync`) | Persistent storage for registered devices, sensor events, alert events, connection transitions, saved memories, and AI analysis logs |
| **Offline Heuristics** | `src/utils/localVision.ts` | Local canvas luminance, light-direction, center color tone, and high-contrast edge heuristics when Gemini API is unreachable or unconfigured |

---

## Honest Capability Matrix

### Implemented & Verified
- **Browser Camera Subsystem (`src/hooks/useCamera.ts`, `src/components/CameraView.tsx`):** Race-safe session tokens, pre-stream `loadedmetadata` attachment, constraint fallback chain avoiding stale device ID failures, explicit iframe Permissions Policy vs browser permission-denial error classification, rear/front camera switching, device enumeration, torch toggle, and clean track release on stop/switch/unmount.
- **Foreground "Hey SENTRA" Voice Assistant (`src/hooks/useVoiceAssistant.ts`):** Controlled single-session Web Speech API listener supporting opt-in foreground `"Hey SENTRA"` wake detection, inline command extraction, automatic TTS pause to prevent self-triggering, `"Stop"` / `"Cancel"` / `"Be quiet"` interruption, **Hold to Talk**, **Tap to Ask**, **Spacebar** shortcut, and typed fallback.
- **Mobile-First PWA (`vite-plugin-pwa`):** Installable standalone manifest, safe-area inset layout, persistent bottom mobile navigation, and static-only Workbox asset caching (`navigateFallbackDenylist: [/^\/api\//]`) so API telemetry, camera frames, and Gemini responses are never served stale.
- **Wearable JPEG Preview (`src/hooks/useWearableFrames.ts`):** Separate ESP32-S3 camera source polling `/api/device/frame/status` and `/api/device/frame/latest` using `AbortController`, `URL.createObjectURL` / `revokeObjectURL`, non-overlapping fetches, bounded exponential backoff, and automatic stale detection (`> 5000 ms`).
- **Validated Hardware Telemetry Gateway (`server/deviceGateway.ts`):** Versioned schema (`TelemetryPayloadV1` + legacy adapter), SHA-256 per-device token authentication, constant-time token verification (`SENTRA_DEVICE_TOKEN` or provisioned device token), sequence deduplication with reboot detection, server-enforced heartbeat timeout disconnect transitions, and SSE real-time push.
- **Safety Grounding & Alert Precedence (`server/validation.ts`):**
  - Critical hardware ToF proximity (`< 45 cm`) and downward drop-off (`> 200 mm`) alerts are generated server-side, enqueued until acknowledged (`POST /api/device/ack`), and cannot be downgraded or contradicted by Gemini responses.
  - Zero (`0`) or out-of-range uninitialized sensor values normalize to `null` instead of being misread as safe clearance.
  - Vision analysis refuses to claim objects found or paths clear without a fresh image.
- **SQLite Event & Memory Persistence (`server/eventStore.ts`):** Stores sensor telemetry, alert history, connection transitions, contextual memories, and analysis telemetry in `data/sentra.db` across server restarts, with dedicated analytics aggregation excluding simulator events by default.
- **Developer Testbench Simulator:** Explicitly separated under device ID `SIM-ESP32-01` (`sourceMode: "simulator"`), protected behind `SENTRA_SIMULATOR_ENABLED` and `X-Sentra-Simulator: true`.

### Prototype Limitations & Planned Hardware Scope
- **Physical ESP32-S3 Firmware:** This repository contains the companion application and backend gateway; ESP32-S3 microcontroller C/Arduino/ESP-IDF firmware is external and must implement the REST protocol documented below.
- **Spatial Awareness Map (`src/components/SpatialWorldView.tsx`):** Plots compass bearings and rough step-distance rings from observed landmarks in the current session. It is **not** full Visual-Inertial SLAM or metric indoor localization.
- **Background / Screen-Off Wake-Word ("Hey SENTRA"):** Foreground `"Hey SENTRA"` listening works in supported Chromium desktop and Android browsers while SENTRA is open and active. True always-on background or lock-screen wake-word detection is not supported by web browsers or PWAs and requires a future native mobile app; iOS Safari also limits continuous speech loops, so Hold-to-Talk, Tap-to-Ask, and typed input remain available.
- **HTTPS / Secure Context Requirement:** Browsers restrict camera (`navigator.mediaDevices.getUserMedia`) and microphone access to `https://` origins or `http://localhost`. Embedded iframes (such as preview windows) can also block camera/mic access via `Permissions-Policy`; open SENTRA directly in a top-level HTTPS browser tab on desktop or mobile.

---

## Hardware API Contract (ESP32-S3 Integration)

All hardware write and device poll/ack routes require authentication via `Authorization: Bearer <token>` or `X-Device-Token: <token>` using either `SENTRA_DEVICE_TOKEN` or a per-device token generated via `POST /api/device/register`.

| Method & Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/device/register` | Optional `SENTRA_OPERATOR_TOKEN` | Registers device capabilities and issues a one-time plaintext token |
| `POST /api/device/telemetry` | Device token | Ingests `TelemetryPayloadV1` JSON (`schemaVersion: 1`, `deviceId`, `sequence`, `uptimeMs`, `batteryPercent`, `sensors`, `capabilities`) or legacy JSON |
| `POST /api/device/frame` | Device token | Ingests raw `image/jpeg` body (preferred, max 5 MB) or JSON `{ frame: "data:image/jpeg;base64,..." }` |
| `GET /api/device/poll?deviceId=...` | Device token | Retrieves unacknowledged spoken guidance or critical proximity alerts |
| `POST /api/device/ack` | Device token | Acknowledges action IDs (`{ deviceId, actionIds }`) so critical messages stop repeating |
| `GET /api/device/frame/status?deviceId=...` | Public read | Returns latest frame sequence, age, format, stale state, and connection status |
| `GET /api/device/frame/latest?deviceId=...` | Public read | Returns latest validated JPEG bytes (`Cache-Control: no-store`, `410` if `rejectStale=true`) |
| `GET /api/device/stream` | Public read | Server-Sent Events (`snapshot`, `telemetry`, `alert`, `device_list`) |
| `GET /api/analytics` | Public read | SQLite-aggregated sensor/alert metrics (`range=1h\|24h\|7d\|all`, `includeSimulated=false\|true`) |

---

## Local Setup & Verification

### 1. Prerequisites
- Node.js **22+** (required for built-in `node:sqlite`)
- A Google Gemini API key (`GEMINI_API_KEY`) for AI Visual Analysis and conversational Q&A

### 2. Configure & Run
```bash
npm install
cp .env.example .env
# Edit .env to set GEMINI_API_KEY and optional SENTRA_DEVICE_TOKEN
npm run dev
```

Open **`http://localhost:3000`** in a modern browser.

### 3. Build, Typecheck & Test
```bash
# Strict TypeScript check
npm run lint

# Automated backend & frontend unit/integration tests (Vitest)
npm test

# Production bundle build
npm run build
```

---

## License

Licensed under the MIT License — see [LICENSE](LICENSE).
