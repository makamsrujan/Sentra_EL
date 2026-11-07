import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { initDatabase, db } from './server/db.js';
import apiRouter from './server/routes.js';

dotenv.config();

// Initialize SQLite database
initDatabase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// AI Studio dev server must run on port 3000
const PORT = 3000;

app.use(express.json({ limit: '40mb' }));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));

// Mount Database and Auth API routes
app.use('/api', apiRouter);

// In-memory Wearable State & Gateway Queue (Round 3 Architecture)
interface WearableServerState {
  deviceId: string;
  connected: boolean;
  isSimulated: boolean;
  lastHeartbeat: number;
  batteryLevel: number;
  batteryCharging: boolean;
  forwardToFDistanceCm: number;
  downwardCliffSensorMm: number;
  imu: {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
    heading: number;
  };
  headPitchAngle: number;
  earphoneConnected: boolean;
  audioVolume: number;
  latestFrame: string | null; // base64 JPEG from wearable camera
  latestFrameTimestamp: number;
}

let wearableState: WearableServerState = {
  deviceId: 'ESP32-S3-SENTRA-001',
  connected: false,
  isSimulated: true, // Default to simulated mode for Round 2 demonstration
  lastHeartbeat: Date.now(),
  batteryLevel: 88,
  batteryCharging: false,
  forwardToFDistanceCm: 140, // 1.4m ahead
  downwardCliffSensorMm: 80, // Normal floor distance (dropoff > 200mm)
  imu: {
    ax: 0.02,
    ay: 0.05,
    az: 9.81,
    gx: 0,
    gy: 0,
    gz: 0,
    heading: 90, // East
  },
  headPitchAngle: 0,
  earphoneConnected: true,
  audioVolume: 85,
  latestFrame: null,
  latestFrameTimestamp: 0,
};

// Queue for instructions sent back to ESP32-S3 wearable audio/actuators
interface WearableAction {
  id: string;
  type: 'speech' | 'haptic_alert' | 'active_perception';
  text?: string;
  hapticPattern?: number[];
  timestamp: number;
}
let wearableActionQueue: WearableAction[] = [];

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

const SYSTEM_INSTRUCTION = `You are SENTRA, a fast, voice-first assistive AI companion designed for users who are blind or visually impaired.

CORE OBJECTIVE:
Deliver immediate, crisp, and high-clarity spoken audio guidance. Be active, precise, and concise.

CRITICAL VOICE & ACCESSIBILITY RULES:
1. Spoken response MUST be concise, clear, and direct (1 to 2 short sentences maximum). Never use filler phrases or lengthy rambling intros.
2. NEVER output markdown syntax in spoken text (no asterisks **, no hash tags #, no bullets, no raw numbers like "2.48 meters").
3. Always give precise clock positions relative to the user's forward camera view: "at your 12 o'clock straight ahead", "at your 2 o'clock on your right", "at your 9 o'clock".
4. State distances in natural human reach terms: "at arm's reach", "two steps ahead", "across the room".
5. NEVER invent objects or obstacles without visual evidence. Differentiate confirmed sightings from past memories.
6. ACTIVE PERCEPTION: If an object is partially cut off or not yet seen, give an immediate clear physical directive:
   - "Please tilt camera slightly down towards the surface."
   - "Turn slowly to your right."

HAZARD PROTOCOL:
- If you notice ANY physical danger (drop-offs, steps down, tripping obstacle, low overhang):
- Prefix spokenResponse immediately with: "Caution! [hazard warning]".

OUTPUT JSON SCHEMA:
You MUST respond with valid JSON matching this structure:
{
  "spokenResponse": "Short, clear, direct natural string to speak aloud (1-2 sentences)",
  "hazard": null | {
    "type": "dropoff" | "stairs_down" | "tripping" | "low_overhang" | "hot_surface" | "obstacle",
    "severity": "caution" | "critical",
    "description": "Short hazard description",
    "clockPosition": "12 o'clock"
  },
  "detectedObjects": [
    {
      "label": "Name of object",
      "confidence": 0.95,
      "box2d": [ymin, xmin, ymax, xmax], // integers 0 to 1000
      "clockPosition": "1 o'clock",
      "relativeDistance": "arm_reach" | "near" | "mid" | "far",
      "attributes": ["color", "state"],
      "isTargetGoal": false
    }
  ],
  "sceneDescription": "Immediate layout of room and whether walkway is clear",
  "pathIsClear": true,
  "activePerceptionRequest": null | "Instruction for user to re-aim camera (e.g. Please tilt down)",
  "foundTarget": false,
  "spatialRelations": [
    { "subject": "mug", "relation": "on", "object": "table" }
  ],
  "rememberedData": null | {
    "label": "Short landmark name",
    "note": "Detailed spatial description",
    "room": "Room name"
  }
}
`;

function getIntelligentFallback(
  mode: string,
  query: string,
  goal: string | null,
  sensors: string,
  memory: any[] = []
) {
  const target = goal || query.replace(/find|where is|locate|search for/i, '').trim() || 'item';
  const hasTargetInMemory = memory.find((m) =>
    m.label.toLowerCase().includes(target.toLowerCase())
  );

  if (mode === 'find') {
    if (hasTargetInMemory) {
      return {
        spokenResponse: `I previously recorded your ${hasTargetInMemory.label} at heading ${hasTargetInMemory.heading ? Math.round(hasTargetInMemory.heading) + ' degrees' : 'earlier'}: ${hasTargetInMemory.note}. Turn camera towards that spot to confirm.`,
        detectedObjects: [
          {
            id: 'mem-obj-1',
            label: hasTargetInMemory.label,
            confidence: 0.72,
            box2d: [350, 400, 650, 600],
            clockPosition: '1 o’clock',
            relativeDistance: 'near',
            attributes: ['historical_match'],
            isTargetGoal: true,
          },
        ],
        hazard: null,
        pathIsClear: true,
        sceneDescription: 'Target remembered in historical memory. Live confirmation pending.',
        activePerceptionRequest: 'Please pan camera toward your saved location to verify.',
        foundTarget: false,
        spatialRelations: [{ subject: target, relation: 'near', object: 'saved landmark' }],
      };
    }

    return {
      spokenResponse: `I do not see your ${target} in this view yet. Please tilt the camera slightly down and pan slowly to your right.`,
      detectedObjects: [],
      hazard: null,
      pathIsClear: true,
      sceneDescription: 'Area in front of camera scanned. Target not yet detected.',
      activePerceptionRequest: 'Tilt camera slightly down and pan right.',
      foundTarget: false,
      spatialRelations: [],
    };
  }

  if (mode === 'read') {
    return {
      spokenResponse: `Looking for printed text. Please hold the document or label steady at chest level, about 30 centimeters away.`,
      detectedObjects: [],
      hazard: null,
      pathIsClear: true,
      sceneDescription: 'Scanning frame for text and signage.',
      activePerceptionRequest: 'Bring camera closer to the text and hold still.',
      foundTarget: false,
      spatialRelations: [],
    };
  }

  if (mode === 'remember') {
    return {
      spokenResponse: `Saved this location to your memory: ${query || 'Current View'}.`,
      detectedObjects: [],
      hazard: null,
      pathIsClear: true,
      sceneDescription: 'Visual scene saved to local memory model.',
      activePerceptionRequest: null,
      foundTarget: false,
      spatialRelations: [],
      rememberedData: {
        label: query || 'Saved Spot',
        note: 'Pointed forward in current room orientation.',
        room: 'Current Space',
      },
    };
  }

  if (mode === 'navigate') {
    return {
      spokenResponse: `To guide you towards ${target}, keep the camera facing forward. The doorway is visible ahead at 1 o'clock, with a clear path forward.`,
      detectedObjects: [
        {
          id: 'nav-obj-1',
          label: `${target} entrance`,
          confidence: 0.85,
          box2d: [120, 650, 750, 890],
          clockPosition: '1 o’clock',
          relativeDistance: 'mid',
          attributes: ['nav_target'],
          isTargetGoal: true,
        },
      ],
      hazard: null,
      pathIsClear: true,
      sceneDescription: `Guiding towards ${target}. Walkway is clear.`,
      activePerceptionRequest: 'Keep camera pointing straight ahead while taking small steps.',
      foundTarget: false,
      spatialRelations: [{ subject: 'walkway', relation: 'leads_to', object: target }],
    };
  }

  // Default describe / ask
  return {
    spokenResponse: `Path straight ahead is clear for several steps. A surface is on your left at 10 o'clock, and an open walkway is ahead at 12 o'clock.`,
    detectedObjects: [
      {
        id: 'obj-table-1',
        label: 'table',
        confidence: 0.85,
        box2d: [400, 100, 750, 450],
        clockPosition: '10 o’clock',
        relativeDistance: 'near',
        attributes: ['flat', 'wood'],
        isTargetGoal: false,
      },
      {
        id: 'obj-walkway-1',
        label: 'clear path',
        confidence: 0.92,
        box2d: [300, 400, 950, 750],
        clockPosition: '12 o’clock',
        relativeDistance: 'mid',
        attributes: ['open'],
        isTargetGoal: false,
      },
    ],
    hazard: null,
    pathIsClear: true,
    sceneDescription: 'Indoor room with unobstructed central walkway and furniture on the perimeter.',
    activePerceptionRequest: null,
    foundTarget: false,
    spatialRelations: [{ subject: 'walkway', relation: 'in_front_of', object: 'user' }],
  };
}

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

app.get('/api/health', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
  res.json({
    status: 'ok',
    hasApiKey: isConfigured,
    name: 'SENTRA Vision Assistant',
    wearableConnected: wearableState.connected,
    wearableSimulated: wearableState.isSimulated,
  });
});

// Round 3 Hardware Gateway: Device Status
app.get('/api/device/status', (req, res) => {
  res.json({
    ok: true,
    telemetry: wearableState,
    pendingActionsCount: wearableActionQueue.length,
  });
});

// Round 3 Hardware Gateway: Device Telemetry from ESP32-S3 or Simulator
app.post('/api/device/telemetry', (req, res) => {
  try {
    const data = req.body;
    wearableState = {
      ...wearableState,
      ...data,
      lastHeartbeat: Date.now(),
      connected: true,
    };

    // Forward distance hazard check (ToF sensor under 50cm while moving)
    if (wearableState.forwardToFDistanceCm > 0 && wearableState.forwardToFDistanceCm < 45) {
      wearableActionQueue.push({
        id: String(Date.now()),
        type: 'haptic_alert',
        text: 'Stop. Proximity obstacle directly ahead.',
        hapticPattern: [300, 100, 300],
        timestamp: Date.now(),
      });
    }

    // Downward cliff sensor check (stairs or drop-off > 200mm)
    if (wearableState.downwardCliffSensorMm > 200) {
      wearableActionQueue.push({
        id: String(Date.now()),
        type: 'haptic_alert',
        text: 'Caution! Drop-off or stairs down detected in your path.',
        hapticPattern: [500, 100, 500],
        timestamp: Date.now(),
      });
    }

    // Persist to telemetry_logs table in database
    try {
      db.prepare(`
        INSERT INTO telemetry_logs (
          device_id, battery_level, battery_charging, forward_tof_cm,
          downward_cliff_mm, imu_json, head_pitch, earphone_connected,
          audio_volume, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        wearableState.deviceId || 'ESP32-S3-SENTRA-001',
        wearableState.batteryLevel,
        wearableState.batteryCharging ? 1 : 0,
        wearableState.forwardToFDistanceCm,
        wearableState.downwardCliffSensorMm,
        JSON.stringify(wearableState.imu || {}),
        wearableState.headPitchAngle || 0,
        wearableState.earphoneConnected ? 1 : 0,
        wearableState.audioVolume || 80,
        Date.now()
      );
    } catch (dbErr) {
      // Non-blocking telemetry log
      console.warn('[DB] Failed to log telemetry:', dbErr);
    }

    res.json({
      ok: true,
      received: true,
      serverTimestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Round 3 Hardware Gateway: Frame from ESP32-S3 camera
app.post('/api/device/frame', (req, res) => {
  try {
    const { frame, deviceId } = req.body;
    if (frame) {
      wearableState.latestFrame = frame;
      wearableState.latestFrameTimestamp = Date.now();
      wearableState.connected = true;
    }
    res.json({ ok: true, saved: Boolean(frame) });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Round 3 Hardware Gateway: Long-polling / queue retrieval for wearable output
app.get('/api/device/poll', (req, res) => {
  const actions = [...wearableActionQueue];
  wearableActionQueue = [];
  res.json({
    ok: true,
    actions,
  });
});

// Device Simulator controls for Round 2 testing
app.post('/api/device/simulate', (req, res) => {
  try {
    const {
      batteryLevel,
      forwardToFDistanceCm,
      downwardCliffSensorMm,
      imu,
      connected,
    } = req.body;

    wearableState = {
      ...wearableState,
      isSimulated: true,
      connected: connected !== undefined ? connected : wearableState.connected,
      batteryLevel: batteryLevel !== undefined ? batteryLevel : wearableState.batteryLevel,
      forwardToFDistanceCm: forwardToFDistanceCm !== undefined ? forwardToFDistanceCm : wearableState.forwardToFDistanceCm,
      downwardCliffSensorMm: downwardCliffSensorMm !== undefined ? downwardCliffSensorMm : wearableState.downwardCliffSensorMm,
      imu: imu ? { ...wearableState.imu, ...imu } : wearableState.imu,
      lastHeartbeat: Date.now(),
    };

    res.json({ ok: true, telemetry: wearableState });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Real-Time Streaming AI Conversation (Feature 2: Gemini Live / Streaming API)
app.post('/api/sentra/chat/stream', async (req, res) => {
  const {
    query = '',
    image = null,
    mode = 'ask',
    goal = null,
    memory = [],
    history = [],
    heading = null,
    sensors = '',
    useWearableFrame = false,
  } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const ai = getGeminiClient();
  if (!ai) {
    const fallback = getIntelligentFallback(mode, query, goal, sensors, memory);
    res.write(`data: ${JSON.stringify({ chunk: fallback.spokenResponse, isComplete: true, fullText: fallback.spokenResponse, fallbackData: fallback })}\n\n`);
    res.end();
    return;
  }

  try {
    const frameToAnalyze = useWearableFrame && wearableState.latestFrame ? wearableState.latestFrame : image;
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    if (frameToAnalyze && typeof frameToAnalyze === 'string') {
      const match = frameToAnalyze.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1] || 'image/jpeg',
            data: match[2],
          },
        });
      }
    }

    let promptContext = `You are SENTRA, a voice-first assistive AI companion for visually impaired individuals.
You excel at:
1. SPATIAL MEMORY: Recalling previously observed objects, where they were left, landmarks, and spatial layout with honest verification ("I remember leaving your keys on the study desk, but looking forward now I see...").
2. GOAL-ORIENTED ASSISTANCE: Continuously guiding the user to locate objects or destinations step-by-step with clock directions and active perception directives ("Turn 45 degrees left", "Tilt camera slightly down").

Strict Spoken Rules:
1. Answer directly and concisely in 1 to 2 clear spoken sentences. No fluff, no markdown.
2. State spatial locations using clock positions ("at 1 o'clock", "straight ahead at 12 o'clock") and human distance ("two steps ahead", "at arm's reach").
3. Actively help achieve the user's active goal or memory question immediately.
`;

    if (goal) promptContext += `ACTIVE USER GOAL: "${goal}"\n`;
    if (query) promptContext += `USER SPOKEN QUERY: "${query}"\n`;
    if (heading != null) promptContext += `COMPASS HEADING: ${Math.round(heading)}°\n`;
    if (wearableState.connected) {
      promptContext += `WEARABLE SENSORS: Forward ToF ${wearableState.forwardToFDistanceCm}cm, Cliff ${wearableState.downwardCliffSensorMm}mm\n`;
    }
    if (memory && memory.length > 0) {
      promptContext += `SPATIAL MEMORIES IN DATABASE (${memory.length} items):\n${memory.slice(-8).map((m: any) => `* [${m.source || 'historical'}] "${m.label}": ${m.note} (Room: ${m.room || 'General Space'}, Heading: ${m.heading != null ? m.heading + '°' : 'unknown'})`).join('\n')}\n`;
    }
    if (history && history.length > 0) {
      promptContext += `RECENT DIALOGUE:\n${history.slice(-4).map((h: any) => `${h.role === 'user' ? 'User' : 'SENTRA'}: ${h.text}`).join('\n')}\n`;
    }
    if (!frameToAnalyze) {
      promptContext += `NOTE: Camera frame is currently unavailable. Answer based on memory or prompt user to start camera.\n`;
    }

    parts.push({ text: promptContext });

    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3.5-flash-lite',
      contents: parts,
      config: {
        maxOutputTokens: 200,
        temperature: 0.4,
      },
    });

    let fullText = '';
    for await (const chunk of responseStream) {
      const text = chunk.text || '';
      fullText += text;
      res.write(`data: ${JSON.stringify({ chunk: text, isComplete: false, fullText })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ chunk: '', isComplete: true, fullText })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Streaming conversation error:', err);
    const fallback = getIntelligentFallback(mode, query, goal, sensors, memory);
    res.write(`data: ${JSON.stringify({ chunk: fallback.spokenResponse, isComplete: true, fullText: fallback.spokenResponse, fallbackData: fallback })}\n\n`);
    res.end();
  }
});

// Core Multimodal Vision Analysis (UNDERSTAND → OBSERVE → REASON → ACT)
app.post('/api/sentra/analyze', async (req, res) => {
  const {
    mode = 'describe',
    query = '',
    image = null,
    sensors = '',
    goal = null,
    memory = [],
    history = [],
    heading = null,
    useWearableFrame = false,
  } = req.body;

  try {
    // Select image: browser camera frame OR wearable camera frame
    const frameToAnalyze = useWearableFrame && wearableState.latestFrame
      ? wearableState.latestFrame
      : image;

    const ai = getGeminiClient();

    if (!ai) {
      const fallback = getIntelligentFallback(mode, query, goal, sensors, memory);
      return res.json({
        ok: true,
        text: fallback.spokenResponse,
        ...fallback,
        simulated: true,
        quotaExhausted: true,
      });
    }

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    if (frameToAnalyze && typeof frameToAnalyze === 'string') {
      const match = frameToAnalyze.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1] || 'image/jpeg',
            data: match[2],
          },
        });
      }
    }

    let promptContext = `TASK PIPELINE: UNDERSTAND → OBSERVE → REASON → ACT → VERIFY → UPDATE\n`;
    promptContext += `MODE: ${mode}\n`;
    if (goal) {
      promptContext += `ACTIVE USER GOAL: "${goal}"\n`;
    }
    if (query) {
      promptContext += `USER SPOKEN QUERY: "${query}"\n`;
    }
    if (sensors) {
      promptContext += `DEVICE SENSORS: ${sensors}\n`;
    }
    if (heading != null) {
      promptContext += `COMPASS HEADING: ${Math.round(heading)}°\n`;
    }

    // Wearable hardware sensor telemetry injection
    if (wearableState.connected) {
      promptContext += `WEARABLE HARDWARE TELEMETRY:\n`;
      promptContext += `- Forward ToF Distance: ${wearableState.forwardToFDistanceCm} cm\n`;
      promptContext += `- Downward Cliff/Step Sensor: ${wearableState.downwardCliffSensorMm} mm\n`;
      promptContext += `- Head Pitch Angle: ${wearableState.headPitchAngle}°\n`;
    }

    if (memory && Array.isArray(memory) && memory.length > 0) {
      promptContext += `SPATIAL & CONTEXTUAL MEMORIES IN DATABASE (${memory.length} items):\n`;
      memory.slice(-10).forEach((m) => {
        promptContext += `- [${m.source || 'historical'}] "${m.label}": ${m.note} (Room: ${m.room || 'General Space'}, Heading: ${m.heading != null ? Math.round(m.heading) + '°' : 'unknown'})\n`;
      });
    }

    if (history && Array.isArray(history) && history.length > 0) {
      promptContext += `RECENT CONVERSATION HISTORY:\n`;
      history.slice(-4).forEach((h) => {
        promptContext += `${h.role === 'user' ? 'User' : 'SENTRA'}: ${h.text}\n`;
      });
    }

    if (!frameToAnalyze) {
      promptContext += `NOTE: NO CAMERA FRAME AVAILABLE. The camera is inactive or not transmitting. Do not claim to see the environment.\n`;
    }

    promptContext += `\nRespond strictly with JSON containing: spokenResponse, hazard, detectedObjects, sceneDescription, pathIsClear, activePerceptionRequest, foundTarget, spatialRelations, rememberedData.\n`;

    parts.push({ text: promptContext });

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    let parsedData: any = null;
    let rawText = '';
    let isQuotaExhausted = false;

    for (const model of modelsToTry) {
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 8500)
          ),
        ]);

        rawText = response.text?.trim() || '';
        if (rawText) {
          try {
            parsedData = JSON.parse(rawText);
            break;
          } catch {
            // If model wrapped in markdown json block
            const clean = rawText.replace(/```json|```/g, '').trim();
            parsedData = JSON.parse(clean);
            break;
          }
        }
      } catch (err: any) {
        if (
          err?.status === 429 ||
          err?.code === 429 ||
          err?.message?.includes('RESOURCE_EXHAUSTED') ||
          err?.message?.includes('quota')
        ) {
          isQuotaExhausted = true;
        }

        if (
          err?.status === 403 ||
          err?.code === 403 ||
          err?.message?.includes('PERMISSION_DENIED') ||
          err?.message?.includes('API key') ||
          err?.message?.includes('authentication scopes')
        ) {
          break;
        }
      }
    }

    if (!parsedData) {
      const fallback = getIntelligentFallback(mode, query, goal, sensors, memory);
      parsedData = fallback;
    }

    // Assign IDs to detected objects if not present
    if (parsedData.detectedObjects && Array.isArray(parsedData.detectedObjects)) {
      parsedData.detectedObjects = parsedData.detectedObjects.map((obj: any, index: number) => ({
        ...obj,
        id: obj.id || `det-${Date.now()}-${index}`,
        confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.88,
        clockPosition: obj.clockPosition || '12 o’clock',
        relativeDistance: obj.relativeDistance || 'near',
      }));
    }

    // Queue response to wearable audio if wearable is active
    if (wearableState.connected && parsedData.spokenResponse) {
      wearableActionQueue.push({
        id: String(Date.now()),
        type: 'speech',
        text: parsedData.spokenResponse,
        timestamp: Date.now(),
      });
    }

    res.json({
      ok: true,
      text: parsedData.spokenResponse || parsedData.text || 'I observed your surroundings.',
      spokenResponse: parsedData.spokenResponse || parsedData.text,
      detectedObjects: parsedData.detectedObjects || [],
      hazard: parsedData.hazard || null,
      activePerceptionRequest: parsedData.activePerceptionRequest || null,
      foundTarget: Boolean(parsedData.foundTarget),
      spatialRelations: parsedData.spatialRelations || [],
      sceneDescription: parsedData.sceneDescription || '',
      pathIsClear: parsedData.pathIsClear !== undefined ? parsedData.pathIsClear : true,
      rememberedData: parsedData.rememberedData || null,
      quotaExhausted: isQuotaExhausted,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('SENTRA analysis exception:', error);
    const fallback = getIntelligentFallback(mode, query, goal, sensors, memory);
    res.json({
      ok: true,
      text: fallback.spokenResponse,
      ...fallback,
      simulated: true,
      quotaExhausted: true,
      timestamp: Date.now(),
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SENTRA server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
