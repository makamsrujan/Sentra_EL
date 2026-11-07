# SENTRA (Sentra_EL)

> **Spatially Intelligent, Voice-First Assistive Wearable & Vision Assistant for Visually Impaired Users**

<p align="left">
  <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/SQLite_3-07405E?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Google_Gemini-8E75C2?style=for-the-badge&logo=google&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/JWT-black?style=for-the-badge&logo=JSON%20web%20tokens" alt="JWT" />
</p>

SENTRA is a voice-first environmental assistant designed to help blind and visually impaired individuals explore their surroundings, find objects, navigate spaces safely, and recall spatial locations using multimodal AI.

---

## 💻 Tech Stack & Architecture

| Layer | Technology | Description |
|---|---|---|
| **Frontend Framework** | **React 19** + **Vite 6** | Ultra-responsive UI, audio synthesis hooks, and WebRTC/Camera streams |
| **Language** | **TypeScript 5** | Strict end-to-end type safety across both frontend and backend |
| **Styling** | **Tailwind CSS v4** + **Lucide Icons** | Accessible, high-contrast UI tailored for visual ergonomics |
| **Backend API** | **Express.js (Node.js)** | Unified full-stack server serving both the SPA and REST endpoints |
| **Database** | **SQLite (better-sqlite3)** | Embedded WAL-mode database storing users, preferences, memories & telemetry |
| **Authentication** | **JWT + bcryptjs** | Secure password hashing, authorization headers, and session tokens |
| **Multimodal AI** | **Google Gemini 2.5 Flash** | Real-time scene spatial reasoning, active perception, and object localization |
| **Hardware Gateway** | **ESP32-S3 / ToF Sensors** | IoT gateway for ToF distance sensors, cliff detection, and 6-axis IMU |

---

## 🌟 Core Perception Pipeline

SENTRA implements a closed-loop perception and reasoning pipeline:

```
UNDERSTAND ──► OBSERVE ──► REASON ──► ACT ──► VERIFY ──► UPDATE
```

- **UNDERSTAND:** Multi-turn conversational intent classification using Google Gemini.
- **OBSERVE:** Live camera acquisition (browser webcam or ESP32-S3 wearable camera stream) fused with IMU orientation and ToF distance telemetry.
- **REASON:** Multimodal vision-language scene analysis with normalized bounding boxes, clock positions (`"at your 1 o'clock"`), and grounded spatial relationships (`"bottle ON table"`).
- **ACT:** Natural spoken feedback without robotic coordinate dumps or markdown formatting; clear directional guidance.
- **VERIFY:** Real visual re-verification before declaring tasks complete; visual verification attempt history.
- **UPDATE:** Persistent consent-based contextual memory differentiating live verified sightings from historical recollections.

---

## 🚀 Key Features

1. **Authentication & Data Persistence (Full-Stack):**
   - User registration and login with encrypted JWT sessions and `bcryptjs` credential hashing.
   - SQLite persistent storage for user profile settings, spatial landmarks, object memories, and wearable device pairings.
   - Automatic cross-device syncing of user preferences (speech rate, camera orientation, haptic alerts).

2. **Conversational Voice Assistant:**
   - Hands-free `"Hey SENTRA"` continuous activation.
   - Microphone pause during speech synthesis to prevent audio feedback loops.
   - Grounded responses that never fabricate sightings when the camera is covered or inactive.

3. **Live Vision & Detection:**
   - 2D normalized object bounding boxes `[ymin, xmin, ymax, xmax]`.
   - Real-time confidence scores and relative distance bands (`arm_reach`, `near`, `mid`, `far`).
   - Urgent hazard caution overlays for drop-offs (descending stairs), low obstacles, or proximity alerts (<45 cm).
   - Built-in Demonstration Room simulation stream with pan controls for camera-restricted environments.

4. **Active Perception Object Finder:**
   - Continuous search state machine (`active` → `need_observation` → `verifying` → `completed`).
   - Dynamic re-aiming advisories (*"Please tilt camera down"*, *"Pan slowly to your left"*).
   - Audit trail of verification attempts showing step numbers, elapsed time, and confidence ratings.

5. **Spatial World Model & Contextual Memory:**
   - Visual-Inertial SLAM with live feature tracking and odometry.
   - 2D compass radar plotting user heading, forward vector, and room landmarks.
   - Contextual memory with search, room tagging, and honest memory disambiguation.

6. **Round 3 ESP32-S3 Wearable Gateway:**
   - Direct REST and polling endpoints for hardware integration:
     - `GET /api/device/status`
     - `POST /api/device/telemetry` (ToF distance 0–400cm, downward cliff sensor 0–1000mm, 6-axis IMU)
     - `POST /api/device/frame`
     - `GET /api/device/poll`
   - Real-time telemetry logging persisted into SQLite `telemetry_logs` table.
   - Interactive Device Simulator (`[SIMULATED]`) for testing without physical hardware.

---

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- A Google Gemini API Key

### Installation & Run

```bash
# 1. Clone the repository
git clone git@github.com:makamsrujan/Sentra_EL.git
cd Sentra_EL

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Set your GEMINI_API_KEY in .env

# 4. Start the full-stack server
npm run dev
```

Open **`http://localhost:3000`** in your browser.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
