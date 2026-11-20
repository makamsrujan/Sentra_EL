import type { CameraSourceType, PathSafetyStatus } from './deviceProtocol';

export type SentraMode = 'describe' | 'find' | 'read' | 'remember' | 'ask' | 'navigate';

export type SentraOperation =
  | 'conversation'
  | 'scene_analysis'
  | 'object_query'
  | 'memory_retrieval'
  | 'device_status';

export type SentraSection =
  | 'assistant'
  | 'vision'
  | 'finder'
  | 'spatial'
  | 'memory'
  | 'device'
  | 'settings';

export type GoalStatus =
  | 'idle'
  | 'active'
  | 'need_observation'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type VerificationStepOutcome =
  | 'success'
  | 'attempted'
  | 'pending'
  | 're_aim_needed'
  | 'inconclusive';

export type VerificationActionCategory = 'completed' | 'active' | 'attempted';

export interface VerificationStep {
  id: string;
  timestamp: number;
  stepName: string;
  note: string;
  state: GoalStatus;
  outcome: VerificationStepOutcome;
  actionCategory?: VerificationActionCategory;
  heading?: number | null;
  clockPosition?: string;
  confidence?: number;
  sensorSummary?: string;
}

export interface GoalTask {
  id: string;
  intent: string;
  targetObject?: string;
  state: GoalStatus;
  requiredObservation?: string | null;
  nextSafeAction?: string | null;
  verificationConditions?: string[];
  confidence: number | null;
  createdAt: number;
  updatedAt: number;
  history: Array<{ timestamp: number; note: string; state: GoalStatus }>;
  verificationSteps: VerificationStep[];
}

export interface DetectedObject {
  id: string;
  label: string;
  confidence: number; // 0 to 1
  box2d?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000 relative to inference image
  clockPosition: string;
  relativeDistance: 'arm_reach' | 'near' | 'mid' | 'far';
  attributes?: string[];
  isTargetGoal?: boolean;
  frameTimestamp?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface HazardAlert {
  id: string;
  type:
    | 'dropoff'
    | 'stairs_down'
    | 'tripping'
    | 'low_overhang'
    | 'hot_surface'
    | 'obstacle'
    | 'moving_vehicle';
  severity: 'caution' | 'critical';
  description: string;
  clockPosition: string;
  source?: 'sensor_hardware' | 'sensor_simulator' | 'vision_ai';
  estimatedDistMeters?: number;
  timestamp?: number;
}

export interface SpatialLandmark {
  id: string;
  name: string;
  heading: number; // 0-359 compass degrees
  distanceEst: string;
  room: string;
  lastSeenAt: number;
  verified: boolean;
}

export interface SpatialRelationship {
  id: string;
  subject: string;
  relation: 'on' | 'next_to' | 'under' | 'near' | 'left_of' | 'right_of' | 'inside' | 'in_front_of' | 'leads_to';
  object: string;
  timestamp: number;
  verifiedLive: boolean;
}

export interface SentraMemoryItem {
  id: string;
  label: string;
  note: string;
  at: string;
  timestamp: number;
  heading?: number | null;
  room?: string;
  source: 'live_verified' | 'remembered_historical' | 'user_manual';
}

export interface SentraStats {
  calls: number;
  totalMs: number;
  hazards: number;
  findsStarted: number;
  findsDone: number;
}

export interface FrameQuality {
  brightness: number; // 0 to 1
  sharpness: number; // Laplacian variance
}

export interface ParsedVoiceIntent {
  mode: SentraMode;
  operation: SentraOperation;
  goal?: string;
  query: string;
}

export interface SentraSettings {
  speechRate: number;
  audioFeedback: boolean;
  voiceMuted: boolean;
  voiceVolume: number;
  wakeWordEnabled: boolean;
  cameraFacing: 'environment' | 'user';
  selectedCameraDeviceId: string | null;
  cameraSource: CameraSourceType;
  selectedWearableDeviceId: string;
  autoContinuousFind: boolean;
  continuousWatchMode: boolean;
  reachGuidanceEnabled: boolean;
  language?: string;
}

export interface ReachGuidance {
  active: boolean;
  targetObject: string;
  clockPosition: string;
  handInstruction: string;
  inArmReach: boolean;
  relativeDistance: 'arm_reach' | 'near' | 'mid' | 'far';
}

export type AnalysisErrorCode =
  | 'MISSING_API_KEY'
  | 'UNSUPPORTED_MODEL'
  | 'QUOTA_EXHAUSTED'
  | 'PERMISSION_DENIED'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'NO_FRESH_IMAGE'
  | 'INVALID_RESPONSE';

export interface AnalysisResponseData {
  ok: boolean;
  status: 'ok' | 'degraded' | 'error';
  operation: SentraOperation;
  errorCode?: AnalysisErrorCode | null;
  errorMessage?: string | null;
  text: string;
  spokenResponse: string;
  detectedObjects: DetectedObject[];
  hazard: HazardAlert | null;
  activePerceptionRequest: string | null;
  foundTarget: boolean;
  pathStatus: PathSafetyStatus;
  sceneDescription: string;
  spatialRelations: Array<{ subject: string; relation: string; object: string }>;
  rememberedData?: { label: string; note: string; room?: string } | null;
  suggestedAction?: string | null;
  reachGuidance?: ReachGuidance | null;
  goalUpdate?: {
    targetObject: string;
    state: GoalStatus;
    nextAction?: string;
  } | null;
  modelUsed?: string | null;
  fallbackUsed?: boolean;
  frameTimestamp?: number | null;
  sensorFusion?: import('./deviceProtocol').SensorFusionSummary | null;
  timestamp: number;
}

export interface GeminiDiagnosticResult {
  ok: boolean;
  hasApiKey: boolean;
  configuredModel: string;
  rawConfiguredModel: string | null;
  modelConfigValid: boolean;
  modelConfigError: string | null;
  modelUsed: string | null;
  usedFallback: boolean;
  apiReachable: boolean;
  latencyMs: number | null;
  errorCode: AnalysisErrorCode | null;
  errorMessage: string | null;
  checkedAt: number;
}

export interface SystemHealthStatus {
  status: 'ok' | 'degraded';
  name: string;
  databaseAvailable: boolean;
  databaseError?: string | null;
  hasApiKey: boolean;
  configuredModel: string;
  rawConfiguredModel: string | null;
  modelConfigValid: boolean;
  modelConfigError: string | null;
  supportedModels: string[];
  liveModel?: string;
  lastWorkingModel: string | null;
  operatorAuthConfigured: boolean;
  simulatorEnabled: boolean;
  deviceAuthRequired: boolean;
  heartbeatTimeoutMs: number;
  wearableConnected: boolean;
  wearableSourceMode: 'hardware' | 'simulator' | 'disconnected';
  lastTelemetryAgeMs: number | null;
  lastFrameAgeMs: number | null;
}
