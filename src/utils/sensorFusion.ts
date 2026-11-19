import type {
  DeviceLiveState,
  DeviceRuntimeConfig,
  SensorFusionSummary,
  SensorReadingStatus,
  SlamPoseContractPlaceholder,
} from '../types/deviceProtocol';

export const DEFAULT_DEVICE_RUNTIME_CONFIG: DeviceRuntimeConfig = {
  tofSampleIntervalMs: 250,
  imuSampleIntervalMs: 200,
  frameUploadIntervalMs: 1200,
  jpegQuality: 12,
  frameSize: 'QVGA',
  proximityCautionCm: 100,
  proximityCriticalCm: 45,
  sensorStaleMs: 5000,
  alertCooldownMs: 8000,
};

export function createPlannedSlamPoseContract(frameTimestamp: number | null = null): SlamPoseContractPlaceholder {
  return {
    status: 'planned',
    note: 'Visual-inertial SLAM/localization is not implemented on the current ESP32-S3 + OV2640 + MPU6050 + single VL53L0X hardware.',
    xMeters: null,
    yMeters: null,
    zMeters: null,
    yawDeg: null,
    frameTimestamp,
  };
}

/**
 * Evaluates live wearable telemetry, camera freshness, and sensor health into an
 * evidence-grounded fusion summary. Enforces strict truthfulness for the
 * single-forward-VL53L0X headband architecture (no ungrounded downward cliff claims).
 */
export function evaluateSensorFusion(
  device: DeviceLiveState | null,
  now = Date.now(),
  overrideConfig?: Partial<DeviceRuntimeConfig>
): SensorFusionSummary {
  const cfg: DeviceRuntimeConfig = {
    ...DEFAULT_DEVICE_RUNTIME_CONFIG,
    ...(device?.runtimeConfig ?? {}),
    ...(overrideConfig ?? {}),
  };

  if (!device || !device.connected) {
    return {
      evaluatedAt: now,
      deviceConnected: false,
      sourceMode: 'disconnected',
      forwardStatus: 'unavailable',
      forwardDistanceCm: null,
      imuStatus: 'unavailable',
      imuCalibrated: false,
      headPitchDeg: null,
      headMotionLevel: 'unavailable',
      cameraStatus: 'unavailable',
      vl53l5cxStatus: 'unavailable',
      wm8960Status: 'unavailable',
      downwardDropOffCapable: false,
      forwardObstruction: 'unknown',
      summaryText: 'Wearable hardware is disconnected; sensor observations are unavailable.',
      advisories: ['Wearable telemetry stream offline.'],
    };
  }

  const telemetryAgeMs = device.lastTelemetryAt !== null ? Math.max(0, now - device.lastTelemetryAt) : null;
  const telemetryStale = telemetryAgeMs === null || telemetryAgeMs > cfg.sensorStaleMs;

  let forwardStatus: SensorReadingStatus = 'unavailable';
  const forwardDist = device.sensors.forwardDistanceCm;
  if (!device.capabilities.forwardToF) {
    forwardStatus = 'unavailable';
  } else if (device.sensorHealth?.forwardToF === 'unavailable') {
    forwardStatus = 'unavailable';
  } else if (telemetryStale) {
    forwardStatus = 'stale';
  } else if (device.sensorHealth?.forwardToF === 'invalid') {
    forwardStatus = 'invalid';
  } else if (forwardDist === null || !Number.isFinite(forwardDist) || forwardDist < 2 || forwardDist > 400) {
    forwardStatus = device.sensorHealth?.forwardToF ?? 'invalid';
  } else {
    forwardStatus = 'valid';
  }

  let imuStatus: SensorReadingStatus = 'unavailable';
  const imu = device.sensors.imu;
  const imuCalibrated = Boolean(device.sensorHealth?.imuCalibrated ?? imu?.calibrated ?? false);
  if (!device.capabilities.imu) {
    imuStatus = 'unavailable';
  } else if (device.sensorHealth?.imu === 'unavailable') {
    imuStatus = 'unavailable';
  } else if (telemetryStale) {
    imuStatus = 'stale';
  } else if (!imu) {
    imuStatus = device.sensorHealth?.imu ?? 'invalid';
  } else {
    imuStatus = device.sensorHealth?.imu === 'invalid' ? 'invalid' : 'valid';
  }

  let headMotionLevel: SensorFusionSummary['headMotionLevel'] = 'unavailable';
  if (imuStatus === 'valid' && imu) {
    const gyroMag = Math.hypot(imu.gx, imu.gy, imu.gz);
    if (gyroMag > 110) {
      headMotionLevel = 'rapid';
    } else if (gyroMag > 25) {
      headMotionLevel = 'moving';
    } else {
      headMotionLevel = 'steady';
    }
  }

  let cameraStatus: SensorReadingStatus = 'unavailable';
  if (!device.capabilities.camera) {
    cameraStatus = 'unavailable';
  } else if (!device.frameAvailable) {
    cameraStatus = device.sensorHealth?.camera ?? 'unavailable';
  } else if (device.frameStale || (device.frameAgeMs !== null && device.frameAgeMs > cfg.sensorStaleMs)) {
    cameraStatus = 'stale';
  } else {
    cameraStatus = 'valid';
  }

  const vl53l5cxCapable = Boolean(device.capabilities.vl53l5cx && device.sensors.vl53l5cx?.available);
  const vl53l5cxStatus: SensorReadingStatus = vl53l5cxCapable
    ? telemetryStale
      ? 'stale'
      : 'valid'
    : 'unavailable';

  const wm8960Status: SensorReadingStatus = device.capabilities.audioOutput
    ? device.sensorHealth?.wm8960 ?? 'valid'
    : 'unavailable';

  // Critical architectural rule: a single forward VL53L0X CANNOT detect downward drop-offs.
  const downwardValid =
    Boolean(device.capabilities.downwardToF) &&
    !telemetryStale &&
    device.sensors.downwardDistanceMm !== null &&
    device.sensors.downwardDistanceMm >= 10 &&
    device.sensors.downwardDistanceMm <= 2000;
  const downwardDropOffCapable = downwardValid || vl53l5cxStatus === 'valid';

  let forwardObstruction: SensorFusionSummary['forwardObstruction'] = 'unknown';
  if (forwardStatus === 'valid' && forwardDist !== null) {
    if (forwardDist <= cfg.proximityCriticalCm) {
      forwardObstruction = 'critical';
    } else if (forwardDist <= cfg.proximityCautionCm) {
      forwardObstruction = 'caution';
    } else {
      forwardObstruction = 'none_detected';
    }
  }

  const advisories: string[] = [];
  if (forwardObstruction === 'critical' && forwardDist !== null) {
    advisories.push(`Critical forward obstruction threshold triggered at ${Math.round(forwardDist)} cm (<= ${cfg.proximityCriticalCm} cm).`);
  } else if (forwardObstruction === 'caution' && forwardDist !== null) {
    advisories.push(`Caution: forward object sensed at ${Math.round(forwardDist)} cm (<= ${cfg.proximityCautionCm} cm).`);
  } else if (forwardStatus === 'stale') {
    advisories.push('Forward VL53L0X reading is stale.');
  } else if (forwardStatus === 'invalid') {
    advisories.push('Forward VL53L0X returned out-of-range or invalid measurement status.');
  } else if (forwardStatus === 'unavailable') {
    advisories.push('Forward VL53L0X distance sensor is unavailable.');
  }

  if (imuStatus === 'valid' && !imuCalibrated) {
    advisories.push('MPU6050 IMU is streaming uncalibrated readings; pitch/motion offsets may drift.');
  } else if (headMotionLevel === 'rapid') {
    advisories.push('Rapid head movement detected; camera frame may contain motion blur.');
  }

  if (!downwardDropOffCapable) {
    advisories.push('No active downward drop-off sensor; floor drop-offs and stairs cannot be confirmed by ToF.');
  }

  const summaryParts: string[] = [
    forwardStatus === 'valid' && forwardDist !== null
      ? `Forward VL53L0X: ${Math.round(forwardDist)} cm (${forwardObstruction})`
      : `Forward VL53L0X: ${forwardStatus}`,
    imuStatus === 'valid' && device.sensors.headPitchDeg !== null
      ? `IMU pitch: ${device.sensors.headPitchDeg.toFixed(1)} deg (${headMotionLevel}, ${imuCalibrated ? 'calibrated' : 'uncalibrated'})`
      : `IMU: ${imuStatus}`,
    `Camera stream: ${cameraStatus}`,
    `Optional VL53L5CX: ${vl53l5cxStatus}`,
  ];

  return {
    evaluatedAt: now,
    deviceConnected: true,
    sourceMode: device.sourceMode,
    forwardStatus,
    forwardDistanceCm: forwardStatus === 'valid' ? forwardDist : null,
    imuStatus,
    imuCalibrated,
    headPitchDeg: device.sensors.headPitchDeg ?? null,
    headMotionLevel,
    cameraStatus,
    vl53l5cxStatus,
    wm8960Status,
    downwardDropOffCapable,
    forwardObstruction,
    summaryText: summaryParts.join(' | '),
    advisories,
  };
}

export class FusionAlertPrioritizer {
  private lastEmittedAt = new Map<string, number>();

  public shouldEmit(alertKey: string, cooldownMs: number, now = Date.now()): boolean {
    const prev = this.lastEmittedAt.get(alertKey) ?? 0;
    if (now - prev < cooldownMs) {
      return false;
    }
    this.lastEmittedAt.set(alertKey, now);
    return true;
  }

  public reset(alertKey?: string): void {
    if (alertKey) {
      this.lastEmittedAt.delete(alertKey);
    } else {
      this.lastEmittedAt.clear();
    }
  }
}
