export type CameraSourceType = 'browser_camera' | 'esp32_camera' | 'none';

export type DeviceSourceMode = 'hardware' | 'simulator' | 'disconnected';

export type AudioHardwareState =
  | 'STANDBY'
  | 'RECORDING'
  | 'TRANSCRIBING'
  | 'REASONING'
  | 'SPEECH_GENERATION'
  | 'PLAYBACK'
  | 'ERROR'
  | 'CANCELLED'
  | 'DISCONNECTED';

export type AudioOwnershipMode = 'browser' | 'wearable' | 'test';

export interface AudioUtteranceResponse {
  ok: boolean;
  turnId?: string;
  deviceId: string;
  sequence: number;
  durationMs?: number;
  status: 'processing' | 'completed' | 'ignored_no_wake' | 'silent' | 'failed';
  wakeDetected?: boolean;
  transcript?: string;
  reasoning?: string;
  audioReplyId?: string | null;
  error?: string;
}

export interface AudioReplyMetadata {
  replyId: string;
  deviceId: string;
  mimeType: 'audio/wav';
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
  sizeBytes: number;
  createdAt: number;
  expiresAt: number;
}

export interface AudioStatusResponse {
  ok: boolean;
  codec: {
    name: string;
    inputFormat: string;
    outputFormat: string;
    sampleRate: number;
    channels: number;
  };
  sttConfigured: boolean;
  sttModel: string;
  ttsConfigured: boolean;
  ttsModel: string;
  activeRepliesCount: number;
  lastTurnLatencyMs: number | null;
  lastTurnStatus: string | null;
  ownershipMode: AudioOwnershipMode;
}

export type PathSafetyStatus =
  | 'unknown'
  | 'observation_available'
  | 'possible_obstruction'
  | 'confirmed_sensor_alert'
  | 'observation_unavailable';

export interface DeviceCapabilities {
  camera: boolean;
  forwardToF: boolean;
  downwardToF: boolean;
  imu: boolean;
  audioOutput: boolean;
  vl53l5cx?: boolean;
}

export type SensorReadingStatus = 'valid' | 'invalid' | 'stale' | 'unavailable';

export interface SensorHealthReport {
  forwardToF: SensorReadingStatus;
  downwardToF: SensorReadingStatus;
  imu: SensorReadingStatus;
  imuCalibrated: boolean;
  camera: SensorReadingStatus;
  vl53l5cx: SensorReadingStatus;
  wm8960: SensorReadingStatus;
}

export interface ImuReading {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  heading: number | null;
  calibrated?: boolean;
  motionMagnitude?: number | null;
}

export interface Vl53l5cxZoneReading {
  available: boolean;
  validZones: number;
  minDistanceMm: number | null;
}

export interface TelemetryPayloadV1 {
  schemaVersion: 1;
  deviceId: string;
  sequence: number;
  uptimeMs: number;
  firmwareVersion?: string | null;
  batteryPercent: number | null;
  batteryVoltageV?: number | null;
  batteryCharging?: boolean | null;
  earphoneConnected?: boolean | null;
  audioVolume?: number | null;
  audioState?: AudioHardwareState | null;
  audioOwnership?: AudioOwnershipMode | null;
  sensors: {
    forwardDistanceCm: number | null;
    downwardDistanceMm: number | null;
    headPitchDeg?: number | null;
    imu: ImuReading | null;
    vl53l5cx?: Vl53l5cxZoneReading | null;
  };
  sensorHealth?: Partial<SensorHealthReport>;
  diagnostics?: string | null;
  capabilities: DeviceCapabilities;
}

export interface DeviceRuntimeConfig {
  tofSampleIntervalMs: number;
  imuSampleIntervalMs: number;
  frameUploadIntervalMs: number;
  jpegQuality: number;
  frameSize: 'QVGA' | 'VGA' | 'SVGA';
  proximityCautionCm: number;
  proximityCriticalCm: number;
  sensorStaleMs: number;
  alertCooldownMs: number;
}

export type DeviceCommandType =
  | 'CAPTURE_FRAME'
  | 'REQUEST_OBSERVATION'
  | 'RECALIBRATE_IMU'
  | 'CONFIG_UPDATE'
  | 'SPEAK_ALERT';

export interface DeviceLiveState {
  deviceId: string;
  name: string;
  firmwareVersion: string | null;
  sourceMode: DeviceSourceMode;
  connected: boolean;
  lastHeartbeatAt: number | null;
  lastTelemetryAt: number | null;
  lastSequence: number | null;
  uptimeMs: number | null;
  batteryPercent: number | null;
  batteryVoltageV: number | null;
  batteryCharging: boolean | null;
  earphoneConnected: boolean | null;
  audioVolume: number | null;
  audioState?: AudioHardwareState | null;
  audioOwnership?: AudioOwnershipMode | null;
  sensors: {
    forwardDistanceCm: number | null;
    downwardDistanceMm: number | null;
    headPitchDeg: number | null;
    imu: ImuReading | null;
    vl53l5cx: Vl53l5cxZoneReading | null;
  };
  sensorHealth: SensorHealthReport;
  diagnostics: string | null;
  capabilities: DeviceCapabilities;
  runtimeConfig: DeviceRuntimeConfig;
  frameAvailable: boolean;
  frameSequence: number | null;
  frameTimestamp: number | null;
  frameAgeMs: number | null;
  frameStale: boolean;
  frameFormat: string | null;
  pendingActionsCount: number;
}

export interface WearableFrameStatus {
  ok: boolean;
  deviceId: string;
  frameAvailable: boolean;
  sequence: number | null;
  lastReceivedTimestamp: number | null;
  frameAgeMs: number | null;
  stale: boolean;
  imageFormat: string | null;
  sizeBytes: number | null;
  connectionStatus: DeviceSourceMode;
}

export interface WearableActionItem {
  id: string;
  deviceId: string;
  type:
    | 'speech'
    | 'proximity_alert'
    | 'active_perception'
    | 'capture_frame'
    | 'recalibrate_imu'
    | 'config_update';
  text: string;
  priority: 'normal' | 'critical';
  createdAt: number;
  acknowledgedAt: number | null;
  payload?: Record<string, unknown> | null;
  audioReplyId?: string | null;
  audioUrl?: string | null;
  audioFormat?: 'wav' | null;
  audioDurationMs?: number | null;
  deliveryMode?: 'direct_response' | 'poll_queue';
}

export interface SensorFusionSummary {
  evaluatedAt: number;
  deviceConnected: boolean;
  sourceMode: DeviceSourceMode;
  forwardStatus: SensorReadingStatus;
  forwardDistanceCm: number | null;
  imuStatus: SensorReadingStatus;
  imuCalibrated: boolean;
  headPitchDeg: number | null;
  headMotionLevel: 'steady' | 'moving' | 'rapid' | 'unavailable';
  cameraStatus: SensorReadingStatus;
  vl53l5cxStatus: SensorReadingStatus;
  wm8960Status: SensorReadingStatus;
  downwardDropOffCapable: boolean;
  forwardObstruction: 'none_detected' | 'caution' | 'critical' | 'unknown';
  summaryText: string;
  advisories: string[];
}

export interface SlamPoseContractPlaceholder {
  status: 'planned';
  note: string;
  xMeters: null;
  yMeters: null;
  zMeters: null;
  yawDeg: null;
  frameTimestamp: number | null;
}

export interface RegisteredDeviceSummary {
  deviceId: string;
  name: string;
  capabilities: DeviceCapabilities;
  registeredAt: number;
  lastSeenAt: number | null;
  isSimulator: boolean;
}

export interface SensorEventRecord {
  id: number;
  deviceId: string;
  sourceMode: 'hardware' | 'simulator';
  sequence: number;
  uptimeMs: number | null;
  batteryPercent: number | null;
  forwardDistanceCm: number | null;
  downwardDistanceMm: number | null;
  headPitchDeg: number | null;
  imuJson: string | null;
  createdAt: number;
}

export interface AlertEventRecord {
  id: number;
  deviceId: string;
  sourceMode: 'hardware' | 'simulator';
  alertType: string;
  severity: 'caution' | 'critical';
  description: string;
  sensorValue: string | null;
  acknowledged: boolean;
  createdAt: number;
}

export interface ConnectionEventRecord {
  id: number;
  deviceId: string;
  sourceMode: 'hardware' | 'simulator';
  eventType: 'connected' | 'disconnected' | 'registered' | 'frame_stale';
  details: string | null;
  createdAt: number;
}

export interface AnalyticsSummary {
  ok: boolean;
  deviceId: string | null;
  range: '1h' | '24h' | '7d' | 'all';
  includeSimulated: boolean;
  totalSensorEvents: number;
  totalAlerts: number;
  proximityAlertCount: number;
  uptimeEstimateMs: number;
  sessionDurationMs: number;
  alertsByHour: Array<{ bucketLabel: string; timestamp: number; count: number }>;
  sensorHistory: Array<{
    timestamp: number;
    forwardDistanceCm: number | null;
    downwardDistanceMm: number | null;
    batteryPercent: number | null;
    sourceMode: 'hardware' | 'simulator';
  }>;
  batteryHistory: Array<{ timestamp: number; batteryPercent: number; sourceMode: 'hardware' | 'simulator' }>;
  recentAlerts: AlertEventRecord[];
  connectionHistory: ConnectionEventRecord[];
}
