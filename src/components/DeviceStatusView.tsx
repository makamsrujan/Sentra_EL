import React, { useState } from 'react';
import {
  Cpu,
  Wifi,
  WifiOff,
  Battery,
  BatteryCharging,
  Headphones,
  AlertTriangle,
  ShieldCheck,
  Sliders,
  FlaskConical,
  BarChart3,
  Clock,
  RefreshCw,
  Download,
  Camera,
} from 'lucide-react';
import type { AnalyticsSummary, DeviceLiveState, SensorReadingStatus } from '../types/deviceProtocol';
import { sendSimulatedFrame, sendSimulatedTelemetry } from '../services/deviceApi';
import { generateDemoRoomDataUrl } from '../utils/demoRoom';
import { evaluateSensorFusion } from '../utils/sensorFusion';

interface DeviceStatusViewProps {
  devices: DeviceLiveState[];
  activeDevice: DeviceLiveState | null;
  selectedDeviceId: string;
  onSelectDeviceId: (deviceId: string) => void;
  sseConnected: boolean;
  telemetryError: string | null;
  analytics: AnalyticsSummary | null;
  analyticsRange: '1h' | '24h' | '7d' | 'all';
  onChangeAnalyticsRange: (range: '1h' | '24h' | '7d' | 'all') => void;
  includeSimulatedAnalytics: boolean;
  onToggleIncludeSimulated: (include: boolean) => void;
  onRefreshAnalytics: () => void;
  audioOwnership?: 'browser' | 'wearable' | 'test';
  onChangeAudioOwnership?: (mode: 'browser' | 'wearable' | 'test') => void;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function sensorStatusBadgeClasses(status: SensorReadingStatus): string {
  switch (status) {
    case 'valid':
      return 'bg-success/15 text-success border-success/40';
    case 'stale':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/40';
    case 'invalid':
      return 'bg-destructive/15 text-destructive border-destructive/40';
    default:
      return 'bg-secondary text-muted-foreground border-border/60';
  }
}

export const DeviceStatusView: React.FC<DeviceStatusViewProps> = ({
  devices,
  activeDevice,
  selectedDeviceId,
  onSelectDeviceId,
  sseConnected,
  telemetryError,
  analytics,
  analyticsRange,
  onChangeAnalyticsRange,
  includeSimulatedAnalytics,
  onToggleIncludeSimulated,
  onRefreshAnalytics,
  audioOwnership,
  onChangeAudioOwnership,
}) => {
  const [showSimulator, setShowSimulator] = useState(false);
  const [simForwardCm, setSimForwardCm] = useState(150);
  const [simDownwardMm, setSimDownwardMm] = useState(85);
  const [simBatteryPct, setSimBatteryPct] = useState(80);
  const [simIncludeDownward, setSimIncludeDownward] = useState(false);
  const [simOperatorToken, setSimOperatorToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem('sentra.operator.token') || '';
    } catch {
      return '';
    }
  });
  const [simFeedback, setSimFeedback] = useState<string | null>(null);

  const dev = activeDevice;
  const isConnected = Boolean(dev?.connected);
  const isSimulator = dev?.sourceMode === 'simulator';
  const fusion = dev ? evaluateSensorFusion(dev) : null;
  const criticalCm = dev?.runtimeConfig?.proximityCriticalCm ?? 45;

  const statusBadge = !dev || !isConnected
    ? { label: 'Disconnected', classes: 'bg-secondary text-muted-foreground border-border', Icon: WifiOff }
    : isSimulator
    ? { label: 'Simulator Testbench', classes: 'bg-accent/15 text-accent border-accent/50', Icon: FlaskConical }
    : { label: 'Hardware Live', classes: 'bg-success/15 text-success border-success/50', Icon: Wifi };

  const StatusIcon = statusBadge.Icon;

  const pushSimTelemetry = async (overrides?: {
    forwardDistanceCm?: number;
    downwardDistanceMm?: number;
    batteryPercent?: number;
    includeDownward?: boolean;
  }) => {
    const fwd = overrides?.forwardDistanceCm ?? simForwardCm;
    const includeDown = overrides?.includeDownward ?? simIncludeDownward;
    const down = includeDown ? overrides?.downwardDistanceMm ?? simDownwardMm : null;
    const bat = overrides?.batteryPercent ?? simBatteryPct;
    if (overrides?.forwardDistanceCm !== undefined) setSimForwardCm(fwd);
    if (overrides?.downwardDistanceMm !== undefined) setSimDownwardMm(overrides.downwardDistanceMm);
    if (overrides?.batteryPercent !== undefined) setSimBatteryPct(bat);

    try {
      await sendSimulatedTelemetry(
        {
          forwardDistanceCm: fwd,
          downwardDistanceMm: down,
          batteryPercent: bat,
          headPitchDeg: -4,
          imu: {
            ax: 0.05,
            ay: 0.02,
            az: 9.81,
            gx: 0.2,
            gy: -0.1,
            gz: 0.0,
            heading: null,
            calibrated: true,
            motionMagnitude: 0.05,
          },
        },
        simOperatorToken.trim() || undefined
      );
      setSimFeedback(
        `Sent simulated packet (Forward VL53L0X: ${fwd} cm${
          down !== null ? `, Downward override: ${down} mm` : ''
        }, Battery: ${bat}%).`
      );
      onRefreshAnalytics();
    } catch (err: any) {
      setSimFeedback(err?.message || 'Simulator update rejected.');
    }
  };

  const pushSimFrame = async () => {
    try {
      const dataUrl = generateDemoRoomDataUrl(0);
      await sendSimulatedFrame(dataUrl, simOperatorToken.trim() || undefined);
      setSimFeedback('Uploaded test JPEG frame to SIM-ESP32-01. Select Wearable Camera & SIM-ESP32-01 to preview.');
    } catch (err: any) {
      setSimFeedback(err?.message || 'Simulated frame upload failed.');
    }
  };

  const maxAlertBucket = Math.max(
    1,
    ...(analytics?.alertsByHour.map((b) => b.count) || [1])
  );

  return (
    <div className="space-y-4 text-foreground">
      {/* Hardware Telemetry Status Panel */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cpu className="h-5 w-5 text-primary shrink-0" />
            <div>
              <h3 className="font-bold text-lg leading-tight">ESP32-S3 Wearable Gateway</h3>
              <p className="text-xs text-muted-foreground font-mono">
                Stream: {sseConnected ? 'SSE Live' : 'Polling Fallback'}
                {dev?.firmwareVersion ? ` · FW ${dev.firmwareVersion}` : ''}
                {dev?.lastHeartbeatAt
                  ? ` · Heartbeat: ${new Date(dev.lastHeartbeatAt).toLocaleTimeString()}`
                  : ' · No heartbeat received'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {devices.length > 0 && (
              <select
                aria-label="Select wearable device"
                value={selectedDeviceId}
                onChange={(e) => onSelectDeviceId(e.target.value)}
                className="rounded-lg bg-secondary border border-border px-2.5 py-1.5 text-xs font-mono text-foreground"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.deviceId} ({d.sourceMode})
                  </option>
                ))}
              </select>
            )}

            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${statusBadge.classes}`}
            >
              <StatusIcon className="h-3.5 w-3.5" />
              <span>{statusBadge.label}</span>
            </span>
          </div>
        </div>

        {telemetryError && (
          <p className="text-xs font-mono text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
            {telemetryError}
          </p>
        )}

        {/* Real Sensor Metrics Grid (Nullable when unavailable; zero never shown as clear) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Forward Distance (VL53L0X Headband) */}
          <div className="rounded-xl bg-secondary p-3 border border-border/60">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Forward VL53L0X</span>
              {dev?.connected &&
              dev.sensors.forwardDistanceCm !== null &&
              dev.sensors.forwardDistanceCm < criticalCm ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <p
              className={`text-2xl font-bold mt-1 font-mono tabular-nums ${
                dev?.connected &&
                dev.sensors.forwardDistanceCm !== null &&
                dev.sensors.forwardDistanceCm < criticalCm
                  ? 'text-destructive'
                  : 'text-foreground'
              }`}
            >
              {dev?.connected && dev.capabilities.forwardToF && dev.sensors.forwardDistanceCm !== null
                ? `${Math.round(dev.sensors.forwardDistanceCm)} cm`
                : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {!dev?.connected
                ? 'Offline'
                : fusion
                ? `Status: ${fusion.forwardStatus} (Alert < ${criticalCm} cm)`
                : dev.capabilities.forwardToF
                ? `Range 2–400 cm (Alert < ${criticalCm} cm)`
                : 'Not equipped'}
            </p>
          </div>

          {/* GY-521 MPU6050 6-axis IMU */}
          <div className="rounded-xl bg-secondary p-3 border border-border/60">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>MPU6050 IMU</span>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground mt-1 font-mono tabular-nums">
              {dev?.connected && dev.capabilities.imu && dev.sensors.headPitchDeg !== null
                ? `${Math.round(dev.sensors.headPitchDeg)}° Pitch`
                : dev?.connected && dev.capabilities.imu && dev.sensors.imu
                ? 'Active'
                : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {!dev?.connected
                ? 'Offline'
                : !dev.capabilities.imu
                ? 'Not equipped'
                : fusion
                ? `${fusion.imuCalibrated ? 'Calibrated' : 'Uncalibrated'} · 6-axis (No compass)`
                : '6-axis (No compass)'}
            </p>
          </div>

          {/* Battery */}
          <div className="rounded-xl bg-secondary p-3 border border-border/60">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Power / Battery</span>
              {dev?.batteryCharging ? (
                <BatteryCharging className="h-4 w-4 text-success" />
              ) : (
                <Battery className="h-4 w-4 text-primary" />
              )}
            </div>
            <p className="text-2xl font-bold text-foreground mt-1 font-mono tabular-nums">
              {!dev?.connected
                ? '—'
                : dev.batteryPercent !== null
                ? `${Math.round(dev.batteryPercent)}%`
                : dev.batteryVoltageV !== null && dev.batteryVoltageV !== undefined
                ? `${dev.batteryVoltageV.toFixed(2)} V`
                : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {!dev?.connected
                ? 'Offline'
                : dev.batteryPercent !== null &&
                  dev.batteryVoltageV !== null &&
                  dev.batteryVoltageV !== undefined
                ? `${dev.batteryVoltageV.toFixed(2)} V · ADC1 GPIO6`
                : dev.batteryPercent !== null
                ? 'Reported'
                : dev.batteryVoltageV !== null && dev.batteryVoltageV !== undefined
                ? 'ADC1 GPIO6 (Measured)'
                : '5000mAh USB Bank (No Fuel Gauge)'}
            </p>
          </div>

          {/* Optional Audio / Downward Depth */}
          <div className="rounded-xl bg-secondary p-3 border border-border/60">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Optional Modules</span>
              <Headphones className="h-4 w-4 text-accent" />
            </div>
            <p className="text-sm font-bold text-foreground mt-2 font-mono tabular-nums">
              {!dev?.connected
                ? 'Offline'
                : dev.capabilities.audioOutput
                ? dev.earphoneConnected
                  ? `Earphone (${dev.audioVolume ?? '--'}%)`
                  : 'WM8960 Disconnected'
                : 'Baseline Headband'}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {!dev?.connected
                ? 'Offline'
                : dev.capabilities.downwardToF && dev.sensors.downwardDistanceMm !== null
                ? `Downward: ${Math.round(dev.sensors.downwardDistanceMm)} mm`
                : dev.capabilities.vl53l5cx
                ? 'VL53L5CX Equipped'
                : 'VL53L5CX / WM8960: Not Installed'}
            </p>
          </div>
        </div>

        {/* Sensor Health & Fusion Summary */}
        {dev && fusion && (
          <div className="rounded-xl bg-secondary/50 border border-border/60 p-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-foreground">Sensor Fusion & Health Verification</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                Forward Obstruction: <strong className="text-foreground uppercase">{fusion.forwardObstruction}</strong> · Drop-off Sensor:{' '}
                <strong className="text-foreground">
                  {fusion.downwardDropOffCapable ? 'Active' : 'Unavailable (Forward-only VL53L0X)'}
                </strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              {(
                [
                  ['VL53L0X', fusion.forwardStatus],
                  ['MPU6050', fusion.imuStatus],
                  ['OV2640', fusion.cameraStatus],
                  ['VL53L5CX (Opt)', fusion.vl53l5cxStatus],
                  ['WM8960 (Opt)', fusion.wm8960Status],
                ] as Array<[string, SensorReadingStatus]>
              ).map(([name, st]) => (
                <span
                  key={name}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-bold ${sensorStatusBadgeClasses(st)}`}
                >
                  <span>{name}:</span>
                  <span className="uppercase">{st}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-card px-2 py-0.5 text-muted-foreground">
                <span>SLAM:</span>
                <span>PLANNED</span>
              </span>
            </div>
            {fusion.advisories.length > 0 && (
              <p className="text-[11px] text-amber-300 font-mono">{fusion.advisories[0]}</p>
            )}
          </div>
        )}

        {/* Reported Hardware Capabilities Row */}
        {dev && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/40 text-xs text-muted-foreground font-mono">
            <span>Capabilities:</span>
            <span>OV2640 Camera: {dev.capabilities.camera ? 'Yes' : 'No'}</span>
            <span>· Forward VL53L0X: {dev.capabilities.forwardToF ? 'Yes' : 'No'}</span>
            <span>· MPU6050 IMU: {dev.capabilities.imu ? 'Yes' : 'No'}</span>
            <span>· VL53L5CX (Opt): {dev.capabilities.vl53l5cx ? 'Yes' : 'No'}</span>
            <span>· WM8960 (Opt): {dev.capabilities.audioOutput ? 'Yes' : 'No'}</span>
            <span>· Downward ToF (Opt): {dev.capabilities.downwardToF ? 'Yes' : 'No'}</span>
          </div>
        )}

        {/* WM8960 Headset Audio Subsystem Diagnostics (Optional) */}
        <div className="mt-4 pt-3 border-t border-border/50">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Headphones className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Audio Output & Optional WM8960 Subsystem
              </h4>
            </div>
            {onChangeAudioOwnership && (
              <div className="flex items-center gap-1 bg-secondary/80 p-0.5 rounded-lg border border-border/60 text-[11px] font-mono">
                <span className="px-2 text-muted-foreground">Ownership:</span>
                {(['browser', 'wearable', 'test'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeAudioOwnership(mode)}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      audioOwnership === mode
                        ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-secondary/60 p-2.5 border border-border/40 font-mono">
              <div className="flex justify-between items-center text-muted-foreground mb-1">
                <span>WM8960 Audio Codec:</span>
                <span className="text-foreground font-semibold">
                  {dev?.capabilities.audioOutput ? 'Enabled on Device' : 'Optional / Disabled by Default'}
                </span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground mb-1">
                <span>Interface:</span>
                <span>I²S Data + I²C Control (0x1A)</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Microphone Capture:</span>
                <span>Browser Web Speech (Primary) / PCM 16 kHz</span>
              </div>
            </div>

            <div className="rounded-lg bg-secondary/60 p-2.5 border border-border/40 font-mono">
              <div className="flex justify-between items-center text-muted-foreground mb-1">
                <span>Headset Output:</span>
                <span>Browser TTS / Optional 24 kHz WAV</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground mb-1">
                <span>Firmware Version:</span>
                <span>{dev?.firmwareVersion || 'Unreported'}</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Local Proximity Cues:</span>
                <span className="text-emerald-400 font-semibold">Threshold-driven (&lt; {criticalCm} cm)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Persistent Analytics Dashboard (Backed by SQLite Event Store) */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <BarChart3 className="h-5 w-5" />
            <span>Device & Analytics</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Time range buttons */}
            <div className="flex items-center gap-1 p-1 bg-secondary rounded-lg border border-border/50">
              {(['1h', '24h', '7d', 'all'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onChangeAnalyticsRange(r)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-bold ${
                    analyticsRange === r
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer px-2">
              <input
                type="checkbox"
                checked={includeSimulatedAnalytics}
                onChange={(e) => onToggleIncludeSimulated(e.target.checked)}
                className="accent-accent"
              />
              <span>Include simulator</span>
            </label>

            <button
              type="button"
              onClick={onRefreshAnalytics}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary border border-border px-2.5 py-1.5 text-xs font-semibold hover:border-primary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>

            <a
              href="/api/events/export"
              download="sentra-events-export.json"
              className="inline-flex items-center gap-1 rounded-lg bg-secondary border border-border px-2.5 py-1.5 text-xs font-semibold hover:border-primary"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export</span>
            </a>
          </div>
        </div>

        {/* Analytics KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums">
          <div className="rounded-xl bg-secondary p-3 border border-border/50">
            <span className="text-[11px] font-sans text-muted-foreground">Estimated Uptime</span>
            <p className="text-xl font-bold text-foreground mt-0.5">
              {analytics ? formatDurationMs(analytics.uptimeEstimateMs) : '0s'}
            </p>
          </div>
          <div className="rounded-xl bg-secondary p-3 border border-border/50">
            <span className="text-[11px] font-sans text-muted-foreground">Active Session</span>
            <p className="text-xl font-bold text-foreground mt-0.5">
              {analytics ? formatDurationMs(analytics.sessionDurationMs) : '0s'}
            </p>
          </div>
          <div className="rounded-xl bg-secondary p-3 border border-border/50">
            <span className="text-[11px] font-sans text-muted-foreground">Sensor Events</span>
            <p className="text-xl font-bold text-primary mt-0.5">
              {analytics?.totalSensorEvents ?? 0}
            </p>
          </div>
          <div className="rounded-xl bg-secondary p-3 border border-border/50">
            <span className="text-[11px] font-sans text-muted-foreground">Proximity Alerts</span>
            <p className="text-xl font-bold text-destructive mt-0.5">
              {analytics?.proximityAlertCount ?? 0}
            </p>
          </div>
        </div>

        {/* Empty State vs Populated Charts */}
        {!analytics ||
        (analytics.totalSensorEvents === 0 &&
          analytics.totalAlerts === 0 &&
          analytics.connectionHistory.length === 0) ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground space-y-1.5">
            <BarChart3 className="mx-auto h-7 w-7 opacity-40" />
            <p className="text-sm font-bold text-foreground">No recorded sensor data yet.</p>
            <p className="text-xs max-w-md mx-auto">
              Connect authenticated ESP32-S3 hardware (or enable "Include simulator" and push test events below) to view real persisted telemetry and alert charts.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sensor History SVG Trend */}
            {analytics.sensorHistory.length > 0 && (
              <div className="rounded-xl bg-secondary/50 border border-border/50 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-foreground">
                    Forward ToF Distance History ({analytics.sensorHistory.length} samples)
                  </span>
                  <span className="text-muted-foreground font-mono">cm</span>
                </div>
                <svg viewBox="0 0 600 120" className="w-full h-28 overflow-visible">
                  <line x1="0" y1="95" x2="600" y2="95" stroke="currentColor" className="text-border/40" strokeDasharray="3 3" />
                  {(() => {
                    const pts = analytics.sensorHistory.filter((p) => p.forwardDistanceCm !== null);
                    if (pts.length < 2) {
                      return (
                        <text x="10" y="60" fill="currentColor" className="fill-muted-foreground text-xs font-mono">
                          Collecting samples…
                        </text>
                      );
                    }
                    const maxVal = Math.max(100, ...pts.map((p) => p.forwardDistanceCm || 0));
                    const pathD = pts
                      .map((p, idx) => {
                        const x = (idx / Math.max(1, pts.length - 1)) * 600;
                        const y = 110 - ((p.forwardDistanceCm || 0) / maxVal) * 95;
                        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
                      })
                      .join(' ');
                    return (
                      <path
                        d={pathD}
                        fill="none"
                        stroke="#ffd15c"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                      />
                    );
                  })()}
                </svg>
              </div>
            )}

            {/* Alerts by Time */}
            {analytics.alertsByHour.length > 0 && (
              <div className="rounded-xl bg-secondary/50 border border-border/50 p-3 space-y-2">
                <span className="font-bold text-xs text-foreground block">Alerts by Hour</span>
                <div className="flex items-end gap-1.5 h-24 pt-2">
                  {analytics.alertsByHour.map((b) => (
                    <div key={b.timestamp} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div
                        className="w-full max-w-[28px] rounded-t bg-destructive/80"
                        style={{ height: `${Math.max(8, Math.round((b.count / maxAlertBucket) * 64))}px` }}
                        title={`${b.bucketLabel}: ${b.count} alerts`}
                      />
                      <span className="text-[10px] font-mono text-muted-foreground truncate max-w-full">
                        {b.bucketLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Battery History (only shown when real non-null battery readings exist) */}
            {analytics.batteryHistory.length > 0 && (
              <div className="rounded-xl bg-secondary/50 border border-border/50 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-foreground">Battery Level History</span>
                  <span className="font-mono text-muted-foreground tabular-nums">
                    Latest: {analytics.batteryHistory[analytics.batteryHistory.length - 1].batteryPercent}%
                  </span>
                </div>
                <div className="flex items-center gap-1 h-6">
                  {analytics.batteryHistory.slice(-30).map((b, i) => (
                    <div
                      key={`${b.timestamp}-${i}`}
                      className="flex-1 bg-success/70 rounded-sm"
                      style={{ height: `${Math.max(15, b.batteryPercent)}%` }}
                      title={`${new Date(b.timestamp).toLocaleTimeString()}: ${b.batteryPercent}%`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent Device Activity & Connection History */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 space-y-2">
                <span className="font-bold text-xs text-foreground block">
                  Recent Alerts ({analytics.recentAlerts.length})
                </span>
                {analytics.recentAlerts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No alerts in selected window.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {analytics.recentAlerts.slice(0, 10).map((a) => (
                      <div
                        key={a.id}
                        className="text-xs p-2 rounded-lg bg-card border border-border/40 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-destructive uppercase">{a.alertType}</span>
                          <span className="text-muted-foreground font-mono"> · {a.sourceMode}</span>
                          <p className="text-foreground/90 truncate">{a.description}</p>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
                          {new Date(a.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 space-y-2">
                <span className="font-bold text-xs text-foreground block">
                  Connection History ({analytics.connectionHistory.length})
                </span>
                {analytics.connectionHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No connection transitions logged.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {analytics.connectionHistory.slice(0, 10).map((c) => (
                      <div
                        key={c.id}
                        className="text-xs p-2 rounded-lg bg-card border border-border/40 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-foreground">{c.deviceId}</span>
                          <span className="text-muted-foreground"> · {c.eventType} ({c.sourceMode})</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums">
                          {new Date(c.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Explicitly Separated Developer Testbench Simulator */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-base text-accent">
            <FlaskConical className="h-5 w-5" />
            <span>Developer Testbench Simulator (Not Real Hardware)</span>
          </div>
          <button
            type="button"
            onClick={() => setShowSimulator((s) => !s)}
            className="text-xs font-bold text-primary hover:underline"
          >
            {showSimulator ? 'Hide Testbench' : 'Open Testbench'}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Sends clearly isolated simulated packets to <span className="font-mono text-foreground">SIM-ESP32-01</span>.
          Never alters real hardware metrics or device connection state.
        </p>

        {showSimulator && (
          <div className="space-y-3 pt-3 border-t border-border/50">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={simOperatorToken}
                onChange={(e) => {
                  const val = e.target.value;
                  setSimOperatorToken(val);
                  try {
                    sessionStorage.setItem('sentra.operator.token', val);
                  } catch {}
                }}
                placeholder="Operator Token (SENTRA_OPERATOR_TOKEN)"
                className="flex-1 min-w-[220px] rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-mono text-foreground"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => pushSimTelemetry({ forwardDistanceCm: 28, includeDownward: false })}
                className="rounded-lg bg-destructive/15 text-destructive border border-destructive/40 px-3 py-1.5 text-xs font-bold"
              >
                Sim Proximity (28 cm)
              </button>
              <button
                type="button"
                onClick={() => pushSimTelemetry({ downwardDistanceMm: 350, includeDownward: true })}
                className="rounded-lg bg-destructive/15 text-destructive border border-destructive/40 px-3 py-1.5 text-xs font-bold"
              >
                Sim Optional Drop-Off (350 mm)
              </button>
              <button
                type="button"
                onClick={() =>
                  pushSimTelemetry({ forwardDistanceCm: 150, batteryPercent: 80, includeDownward: false })
                }
                className="rounded-lg bg-secondary text-foreground border border-border px-3 py-1.5 text-xs font-bold"
              >
                Send Baseline Packet
              </button>
              <button
                type="button"
                onClick={pushSimFrame}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-bold"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Push Test JPEG Frame</span>
              </button>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={simIncludeDownward}
                onChange={(e) => setSimIncludeDownward(e.target.checked)}
                className="accent-accent"
              />
              <span>Include optional downward reading (not on baseline hardware)</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between font-mono">
                  <span>Forward VL53L0X (cm):</span>
                  <span>{simForwardCm}</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={300}
                  value={simForwardCm}
                  onChange={(e) => setSimForwardCm(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between font-mono">
                  <span>Optional Downward (mm):</span>
                  <span>{simIncludeDownward ? simDownwardMm : 'disabled'}</span>
                </div>
                <input
                  type="range"
                  min={40}
                  max={500}
                  disabled={!simIncludeDownward}
                  value={simDownwardMm}
                  onChange={(e) => setSimDownwardMm(Number(e.target.value))}
                  className="w-full accent-accent disabled:opacity-40"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between font-mono">
                  <span>Battery (%):</span>
                  <span>{simBatteryPct}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={simBatteryPct}
                  onChange={(e) => setSimBatteryPct(Number(e.target.value))}
                  className="w-full accent-success"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => pushSimTelemetry()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 py-1.5 text-xs font-bold"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>Send Simulated Telemetry</span>
              </button>
              {simFeedback && (
                <span className="text-xs font-mono text-muted-foreground">{simFeedback}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
