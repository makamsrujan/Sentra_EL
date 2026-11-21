import crypto from 'node:crypto';
import type { Response } from 'express';
import type {
  DeviceCapabilities,
  DeviceCommandType,
  DeviceLiveState,
  DeviceRuntimeConfig,
  DeviceSourceMode,
  SensorHealthReport,
  TelemetryPayloadV1,
  WearableActionItem,
  WearableFrameStatus,
} from '../src/types/deviceProtocol';
import type { GoalTask } from '../src/types/sentra';
import { DEFAULT_DEVICE_RUNTIME_CONFIG, FusionAlertPrioritizer } from '../src/utils/sensorFusion';
import { hashToken, SentraEventStore } from './eventStore';

const DEFAULT_HEARTBEAT_TIMEOUT_MS = Number(process.env.SENTRA_HEARTBEAT_TIMEOUT_MS || 15000);
const FRAME_STALE_THRESHOLD_MS = Number(process.env.SENTRA_FRAME_STALE_MS || 5000);
const MAX_ACTION_QUEUE_PER_DEVICE = 20;

export function parseCameraPairings(raw?: string | Record<string, string> | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const s3 = k.trim();
      const cam = typeof v === 'string' ? v.trim() : '';
      if (s3 && cam && s3 !== cam) {
        result[s3] = cam;
      }
    }
    return result;
  }
  const trimmed = raw.trim();
  if (!trimmed) return result;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        const s3 = k.trim();
        const cam = typeof v === 'string' ? v.trim() : '';
        if (s3 && cam && s3 !== cam) {
          result[s3] = cam;
        }
      }
      return result;
    } catch {
      return result;
    }
  }
  for (const entry of trimmed.split(',')) {
    const idx = entry.indexOf('=');
    if (idx <= 0) continue;
    const s3 = entry.slice(0, idx).trim();
    const cam = entry.slice(idx + 1).trim();
    if (s3 && cam && s3 !== cam) {
      result[s3] = cam;
    }
  }
  return result;
}

interface FrameEntry {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  sequence: number;
  receivedAt: number;
  sizeBytes: number;
}

interface InternalDeviceState {
  deviceId: string;
  name: string;
  firmwareVersion: string | null;
  isSimulator: boolean;
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
  sensors: DeviceLiveState['sensors'];
  sensorHealth: SensorHealthReport;
  diagnostics: string | null;
  capabilities: DeviceCapabilities;
  runtimeConfig: DeviceRuntimeConfig;
  frame: FrameEntry | null;
  frameSequenceCounter: number;
  frameBootSession: string | null;
  lastClientFrameSequence: number | null;
  actions: WearableActionItem[];
  alertPrioritizer: FusionAlertPrioritizer;
  activeGoal: GoalTask | null;
}

export class DeviceGateway {
  private store: SentraEventStore;
  private devices = new Map<string, InternalDeviceState>();
  private sseClients = new Set<Response>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private heartbeatTimeoutMs: number;
  private cameraPairings = new Map<string, string>();
  private reverseCameraPairings = new Map<string, Set<string>>();

  constructor(
    store: SentraEventStore,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    cameraPairings?: Record<string, string> | string
  ) {
    this.store = store;
    this.heartbeatTimeoutMs = Number.isFinite(heartbeatTimeoutMs) && heartbeatTimeoutMs >= 2000
      ? heartbeatTimeoutMs
      : 15000;
    const pairingMap = parseCameraPairings(
      cameraPairings !== undefined ? cameraPairings : process.env.SENTRA_CAMERA_PAIRINGS
    );
    for (const [s3Id, camId] of Object.entries(pairingMap)) {
      this.cameraPairings.set(s3Id, camId);
      if (!this.reverseCameraPairings.has(camId)) {
        this.reverseCameraPairings.set(camId, new Set());
      }
      this.reverseCameraPairings.get(camId)!.add(s3Id);
    }

    // Seed registered devices from SQLite (all start disconnected with null readings)
    for (const dev of this.store.listDevices()) {
      this.devices.set(dev.deviceId, this.createEmptyState(dev.deviceId, dev.name, dev.capabilities, dev.isSimulator));
    }
  }

  public startHeartbeatMonitor(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepHeartbeats(), 2000);
    this.sweepTimer.unref?.();
  }

  public stopHeartbeatMonitor(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  public getHeartbeatTimeoutMs(): number {
    return this.heartbeatTimeoutMs;
  }

  public getCameraPairings(): Record<string, string> {
    return Object.fromEntries(this.cameraPairings.entries());
  }

  public getPairedCameraDeviceId(deviceId: string): string | null {
    return this.cameraPairings.get(deviceId) ?? null;
  }

  public getPairedControllerDeviceIds(cameraDeviceId: string): string[] {
    return Array.from(this.reverseCameraPairings.get(cameraDeviceId) ?? []);
  }

  public isPairedCameraTarget(deviceId: string): boolean {
    return this.reverseCameraPairings.has(deviceId);
  }

  public resolveFrameSourceDeviceId(deviceId: string): string {
    return this.cameraPairings.get(deviceId) ?? deviceId;
  }

  public isSimulatorEnabled(): boolean {
    return process.env.SENTRA_SIMULATOR_ENABLED !== 'false';
  }

  public isDeviceAuthConfigured(deviceId?: string): boolean {
    if (process.env.SENTRA_DEVICE_TOKEN && process.env.SENTRA_DEVICE_TOKEN.trim().length > 0) {
      return true;
    }
    if (deviceId) {
      const stored = this.store.getDevice(deviceId);
      if (stored?.tokenHash) return true;
    }
    return false;
  }

  private createDefaultHealth(capabilities: DeviceCapabilities): SensorHealthReport {
    return {
      forwardToF: capabilities.forwardToF ? 'unavailable' : 'unavailable',
      downwardToF: capabilities.downwardToF ? 'unavailable' : 'unavailable',
      imu: capabilities.imu ? 'unavailable' : 'unavailable',
      imuCalibrated: false,
      camera: capabilities.camera ? 'unavailable' : 'unavailable',
      vl53l5cx: capabilities.vl53l5cx ? 'unavailable' : 'unavailable',
      wm8960: capabilities.audioOutput ? 'unavailable' : 'unavailable',
    };
  }

  private createEmptyState(
    deviceId: string,
    name: string,
    capabilities: DeviceCapabilities,
    isSimulator: boolean
  ): InternalDeviceState {
    return {
      deviceId,
      name,
      firmwareVersion: null,
      isSimulator,
      connected: false,
      lastHeartbeatAt: null,
      lastTelemetryAt: null,
      lastSequence: null,
      uptimeMs: null,
      batteryPercent: null,
      batteryVoltageV: null,
      batteryCharging: null,
      earphoneConnected: null,
      audioVolume: null,
      sensors: {
        forwardDistanceCm: null,
        downwardDistanceMm: null,
        headPitchDeg: null,
        imu: null,
        vl53l5cx: null,
      },
      sensorHealth: this.createDefaultHealth(capabilities),
      diagnostics: null,
      capabilities: {
        ...capabilities,
        vl53l5cx: Boolean(capabilities.vl53l5cx),
      },
      runtimeConfig: { ...DEFAULT_DEVICE_RUNTIME_CONFIG },
      frame: null,
      frameSequenceCounter: 0,
      frameBootSession: null,
      lastClientFrameSequence: null,
      actions: [],
      alertPrioritizer: new FusionAlertPrioritizer(),
      activeGoal: null,
    };
  }

  public registerDevice(params: {
    deviceId: string;
    name: string;
    capabilities: DeviceCapabilities;
    isSimulator?: boolean;
  }): { deviceId: string; provisionedToken: string } {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashToken(rawToken);
    const isSim = Boolean(params.isSimulator);

    this.store.upsertDevice({
      deviceId: params.deviceId,
      name: params.name,
      tokenHash,
      capabilities: params.capabilities,
      isSimulator: isSim,
    });

    this.store.insertConnectionEvent({
      deviceId: params.deviceId,
      sourceMode: isSim ? 'simulator' : 'hardware',
      eventType: 'registered',
      details: `Device registered (${params.name})`,
    });

    const existing = this.devices.get(params.deviceId);
    if (existing) {
      existing.name = params.name;
      existing.capabilities = { ...params.capabilities, vl53l5cx: Boolean(params.capabilities.vl53l5cx) };
    } else {
      this.devices.set(
        params.deviceId,
        this.createEmptyState(params.deviceId, params.name, params.capabilities, isSim)
      );
    }

    this.broadcast('device_list', this.listLiveStates());
    return { deviceId: params.deviceId, provisionedToken: rawToken };
  }

  /**
   * Constant-time authentication for hardware write/poll endpoints.
   */
  public authenticateHardwareToken(providedToken: string | undefined, deviceId?: string): boolean {
    if (!providedToken || !providedToken.trim()) return false;
    const clean = providedToken.trim();

    if (deviceId) {
      const stored = this.store.getDevice(deviceId);
      if (stored?.tokenHash) {
        const providedHash = Buffer.from(hashToken(clean));
        const expectedHash = Buffer.from(stored.tokenHash);
        return providedHash.length === expectedHash.length && crypto.timingSafeEqual(providedHash, expectedHash);
      }
    }

    const envToken = process.env.SENTRA_DEVICE_TOKEN?.trim();
    if (envToken && envToken.length > 0) {
      const a = Buffer.from(hashToken(clean));
      const b = Buffer.from(hashToken(envToken));
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return true;
      }
    }

    return false;
  }

  private resolveSensorHealth(state: InternalDeviceState, payload: TelemetryPayloadV1, now: number): SensorHealthReport {
    const incoming = payload.sensorHealth || {};
    const caps = payload.capabilities;
    const frameAgeMs = state.frame ? Math.max(0, now - state.frame.receivedAt) : null;

    const forwardToF =
      incoming.forwardToF ??
      (!caps.forwardToF
        ? 'unavailable'
        : payload.sensors.forwardDistanceCm !== null
        ? 'valid'
        : 'invalid');

    const downwardToF =
      incoming.downwardToF ??
      (!caps.downwardToF
        ? 'unavailable'
        : payload.sensors.downwardDistanceMm !== null
        ? 'valid'
        : 'invalid');

    const imu =
      incoming.imu ??
      (!caps.imu ? 'unavailable' : payload.sensors.imu !== null ? 'valid' : 'invalid');

    const imuCalibrated = Boolean(incoming.imuCalibrated ?? payload.sensors.imu?.calibrated ?? false);

    const camera =
      incoming.camera ??
      (!caps.camera
        ? 'unavailable'
        : !state.frame
        ? 'unavailable'
        : frameAgeMs !== null && frameAgeMs > FRAME_STALE_THRESHOLD_MS
        ? 'stale'
        : 'valid');

    const vl53l5cx =
      incoming.vl53l5cx ??
      (caps.vl53l5cx && payload.sensors.vl53l5cx?.available ? 'valid' : 'unavailable');

    const wm8960 = incoming.wm8960 ?? (caps.audioOutput ? 'valid' : 'unavailable');

    return {
      forwardToF,
      downwardToF,
      imu,
      imuCalibrated,
      camera,
      vl53l5cx,
      wm8960,
    };
  }

  public ingestTelemetry(
    payload: TelemetryPayloadV1,
    sourceMode: 'hardware' | 'simulator'
  ): {
    accepted: boolean;
    reason?: string;
    state: DeviceLiveState;
    triggeredAlerts: Array<{ type: string; severity: 'caution' | 'critical'; description: string }>;
  } {
    const now = Date.now();
    let state = this.devices.get(payload.deviceId);

    // Enforce strict hardware/simulator separation
    if (state && state.isSimulator !== (sourceMode === 'simulator')) {
      return {
        accepted: false,
        reason: `Device ID "${payload.deviceId}" belongs to ${state.isSimulator ? 'simulator' : 'hardware'} mode and cannot be overwritten by ${sourceMode}.`,
        state: this.toLiveState(state, now),
        triggeredAlerts: [],
      };
    }

    if (!state) {
      const name = sourceMode === 'simulator' ? 'Simulated Wearable Testbench' : payload.deviceId;
      state = this.createEmptyState(payload.deviceId, name, payload.capabilities, sourceMode === 'simulator');
      this.devices.set(payload.deviceId, state);
      this.store.upsertDevice({
        deviceId: payload.deviceId,
        name,
        capabilities: payload.capabilities,
        isSimulator: sourceMode === 'simulator',
        lastSeenAt: now,
      });
    }

    // Deduplicate & reject out-of-order sequences within the same boot uptime
    const isReboot = state.uptimeMs !== null && payload.uptimeMs < state.uptimeMs;
    if (!isReboot && state.lastSequence !== null && payload.sequence <= state.lastSequence) {
      return {
        accepted: false,
        reason: `Duplicate or out-of-order sequence (${payload.sequence} <= ${state.lastSequence}).`,
        state: this.toLiveState(state, now),
        triggeredAlerts: [],
      };
    }

    const wasConnected = state.connected;
    state.connected = true;
    state.lastHeartbeatAt = now;
    state.lastTelemetryAt = now;
    state.lastSequence = payload.sequence;
    state.uptimeMs = payload.uptimeMs;
    if (payload.firmwareVersion !== undefined) {
      state.firmwareVersion = payload.firmwareVersion ?? null;
    }
    state.batteryPercent = payload.batteryPercent ?? null;
    state.batteryVoltageV = payload.batteryVoltageV ?? null;
    state.batteryCharging = payload.batteryCharging ?? null;
    state.earphoneConnected = payload.earphoneConnected ?? null;
    state.audioVolume = payload.audioVolume ?? null;
    state.sensors = {
      forwardDistanceCm: payload.sensors.forwardDistanceCm,
      downwardDistanceMm: payload.sensors.downwardDistanceMm,
      headPitchDeg: payload.sensors.headPitchDeg ?? null,
      imu: payload.sensors.imu,
      vl53l5cx: payload.sensors.vl53l5cx ?? null,
    };
    state.capabilities = {
      ...payload.capabilities,
      vl53l5cx: Boolean(payload.capabilities.vl53l5cx),
    };
    state.sensorHealth = this.resolveSensorHealth(state, payload, now);
    state.diagnostics = payload.diagnostics ?? state.diagnostics;

    this.store.upsertDevice({
      deviceId: payload.deviceId,
      name: state.name,
      capabilities: state.capabilities,
      isSimulator: sourceMode === 'simulator',
      lastSeenAt: now,
    });

    if (!wasConnected) {
      this.store.insertConnectionEvent({
        deviceId: payload.deviceId,
        sourceMode,
        eventType: 'connected',
        details: isReboot ? 'Device rebooted and reconnected' : 'Heartbeat established',
        createdAt: now,
      });
    }

    this.store.insertSensorEvent({
      deviceId: payload.deviceId,
      sourceMode,
      sequence: payload.sequence,
      uptimeMs: payload.uptimeMs,
      batteryPercent: payload.batteryPercent ?? null,
      forwardDistanceCm: payload.sensors.forwardDistanceCm,
      downwardDistanceMm: payload.sensors.downwardDistanceMm,
      headPitchDeg: payload.sensors.headPitchDeg ?? null,
      imuJson: payload.sensors.imu ? JSON.stringify(payload.sensors.imu) : null,
      createdAt: now,
    });

    const triggeredAlerts: Array<{ type: string; severity: 'caution' | 'critical'; description: string }> = [];
    const criticalCm = state.runtimeConfig.proximityCriticalCm;
    const cooldownMs = state.runtimeConfig.alertCooldownMs;

    // Forward ToF proximity alert (< criticalCm, valid non-null sensor)
    if (
      payload.capabilities.forwardToF &&
      payload.sensors.forwardDistanceCm !== null &&
      payload.sensors.forwardDistanceCm < criticalCm
    ) {
      if (state.alertPrioritizer.shouldEmit('obstacle', cooldownMs, now)) {
        const desc = `Forward sensor proximity alert: object within ${Math.round(payload.sensors.forwardDistanceCm)} cm.`;
        this.store.insertAlertEvent({
          deviceId: payload.deviceId,
          sourceMode,
          alertType: 'obstacle',
          severity: 'critical',
          description: desc,
          sensorValue: `${payload.sensors.forwardDistanceCm} cm`,
          createdAt: now,
        });
        this.enqueueAction(payload.deviceId, {
          type: 'proximity_alert',
          text: 'Obstacle within close range ahead.',
          priority: 'critical',
        });
        triggeredAlerts.push({ type: 'obstacle', severity: 'critical', description: desc });
      }
    }

    // Downward sensor change alert (ONLY when downwardToF capability is explicitly equipped)
    if (
      payload.capabilities.downwardToF &&
      payload.sensors.downwardDistanceMm !== null &&
      payload.sensors.downwardDistanceMm > 200
    ) {
      if (state.alertPrioritizer.shouldEmit('dropoff', cooldownMs, now)) {
        const desc = `Downward distance reading increased to ${Math.round(payload.sensors.downwardDistanceMm)} mm (possible step-down or drop-off).`;
        this.store.insertAlertEvent({
          deviceId: payload.deviceId,
          sourceMode,
          alertType: 'dropoff',
          severity: 'critical',
          description: desc,
          sensorValue: `${payload.sensors.downwardDistanceMm} mm`,
          createdAt: now,
        });
        this.enqueueAction(payload.deviceId, {
          type: 'proximity_alert',
          text: 'Caution. Downward sensor detected a possible drop-off.',
          priority: 'critical',
        });
        triggeredAlerts.push({ type: 'dropoff', severity: 'critical', description: desc });
      }
    }

    const liveState = this.toLiveState(state, now);
    this.broadcast('telemetry', liveState);
    if (triggeredAlerts.length > 0) {
      this.broadcast('alert', { deviceId: payload.deviceId, sourceMode, alerts: triggeredAlerts, timestamp: now });
    }

    return { accepted: true, state: liveState, triggeredAlerts };
  }

  public getDeviceConfig(deviceId?: string): DeviceRuntimeConfig {
    if (deviceId) {
      const state = this.devices.get(deviceId);
      if (state) return { ...state.runtimeConfig };
    }
    const primary = this.getLiveState();
    if (primary) return { ...primary.runtimeConfig };
    return { ...DEFAULT_DEVICE_RUNTIME_CONFIG };
  }

  public updateDeviceConfig(
    deviceId: string,
    patch: Partial<DeviceRuntimeConfig>
  ): { ok: boolean; config: DeviceRuntimeConfig; action: WearableActionItem | null } {
    let state = this.devices.get(deviceId);
    if (!state) {
      const isSim = deviceId.startsWith('SIM-');
      state = this.createEmptyState(
        deviceId,
        isSim ? 'Simulated Wearable Testbench' : deviceId,
        {
          camera: true,
          forwardToF: true,
          downwardToF: false,
          imu: true,
          audioOutput: false,
          vl53l5cx: false,
        },
        isSim
      );
      this.devices.set(deviceId, state);
    }

    const nextCaution = patch.proximityCautionCm ?? state.runtimeConfig.proximityCautionCm;
    const nextCritical = patch.proximityCriticalCm ?? state.runtimeConfig.proximityCriticalCm;
    state.runtimeConfig = {
      ...state.runtimeConfig,
      ...patch,
      proximityCriticalCm: Math.min(nextCritical, nextCaution - 5),
      proximityCautionCm: Math.max(nextCaution, nextCritical + 5),
    };

    const action = this.enqueueAction(deviceId, {
      type: 'config_update',
      text: 'Apply updated sampling and threshold configuration.',
      priority: 'normal',
      payload: state.runtimeConfig as unknown as Record<string, unknown>,
    });

    this.broadcast('telemetry', this.toLiveState(state, Date.now()));
    return { ok: true, config: { ...state.runtimeConfig }, action };
  }

  public enqueueCommand(params: {
    deviceId: string;
    command: DeviceCommandType;
    text?: string;
    priority?: 'normal' | 'critical';
    payload?: Record<string, unknown>;
  }): WearableActionItem | null {
    const state = this.devices.get(params.deviceId);
    if (!state) return null;

    if (params.command === 'CAPTURE_FRAME') {
      const pairedCamId = this.getPairedCameraDeviceId(params.deviceId);
      const targetId = pairedCamId && this.devices.has(pairedCamId) ? pairedCamId : params.deviceId;
      return this.enqueueAction(targetId, {
        type: 'capture_frame',
        text: params.text || 'Capture and upload a fresh JPEG frame immediately.',
        priority: params.priority ?? 'normal',
        payload: params.payload ?? null,
      });
    }
    if (params.command === 'RECALIBRATE_IMU') {
      return this.enqueueAction(params.deviceId, {
        type: 'recalibrate_imu',
        text: params.text || 'Keep headband stationary and recalibrate MPU6050 offsets.',
        priority: params.priority ?? 'normal',
        payload: params.payload ?? null,
      });
    }
    if (params.command === 'REQUEST_OBSERVATION') {
      return this.enqueueAction(params.deviceId, {
        type: 'active_perception',
        text: params.text || 'Refresh forward sensor and camera observation.',
        priority: params.priority ?? 'normal',
        payload: params.payload ?? null,
      });
    }
    if (params.command === 'CONFIG_UPDATE') {
      return this.enqueueAction(params.deviceId, {
        type: 'config_update',
        text: params.text || 'Reload runtime configuration.',
        priority: params.priority ?? 'normal',
        payload: (params.payload ?? state.runtimeConfig) as Record<string, unknown>,
      });
    }
    return this.enqueueAction(params.deviceId, {
      type: 'speech',
      text: params.text || 'Active voice prompt from SENTRA.',
      priority: params.priority ?? 'normal',
      payload: params.payload ?? null,
    });
  }

  public ingestFrame(params: {
    deviceId: string;
    buffer: Buffer;
    sequence?: number;
    bootSessionId?: string;
    sourceMode: 'hardware' | 'simulator';
  }): { ok: boolean; error?: string; status?: WearableFrameStatus } {
    const now = Date.now();
    let state = this.devices.get(params.deviceId);

    if (state && state.isSimulator !== (params.sourceMode === 'simulator')) {
      return {
        ok: false,
        error: `Device ID "${params.deviceId}" mode mismatch (${state.isSimulator ? 'simulator' : 'hardware'}).`,
      };
    }

    if (!state) {
      const defaultCaps: DeviceCapabilities = {
        camera: true,
        forwardToF: false,
        downwardToF: false,
        imu: false,
        audioOutput: false,
        vl53l5cx: false,
      };
      const name = params.sourceMode === 'simulator' ? 'Simulated Wearable Testbench' : params.deviceId;
      state = this.createEmptyState(params.deviceId, name, defaultCaps, params.sourceMode === 'simulator');
      this.devices.set(params.deviceId, state);
      this.store.upsertDevice({
        deviceId: params.deviceId,
        name,
        capabilities: defaultCaps,
        isSimulator: params.sourceMode === 'simulator',
        lastSeenAt: now,
      });
    }

    const bootSession = params.bootSessionId?.trim() || null;
    const isNewBootSession = Boolean(bootSession && bootSession !== state.frameBootSession);

    if (isNewBootSession) {
      state.frameBootSession = bootSession;
      state.lastClientFrameSequence = null;
    } else if (
      state.frame &&
      params.sequence !== undefined &&
      state.lastClientFrameSequence !== null &&
      params.sequence <= state.lastClientFrameSequence
    ) {
      return { ok: true, status: this.getFrameStatus(params.deviceId) };
    }

    if (params.sequence !== undefined) {
      state.lastClientFrameSequence = params.sequence;
    }

    // Server-assigned strictly monotonic sequence guarantees camera-only reboots never stall UI refresh
    const seq =
      params.sequence !== undefined && !bootSession && params.sequence > state.frameSequenceCounter
        ? (state.frameSequenceCounter = params.sequence)
        : ++state.frameSequenceCounter;

    const wasConnected = state.connected;
    state.connected = true;
    state.lastHeartbeatAt = now;
    state.capabilities.camera = true;
    state.sensorHealth.camera = 'valid';
    state.frame = {
      buffer: params.buffer,
      mimeType: 'image/jpeg',
      sequence: seq,
      receivedAt: now,
      sizeBytes: params.buffer.length,
    };

    if (!wasConnected) {
      this.store.insertConnectionEvent({
        deviceId: params.deviceId,
        sourceMode: params.sourceMode,
        eventType: 'connected',
        details: 'Camera frame stream started',
        createdAt: now,
      });
    }

    const frameStatus = this.getFrameStatus(params.deviceId);
    this.broadcast('frame', frameStatus);
    this.broadcast('telemetry', this.toLiveState(state, now));

    // Propagate paired camera updates to S3 controller subscribers preserving controller deviceId
    for (const controllerId of this.getPairedControllerDeviceIds(params.deviceId)) {
      const controllerState = this.devices.get(controllerId);
      if (controllerState && !( !controllerState.isSimulator && state.isSimulator )) {
        this.broadcast('frame', this.getFrameStatus(controllerId));
        this.broadcast('telemetry', this.toLiveState(controllerState, now));
      }
    }

    return { ok: true, status: frameStatus };
  }

  public getLatestFrame(
    deviceId: string,
    options?: { excludeSimulator?: boolean }
  ): {
    available: boolean;
    stale: boolean;
    cameraConnected: boolean;
    sourceDeviceId: string;
    frame: FrameEntry | null;
    ageMs: number | null;
  } {
    const now = Date.now();
    const controllerState = this.devices.get(deviceId);
    const pairedCamId = this.getPairedCameraDeviceId(deviceId);
    const sourceId = pairedCamId ?? deviceId;
    const state = this.devices.get(sourceId);

    if (!state || !state.frame) {
      return {
        available: false,
        stale: true,
        cameraConnected: false,
        sourceDeviceId: sourceId,
        frame: null,
        ageMs: null,
      };
    }

    // Never allow simulator frames when excluded or paired to a non-simulator hardware controller
    const controllerIsHardware = controllerState ? !controllerState.isSimulator : !deviceId.startsWith('SIM-');
    if (state.isSimulator && (options?.excludeSimulator || (pairedCamId && controllerIsHardware))) {
      return {
        available: false,
        stale: true,
        cameraConnected: false,
        sourceDeviceId: sourceId,
        frame: null,
        ageMs: null,
      };
    }

    const sourceMode = this.computeSourceMode(state, now);
    const cameraConnected = sourceMode !== 'disconnected';
    const staleThreshold = state.runtimeConfig.sensorStaleMs || FRAME_STALE_THRESHOLD_MS;
    const ageMs = Math.max(0, now - state.frame.receivedAt);

    if (!cameraConnected) {
      return {
        available: false,
        stale: true,
        cameraConnected: false,
        sourceDeviceId: sourceId,
        frame: null,
        ageMs,
      };
    }

    return {
      available: true,
      stale: ageMs > staleThreshold,
      cameraConnected: true,
      sourceDeviceId: sourceId,
      frame: state.frame,
      ageMs,
    };
  }

  public getFrameStatus(deviceId: string): WearableFrameStatus {
    const now = Date.now();
    const controllerState = this.devices.get(deviceId);
    const pairedCamId = this.getPairedCameraDeviceId(deviceId);
    const sourceId = pairedCamId ?? deviceId;
    const state = this.devices.get(sourceId);

    const controllerIsHardware = controllerState ? !controllerState.isSimulator : !deviceId.startsWith('SIM-');
    if (!state || !state.frame || (pairedCamId && controllerIsHardware && state.isSimulator)) {
      return {
        ok: true,
        deviceId,
        frameAvailable: false,
        sequence: null,
        lastReceivedTimestamp: null,
        frameAgeMs: null,
        stale: true,
        imageFormat: null,
        sizeBytes: null,
        connectionStatus: state ? this.computeSourceMode(state, now) : 'disconnected',
      };
    }

    const connectionStatus = this.computeSourceMode(state, now);
    if (connectionStatus === 'disconnected') {
      return {
        ok: true,
        deviceId,
        frameAvailable: false,
        sequence: null,
        lastReceivedTimestamp: null,
        frameAgeMs: null,
        stale: true,
        imageFormat: null,
        sizeBytes: null,
        connectionStatus: 'disconnected',
      };
    }

    const staleThreshold = state.runtimeConfig.sensorStaleMs || FRAME_STALE_THRESHOLD_MS;
    const ageMs = Math.max(0, now - state.frame.receivedAt);
    return {
      ok: true,
      deviceId,
      frameAvailable: true,
      sequence: state.frame.sequence,
      lastReceivedTimestamp: state.frame.receivedAt,
      frameAgeMs: ageMs,
      stale: ageMs > staleThreshold,
      imageFormat: state.frame.mimeType,
      sizeBytes: state.frame.sizeBytes,
      connectionStatus,
    };
  }

  public enqueueAction(
    deviceId: string,
    action: {
      type: WearableActionItem['type'];
      text: string;
      priority: WearableActionItem['priority'];
      payload?: Record<string, unknown> | null;
      audioReplyId?: string | null;
      audioUrl?: string | null;
      audioFormat?: 'wav' | null;
      audioDurationMs?: number | null;
      deliveryMode?: 'direct_response' | 'poll_queue';
    }
  ): WearableActionItem | null {
    const state = this.devices.get(deviceId);
    if (!state) return null;

    const item: WearableActionItem = {
      id: `act-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      deviceId,
      type: action.type,
      text: action.text,
      priority: action.priority,
      createdAt: Date.now(),
      acknowledgedAt: null,
      payload: action.payload ?? null,
      audioReplyId: action.audioReplyId ?? null,
      audioUrl: action.audioUrl ?? null,
      audioFormat: action.audioFormat ?? null,
      audioDurationMs: action.audioDurationMs ?? null,
      deliveryMode: action.deliveryMode ?? 'poll_queue',
    };

    state.actions.push(item);
    // Bounded retention: drop oldest non-critical first if over capacity
    while (state.actions.length > MAX_ACTION_QUEUE_PER_DEVICE) {
      const nonCritIdx = state.actions.findIndex((a) => a.priority !== 'critical');
      if (nonCritIdx >= 0) {
        state.actions.splice(nonCritIdx, 1);
      } else {
        state.actions.shift();
      }
    }
    return item;
  }

  public pollPendingActions(deviceId: string): WearableActionItem[] {
    const state = this.devices.get(deviceId);
    if (!state) return [];
    const now = Date.now();
    // Expire unacknowledged actions older than 60s
    state.actions = state.actions.filter((a) => now - a.createdAt < 60000);
    // Exclude actions that were already delivered directly via utterance response to prevent duplicate playback
    return state.actions.filter((a) => a.acknowledgedAt === null && a.deliveryMode !== 'direct_response');
  }

  public getActiveGoal(deviceId?: string): GoalTask | null {
    const targetId = deviceId || 'ESP32-S3-SENTRA-001';
    return this.devices.get(targetId)?.activeGoal ?? null;
  }

  public setActiveGoal(deviceId: string, goal: GoalTask | null): void {
    const state = this.devices.get(deviceId);
    if (state) {
      state.activeGoal = goal;
      this.broadcast('goal_update', { deviceId, goal, timestamp: Date.now() });
    }
  }

  public acknowledgeActions(deviceId: string, actionIds: string[]): number {
    const state = this.devices.get(deviceId);
    if (!state) return 0;
    const idSet = new Set(actionIds);
    const now = Date.now();
    let count = 0;
    for (const action of state.actions) {
      if (idSet.has(action.id) && action.acknowledgedAt === null) {
        action.acknowledgedAt = now;
        count++;
      }
    }
    // Prune acknowledged actions
    state.actions = state.actions.filter((a) => a.acknowledgedAt === null);
    return count;
  }

  public sweepHeartbeats(): void {
    const now = Date.now();
    for (const state of this.devices.values()) {
      if (state.connected && state.lastHeartbeatAt !== null) {
        if (now - state.lastHeartbeatAt > this.heartbeatTimeoutMs) {
          state.connected = false;
          this.store.insertConnectionEvent({
            deviceId: state.deviceId,
            sourceMode: state.isSimulator ? 'simulator' : 'hardware',
            eventType: 'disconnected',
            details: `Heartbeat timeout after ${this.heartbeatTimeoutMs} ms`,
            createdAt: now,
          });
          this.broadcast('telemetry', this.toLiveState(state, now));
          for (const controllerId of this.getPairedControllerDeviceIds(state.deviceId)) {
            const controllerState = this.devices.get(controllerId);
            if (controllerState) {
              this.broadcast('frame', this.getFrameStatus(controllerId));
              this.broadcast('telemetry', this.toLiveState(controllerState, now));
            }
          }
        }
      }
    }
  }

  private computeSourceMode(state: InternalDeviceState, now: number): DeviceSourceMode {
    const isAlive =
      state.connected &&
      state.lastHeartbeatAt !== null &&
      now - state.lastHeartbeatAt <= this.heartbeatTimeoutMs;
    if (!isAlive) return 'disconnected';
    return state.isSimulator ? 'simulator' : 'hardware';
  }

  private toLiveState(state: InternalDeviceState, now = Date.now()): DeviceLiveState {
    const sourceMode = this.computeSourceMode(state, now);
    const connected = sourceMode !== 'disconnected';

    const pairedCamId = this.getPairedCameraDeviceId(state.deviceId);
    let frameAvailable = false;
    let frameSequence: number | null = null;
    let frameTimestamp: number | null = null;
    let frameAgeMs: number | null = null;
    let frameStale = true;
    let frameFormat: 'image/jpeg' | null = null;
    let effectiveSensorHealth: SensorHealthReport = { ...state.sensorHealth };
    let effectiveCapabilities: DeviceCapabilities = { ...state.capabilities };

    if (pairedCamId) {
      const camState = this.devices.get(pairedCamId);
      const camBlockedSim = Boolean(!state.isSimulator && camState?.isSimulator);
      const camMode = camState && !camBlockedSim ? this.computeSourceMode(camState, now) : 'disconnected';
      if (camState && !camBlockedSim && camMode !== 'disconnected' && camState.frame) {
        const staleThreshold = camState.runtimeConfig.sensorStaleMs || FRAME_STALE_THRESHOLD_MS;
        frameAgeMs = Math.max(0, now - camState.frame.receivedAt);
        frameStale = frameAgeMs > staleThreshold;
        frameAvailable = true;
        frameSequence = camState.frame.sequence;
        frameTimestamp = camState.frame.receivedAt;
        frameFormat = camState.frame.mimeType;
        effectiveCapabilities.camera = true;
        effectiveSensorHealth.camera = frameStale ? 'stale' : 'valid';
      } else {
        frameAvailable = false;
        frameStale = true;
        effectiveSensorHealth.camera = 'unavailable';
      }
    } else if (state.frame && connected) {
      const staleThreshold = state.runtimeConfig.sensorStaleMs || FRAME_STALE_THRESHOLD_MS;
      frameAgeMs = Math.max(0, now - state.frame.receivedAt);
      frameStale = frameAgeMs > staleThreshold;
      frameAvailable = true;
      frameSequence = state.frame.sequence;
      frameTimestamp = state.frame.receivedAt;
      frameFormat = state.frame.mimeType;
      if (frameStale && effectiveSensorHealth.camera === 'valid') {
        effectiveSensorHealth.camera = 'stale';
      }
    } else if (state.frame && !connected) {
      frameAvailable = false;
      frameStale = true;
      effectiveSensorHealth.camera = 'unavailable';
    }

    return {
      deviceId: state.deviceId,
      name: state.name,
      firmwareVersion: state.firmwareVersion,
      sourceMode,
      connected,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastTelemetryAt: state.lastTelemetryAt,
      lastSequence: state.lastSequence,
      uptimeMs: state.uptimeMs,
      batteryPercent: state.batteryPercent,
      batteryVoltageV: state.batteryVoltageV,
      batteryCharging: state.batteryCharging,
      earphoneConnected: state.earphoneConnected,
      audioVolume: state.audioVolume,
      sensors: state.sensors,
      sensorHealth: effectiveSensorHealth,
      diagnostics: state.diagnostics,
      capabilities: effectiveCapabilities,
      runtimeConfig: state.runtimeConfig,
      frameAvailable,
      frameSequence,
      frameTimestamp,
      frameAgeMs,
      frameStale,
      frameFormat,
      pendingActionsCount: state.actions.filter((a) => a.acknowledgedAt === null).length,
    };
  }

  public getLiveState(deviceId?: string): DeviceLiveState | null {
    const now = Date.now();
    if (deviceId) {
      const state = this.devices.get(deviceId);
      return state ? this.toLiveState(state, now) : null;
    }
    // Prefer connected primary hardware controllers over paired-camera-only nodes, then any connected, then first registered
    const all = this.listLiveStates();
    return (
      all.find((d) => d.sourceMode === 'hardware' && !this.isPairedCameraTarget(d.deviceId)) ||
      all.find((d) => d.sourceMode === 'hardware') ||
      all.find((d) => d.connected) ||
      all[0] ||
      null
    );
  }

  public listLiveStates(): DeviceLiveState[] {
    const now = Date.now();
    return Array.from(this.devices.values()).map((s) => this.toLiveState(s, now));
  }

  public addSseClient(res: Response): void {
    this.sseClients.add(res);
  }

  public removeSseClient(res: Response): void {
    this.sseClients.delete(res);
  }

  public broadcast(event: string, data: unknown): void {
    if (this.sseClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}
