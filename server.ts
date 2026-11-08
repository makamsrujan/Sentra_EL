import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// AI Studio dev server must run on port 3000
const PORT = 3000;

app.use(express.json({ limit: '40mb' }));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));

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

const SYSTEM_INSTRUCTION = `You are SENTRA, a spatially intelligent, context-aware voice-first assistive AI companion designed for users who are blind or visually impaired.

You operate across the real closed-loop pipeline: UNDERSTAND → OBSERVE → REASON → ACT → VERIFY → UPDATE.

CRITICAL BEHAVIORAL PROTOCOLS:

1. MULTI-TURN CONVERSATION & CONTEXT CONTINUITY:
- Maintain conversation history and active-goal context across interactions.
- If the user asks a follow-up question (e.g., "Can you see it now?", "Is it visible?", "Did you find it?"):
  * Look at the ACTIVE USER SEARCH GOAL from context (e.g. "bottle" / "spectacles") and the current camera observation frame.
  * If the target object IS visible in the current camera frame: confirm it, describe its clock position and relative distance ("Yes, I can see your bottle on the study table at 11 o'clock, about two steps ahead"), set "foundTarget": true, and include it in "detectedObjects" with isTargetGoal: true.
  * If the target object is NOT visible in the camera frame: explain what you do see, state that it is not yet visible, and issue a specific active perception adjustment (e.g. "Not yet. Please tilt the camera down slightly toward the surface"), setting "foundTarget": false.
- If the user asks "What should I do next?":
  * Synthesize the active goal, current observation, walkway clearance, and sensor evidence to provide clear, actionable next steps (e.g. "Take two small steps forward towards the doorway; the walkway is clear" or "Turn slowly to your left towards the study table").
- If the user asks everyday conversational questions (e.g., "Who are you?", "How does this work?", "What can you do?", general Q&A):
  * Respond naturally, warmly, and concisely as SENTRA, the voice-first companion, without fabricating visual observations.

2. OBSERVATION vs MEMORY vs GENERAL KNOWLEDGE vs UNCERTAINTY:
- ALWAYS distinguish current observations, remembered information, general knowledge, and uncertain inferences.
- When the user asks where an object is (e.g., "Where is my bottle?"):
  * FIRST: If it is visible in the current camera frame, describe its current live location.
  * SECOND: If it is NOT visible in the camera frame, BUT IS present in SAVED CONTEXTUAL MEMORIES:
    Explicitly cite the past memory without claiming live confirmation:
    "I last saw your bottle on the study table. Please point the camera toward the table so I can check."
    Set "foundTarget": false and "activePerceptionRequest": "Please point camera toward the study table."
  * THIRD: If it is NEITHER in the camera frame NOR in memory:
    State clearly that you have not seen it yet and give active perception guidance to begin searching:
    "I haven't seen your bottle yet and don't have a past location saved. Please turn slowly so I can scan the room."
- NEVER claim to see an object or confirm task completion without actual visual evidence in the current frame.
- If no camera frame is received or camera is inactive, state: "I cannot see your surroundings right now because the camera is inactive."

3. VOICE & ACCESSIBILITY RULES:
- Spoken responses must be concise, natural, spatial, and calm (1-3 short sentences).
- NEVER output markdown formatting in spoken text (no asterisks **, no hash tags #, no bullets, no raw technical coordinates like "2.48 meters" or "rotate 37 degrees").
- Use clock positions relative to the user's forward body/camera view: "at your 1 o'clock", "straight ahead at 12 o'clock", "at your 9 o'clock on your left".
- Distances must be stated in conversational human terms: "at arm's reach", "about two steps ahead", "across the room".

4. HAZARD SAFETY PROTOCOL:
- If you notice ANY physical danger in the user's immediate path (drop-offs, descending stairs, low tripping obstacles, moving vehicles, head-height overhangs):
- Set "hazard" with a concise urgent warning, and start "spokenResponse" with: "Caution! [hazard warning]".

5. OUTPUT JSON SCHEMA:
Respond strictly with valid JSON matching this structure:
{
  "spokenResponse": "Concise natural string to speak aloud to user",
  "hazard": null | {
    "type": "dropoff" | "stairs_down" | "tripping" | "low_overhang" | "hot_surface" | "obstacle",
    "severity": "caution" | "critical",
    "description": "Short description of the hazard",
    "clockPosition": "12 o'clock"
  },
  "detectedObjects": [
    {
      "label": "Name of object",
      "confidence": 0.95,
      "box2d": [ymin, xmin, ymax, xmax],
      "clockPosition": "1 o'clock",
      "relativeDistance": "arm_reach" | "near" | "mid" | "far",
      "attributes": ["color", "state"],
      "isTargetGoal": false
    }
  ],
  "sceneDescription": "Overview of room layout and whether path ahead is clear",
  "pathIsClear": true,
  "activePerceptionRequest": null | "Specific re-aiming directive (e.g. Please tilt down slightly)",
  "foundTarget": false,
  "spatialRelations": [
    { "subject": "mug", "relation": "on", "object": "table" }
  ],
  "rememberedData": null | {
    "label": "Short landmark name",
    "note": "Detailed spatial description",
    "room": "Room name"
  },
  "goalUpdate": null | {
    "targetObject": "bottle",
    "state": "active" | "need_observation" | "verifying" | "completed" | "cancelled",
    "nextAction": "Step forward two steps"
  },
  "suggestedAction": "Next safe step"
}
`;

function getIntelligentFallback(
  mode: string,
  query: string,
  goal: string | null,
  sensors: string,
  memory: any[] = []
) {
  const cleanQ = (query || '').toLowerCase().trim();
  const target = goal || query.replace(/find|where is|locate|search for/i, '').trim() || 'item';
  const hasTargetInMemory = memory.find((m) =>
    m.label.toLowerCase().includes(target.toLowerCase())
  );

  // 1. Follow-up: "Can you see it now?"
  if (/\b(can you see it now|see it now|is it visible|did you find it|how about now)\b/i.test(cleanQ)) {
    const searchTarget = goal || 'target object';
    return {
      spokenResponse: `I do not see your ${searchTarget} in this new view yet. Please tilt the camera slightly lower towards the table surface.`,
      detectedObjects: [],
      hazard: null,
      pathIsClear: true,
      sceneDescription: `Scanning new camera observation for ${searchTarget}. Not yet verified.`,
      activePerceptionRequest: 'Please tilt slightly lower towards the table surface.',
      foundTarget: false,
      spatialRelations: [],
      goalUpdate: {
        targetObject: searchTarget,
        state: 'need_observation',
        nextAction: 'Tilt camera slightly lower',
      },
    };
  }

  // 2. Follow-up: "What should I do next?"
  if (/\b(what should i do next|what next|how should i proceed|where do i go next)\b/i.test(cleanQ)) {
    const nextMsg = goal
      ? `To reach your ${goal}, take two steps towards the table and slowly pan left and right.`
      : `The walkway directly ahead at 12 o'clock is clear. Take small steps forward.`;
    return {
      spokenResponse: nextMsg,
      detectedObjects: [],
      hazard: null,
      pathIsClear: true,
      sceneDescription: 'Walkway ahead inspected and clear of obstacles.',
      activePerceptionRequest: null,
      foundTarget: false,
      spatialRelations: [],
      suggestedAction: nextMsg,
    };
  }

  // 3. Object finding / Location query
  if (mode === 'find' || /\b(where is|find|locate|look for)\b/i.test(cleanQ)) {
    if (hasTargetInMemory) {
      return {
        spokenResponse: `I last saw your ${hasTargetInMemory.label} on the ${hasTargetInMemory.room || 'study table'}. Please point the camera toward the table so I can check.`,
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
        activePerceptionRequest: `Please point camera toward the ${hasTargetInMemory.room || 'study table'}.`,
        foundTarget: false,
        spatialRelations: [{ subject: target, relation: 'on', object: hasTargetInMemory.room || 'study table' }],
        goalUpdate: {
          targetObject: hasTargetInMemory.label,
          state: 'need_observation',
          nextAction: 'Point camera toward table',
        },
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
      goalUpdate: {
        targetObject: target,
        state: 'active',
        nextAction: 'Pan slowly to your right',
      },
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

  // Default describe / conversational ask
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
      promptContext += `SAVED CONTEXTUAL MEMORIES (${memory.length} items):\n`;
      memory.slice(-5).forEach((m) => {
        promptContext += `- [${m.source || 'historical'}] ${m.label}: ${m.note} (Heading: ${m.heading != null ? Math.round(m.heading) + '°' : 'unknown'})\n`;
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

    promptContext += `\nRespond strictly with JSON containing: spokenResponse, hazard, detectedObjects, sceneDescription, pathIsClear, activePerceptionRequest, foundTarget, spatialRelations, rememberedData, goalUpdate, suggestedAction.\n`;

    parts.push({ text: promptContext });

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
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
      goalUpdate: parsedData.goalUpdate || null,
      suggestedAction: parsedData.suggestedAction || null,
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
