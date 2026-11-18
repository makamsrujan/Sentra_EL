import { z } from 'zod';
import type { PathSafetyStatus, TelemetryPayloadV1 } from '../src/types/deviceProtocol';
import type { DetectedObject, HazardAlert, SentraOperation } from '../src/types/sentra';

export const MAX_FRAME_BYTES = 5 * 1024 * 1024; // 5 MB

const finiteNullableNumber = (min: number, max: number) =>
  z
    .number()
    .refine((n) => Number.isFinite(n) && n >= min && n <= max, {
      message: `Must be finite number between ${min} and ${max}`,
    })
    .nullable()
    .optional();

export const CapabilitiesSchema = z.object({
  camera: z.boolean().default(false),
  forwardToF: z.boolean().default(false),
  downwardToF: z.boolean().default(false),
  imu: z.boolean().default(false),
  audioOutput: z.boolean().default(false),
});

export const ImuSchema = z.object({
  ax: z.number().finite().min(-100).max(100),
  ay: z.number().finite().min(-100).max(100),
  az: z.number().finite().min(-100).max(100),
  gx: z.number().finite().min(-2000).max(2000),
  gy: z.number().finite().min(-2000).max(2000),
  gz: z.number().finite().min(-2000).max(2000),
  heading: z.number().finite().min(0).max(360).nullable(),
});

export const TelemetryPayloadV1Schema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/),
  sequence: z.number().int().min(0),
  uptimeMs: z.number().finite().min(0).max(365 * 24 * 3600 * 1000),
  batteryPercent: finiteNullableNumber(0, 100),
  batteryCharging: z.boolean().nullable().optional(),
  earphoneConnected: z.boolean().nullable().optional(),
  audioVolume: finiteNullableNumber(0, 100),
  sensors: z.object({
    // Valid VL53L0X/ToF range: 2..400 cm; 0 is treated as invalid/unavailable later
    forwardDistanceCm: finiteNullableNumber(0, 1000),
    downwardDistanceMm: finiteNullableNumber(0, 5000),
    headPitchDeg: finiteNullableNumber(-90, 90),
    imu: ImuSchema.nullable(),
  }),
  capabilities: CapabilitiesSchema,
});

// Explicit adapter schema for legacy firmware packets (no unsafe merging)
export const LegacyTelemetrySchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  sequence: z.number().int().min(0).optional(),
  uptimeMs: z.number().finite().min(0).optional(),
  batteryLevel: finiteNullableNumber(0, 100),
  batteryCharging: z.boolean().nullable().optional(),
  forwardToFDistanceCm: finiteNullableNumber(0, 1000),
  downwardCliffSensorMm: finiteNullableNumber(0, 5000),
  headPitchAngle: finiteNullableNumber(-90, 90),
  earphoneConnected: z.boolean().nullable().optional(),
  audioVolume: finiteNullableNumber(0, 100),
  imu: z
    .object({
      ax: z.number().finite(),
      ay: z.number().finite(),
      az: z.number().finite(),
      gx: z.number().finite(),
      gy: z.number().finite(),
      gz: z.number().finite(),
      heading: z.number().finite().min(0).max(360).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type AdaptedTelemetryResult =
  | {
      ok: true;
      payload: TelemetryPayloadV1;
      isLegacyAdapted: boolean;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Normalizes zero/out-of-spec sensor values so an uninitialized 0 reading
 * is never mistaken for confirmed free space or zero proximity.
 */
function sanitizeDistanceReading(val: number | null | undefined, minValid: number, maxValid: number): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  if (val <= 0 || val < minValid || val > maxValid) return null;
  return val;
}

export function parseAndAdaptTelemetry(
  rawBody: unknown,
  fallbackSequence = 0,
  defaultDeviceId = 'ESP32-S3-SENTRA-001'
): AdaptedTelemetryResult {
  if (!rawBody || typeof rawBody !== 'object') {
    return { ok: false, error: 'Telemetry body must be a JSON object.' };
  }

  const record = rawBody as Record<string, unknown>;

  if (record.schemaVersion === 1) {
    const parsed = TelemetryPayloadV1Schema.safeParse(record);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }

    const d = parsed.data;
    const forwardCm = d.capabilities.forwardToF
      ? sanitizeDistanceReading(d.sensors.forwardDistanceCm, 2, 400)
      : null;
    const downwardMm = d.capabilities.downwardToF
      ? sanitizeDistanceReading(d.sensors.downwardDistanceMm, 10, 2000)
      : null;

    return {
      ok: true,
      isLegacyAdapted: false,
      payload: {
        schemaVersion: 1,
        deviceId: d.deviceId,
        sequence: d.sequence,
        uptimeMs: d.uptimeMs,
        batteryPercent: d.batteryPercent ?? null,
        batteryCharging: d.batteryCharging ?? null,
        earphoneConnected: d.capabilities.audioOutput ? (d.earphoneConnected ?? null) : null,
        audioVolume: d.capabilities.audioOutput ? (d.audioVolume ?? null) : null,
        sensors: {
          forwardDistanceCm: forwardCm,
          downwardDistanceMm: downwardMm,
          headPitchDeg: d.sensors.headPitchDeg ?? null,
          imu: d.capabilities.imu ? d.sensors.imu : null,
        },
        capabilities: d.capabilities,
      },
    };
  }

  // Legacy adapter path (rejects arbitrary extra fields & invalid numbers)
  const legacyParsed = LegacyTelemetrySchema.safeParse(record);
  if (!legacyParsed.success) {
    return {
      ok: false,
      error: legacyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  const l = legacyParsed.data;
  const forwardCm = sanitizeDistanceReading(l.forwardToFDistanceCm, 2, 400);
  const downwardMm = sanitizeDistanceReading(l.downwardCliffSensorMm, 10, 2000);
  const hasImu = Boolean(l.imu);

  return {
    ok: true,
    isLegacyAdapted: true,
    payload: {
      schemaVersion: 1,
      deviceId: l.deviceId || defaultDeviceId,
      sequence: l.sequence ?? fallbackSequence,
      uptimeMs: l.uptimeMs ?? 0,
      batteryPercent: l.batteryLevel ?? null,
      batteryCharging: l.batteryCharging ?? null,
      earphoneConnected: l.earphoneConnected ?? null,
      audioVolume: l.audioVolume ?? null,
      sensors: {
        forwardDistanceCm: forwardCm,
        downwardDistanceMm: downwardMm,
        headPitchDeg: l.headPitchAngle ?? null,
        imu: l.imu
          ? {
              ...l.imu,
              heading: l.imu.heading ?? null,
            }
          : null,
      },
      capabilities: {
        camera: false,
        forwardToF: forwardCm !== null,
        downwardToF: downwardMm !== null,
        imu: hasImu,
        audioOutput: l.earphoneConnected !== undefined && l.earphoneConnected !== null,
      },
    },
  };
}

export const DeviceRegistrationSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Device ID may only contain letters, digits, dot, underscore, or hyphen.'),
  name: z.string().trim().min(1).max(80),
  capabilities: CapabilitiesSchema.default({
    camera: true,
    forwardToF: true,
    downwardToF: false,
    imu: false,
    audioOutput: false,
  }),
});

export const AckActionsSchema = z.object({
  deviceId: z.string().trim().min(2).max(64),
  actionIds: z.array(z.string().min(1).max(128)).min(1).max(50),
});

export const MemoryCreateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  note: z.string().trim().min(1).max(500),
  room: z.string().trim().max(80).optional(),
  heading: z.number().finite().min(0).max(360).nullable().optional(),
  source: z.enum(['live_verified', 'remembered_historical', 'user_manual']).default('user_manual'),
});

export const AnalyzeRequestSchema = z.object({
  mode: z.enum(['describe', 'find', 'read', 'remember', 'ask', 'navigate']).default('describe'),
  operation: z
    .enum(['conversation', 'scene_analysis', 'object_query', 'memory_retrieval', 'device_status'])
    .optional(),
  query: z.string().max(1000).default(''),
  image: z.string().nullable().optional(),
  imageTimestamp: z.number().finite().nullable().optional(),
  imageDimensions: z
    .object({
      width: z.number().int().positive().max(8192),
      height: z.number().int().positive().max(8192),
    })
    .nullable()
    .optional(),
  sensors: z.string().max(500).default(''),
  goal: z.string().max(200).nullable().optional(),
  memory: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().max(150),
        note: z.string().max(500),
        room: z.string().max(80).optional(),
        heading: z.number().finite().nullable().optional(),
        source: z.string().optional(),
        timestamp: z.number().optional(),
      })
    )
    .max(50)
    .default([]),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(1000),
      })
    )
    .max(20)
    .default([]),
  heading: z.number().finite().nullable().optional(),
  useWearableFrame: z.boolean().default(false),
  wearableDeviceId: z.string().max(64).optional(),
});

/**
 * Validates that a Buffer or Data URL is a genuine JPEG image within size bounds.
 */
export function validateJpegBuffer(buffer: Buffer): { ok: true; buffer: Buffer } | { ok: false; error: string } {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { ok: false, error: 'Image buffer is empty or too small to be a valid JPEG.' };
  }
  if (buffer.length > MAX_FRAME_BYTES) {
    return { ok: false, error: `Frame exceeds maximum allowed size (${MAX_FRAME_BYTES} bytes).` };
  }
  // JPEG SOI marker: 0xFF 0xD8 0xFF
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    return { ok: false, error: 'Invalid JPEG header signature (expected SOI bytes FF D8 FF).' };
  }
  return { ok: true, buffer };
}

export function decodeBase64Image(
  dataUrl: string,
  allowedMimeTypes: string[] = ['image/jpeg', 'image/png', 'image/webp']
): { ok: true; mimeType: string; base64Data: string; buffer: Buffer } | { ok: false; error: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return { ok: false, error: 'Malformed base64 image data URL.' };
  }
  const mimeType = match[1].toLowerCase();
  if (!allowedMimeTypes.includes(mimeType)) {
    return { ok: false, error: `Unsupported image MIME type: ${mimeType}` };
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_FRAME_BYTES) {
    return { ok: false, error: 'Decoded image exceeds size limits or is empty.' };
  }
  if (mimeType === 'image/jpeg') {
    const jpegCheck = validateJpegBuffer(buffer);
    if (!jpegCheck.ok) return jpegCheck;
  }
  return { ok: true, mimeType, base64Data: match[2], buffer };
}

export function clampBox2d(rawBox: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return undefined;
  const nums = rawBox.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;

  const ymin = Math.max(0, Math.min(1000, Math.round(nums[0])));
  const xmin = Math.max(0, Math.min(1000, Math.round(nums[1])));
  const ymax = Math.max(0, Math.min(1000, Math.round(nums[2])));
  const xmax = Math.max(0, Math.min(1000, Math.round(nums[3])));

  if (ymax <= ymin + 4 || xmax <= xmin + 4) return undefined;
  return [ymin, xmin, ymax, xmax];
}

const VALID_PATH_STATUSES: PathSafetyStatus[] = [
  'unknown',
  'observation_available',
  'possible_obstruction',
  'confirmed_sensor_alert',
  'observation_unavailable',
];

export function sanitizeGeminiResponse(
  rawObj: any,
  context: {
    operation: SentraOperation;
    hasFreshImage: boolean;
    frameTimestamp: number | null;
    imageDimensions: { width: number; height: number } | null;
    hardwareHazard: HazardAlert | null;
  }
) {
  let spokenResponse =
    typeof rawObj?.spokenResponse === 'string' && rawObj.spokenResponse.trim()
      ? rawObj.spokenResponse.trim()
      : 'Analysis completed, but no spoken summary was returned.';

  const detectedObjects: DetectedObject[] = [];
  if (context.hasFreshImage && Array.isArray(rawObj?.detectedObjects)) {
    rawObj.detectedObjects.forEach((item: any, idx: number) => {
      if (!item || typeof item.label !== 'string' || !item.label.trim()) return;
      const box2d = clampBox2d(item.box2d);
      const confidence =
        typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5;
      const validDist = ['arm_reach', 'near', 'mid', 'far'].includes(item.relativeDistance)
        ? item.relativeDistance
        : 'near';

      detectedObjects.push({
        id: `det-${Date.now()}-${idx}`,
        label: item.label.trim().slice(0, 60),
        confidence,
        box2d,
        clockPosition:
          typeof item.clockPosition === 'string' && item.clockPosition.trim()
            ? item.clockPosition.trim().slice(0, 30)
            : "12 o'clock",
        relativeDistance: validDist,
        attributes: Array.isArray(item.attributes)
          ? item.attributes.filter((a: unknown) => typeof a === 'string').slice(0, 5)
          : undefined,
        isTargetGoal: Boolean(item.isTargetGoal),
        frameTimestamp: context.frameTimestamp ?? undefined,
        sourceWidth: context.imageDimensions?.width,
        sourceHeight: context.imageDimensions?.height,
      });
    });
  }

  let pathStatus: PathSafetyStatus = VALID_PATH_STATUSES.includes(rawObj?.pathStatus)
    ? rawObj.pathStatus
    : context.hasFreshImage
    ? 'observation_available'
    : 'observation_unavailable';

  // Never allow Gemini output to claim safety or downgrade a real hardware hazard
  let hazard: HazardAlert | null = null;
  if (context.hardwareHazard) {
    hazard = context.hardwareHazard;
    pathStatus = 'confirmed_sensor_alert';
    spokenResponse = `Stop. ${context.hardwareHazard.description}`;
  } else if (context.hasFreshImage && rawObj?.hazard && typeof rawObj.hazard.description === 'string') {
    const validType = [
      'dropoff',
      'stairs_down',
      'tripping',
      'low_overhang',
      'hot_surface',
      'obstacle',
      'moving_vehicle',
    ].includes(rawObj.hazard.type)
      ? rawObj.hazard.type
      : 'obstacle';
    hazard = {
      id: `haz-${Date.now()}`,
      type: validType,
      severity: rawObj.hazard.severity === 'critical' ? 'critical' : 'caution',
      description: rawObj.hazard.description.trim().slice(0, 180),
      clockPosition:
        typeof rawObj.hazard.clockPosition === 'string' ? rawObj.hazard.clockPosition.trim() : "12 o'clock",
      source: 'vision_ai',
      timestamp: Date.now(),
    };
    pathStatus = 'possible_obstruction';
  }

  // Strictly prevent claiming target found without live camera evidence
  const foundTarget = context.hasFreshImage ? Boolean(rawObj?.foundTarget) : false;

  const spatialRelations =
    context.hasFreshImage && Array.isArray(rawObj?.spatialRelations)
      ? rawObj.spatialRelations
          .filter(
            (r: any) =>
              r &&
              typeof r.subject === 'string' &&
              typeof r.relation === 'string' &&
              typeof r.object === 'string'
          )
          .slice(0, 12)
      : [];

  const reachGuidance =
    context.hasFreshImage &&
    rawObj?.reachGuidance &&
    rawObj.reachGuidance.active &&
    typeof rawObj.reachGuidance.handInstruction === 'string'
      ? {
          active: true,
          targetObject: String(rawObj.reachGuidance.targetObject || ''),
          clockPosition: String(rawObj.reachGuidance.clockPosition || "12 o'clock"),
          handInstruction: String(rawObj.reachGuidance.handInstruction),
          inArmReach: Boolean(rawObj.reachGuidance.inArmReach),
          relativeDistance: (['arm_reach', 'near', 'mid', 'far'].includes(
            rawObj.reachGuidance.relativeDistance
          )
            ? rawObj.reachGuidance.relativeDistance
            : 'near') as 'arm_reach' | 'near' | 'mid' | 'far',
        }
      : null;

  return {
    spokenResponse,
    detectedObjects,
    hazard,
    pathStatus,
    sceneDescription:
      typeof rawObj?.sceneDescription === 'string'
        ? rawObj.sceneDescription.trim()
        : context.hasFreshImage
        ? 'Visual observation processed.'
        : 'No current camera frame provided.',
    activePerceptionRequest:
      typeof rawObj?.activePerceptionRequest === 'string' && rawObj.activePerceptionRequest.trim()
        ? rawObj.activePerceptionRequest.trim()
        : null,
    foundTarget,
    reachGuidance,
    spatialRelations,
    rememberedData:
      rawObj?.rememberedData &&
      typeof rawObj.rememberedData.label === 'string' &&
      typeof rawObj.rememberedData.note === 'string'
        ? {
            label: rawObj.rememberedData.label.trim().slice(0, 100),
            note: rawObj.rememberedData.note.trim().slice(0, 300),
            room:
              typeof rawObj.rememberedData.room === 'string'
                ? rawObj.rememberedData.room.trim().slice(0, 80)
                : undefined,
          }
        : null,
    goalUpdate:
      rawObj?.goalUpdate && typeof rawObj.goalUpdate.targetObject === 'string'
        ? {
            targetObject: rawObj.goalUpdate.targetObject.trim(),
            state: foundTarget
              ? ('completed' as const)
              : (['active', 'need_observation', 'verifying', 'cancelled'].includes(
                  rawObj.goalUpdate.state
                )
                  ? rawObj.goalUpdate.state
                  : 'active'),
            nextAction:
              typeof rawObj.goalUpdate.nextAction === 'string' ? rawObj.goalUpdate.nextAction : undefined,
          }
        : null,
    suggestedAction:
      typeof rawObj?.suggestedAction === 'string' ? rawObj.suggestedAction.trim() : null,
  };
}
