export type SentraMode = 'describe' | 'find' | 'read' | 'remember' | 'ask' | 'navigate';

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

export interface VerificationStep {
  id: string;
  timestamp: number;
  stepName: string;
  note: string;
  state: GoalStatus;
  outcome: VerificationStepOutcome;
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
  confidence: number; // 0 to 1
  createdAt: number;
  updatedAt: number;
  history: Array<{ timestamp: number; note: string; state: GoalStatus }>;
  verificationSteps: VerificationStep[];
}

export interface BoundingBox2D {
  ymin: number; // 0 to 1000
  xmin: number; // 0 to 1000
  ymax: number; // 0 to 1000
  xmax: number; // 0 to 1000
}

export interface DetectedObject {
  id: string;
  label: string;
  confidence: number; // 0 to 1
  box2d?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  clockPosition: string; // e.g. "1 o'clock", "12 o'clock", "9 o'clock"
  relativeDistance: 'arm_reach' | 'near' | 'mid' | 'far';
  attributes?: string[];
  isTargetGoal?: boolean;
  trackedSince?: number;
}

export interface HazardAlert {
  id: string;
  type: 'dropoff' | 'stairs_down' | 'tripping' | 'low_overhang' | 'hot_surface' | 'obstacle' | 'moving_vehicle';
  severity: 'caution' | 'critical';
  description: string;
  clockPosition: string;
  estimatedDistMeters?: number;
}

export interface SpatialLandmark {
  id: string;
  name: string;
  heading: number; // 0-359 compass degrees
  distanceEst: string; // e.g. "3 steps ahead", "arm's reach"
  room: string;
  lastSeenAt: number;
  verified: boolean;
}

export interface SpatialRelationship {
  id: string;
  subject: string;
  relation: 'on' | 'next_to' | 'under' | 'near' | 'left_of' | 'right_of' | 'inside';
  object: string;
  timestamp: number;
  verifiedLive: boolean;
}

export interface SpatialWorldModel {
  currentRoom: string;
  rooms: string[];
  compassHeading: number | null;
  motionState: 'still' | 'moving' | 'turning';
  landmarks: SpatialLandmark[];
  relationships: SpatialRelationship[];
  pathIsClear: boolean;
  lastObservationTimestamp: number;
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
  spatialRelationship?: string;
}

export interface SentraStats {
  calls: number;
  totalMs: number;
  hazards: number;
  findsStarted: number;
  findsDone: number;
  findMs: number;
  retakes: number;
}

export interface FrameQuality {
  brightness: number; // 0 to 1
  sharpness: number;  // Laplacian variance
}

export interface ParsedVoiceIntent {
  mode: SentraMode;
  goal?: string;
  query: string;
  contextNeeds?: 'new_observation' | 'confirmation' | 'direct_answer';
}

export interface SentraSettings {
  speechRate: number;
  audioFeedback: boolean;
  hapticFeedback: boolean;
  cameraFacing: 'environment' | 'user';
  autoContinuousFind: boolean;
  wakeWordEnabled: boolean; // "Hey SENTRA" activation
  selectedInputSource: 'browser_camera' | 'esp32_wearable';
}

// Round 3 Hardware Specification for ESP32-S3 Wearable
export interface WearableTelemetry {
  deviceId: string;
  connected: boolean;
  isSimulated: boolean;
  lastHeartbeat: number;
  batteryLevel: number; // 0-100%
  batteryCharging: boolean;
  forwardToFDistanceCm: number; // ToF forward distance sensor (0-400cm)
  downwardCliffSensorMm: number; // Ground drop-off / stairs sensor (0-1000mm)
  imu: {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
    heading: number;
  };
  headPitchAngle: number; // -90 (looking down) to +90 (looking up)
  earphoneConnected: boolean;
  audioVolume: number;
}

export interface AnalysisResponseData {
  ok: boolean;
  text: string;
  spokenResponse?: string;
  detectedObjects?: DetectedObject[];
  hazard?: HazardAlert | null;
  activePerceptionRequest?: string | null;
  foundTarget?: boolean;
  spatialRelations?: Array<{ subject: string; relation: string; object: string }>;
  suggestedAction?: string;
  quotaExhausted?: boolean;
  simulated?: boolean;
  timestamp?: number;
}
