# SENTRA (Sentra_EL)

> **Spatially Intelligent, Voice-First Assistive Wearable & Vision Assistant for Visually Impaired Users**

SENTRA is a voice-first environmental assistant designed to help blind and visually impaired individuals explore their surroundings, find objects, navigate spaces safely, and recall spatial locations using multimodal AI.

---

## 🌟 Core Architecture

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

1. **Conversational Voice Assistant:**
   - Hands-free `"Hey SENTRA"` continuous activation.
   - Microphone pause during speech synthesis to prevent audio feedback loops.
   - Grounded responses that never fabricate sightings when the camera is covered or inactive.

2. **Live Vision & Detection:**
   - 2D normalized object bounding boxes `[ymin, xmin, ymax, xmax]`.
   - Real-time confidence scores and relative distance bands (`arm_reach`, `near`, `mid`, `far`).
   - Urgent hazard caution overlays for drop-offs (descending stairs), low obstacles, or proximity alerts (<45 cm).
   - Built-in Demonstration Room simulation stream with pan controls for camera-restricted environments.

3. **Active Perception Object Finder:**
   - Continuous search state machine (`active` → `need_observation` → `verifying` → `completed`).
   - Dynamic re-aiming advisories (*"Please tilt camera down"*, *"Pan slowly to your left"*).
   - Audit trail of verification attempts showing step numbers, elapsed time, and confidence ratings.

4. **Spatial World Model & Contextual Memory:**
   - 2D compass radar plotting user heading, forward vector, and room landmarks.
   - Contextual memory with search, room tagging, and honest memory disambiguation.

5. **Round 3 ESP32-S3 Wearable Gateway:**
   - Direct REST and polling endpoints for hardware integration:
     - `GET /api/device/status`
     - `POST /api/device/telemetry` (ToF distance 0–400cm, downward cliff sensor 0–1000mm, 6-axis IMU)
     - `POST /api/device/frame`
     - `GET /api/device/poll`
   - Interactive Device Simulator (`[SIMULATED]`) for testing without physical hardware.

---

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- A Google Gemini API Key

### Installation

```bash
# Clone the repository
git clone git@github.com:makamsrujan/Sentra_EL.git
cd Sentra_EL

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Add your GEMINI_API_KEY to .env

# Start development server
npm run dev
```

Visit `http://localhost:3000` in your browser.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
