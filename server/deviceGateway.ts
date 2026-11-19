import crypto from 'node:crypto';
import type { Response } from 'express';
import type {
  DeviceCapabilities,
  DeviceLiveState,
  DeviceSourceMode,
  TelemetryPayloadV1,
  WearableActionItem,
  WearableFrameStatus,
} from '../src/types/deviceProtocol';
import { hashToken, SentraEventStore } from './eventStore';

const DEFAULT_HEARTBEAT_TIMEOUT_MS = Number(process.env.SENTRA_HEARTBEAT_TIMEOUT_MS || 15000);
const FRAME_STALE_THRESHOLD_MS = Number(process.env.SENTRA_FRAME_STALE_MS || 5000);
const MAX_ACTION_QUEUE_PER_DEVICE = 20;
const ALERT_DEDUP_WINDOW_MS = 8000;

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
  isSimulator: boolean;
  connected: boolean;
  lastHeartbeatAt: number | null;
  lastTelemetryAt: number | null;
  lastSequence: number | null;
  uptimeMs: number | null;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  earphoneConnected: boolean | null;
  audioVolume: number | null;
  sensors: DeviceLiveState['sensors'];
  capabilities: DeviceCapabilities;
  frame: FrameEntry | null;
  frameSequenceCounter: number;
  actions: WearableActionItem[];
  lastAlertTimes: Record<string, number>;
}

export class DeviceGateway {
  private store: SentraEventStore;
  private devices = new Map<string, InternalDeviceState>();
  private sseClients = new Set<Response>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private heartbeatTimeoutMs: number;

  constructor(store: SentraEventStore, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS) {
    this.store = store;
    this.heartbeatTimeoutMs = Number.isFinite(heartbeatTimeoutMs) && heartbeatTimeoutMs >= 2000
      ? heartbeatTimeoutMs
      : 15000;

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

  private createEmptyState(
    deviceId: string,
    name: string,
    capabilities: DeviceCapabilities,
    isSimulator: boolean
  ): InternalDeviceState {
    return {
      deviceId,
      name,
      isSimulator,
      connected: false,
      lastHeartbeatAt: null,
      lastTelemetryAt: null,
      lastSequence: null,
      uptimeMs: null,
      batteryPercent: null,
      batteryCharging: null,
      earphoneConnected: null,
      audioVolume: null,
      sensors: {
        forwardDistanceCm: null,
        downwardDistanceMm: null,
        headPitchDeg: null,
        imu: null,
      },
      capabilities,
      frame: null,
      frameSequenceCounter: 0,
      actions: [],
      lastAlertTimes: {},
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
      existing.capabilities = params.capabilities;
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

    const envToken = process.env.SENTRA_DEVICE_TOKEN?.trim();
    if (envToken && envToken.length > 0) {
      const a = Buffer.from(hashToken(clean));
      const b = Buffer.from(hashToken(envToken));
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return true;
      }
    }

    if (deviceId) {
      const stored = this.store.getDevice(deviceId);
      if (stored?.tokenHash) {
        const providedHash = Buffer.from(hashToken(clean));
        const expectedHash = Buffer.from(stored.tokenHash);
        if (providedHash.length === expectedHash.length && crypto.timingSafeEqual(providedHash, expectedHash)) {
          return true;
        }
      }
    }

    return false;
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
    state.batteryPercent = payload.batteryPercent ?? null;
    state.batteryCharging = payload.batteryCharging ?? null;
    state.earphoneConnected = payload.earphoneConnected ?? null;
    state.audioVolume = payload.audioVolume ?? null;
    state.sensors = {
      forwardDistanceCm: payload.sensors.forwardDistanceCm,
      downwardDistanceMm: payload.sensors.downwardDistanceMm,
      headPitchDeg: payload.sensors.headPitchDeg ?? null,
      imu: payload.sensors.imu,
    };
    state.capabilities = payload.capabilities;

    this.store.upsertDevice({
      deviceId: payload.deviceId,
      name: state.name,
      capabilities: payload.capabilities,
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

    // Forward ToF proximity alert (< 45cm, valid non-null sensor)
    if (
      payload.capabilities.forwardToF &&
      payload.sensors.forwardDistanceCm !== null &&
      payload.sensors.forwardDistanceCm < 45
    ) {
      const lastTs = state.lastAlertTimes['obstacle'] || 0;
      if (now - lastTs >= ALERT_DEDUP_WINDOW_MS) {
        state.lastAlertTimes['obstacle'] = now;
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

    // Downward sensor change alert (> 200mm, explicitly framed without uncalibrated geometry claims)
    if (
      payload.capabilities.downwardToF &&
      payload.sensors.downwardDistanceMm !== null &&
      payload.sensors.downwardDistanceMm > 200
    ) {
      const lastTs = state.lastAlertTimes['dropoff'] || 0;
      if (now - lastTs >= ALERT_DEDUP_WINDOW_MS) {
        state.lastAlertTimes['dropoff'] = now;
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

  public ingestFrame(params: {
    deviceId: string;
    buffer: Buffer;
    sequence?: number;
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

    const seq = params.sequence !== undefined ? params.sequence : ++state.frameSequenceCounter;
    if (state.frame && params.sequence !== undefined && params.sequence <= state.frame.sequence) {
      return { ok: true, status: this.getFrameStatus(params.deviceId) };
    }

    const wasConnected = state.connected;
    state.connected = true;
    state.lastHeartbeatAt = now;
    state.capabilities.camera = true;
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
    return { ok: true, status: frameStatus };
  }

  public getLatestFrame(deviceId: string): {
    available: boolean;
    stale: boolean;
    frame: FrameEntry | null;
    ageMs: number | null;
  } {
    const state = this.devices.get(deviceId);
    if (!state || !state.frame) {
      return { available: false, stale: true, frame: null, ageMs: null };
    }
    const ageMs = Math.max(0, Date.now() - state.frame.receivedAt);
    return {
      available: true,
      stale: ageMs > FRAME_STALE_THRESHOLD_MS,
      frame: state.frame,
      ageMs,
    };
  }

  public getFrameStatus(deviceId: string): WearableFrameStatus {
    const now = Date.now();
    const state = this.devices.get(deviceId);
    if (!state || !state.frame) {
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

    const ageMs = Math.max(0, now - state.frame.receivedAt);
    return {
      ok: true,
      deviceId,
      frameAvailable: true,
      sequence: state.frame.sequence,
      lastReceivedTimestamp: state.frame.receivedAt,
      frameAgeMs: ageMs,
      stale: ageMs > FRAME_STALE_THRESHOLD_MS,
      imageFormat: state.frame.mimeType,
      sizeBytes: state.frame.sizeBytes,
      connectionStatus: this.computeSourceMode(state, now),
    };
  }

  public enqueueAction(
    deviceId: string,
    action: {
      type: WearableActionItem['type'];
      text: string;
      priority: WearableActionItem['priority'];
      audioReplyId?: string | null;
      audioUrl?: string | null;
      audioFormat?: 'wav' | null;
      audioDurationMs?: number | null;
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
      audioReplyId: action.audioReplyId ?? null,
      audioUrl: action.audioUrl ?? null,
      audioFormat: action.audioFormat ?? null,
      audioDurationMs: action.audioDurationMs ?? null,
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
    return state.actions.filter((a) => a.acknowledgedAt === null);
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
    const frameAgeMs = state.frame ? Math.max(0, now - state.frame.receivedAt) : null;

    return {
      deviceId: state.deviceId,
      name: state.name,
      sourceMode,
      connected,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastTelemetryAt: state.lastTelemetryAt,
      lastSequence: state.lastSequence,
      uptimeMs: state.uptimeMs,
      batteryPercent: state.batteryPercent,
      batteryCharging: state.batteryCharging,
      earphoneConnected: state.earphoneConnected,
      audioVolume: state.audioVolume,
      sensors: state.sensors,
      capabilities: state.capabilities,
      frameAvailable: Boolean(state.frame),
      frameSequence: state.frame?.sequence ?? null,
      frameTimestamp: state.frame?.receivedAt ?? null,
      frameAgeMs,
      frameStale: frameAgeMs === null || frameAgeMs > FRAME_STALE_THRESHOLD_MS,
      frameFormat: state.frame?.mimeType ?? null,
      pendingActionsCount: state.actions.filter((a) => a.acknowledgedAt === null).length,
    };
  }

  public getLiveState(deviceId?: string): DeviceLiveState | null {
    const now = Date.now();
    if (deviceId) {
      const state = this.devices.get(deviceId);
      return state ? this.toLiveState(state, now) : null;
    }
    // Prefer connected hardware, then any connected, then first registered
    const all = this.listLiveStates();
    return (
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
