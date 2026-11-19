import { describe, expect, it } from 'vitest';
import type { DeviceLiveState } from '../src/types/deviceProtocol';
import {
  DEFAULT_DEVICE_RUNTIME_CONFIG,
  FusionAlertPrioritizer,
  createPlannedSlamPoseContract,
  evaluateSensorFusion,
} from '../src/utils/sensorFusion';

function makeBaseDevice(overrides: Partial<DeviceLiveState> = {}): DeviceLiveState {
  const now = Date.now();
  return {
    deviceId: 'ESP32-S3-SENTRA-001',
    name: 'Headband Unit',
    sourceMode: 'hardware',
    connected: true,
    firmwareVersion: '1.1.0-prehw',
    lastHeartbeatAt: now,
    lastTelemetryAt: now,
    lastSequence: 12,
    uptimeMs: 12000,
    frameAvailable: true,
    frameSequence: 12,
    frameTimestamp: now - 400,
    frameAgeMs: 400,
    frameStale: false,
    frameFormat: 'image/jpeg',
    batteryPercent: null,
    batteryCharging: null,
    earphoneConnected: false,
    audioVolume: null,
    capabilities: {
      camera: true,
      forwardToF: true,
      downwardToF: false,
      imu: true,
      audioOutput: false,
      vl53l5cx: false,
    },
    sensors: {
      forwardDistanceCm: 125,
      downwardDistanceMm: null,
      headPitchDeg: -4,
      imu: {
        ax: 0.02,
        ay: 0.01,
        az: 9.81,
        gx: 0.1,
        gy: -0.05,
        gz: 0,
        heading: null,
        calibrated: true,
        motionMagnitude: 0.04,
      },
      vl53l5cx: null,
    },
    sensorHealth: {
      forwardToF: 'valid',
      downwardToF: 'unavailable',
      imu: 'valid',
      imuCalibrated: true,
      camera: 'valid',
      vl53l5cx: 'unavailable',
      wm8960: 'unavailable',
    },
    diagnostics: null,
    runtimeConfig: { ...DEFAULT_DEVICE_RUNTIME_CONFIG },
    pendingActionsCount: 0,
    ...overrides,
  };
}

describe('SENTRA Sensor Fusion & Grounding Contracts', () => {
  it('evaluates valid forward VL53L0X + calibrated 6-axis MPU6050 + fresh OV2640 without claiming downward or SLAM support', () => {
    const now = Date.now();
    const fusion = evaluateSensorFusion(
      makeBaseDevice({
        lastHeartbeatAt: now,
        lastTelemetryAt: now,
        frameTimestamp: now - 300,
        frameAgeMs: 300,
      }),
      now
    );

    expect(fusion.forwardStatus).toBe('valid');
    expect(fusion.forwardObstruction).toBe('none_detected');
    expect(fusion.downwardDropOffCapable).toBe(false);
    expect(fusion.imuStatus).toBe('valid');
    expect(fusion.imuCalibrated).toBe(true);
    expect(fusion.cameraStatus).toBe('valid');
    expect(fusion.vl53l5cxStatus).toBe('unavailable');
    expect(fusion.wm8960Status).toBe('unavailable');
    expect(fusion.advisories.some((w) => /downward/i.test(w))).toBe(true);
  });

  it('classifies critical and caution forward obstructions from configurable experimental thresholds', () => {
    const now = Date.now();
    const critical = evaluateSensorFusion(
      makeBaseDevice({
        lastHeartbeatAt: now,
        lastTelemetryAt: now,
        sensors: {
          forwardDistanceCm: 32,
          downwardDistanceMm: null,
          headPitchDeg: 0,
          imu: { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, heading: null, calibrated: true },
          vl53l5cx: null,
        },
      }),
      now
    );
    expect(critical.forwardObstruction).toBe('critical');

    const caution = evaluateSensorFusion(
      makeBaseDevice({
        lastHeartbeatAt: now,
        lastTelemetryAt: now,
        sensors: {
          forwardDistanceCm: 72,
          downwardDistanceMm: null,
          headPitchDeg: 0,
          imu: { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, heading: null, calibrated: true },
          vl53l5cx: null,
        },
      }),
      now
    );
    expect(caution.forwardObstruction).toBe('caution');
  });

  it('distinguishes stale telemetry and stale camera frames from valid live observations', () => {
    const now = Date.now();
    const staleDev = makeBaseDevice({
      lastHeartbeatAt: now - 9000,
      lastTelemetryAt: now - 9000,
      frameTimestamp: now - 9000,
      frameAgeMs: 9000,
      frameStale: true,
    });
    const fusion = evaluateSensorFusion(staleDev, now);
    expect(fusion.forwardStatus).toBe('stale');
    expect(fusion.imuStatus).toBe('stale');
    expect(fusion.cameraStatus).toBe('stale');
    expect(fusion.forwardObstruction).toBe('unknown');
  });

  it('reports invalid health explicitly when firmware flags sensor failure', () => {
    const now = Date.now();
    const invalidToF = makeBaseDevice({
      lastHeartbeatAt: now,
      lastTelemetryAt: now,
      sensors: {
        forwardDistanceCm: null,
        downwardDistanceMm: null,
        headPitchDeg: 0,
        imu: { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, heading: null, calibrated: true },
        vl53l5cx: null,
      },
      sensorHealth: {
        forwardToF: 'invalid',
        downwardToF: 'unavailable',
        imu: 'valid',
        imuCalibrated: true,
        camera: 'valid',
        vl53l5cx: 'unavailable',
        wm8960: 'unavailable',
      },
    });
    const fusion = evaluateSensorFusion(invalidToF, now);
    expect(fusion.forwardStatus).toBe('invalid');
    expect(fusion.advisories.some((w) => /invalid|out-of-range/i.test(w))).toBe(true);
  });

  it('deduplicates critical proximity alerts with FusionAlertPrioritizer cooldown', () => {
    const prio = new FusionAlertPrioritizer();
    expect(prio.shouldEmit('ESP32-S3-SENTRA-001:proximity', 4000, 10000)).toBe(true);
    expect(prio.shouldEmit('ESP32-S3-SENTRA-001:proximity', 4000, 11500)).toBe(false);
    expect(prio.shouldEmit('ESP32-S3-SENTRA-001:proximity', 4000, 15000)).toBe(true);
  });

  it('keeps SLAM pose contract explicitly planned and non-operational', () => {
    const slam = createPlannedSlamPoseContract(123456);
    expect(slam.status).toBe('planned');
    expect(slam.xMeters).toBeNull();
    expect(slam.yMeters).toBeNull();
    expect(slam.zMeters).toBeNull();
    expect(slam.yawDeg).toBeNull();
    expect(slam.frameTimestamp).toBe(123456);
  });
});
