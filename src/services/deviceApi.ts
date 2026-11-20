import type {
  AnalyticsSummary,
  DeviceCapabilities,
  DeviceCommandType,
  DeviceLiveState,
  DeviceRuntimeConfig,
  SensorEventRecord,
  SensorFusionSummary,
  WearableFrameStatus,
} from '../types/deviceProtocol';
import type {
  AnalysisResponseData,
  GeminiDiagnosticResult,
  SentraMemoryItem,
  SentraMode,
  SentraOperation,
  SystemHealthStatus,
} from '../types/sentra';

export async function fetchHealthStatus(): Promise<SystemHealthStatus> {
  const res = await fetch('/api/health', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json();
}

export async function runGeminiDiagnostic(): Promise<GeminiDiagnosticResult> {
  const res = await fetch('/api/gemini/diagnostic', {
    method: 'POST',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gemini diagnostic request failed (${res.status})`);
  return res.json();
}

export async function fetchDeviceStatus(deviceId?: string): Promise<{
  ok: boolean;
  telemetry: DeviceLiveState | null;
  devices: DeviceLiveState[];
  pendingActionsCount: number;
  deviceConfig?: DeviceRuntimeConfig;
  sensorFusion?: SensorFusionSummary | null;
}> {
  const url = deviceId
    ? `/api/device/status?deviceId=${encodeURIComponent(deviceId)}`
    : '/api/device/status';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Device status failed (${res.status})`);
  return res.json();
}

export async function fetchDeviceConfig(deviceId: string): Promise<{
  ok: boolean;
  deviceId: string;
  config: DeviceRuntimeConfig;
}> {
  const res = await fetch(`/api/device/config?deviceId=${encodeURIComponent(deviceId)}`, {
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Device config fetch failed (${res.status})`);
  return data;
}

export async function updateDeviceConfig(params: {
  deviceId: string;
  config: Partial<DeviceRuntimeConfig>;
  operatorToken?: string;
}): Promise<{ ok: boolean; deviceId: string; config: DeviceRuntimeConfig; queuedActionId?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.operatorToken?.trim()) {
    headers['X-Operator-Token'] = params.operatorToken.trim();
  }
  const res = await fetch('/api/device/config', {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId: params.deviceId, ...params.config }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Config update failed (${res.status})`);
  return data;
}

export async function sendDeviceCommand(params: {
  deviceId: string;
  type: DeviceCommandType;
  text?: string;
  payload?: Record<string, unknown>;
  operatorToken?: string;
}): Promise<{ ok: boolean; deviceId: string; action: { id: string; type: string } }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.operatorToken?.trim()) {
    headers['X-Operator-Token'] = params.operatorToken.trim();
  }
  const res = await fetch('/api/device/command', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      deviceId: params.deviceId,
      command: params.type,
      text: params.text,
      payload: params.payload,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Device command failed (${res.status})`);
  return data;
}

export async function updateAudioOwnership(
  mode: 'browser' | 'wearable' | 'test',
  operatorToken?: string
): Promise<{ ok: boolean; audioOwnership: 'browser' | 'wearable' | 'test' }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (operatorToken?.trim()) {
    headers['X-Operator-Token'] = operatorToken.trim();
  }
  const res = await fetch('/api/device/audio/ownership', {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Audio ownership update failed (${res.status})`);
  return data;
}

export async function fetchFrameStatus(deviceId: string, signal?: AbortSignal): Promise<WearableFrameStatus> {
  const res = await fetch(`/api/device/frame/status?deviceId=${encodeURIComponent(deviceId)}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`Frame status failed (${res.status})`);
  return res.json();
}

export async function fetchLatestFrameBlob(
  deviceId: string,
  signal?: AbortSignal
): Promise<{
  blob: Blob;
  deviceIdHeader: string | null;
  sequence: number | null;
  timestamp: number | null;
  stale: boolean;
}> {
  const res = await fetch(
    `/api/device/frame/latest?deviceId=${encodeURIComponent(deviceId)}&t=${Date.now()}`,
    { cache: 'no-store', signal }
  );
  if (!res.ok) {
    throw new Error(`Frame fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  const deviceIdHeader = res.headers.get('X-Device-Id');
  const seqHeader = res.headers.get('X-Frame-Sequence');
  const tsHeader = res.headers.get('X-Frame-Timestamp');
  const staleHeader = res.headers.get('X-Frame-Stale');
  return {
    blob,
    deviceIdHeader: deviceIdHeader ? deviceIdHeader.trim() : null,
    sequence: seqHeader ? Number(seqHeader) : null,
    timestamp: tsHeader ? Number(tsHeader) : null,
    stale: staleHeader === 'true',
  };
}

export async function registerHardwareDevice(params: {
  deviceId: string;
  name: string;
  capabilities: DeviceCapabilities;
  operatorToken?: string;
}): Promise<{ ok: boolean; deviceId: string; provisionedToken: string; note: string }> {
  const { operatorToken, ...body } = params;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (operatorToken?.trim()) {
    headers['X-Operator-Token'] = operatorToken.trim();
  }
  const res = await fetch('/api/device/register', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Registration failed (${res.status})`);
  return data;
}

export async function sendSimulatedTelemetry(
  payload: {
    batteryPercent?: number | null;
    forwardDistanceCm?: number | null;
    downwardDistanceMm?: number | null;
    headPitchDeg?: number | null;
    imu?: {
      ax: number;
      ay: number;
      az: number;
      gx: number;
      gy: number;
      gz: number;
      heading: number | null;
      calibrated?: boolean;
      motionMagnitude?: number;
    } | null;
  },
  operatorToken?: string
): Promise<{ ok: boolean; telemetry: DeviceLiveState }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Sentra-Simulator': 'true',
  };
  if (operatorToken?.trim()) {
    headers['X-Operator-Token'] = operatorToken.trim();
  }
  const res = await fetch('/api/device/simulate', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Simulator error (${res.status})`);
  return data;
}

export async function sendSimulatedFrame(
  frameDataUrl: string,
  operatorToken?: string
): Promise<{ ok: boolean }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Sentra-Simulator': 'true',
  };
  if (operatorToken?.trim()) {
    headers['X-Operator-Token'] = operatorToken.trim();
  }
  const res = await fetch('/api/device/simulate/frame', {
    method: 'POST',
    headers,
    body: JSON.stringify({ frame: frameDataUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Simulated frame upload failed (${res.status})`);
  return data;
}

export async function fetchAnalyticsSummary(params: {
  deviceId?: string | null;
  range: '1h' | '24h' | '7d' | 'all';
  includeSimulated: boolean;
}): Promise<AnalyticsSummary> {
  const qs = new URLSearchParams({
    range: params.range,
    includeSimulated: String(params.includeSimulated),
  });
  if (params.deviceId) qs.set('deviceId', params.deviceId);
  const res = await fetch(`/api/analytics?${qs.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Analytics fetch failed (${res.status})`);
  return res.json();
}

export async function fetchSensorEvents(params: {
  deviceId?: string;
  includeSimulated?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ ok: boolean; total: number; events: SensorEventRecord[] }> {
  const qs = new URLSearchParams({
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0),
    includeSimulated: String(Boolean(params.includeSimulated)),
  });
  if (params.deviceId) qs.set('deviceId', params.deviceId);
  const res = await fetch(`/api/events?${qs.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Events fetch failed (${res.status})`);
  return res.json();
}

export async function clearStoredTelemetryEvents(operatorToken?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (operatorToken?.trim()) {
    headers['X-Operator-Token'] = operatorToken.trim();
  }
  const res = await fetch('/api/events', { method: 'DELETE', headers });
  if (!res.ok) {
    let msg = `Failed to clear events (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
}

export async function fetchMemories(): Promise<SentraMemoryItem[]> {
  const res = await fetch('/api/memories', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Memories fetch failed (${res.status})`);
  const data = await res.json();
  return data.memories || [];
}

export async function createMemory(params: {
  label: string;
  note: string;
  room?: string;
  heading?: number | null;
  source?: 'live_verified' | 'remembered_historical' | 'user_manual';
}): Promise<SentraMemoryItem> {
  const res = await fetch('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Create memory failed (${res.status})`);
  return data.memory;
}

export async function deleteMemory(id: string): Promise<void> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete memory failed (${res.status})`);
}

export async function clearAllMemories(): Promise<void> {
  const res = await fetch('/api/memories', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Clear memories failed (${res.status})`);
}

export async function analyzeSentraObservation(
  body: {
    mode: SentraMode;
    operation?: SentraOperation;
    query: string;
    image: string | null;
    imageTimestamp: number | null;
    imageDimensions: { width: number; height: number } | null;
    sensors: string;
    goal: string | null;
    memory: SentraMemoryItem[];
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
    heading: number | null;
    useWearableFrame: boolean;
    wearableDeviceId?: string;
    language?: string;
  },
  signal?: AbortSignal
): Promise<AnalysisResponseData> {
  const res = await fetch('/api/sentra/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return res.json();
}
