import { GoogleGenAI, Type } from '@google/genai';
import type { DeviceLiveState, PathSafetyStatus, SensorFusionSummary } from '../src/types/deviceProtocol';
import type {
  AnalysisErrorCode,
  AnalysisResponseData,
  GeminiDiagnosticResult,
  HazardAlert,
  SentraMode,
  SentraOperation,
} from '../src/types/sentra';
import { evaluateSensorFusion } from '../src/utils/sensorFusion';
import { SentraEventStore } from './eventStore';
import { decodeBase64Image, sanitizeGeminiResponse } from './validation';

export const SUPPORTED_MODELS = [
  'gemini-3.8-flash',
  'gemini-4-hydrogen',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-4-neon',
] as const;

// Default to gemini-3.8-flash with active gemini-4-hydrogen fallback.
export const DEFAULT_PRIMARY_MODEL = 'gemini-3.8-flash';
export const FALLBACK_MODEL = 'gemini-4-hydrogen';
const GEMINI_TIMEOUT_MS = 9500;
const BROWSER_FRAME_STALE_MS = Number(process.env.SENTRA_BROWSER_FRAME_STALE_MS || 20000);

let lastWorkingModelState: string | null = null;

export interface ModelConfigValidation {
  valid: boolean;
  rawConfiguredModel: string | null;
  configuredModel: string;
  errorMessage: string | null;
}

const RETIRED_MODEL_PREFIXES = ['gemini-2.5-', 'gemini-2.0-', 'gemini-1.5-', 'gemini-pro'];

export function validateConfiguredModel(): ModelConfigValidation {
  const raw = process.env.SENTRA_GEMINI_MODEL?.trim() || null;
  if (!raw) {
    return {
      valid: true,
      rawConfiguredModel: null,
      configuredModel: DEFAULT_PRIMARY_MODEL,
      errorMessage: null,
    };
  }
  const normalized = raw.replace(/^models\//i, '');
  if ((SUPPORTED_MODELS as readonly string[]).includes(normalized)) {
    return {
      valid: true,
      rawConfiguredModel: raw,
      configuredModel: normalized,
      errorMessage: null,
    };
  }
  if (
    RETIRED_MODEL_PREFIXES.some(
      (prefix) => normalized.toLowerCase() === prefix || normalized.toLowerCase().startsWith(prefix)
    )
  ) {
    return {
      valid: true,
      rawConfiguredModel: raw,
      configuredModel: DEFAULT_PRIMARY_MODEL,
      errorMessage: null,
    };
  }
  return {
    valid: false,
    rawConfiguredModel: raw,
    configuredModel: raw,
    errorMessage: `Configured SENTRA_GEMINI_MODEL "${raw}" is not supported. Supported models: ${SUPPORTED_MODELS.join(', ')}.`,
  };
}

export function getConfiguredModel(): string {
  return validateConfiguredModel().configuredModel;
}

export function getLastWorkingModel(): string | null {
  return lastWorkingModelState;
}

export function isGeminiApiKeyConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function getGeminiClient(): GoogleGenAI | null {
  if (!isGeminiApiKeyConfigured()) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const SYSTEM_INSTRUCTION = `You are SENTRA, a voice-first, spatially grounded assistive companion designed to work alongside a blind or visually impaired user's white cane.

Core pipeline: UNDERSTAND -> OBSERVE -> REASON -> ACT -> VERIFY -> UPDATE.

CRITICAL GROUNDING & SAFETY RULES:
1. NEVER invent, guess, or extrapolate objects, doorways, bus numbers, traffic lights, product names, or clear walkways that are not clearly visible in the provided image. Honesty is safer than guessing.
2. NEVER declare a path or road completely safe to cross or unobstructed. State cautiously what is visible in the current camera frame, note peripheral/left-right areas (9-10 o'clock and 2-3 o'clock) when relevant, and remind the user that hazards outside the frame, quiet approaching vehicles, or below floor level may not be visible.
3. REAL-WORLD MOBILITY PRIORITIES:
   - OVERHEAD & HANGING HAZARDS: Always scan upper/head-level regions of the frame for hanging obstacles (low tree branches, hanging signs, awnings, open cabinet doors, wires, beams, scaffolding). Flag them in hazard with type="low_overhang" and clockPosition.
   - ROADS, TRAFFIC SIGNALS & VEHICLES (INCLUDING SILENT EVs): When viewing a road, intersection, or bus stop, report any visible traffic or pedestrian signal color (ONLY if clearly seen), approaching cars/bikes/autos/electric vehicles/buses with direction and clockPosition (use hazard type="moving_vehicle" when close or approaching), and readable bus numbers, destination boards, or stop signs.
   - SHOPS, SIGNS & FAST QR/DOCUMENT FRAMING: Read visible shop names, bus stop boards, and signage concisely. If a sign, label, or QR code is cropped, tilted, or blurry, immediately give a short camera adjustment in activePerceptionRequest (e.g., "Tilt slightly up" or "Move back one step").
   - SUPERMARKETS & PACKAGED PRODUCTS: When asked to identify a product, read brand, product name, variant/flavor, weight/size, and MRP/expiry date if clearly visible.
4. Distinguish evidence sources explicitly:
   - Current observation: describe only what is directly visible in the attached camera image.
   - Saved contextual memory: when an item is not visible now but exists in SAVED CONTEXTUAL MEMORIES, state clearly that it was saved previously and cannot be confirmed without pointing the camera there. Set foundTarget=false.
   - Uncertainty: if blurry, dark, or unclear, say so honestly and provide a brief re-aiming directive in activePerceptionRequest.
5. General conversational questions (operation="conversation"): answer helpfully and concisely without inventing visual claims about the room.
6. Spoken accessibility style:
   - 1 to 3 short, calm, immediately actionable sentences.
   - No markdown formatting (no asterisks, hashtags, bullet lists, or raw decimal angles).
   - Use relative clock positions ("at 12 o'clock", "at your 2 o'clock") and human-scale distances ("within arm's reach", "a couple of steps ahead").
   - Bounding boxes [ymin, xmin, ymax, xmax] must be integers on 0-1000 scale matching the attached image.
   - If PREFERRED SPOKEN LANGUAGE is specified and is not English, write spokenResponse (and handInstruction / activePerceptionRequest if present) naturally in that requested language while keeping JSON field names, pathStatus, clockPosition labels, and hazard.type in standard English schema values.
7. Tactile reach guidance: ONLY populate reachGuidance when the requested target object is clearly confirmed within arm's reach in the current image.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    spokenResponse: { type: Type.STRING },
    pathStatus: {
      type: Type.STRING,
      description:
        'One of: unknown, observation_available, possible_obstruction, confirmed_sensor_alert, observation_unavailable',
    },
    sceneDescription: { type: Type.STRING },
    activePerceptionRequest: { type: Type.STRING, nullable: true },
    foundTarget: { type: Type.BOOLEAN },
    suggestedAction: { type: Type.STRING, nullable: true },
    hazard: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        type: { type: Type.STRING },
        severity: { type: Type.STRING },
        description: { type: Type.STRING },
        clockPosition: { type: Type.STRING },
      },
    },
    detectedObjects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          box2d: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          clockPosition: { type: Type.STRING },
          relativeDistance: { type: Type.STRING },
          attributes: { type: Type.ARRAY, items: { type: Type.STRING } },
          isTargetGoal: { type: Type.BOOLEAN },
        },
      },
    },
    reachGuidance: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        active: { type: Type.BOOLEAN },
        targetObject: { type: Type.STRING },
        clockPosition: { type: Type.STRING },
        handInstruction: { type: Type.STRING },
        inArmReach: { type: Type.BOOLEAN },
        relativeDistance: { type: Type.STRING },
      },
    },
    spatialRelations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          relation: { type: Type.STRING },
          object: { type: Type.STRING },
        },
      },
    },
    rememberedData: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        label: { type: Type.STRING },
        note: { type: Type.STRING },
        room: { type: Type.STRING },
      },
    },
    goalUpdate: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        targetObject: { type: Type.STRING },
        state: { type: Type.STRING },
        nextAction: { type: Type.STRING },
      },
    },
  },
  required: ['spokenResponse', 'pathStatus', 'sceneDescription', 'foundTarget', 'detectedObjects'],
};

function resolveOperation(mode: SentraMode, query: string, explicitOp?: SentraOperation): SentraOperation {
  if (explicitOp) return explicitOp;
  const q = query.toLowerCase();
  if (/\b(device|battery|wearable|sensor|esp32|connection) status\b/i.test(q)) {
    return 'device_status';
  }
  if (mode === 'find' || mode === 'navigate') return 'object_query';
  if (mode === 'ask' && !/\b(front|see|around|look|room|ahead|door|table|read|what is this)\b/i.test(q)) {
    return 'conversation';
  }
  return 'scene_analysis';
}

function buildActiveHardwareHazard(device: DeviceLiveState | null): HazardAlert | null {
  if (!device || !device.connected) return null;
  const source = device.sourceMode === 'simulator' ? 'sensor_simulator' : 'sensor_hardware';
  const criticalCm = device.runtimeConfig?.proximityCriticalCm ?? 45;
  if (
    device.capabilities.downwardToF &&
    device.sensors.downwardDistanceMm !== null &&
    device.sensors.downwardDistanceMm > 200
  ) {
    return {
      id: `hw-dropoff-${device.lastSequence ?? Date.now()}`,
      type: 'dropoff',
      severity: 'critical',
      description: `Downward sensor reading ${Math.round(device.sensors.downwardDistanceMm)} mm indicates a possible drop-off.`,
      clockPosition: "12 o'clock",
      source,
      timestamp: device.lastTelemetryAt ?? Date.now(),
    };
  }
  if (
    device.capabilities.forwardToF &&
    device.sensors.forwardDistanceCm !== null &&
    device.sensors.forwardDistanceCm <= criticalCm
  ) {
    return {
      id: `hw-prox-${device.lastSequence ?? Date.now()}`,
      type: 'obstacle',
      severity: 'critical',
      description: `Forward sensor detects an obstacle within ${Math.round(device.sensors.forwardDistanceCm)} cm.`,
      clockPosition: "12 o'clock",
      source,
      timestamp: device.lastTelemetryAt ?? Date.now(),
    };
  }
  return null;
}

function buildTruthfulDegradedResponse(params: {
  operation: SentraOperation;
  errorCode: AnalysisErrorCode;
  errorMessage: string;
  goal?: string | null;
  memory: Array<{ label: string; note: string; room?: string }>;
  hardwareHazard: HazardAlert | null;
  sensorFusion: SensorFusionSummary;
  hasFreshImage: boolean;
  frameTimestamp: number | null;
}): AnalysisResponseData {
  const {
    operation,
    errorCode,
    errorMessage,
    goal,
    memory,
    hardwareHazard,
    sensorFusion,
    hasFreshImage,
    frameTimestamp,
  } = params;

  let spoken = '';
  const pathStatus: PathSafetyStatus = hardwareHazard
    ? 'confirmed_sensor_alert'
    : 'observation_unavailable';

  if (hardwareHazard) {
    spoken = `Caution! ${hardwareHazard.description} Visual AI analysis is currently unavailable.`;
  } else if (errorCode === 'NO_FRESH_IMAGE') {
    const targetMatch = goal
      ? memory.find((m) => m.label.toLowerCase().includes(goal.toLowerCase()))
      : null;
    if (targetMatch) {
      spoken = `No current camera frame is available. I have a previously saved location for ${targetMatch.label} (${targetMatch.note}), but I cannot confirm it is still there without an active camera view.`;
    } else {
      spoken = 'No current visual analysis is available because no active camera frame was received.';
    }
  } else if (errorCode === 'MISSING_API_KEY') {
    spoken = hasFreshImage
      ? 'The camera is active, but AI Visual Analysis is unavailable because Gemini API credentials are not configured on the server.'
      : 'No current AI Visual Analysis is available because Gemini API credentials are not configured on the server.';
  } else if (errorCode === 'UNSUPPORTED_MODEL') {
    spoken = `Configured Gemini model is invalid or unavailable: ${errorMessage}`;
  } else if (errorCode === 'QUOTA_EXHAUSTED') {
    spoken = hasFreshImage
      ? 'The camera is active, but Gemini AI quota has been reached. No visual confirmation can be provided right now.'
      : 'Gemini AI quota has been reached. No current analysis is available.';
  } else if (errorCode === 'PERMISSION_DENIED') {
    spoken = 'Gemini API authentication failed on the server. Verify GEMINI_API_KEY and model access.';
  } else {
    spoken = hasFreshImage
      ? 'The camera is active, but AI Visual Analysis is currently unavailable due to a service error.'
      : 'No current visual analysis is available right now.';
  }

  return {
    ok: false,
    status: errorCode === 'NO_FRESH_IMAGE' || errorCode === 'MISSING_API_KEY' ? 'degraded' : 'error',
    operation,
    errorCode,
    errorMessage,
    text: spoken,
    spokenResponse: spoken,
    detectedObjects: [],
    hazard: hardwareHazard,
    activePerceptionRequest:
      errorCode === 'NO_FRESH_IMAGE' ? 'Start the browser camera or connect a wearable camera stream.' : null,
    foundTarget: false,
    pathStatus,
    sceneDescription: errorMessage,
    spatialRelations: [],
    rememberedData: null,
    goalUpdate: null,
    suggestedAction: null,
    reachGuidance: null,
    modelUsed: null,
    fallbackUsed: false,
    frameTimestamp,
    sensorFusion,
    timestamp: Date.now(),
  };
}

function classifyGeminiError(err: any): { code: AnalysisErrorCode; message: string; retryable: boolean } {
  const status = err?.status || err?.code;
  const msg = String(err?.message || 'Gemini request failed');
  const lower = msg.toLowerCase();
  if (msg === 'TIMEOUT') {
    return { code: 'TIMEOUT', message: 'Gemini analysis timed out.', retryable: true };
  }
  if (status === 429 || msg.includes('RESOURCE_EXHAUSTED') || lower.includes('quota')) {
    return { code: 'QUOTA_EXHAUSTED', message: 'Gemini API quota exhausted (429).', retryable: false };
  }
  if (status === 403 || status === 401 || msg.includes('PERMISSION_DENIED') || lower.includes('api key')) {
    return { code: 'PERMISSION_DENIED', message: 'Gemini API authentication failed (403/401).', retryable: false };
  }
  if (
    status === 404 ||
    lower.includes('not found') ||
    lower.includes('not supported') ||
    lower.includes('unknown model')
  ) {
    return { code: 'UNSUPPORTED_MODEL', message: `Model unavailable or unsupported: ${msg}`, retryable: false };
  }
  if (status >= 500 || lower.includes('fetch') || lower.includes('network') || msg.includes('ECONN')) {
    return { code: 'UPSTREAM_ERROR', message: msg, retryable: true };
  }
  return { code: 'UPSTREAM_ERROR', message: msg, retryable: false };
}

export async function runGeminiDiagnostic(): Promise<GeminiDiagnosticResult> {
  const checkedAt = Date.now();
  const validation = validateConfiguredModel();
  const hasApiKey = isGeminiApiKeyConfigured();

  if (!validation.valid) {
    return {
      ok: false,
      hasApiKey,
      configuredModel: validation.configuredModel,
      rawConfiguredModel: validation.rawConfiguredModel,
      modelConfigValid: false,
      modelConfigError: validation.errorMessage,
      modelUsed: null,
      usedFallback: false,
      apiReachable: false,
      latencyMs: null,
      errorCode: 'UNSUPPORTED_MODEL',
      errorMessage: validation.errorMessage,
      checkedAt,
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      hasApiKey: false,
      configuredModel: validation.configuredModel,
      rawConfiguredModel: validation.rawConfiguredModel,
      modelConfigValid: true,
      modelConfigError: null,
      modelUsed: null,
      usedFallback: false,
      apiReachable: false,
      latencyMs: null,
      errorCode: 'MISSING_API_KEY',
      errorMessage: 'GEMINI_API_KEY is not configured on the server.',
      checkedAt,
    };
  }

  const primary = validation.configuredModel;
  const modelsToProbe = primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
  let primaryFailure: { code: AnalysisErrorCode; message: string } | null = null;
  const startedAt = Date.now();

  for (let i = 0; i < modelsToProbe.length; i++) {
    const candidate = modelsToProbe[i];
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: candidate,
          contents: 'Reply with OK.',
          config: { maxOutputTokens: 8 },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), GEMINI_TIMEOUT_MS)
        ),
      ]);
      const reply = response.text?.trim() || '';
      if (!reply) {
        throw new Error('Model returned an empty diagnostic response.');
      }
      lastWorkingModelState = candidate;
      const usedFallback = i > 0;
      return {
        ok: true,
        hasApiKey: true,
        configuredModel: primary,
        rawConfiguredModel: validation.rawConfiguredModel,
        modelConfigValid: true,
        modelConfigError: null,
        modelUsed: candidate,
        usedFallback,
        apiReachable: true,
        latencyMs: Date.now() - startedAt,
        errorCode: usedFallback ? primaryFailure?.code ?? null : null,
        errorMessage: usedFallback
          ? `Configured model "${primary}" failed (${primaryFailure?.message || 'unavailable'}). Verified fallback model "${candidate}" succeeded.`
          : null,
        checkedAt: Date.now(),
      };
    } catch (err: any) {
      const classified = classifyGeminiError(err);
      if (i === 0) {
        primaryFailure = { code: classified.code, message: classified.message };
        if (classified.code === 'PERMISSION_DENIED') {
          break;
        }
      } else {
        return {
          ok: false,
          hasApiKey: true,
          configuredModel: primary,
          rawConfiguredModel: validation.rawConfiguredModel,
          modelConfigValid: true,
          modelConfigError: null,
          modelUsed: null,
          usedFallback: false,
          apiReachable: false,
          latencyMs: Date.now() - startedAt,
          errorCode: primaryFailure?.code || classified.code,
          errorMessage: `Primary "${primary}": ${primaryFailure?.message || 'failed'}; Fallback "${candidate}": ${classified.message}`,
          checkedAt: Date.now(),
        };
      }
    }
  }

  return {
    ok: false,
    hasApiKey: true,
    configuredModel: primary,
    rawConfiguredModel: validation.rawConfiguredModel,
    modelConfigValid: true,
    modelConfigError: null,
    modelUsed: null,
    usedFallback: false,
    apiReachable: false,
    latencyMs: Date.now() - startedAt,
    errorCode: primaryFailure?.code || 'UPSTREAM_ERROR',
    errorMessage: primaryFailure?.message || 'Gemini diagnostic check failed.',
    checkedAt: Date.now(),
  };
}

export async function runSentraAnalysis(params: {
  mode: SentraMode;
  explicitOperation?: SentraOperation;
  query: string;
  imageDataUrl: string | null;
  imageTimestamp: number | null;
  imageDimensions: { width: number; height: number } | null;
  sensors: string;
  goal: string | null;
  memory: Array<{ label: string; note: string; room?: string; heading?: number | null; source?: string }>;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  heading: number | null;
  wearableDevice: DeviceLiveState | null;
  wearableFrameBuffer: { buffer: Buffer; receivedAt: number; stale: boolean } | null;
  useWearableFrame: boolean;
  language?: string;
  store: SentraEventStore;
}): Promise<AnalysisResponseData> {
  const startTime = Date.now();
  const operation = resolveOperation(params.mode, params.query, params.explicitOperation);
  const sensorFusion = evaluateSensorFusion(params.wearableDevice, startTime);
  const hardwareHazard = buildActiveHardwareHazard(params.wearableDevice);

  // Separate Device Status operation without unnecessary Gemini camera call
  if (operation === 'device_status') {
    const dev = params.wearableDevice;
    let spoken = 'No wearable hardware is currently connected.';
    if (dev && dev.connected) {
      const fwd =
        sensorFusion.forwardStatus === 'valid' && sensorFusion.forwardDistanceCm !== null
          ? `Forward distance reads ${Math.round(sensorFusion.forwardDistanceCm)} centimeters.`
          : `Forward distance sensor is ${sensorFusion.forwardStatus}.`;
      const bat = dev.batteryPercent !== null ? `Battery is at ${Math.round(dev.batteryPercent)} percent.` : '';
      spoken = `${dev.sourceMode === 'simulator' ? 'Simulated device' : 'Wearable device'} ${dev.deviceId} is connected. ${fwd} ${bat}`.trim();
    }
    params.store.insertAnalysisEvent({
      operation,
      mode: params.mode,
      status: 'ok',
      latencyMs: Date.now() - startTime,
      summary: spoken,
    });
    return {
      ok: true,
      status: 'ok',
      operation,
      text: spoken,
      spokenResponse: spoken,
      detectedObjects: [],
      hazard: hardwareHazard,
      activePerceptionRequest: null,
      foundTarget: false,
      pathStatus: hardwareHazard ? 'confirmed_sensor_alert' : 'unknown',
      sceneDescription: spoken,
      spatialRelations: [],
      frameTimestamp: null,
      sensorFusion,
      timestamp: Date.now(),
    };
  }

  // Resolve image evidence cleanly and guard against stale images
  let inlineImagePart: { mimeType: string; data: string } | null = null;
  let frameTimestamp: number | null = params.imageTimestamp;
  let hasFreshImage = false;
  let staleImageRejected = false;

  if (params.useWearableFrame) {
    if (params.wearableFrameBuffer && !params.wearableFrameBuffer.stale) {
      inlineImagePart = {
        mimeType: 'image/jpeg',
        data: params.wearableFrameBuffer.buffer.toString('base64'),
      };
      frameTimestamp = params.wearableFrameBuffer.receivedAt;
      hasFreshImage = true;
    } else if (params.wearableFrameBuffer?.stale) {
      staleImageRejected = true;
    }
  } else if (params.imageDataUrl) {
    const isBrowserFrameStale =
      params.imageTimestamp !== null &&
      Number.isFinite(params.imageTimestamp) &&
      startTime - params.imageTimestamp > BROWSER_FRAME_STALE_MS;
    if (isBrowserFrameStale) {
      staleImageRejected = true;
    } else {
      const decoded = decodeBase64Image(params.imageDataUrl);
      if (decoded.ok) {
        inlineImagePart = {
          mimeType: decoded.mimeType,
          data: decoded.base64Data,
        };
        hasFreshImage = true;
        frameTimestamp = params.imageTimestamp ?? Date.now();
      }
    }
  }

  // Camera-dependent operations MUST NOT be answered as live observations without a fresh frame
  if ((operation === 'scene_analysis' || operation === 'object_query') && !hasFreshImage) {
    const degraded = buildTruthfulDegradedResponse({
      operation,
      errorCode: 'NO_FRESH_IMAGE',
      errorMessage: staleImageRejected
        ? 'Latest camera frame is stale and was excluded from live visual inspection.'
        : 'No current camera frame available for visual inspection.',
      goal: params.goal,
      memory: params.memory,
      hardwareHazard,
      sensorFusion,
      hasFreshImage: false,
      frameTimestamp: null,
    });
    params.store.insertAnalysisEvent({
      operation,
      mode: params.mode,
      status: 'degraded',
      latencyMs: Date.now() - startTime,
      errorCode: 'NO_FRESH_IMAGE',
      summary: degraded.spokenResponse,
    });
    return degraded;
  }

  const modelValidation = validateConfiguredModel();
  if (!modelValidation.valid) {
    const degraded = buildTruthfulDegradedResponse({
      operation,
      errorCode: 'UNSUPPORTED_MODEL',
      errorMessage: modelValidation.errorMessage!,
      goal: params.goal,
      memory: params.memory,
      hardwareHazard,
      sensorFusion,
      hasFreshImage,
      frameTimestamp,
    });
    params.store.insertAnalysisEvent({
      operation,
      mode: params.mode,
      status: 'error',
      model: modelValidation.configuredModel,
      latencyMs: Date.now() - startTime,
      errorCode: 'UNSUPPORTED_MODEL',
      summary: modelValidation.errorMessage!,
      frameTimestamp,
    });
    return degraded;
  }

  const ai = getGeminiClient();
  if (!ai) {
    const degraded = buildTruthfulDegradedResponse({
      operation,
      errorCode: 'MISSING_API_KEY',
      errorMessage: 'GEMINI_API_KEY is not configured on the server.',
      goal: params.goal,
      memory: params.memory,
      hardwareHazard,
      sensorFusion,
      hasFreshImage,
      frameTimestamp,
    });
    params.store.insertAnalysisEvent({
      operation,
      mode: params.mode,
      status: 'degraded',
      latencyMs: Date.now() - startTime,
      errorCode: 'MISSING_API_KEY',
      summary: degraded.spokenResponse,
    });
    return degraded;
  }

  // Construct prompt context
  const lines: string[] = [
    `OPERATION: ${operation}`,
    `MODE: ${params.mode}`,
    `CAMERA EVIDENCE AVAILABLE: ${hasFreshImage ? 'YES' : 'NO'}`,
    `CAMERA PERSPECTIVE: ${params.useWearableFrame ? 'Headband-mounted OV2640 forward-facing camera' : 'Browser camera'}`,
  ];
  if (params.goal) lines.push(`ACTIVE GOAL: "${params.goal}"`);
  if (params.query) lines.push(`USER QUERY: "${params.query}"`);
  if (params.language && !params.language.toLowerCase().startsWith('en')) {
    const langLabels: Record<string, string> = {
      'hi-in': 'Hindi (हिन्दी)',
      'kn-in': 'Kannada (ಕನ್ನಡ)',
      'ta-in': 'Tamil (தமிழ்)',
      'te-in': 'Telugu (తెలుగు)',
      'mr-in': 'Marathi (मराठी)',
      'ml-in': 'Malayalam (മലയാളം)',
    };
    const label = langLabels[params.language.toLowerCase()] || params.language;
    lines.push(`PREFERRED SPOKEN LANGUAGE: ${label}`);
  }
  if (params.sensors) lines.push(`BROWSER SENSORS: ${params.sensors}`);
  if (params.heading != null) lines.push(`HEADING: ${Math.round(params.heading)} deg`);

  if (params.wearableDevice && params.wearableDevice.connected) {
    lines.push(
      `WEARABLE TELEMETRY (${params.wearableDevice.sourceMode}, device=${params.wearableDevice.deviceId}):`
    );
    lines.push(`- Fused Sensor Summary: ${sensorFusion.summaryText}`);
    if (sensorFusion.advisories.length > 0) {
      lines.push(`- Sensor Advisories: ${sensorFusion.advisories.join(' ; ')}`);
    }
  }

  if (params.memory.length > 0) {
    lines.push(`SAVED CONTEXTUAL MEMORIES (${params.memory.length}):`);
    for (const m of params.memory.slice(-8)) {
      lines.push(`- [${m.source || 'historical'}] ${m.label}: ${m.note} (room: ${m.room || 'unknown'})`);
    }
  }

  if (params.history.length > 0) {
    lines.push('RECENT HISTORY:');
    for (const h of params.history.slice(-4)) {
      lines.push(`${h.role === 'user' ? 'User' : 'SENTRA'}: ${h.text}`);
    }
  }

  const parts: any[] = [];
  if (inlineImagePart) {
    parts.push({ inlineData: inlineImagePart });
  }
  parts.push({ text: lines.join('\n') });

  const primaryModel = modelValidation.configuredModel;
  const modelsToTry = primaryModel === FALLBACK_MODEL ? [primaryModel] : [primaryModel, FALLBACK_MODEL];

  let lastError: { code: AnalysisErrorCode; message: string } = {
    code: 'UPSTREAM_ERROR',
    message: 'Gemini request did not succeed.',
  };

  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
    const model = modelsToTry[modelIdx];
    // Up to 2 attempts per model (1 retry only on retryable errors)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA as any,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), GEMINI_TIMEOUT_MS)
          ),
        ]);

        const rawText = response.text?.trim() || '';
        if (!rawText) {
          lastError = { code: 'INVALID_RESPONSE', message: 'Model returned an empty response.' };
          break;
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          const stripped = rawText.replace(/```json|```/g, '').trim();
          parsedJson = JSON.parse(stripped);
        }

        const sanitized = sanitizeGeminiResponse(parsedJson, {
          operation,
          hasFreshImage,
          frameTimestamp,
          imageDimensions: params.imageDimensions,
          hardwareHazard,
        });

        params.store.insertAnalysisEvent({
          operation,
          mode: params.mode,
          status: 'ok',
          model,
          latencyMs: Date.now() - startTime,
          summary: sanitized.spokenResponse.slice(0, 200),
          frameTimestamp,
        });

        lastWorkingModelState = model;
        return {
          ok: true,
          status: 'ok',
          operation,
          text: sanitized.spokenResponse,
          ...sanitized,
          modelUsed: model,
          fallbackUsed: modelIdx > 0,
          frameTimestamp,
          sensorFusion,
          timestamp: Date.now(),
        };
      } catch (err: any) {
        const classified = classifyGeminiError(err);
        lastError = { code: classified.code, message: classified.message };
        if (!classified.retryable || attempt === 1) {
          // Stop retrying auth/quota errors immediately across models if permission denied
          if (classified.code === 'PERMISSION_DENIED') {
            break;
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    if (lastError.code === 'PERMISSION_DENIED') break;
  }

  const degraded = buildTruthfulDegradedResponse({
    operation,
    errorCode: lastError.code,
    errorMessage: lastError.message,
    goal: params.goal,
    memory: params.memory,
    hardwareHazard,
    sensorFusion,
    hasFreshImage,
    frameTimestamp,
  });

  params.store.insertAnalysisEvent({
    operation,
    mode: params.mode,
    status: 'error',
    model: primaryModel,
    latencyMs: Date.now() - startTime,
    errorCode: lastError.code,
    summary: lastError.message,
    frameTimestamp,
  });

  return degraded;
}
