# SENTRA (Sentra_EL)

> **Spatially Intelligent, Voice-First Assistive Wearable & Environmental Assistant for Visually Impaired Users**

<p align="left">
  <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Vite_6-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Google_Gemini-8E75C2?style=for-the-badge&logo=google&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/ESP32--S3-E7352C?style=for-the-badge&logo=espressif&logoColor=white" alt="ESP32-S3" />
</p>

SENTRA is a voice-first, spatially intelligent environmental assistant designed to empower blind and visually impaired individuals to explore surroundings, locate personal objects, navigate spaces safely, and recall spatial locations through multimodal AI.

---

## 🌟 Core Closed-Loop Pipeline

SENTRA operates on a continuous perception and verification feedback loop:

```
UNDERSTAND ──► OBSERVE ──► REASON ──► ACT ──► VERIFY ──► UPDATE
```

- **UNDERSTAND:** Multi-turn conversational intent extraction using Google Gemini, maintaining active search goals and conversational context across interactions.
- **OBSERVE:** Live camera frames (device webcam or wearable feed) fused with orientation (IMU compass heading) and proximity sensors (ToF distance & downward cliff sensor).
- **REASON:** Multimodal vision-language scene interpretation with 2D normalized bounding boxes (`[ymin, xmin, ymax, xmax]`), natural clock positions (`"at your 1 o'clock"`), and grounded spatial relationships (`"bottle ON study table"`).
- **ACT:** Natural spoken feedback without robotic coordinate dumps or markdown formatting; clear directional steps.
- **VERIFY:** Continuous observation checks before declaring tasks complete; visual verification attempt history tracking.
- **UPDATE:** Persistent consent-based contextual memory distinguishing live verified sightings from historical recollections.

---

## 💻 Tech Stack & System Architecture

| Layer | Technology | Role |
|---|---|---|
| **Frontend Framework** | **React 19** + **Vite 6** | Accessible SPA with Web Speech API recognition, Web Audio chimes, and camera streams |
| **Language** | **TypeScript 5** | Strict end-to-end type safety (`tsc --noEmit` verified) |
| **Styling** | **Tailwind CSS v4** + **Lucide Icons** | Accessible, high-contrast UI tailored for low-vision and assistive use |
| **Full-Stack Backend** | **Express.js (Node.js)** | Unified server (`server.ts`) hosting the REST API, device IoT endpoints, and Vite middleware |
| **Multimodal AI** | **Google Gemini (3.8 & 3.5 Flash)** | Multimodal reasoning, scene analysis, active perception directives, and spatial grounding |
| **Offline Engine** | **HTML5 Canvas Computer Vision** | Local fallback (`src/utils/localVision.ts`) for zero-credit, offline operation |
| **Hardware Gateway** | **ESP32-S3 REST Interface** | IoT endpoints for wearable sensor telemetry and earphone audio delivery |

---

## 🚀 Capabilities & Project Status

### 🟢 Round 2: Software Application (Active & Working)

1. **Voice-First Natural Interaction:**
   - Real-time speech recognition via Web Speech API with Spacebar push-to-talk shortcut.
   - Speech synthesis with automatic microphone pause during speaking to prevent feedback loops.
   - Auditory feedback chimes for listening start/stop, target detection, and hazard warnings.

2. **Multimodal Environmental Perception:**
   - Real-time scene description and obstacle clearance checking.
   - 2D object bounding boxes rendered directly on the camera canvas.
   - Hazard detection for drop-offs (stairs down) and physical obstacles within proximity.

3. **Active Perception Object Finder & Verification History:**
   - Active goal tracking across multiple turns (*"Where is my bottle?"* → *"Can you see it now?"* → *"What should I do next?"*).
   - Dynamic re-aiming advisories (*"Please tilt camera down 15 degrees toward table"*).
   - Dedicated **Verification History** component categorizing actions into:
     - **Completed:** Confirmed visual detection with confidence rating and clock direction.
     - **Active:** Current live sweep or active perception re-aim prompt.
     - **Attempted:** Recorded observation scan where the target was not confirmed.
   - Text-to-speech audio narration (`Read History` button).

4. **Zero-Hallucination Grounding:**
   - Strictly refuses to invent objects or clear paths when the camera is covered, obscured, or inactive.
   - Clearly disambiguates remembered locations (*"I last saw your bottle on the study table"*) from live camera sightings.

5. **Local Offline Fallback:**
   - Built-in lightweight canvas luminance and edge-transition analysis ensuring the app provides orientation guidance even without internet or API credits.

---

### 🟡 Round 2 Hardware Testbench (Simulated Integration)

- **Interactive Wearable Simulator:** Testbench interface for simulating ESP32-S3 hardware telemetry without physical hardware attached:
  - Forward Time-of-Flight (ToF) distance sensor (0–400 cm).
  - Downward ground drop-off / cliff sensor (0–1000 mm).
  - Head pitch angle (-90° to +90°).
  - 6-axis IMU compass heading.
- **Panoramic Demonstration Room:** Built-in simulated room stream with pan controls (`◀ Left`, `Right ▶`) and local image uploader for testing in restricted browser environments.

---

### 🔵 Round 3: Wearable Hardware (Planned Architecture)

The SAME backend developed in Round 2 connects directly to the Round 3 wearable prototype:

- **Headband:**
  - Wide-angle camera module.
  - Forward-facing ToF distance sensor (obstacle proximity).
  - Downward-facing ToF sensor (drop-off, step-down, and cliff detection).
  - 6-axis IMU (head orientation and tilt angle).
  - Beamforming microphone array.
- **Bag-Mounted Electronics Box:**
  - ESP32-S3 microcontroller running lightweight Wi-Fi client firmware.
  - Protected rechargeable battery power supply.
  - Audio codec driving wired earphones.
- **Communication Protocol:**
  - `GET /api/device/status` — Connection heartbeat and battery level.
  - `POST /api/device/telemetry` — Forward ToF, cliff sensor, IMU data.
  - `POST /api/device/frame` — JPEG camera frame transmission.
  - `GET /api/device/poll` — Pulls spoken guidance audio queue for earphone output.

---

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- A Google Gemini API Key

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/makamsrujan/Sentra_EL.git
cd Sentra_EL

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Add your GEMINI_API_KEY to .env

# 4. Start the development server
npm run dev
```

Open **`http://localhost:3000`** in your browser.

### Verification & Testing

```bash
# Run TypeScript compilation check
npm run lint

# Build production bundle
npm run build
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
