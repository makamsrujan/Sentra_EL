import React, { useCallback, useEffect, useState } from 'react';
import {
  Sliders,
  PlayCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
  Cpu,
  KeyRound,
  Download,
  Trash2,
  AlertTriangle,
  Volume2,
  VolumeX,
  Mic,
  Smartphone,
} from 'lucide-react';
import { SentraSettings, SystemHealthStatus } from '../types/sentra';
import { DeviceLiveState } from '../types/deviceProtocol';
import { speakText } from '../utils/audio';
import {
  clearStoredTelemetryEvents,
  fetchHealthStatus,
  registerHardwareDevice,
} from '../services/deviceApi';
import type { BrowserCameraErrorType, BrowserCameraStatus } from '../hooks/useCamera';
import type { VoiceAssistantState, VoiceCompatibilityInfo } from '../hooks/useVoiceAssistant';
import { PWAInstallButton } from './PWAInstallButton';

interface CameraDiagnosticsSnapshot {
  source: string;
  browserStatus: BrowserCameraStatus | string;
  browserErrorType?: BrowserCameraErrorType;
  browserError: string | null;
  isEmbedded?: boolean;
  resolution: { width: number; height: number } | null;
  wearableFrameAgeMs: number | null;
  wearableFrameStale: boolean;
  wearableConnected: boolean;
}

interface SettingsDiagnosticsViewProps {
  settings: SentraSettings;
  onUpdateSettings: (settings: SentraSettings) => void;
  activeDevice: DeviceLiveState | null;
  cameraDiagnostics: CameraDiagnosticsSnapshot | null;
  lastAppError: string | null;
  voiceState: VoiceAssistantState;
  voiceError: string | null;
  voiceCompatibility: VoiceCompatibilityInfo;
  onToggleWakeWord: (enabled: boolean) => void | Promise<unknown>;
  onRestartMicrophone: () => void | Promise<unknown>;
  onDeviceRegistered?: (deviceId: string) => void;
}

export const SettingsDiagnosticsView: React.FC<SettingsDiagnosticsViewProps> = ({
  settings,
  onUpdateSettings,
  activeDevice,
  cameraDiagnostics,
  lastAppError,
  voiceState,
  voiceError,
  voiceCompatibility,
  onToggleWakeWord,
  onRestartMicrophone,
  onDeviceRegistered,
}) => {
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Hardware Device Registration Form
  const [regDeviceId, setRegDeviceId] = useState('ESP32-S3-SENTRA-001');
  const [regName, setRegName] = useState('SENTRA Headband Unit');
  const [regCaps, setRegCaps] = useState({
    camera: true,
    forwardToF: true,
    downwardToF: false,
    imu: false,
    audioOutput: false,
  });
  const [provisionedResult, setProvisionedResult] = useState<{
    deviceId: string;
    token: string;
  } | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [confirmClearEvents, setConfirmClearEvents] = useState(false);

  const runDiagnosticsRefresh = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const h = await fetchHealthStatus();
      setHealth(h);
      setHealthError(null);
    } catch (err: any) {
      setHealth(null);
      setHealthError(err?.message || 'Backend unreachable');
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    runDiagnosticsRefresh();
  }, [runDiagnosticsRefresh]);

  const speechRecSupported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const speechSynthSupported =
    typeof window !== 'undefined' && Boolean(window.speechSynthesis);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setProvisionedResult(null);
    try {
      const res = await registerHardwareDevice({
        deviceId: regDeviceId.trim(),
        name: regName.trim(),
        capabilities: regCaps,
      });
      setProvisionedResult({ deviceId: res.deviceId, token: res.provisionedToken });
      onDeviceRegistered?.(res.deviceId);
    } catch (err: any) {
      setRegError(err?.message || 'Device registration failed');
    }
  };

  const diagnosticRows = [
    {
      label: 'Backend Server Reachable',
      healthy: Boolean(health && !healthError),
      detail: healthError ? healthError : health ? `Online (${health.name})` : 'Checking…',
    },
    {
      label: 'SQLite Event Persistence',
      healthy: Boolean(health?.databaseAvailable),
      detail: health?.databaseAvailable
        ? 'SQLite operational (WAL mode)'
        : health?.databaseError || 'Database unavailable',
    },
    {
      label: 'Gemini API Configured',
      healthy: Boolean(health?.hasApiKey),
      detail: health?.hasApiKey
        ? `Key present · Model: ${health.configuredModel}`
        : 'Missing GEMINI_API_KEY on server',
    },
    {
      label: 'Browser Camera & Environment',
      healthy: cameraDiagnostics?.browserStatus === 'streaming',
      detail:
        cameraDiagnostics?.browserStatus === 'streaming'
          ? `Streaming ${cameraDiagnostics.resolution?.width ?? '?'}×${cameraDiagnostics.resolution?.height ?? '?'}${
              cameraDiagnostics.isEmbedded ? ' (Embedded frame)' : ''
            }`
          : `${
              cameraDiagnostics?.browserErrorType
                ? `[${cameraDiagnostics.browserErrorType}] `
                : ''
            }${cameraDiagnostics?.browserError || `Status: ${cameraDiagnostics?.browserStatus || 'idle'}`}`,
    },
    {
      label: 'Wearable Camera Frames',
      healthy: Boolean(
        cameraDiagnostics?.wearableConnected &&
          cameraDiagnostics.wearableFrameAgeMs !== null &&
          !cameraDiagnostics.wearableFrameStale
      ),
      detail:
        cameraDiagnostics?.wearableFrameAgeMs != null
          ? `Last frame age: ${Math.round(cameraDiagnostics.wearableFrameAgeMs)} ms (${
              cameraDiagnostics.wearableFrameStale ? 'stale' : 'fresh'
            })`
          : 'No wearable frames received',
    },
    {
      label: 'Real Hardware Connected',
      healthy: Boolean(activeDevice?.connected && activeDevice.sourceMode === 'hardware'),
      detail:
        activeDevice?.sourceMode === 'hardware' && activeDevice.connected
          ? `${activeDevice.deviceId} · Telemetry age ${
              activeDevice.lastTelemetryAt
                ? `${Math.max(0, Math.round((Date.now() - activeDevice.lastTelemetryAt) / 1000))}s`
                : 'N/A'
            }`
          : activeDevice?.sourceMode === 'simulator'
          ? 'Simulator active (not physical hardware)'
          : 'No real ESP32-S3 hardware connected',
    },
    {
      label: 'Voice Wake Word & Speech Engine',
      healthy: speechRecSupported && speechSynthSupported && voiceState !== 'error',
      detail: voiceError
        ? `Voice Error: ${voiceError}`
        : `State: ${voiceState} · ${voiceCompatibility.modeSummary}`,
    },
  ];

  return (
    <div className="space-y-4 text-foreground">
      {/* Live System Diagnostics */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg text-accent">
            <ShieldCheck className="h-5 w-5" />
            <span>Live System Diagnostics</span>
          </div>
          <button
            type="button"
            onClick={runDiagnosticsRefresh}
            disabled={checkingHealth}
            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-bold hover:border-primary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
            <span>Re-check Health</span>
          </button>
        </div>

        {lastAppError && (
          <div className="rounded-lg bg-destructive/15 border border-destructive/40 p-3 flex items-start gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-destructive">Latest Runtime Error: </span>
              <span className="font-mono text-foreground">{lastAppError}</span>
            </div>
          </div>
        )}

        <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-secondary/40">
          {diagnosticRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
              <div>
                <p className="font-bold text-foreground">{row.label}</p>
                <p className="text-muted-foreground font-mono">{row.detail}</p>
              </div>
              <span
                className={`inline-flex items-center gap-1 font-mono font-bold shrink-0 ${
                  row.healthy ? 'text-success' : 'text-muted-foreground'
                }`}
              >
                {row.healthy ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span>HEALTHY</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span>INACTIVE / WARN</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Voice & Interaction Preferences */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg text-primary">
          <Sliders className="h-5 w-5" />
          <span>Voice & Interaction Settings</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Speech Rate</span>
              <span className="font-mono font-bold text-primary tabular-nums">
                {settings.speechRate.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min="0.75"
              max="1.6"
              step="0.05"
              value={settings.speechRate}
              onChange={(e) =>
                onUpdateSettings({ ...settings, speechRate: parseFloat(e.target.value) })
              }
              className="w-full accent-primary h-2 rounded cursor-pointer"
            />
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>0.75x</span>
              <span>1.60x</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Voice Output Volume</span>
              <span className="font-mono font-bold text-primary tabular-nums">
                {settings.voiceMuted ? 'Muted' : `${Math.round(settings.voiceVolume * 100)}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              disabled={settings.voiceMuted}
              value={settings.voiceVolume}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  voiceVolume: parseFloat(e.target.value),
                  voiceMuted: parseFloat(e.target.value) === 0,
                })
              }
              className="w-full accent-primary h-2 rounded cursor-pointer disabled:opacity-40"
            />
            <div className="flex justify-between items-center text-xs">
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, voiceMuted: !settings.voiceMuted })
                }
                className="inline-flex items-center gap-1 font-bold text-foreground hover:text-primary"
              >
                {settings.voiceMuted ? (
                  <>
                    <VolumeX className="h-3.5 w-3.5 text-destructive" />
                    <span>Unmute Audio</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5 text-primary" />
                    <span>Mute Audio</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  speakText('SENTRA voice output active at selected volume and speech rate.', {
                    rate: settings.speechRate,
                    volume: settings.voiceVolume,
                    force: true,
                  })
                }
                className="inline-flex items-center gap-1 text-primary font-bold hover:underline"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                <span>Test Voice</span>
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-border/40 text-sm">
          {/* Working "Hey SENTRA" Wake Word Control */}
          <div className="rounded-xl bg-secondary/60 border border-border/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Mic className={`h-4 w-4 mt-1 shrink-0 ${settings.wakeWordEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <p className="font-semibold">Foreground "Hey SENTRA" Wake Listening</p>
                  <p className="text-xs text-muted-foreground">
                    {voiceCompatibility.modeSummary}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleWakeWord(!settings.wakeWordEnabled)}
                disabled={!voiceCompatibility.speechRecognitionSupported}
                className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-bold border transition-colors shrink-0 disabled:opacity-40 ${
                  settings.wakeWordEnabled
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:border-primary'
                }`}
              >
                {settings.wakeWordEnabled ? 'Enabled' : 'Enable Mic'}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {voiceCompatibility.limitationNote}
            </p>
            {voiceError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/15 border border-destructive/40 px-2.5 py-2 text-xs text-destructive">
                <span>{voiceError}</span>
                <button
                  type="button"
                  onClick={onRestartMicrophone}
                  className="rounded bg-destructive px-2.5 py-1 text-[11px] font-bold text-destructive-foreground"
                >
                  Restart Mic
                </button>
              </div>
            )}
          </div>

          <label className="flex items-center justify-between cursor-pointer gap-3 min-h-[44px]">
            <div>
              <p className="font-semibold">Auditory Chimes</p>
              <p className="text-xs text-muted-foreground">
                Play subtle audio tones for mic activation and hazard cues
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.audioFeedback}
              onChange={(e) =>
                onUpdateSettings({ ...settings, audioFeedback: e.target.checked })
              }
              className="h-5 w-5 accent-primary"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer gap-3 min-h-[44px]">
            <div>
              <p className="font-semibold">Arm-Reach Hand Guidance</p>
              <p className="text-xs text-muted-foreground">
                Include hand placement instructions when confirmed target is within arm reach
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.reachGuidanceEnabled}
              onChange={(e) =>
                onUpdateSettings({ ...settings, reachGuidanceEnabled: e.target.checked })
              }
              className="h-5 w-5 accent-primary"
            />
          </label>
        </div>
      </div>

      {/* Mobile PWA Installation Card */}
      <div className="rounded-xl bg-card border border-border p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Smartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm text-foreground">Mobile Web App (PWA) Installation</p>
            <p className="text-xs text-muted-foreground">
              Install SENTRA to your home screen for full-screen mobile camera access and static app shell loading.
            </p>
          </div>
        </div>
        <PWAInstallButton />
      </div>

      {/* ESP32-S3 Device Registration & Token Provisioning */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 font-bold text-base text-foreground">
          <KeyRound className="h-5 w-5 text-primary" />
          <span>ESP32-S3 Device Registration & Provisioning</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Register an ESP32-S3 unit to obtain a single-display authentication token for{' '}
          <span className="font-mono">POST /api/device/telemetry</span> and{' '}
          <span className="font-mono">POST /api/device/frame</span>. Hardware write endpoints require HTTPS in non-local deployments.
        </p>

        <form onSubmit={handleRegisterSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={regDeviceId}
              onChange={(e) => setRegDeviceId(e.target.value)}
              placeholder="Device ID (e.g. ESP32-S3-SENTRA-001)"
              className="rounded-lg bg-secondary border border-border px-3 py-2 text-xs font-mono text-foreground"
              required
            />
            <input
              type="text"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder="Friendly Name"
              className="rounded-lg bg-secondary border border-border px-3 py-2 text-xs text-foreground"
              required
            />
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            {(
              [
                ['camera', 'Camera'],
                ['forwardToF', 'Forward ToF'],
                ['downwardToF', 'Downward ToF'],
                ['imu', 'IMU'],
                ['audioOutput', 'Audio Output'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={regCaps[key]}
                  onChange={(e) => setRegCaps({ ...regCaps, [key]: e.target.checked })}
                  className="accent-primary"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>Register & Provision Token</span>
          </button>
        </form>

        {regError && <p className="text-xs font-mono text-destructive">{regError}</p>}

        {provisionedResult && (
          <div className="rounded-lg bg-secondary border border-primary/50 p-3 space-y-1 text-xs font-mono">
            <p className="text-primary font-bold">
              Provisioned Device: {provisionedResult.deviceId}
            </p>
            <p className="break-all text-foreground select-all">
              X-Device-Token: {provisionedResult.token}
            </p>
            <p className="text-muted-foreground font-sans">
              Copy this token into your ESP32-S3 firmware config or SENTRA_DEVICE_TOKEN env var. It is hashed in SQLite and will not be displayed again.
            </p>
          </div>
        )}
      </div>

      {/* Stored Event Management */}
      <div className="rounded-xl bg-card border border-border p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold text-sm text-foreground">Stored Telemetry & Audit Records</p>
          <p className="text-xs text-muted-foreground">
            Export persisted SQLite records or clear telemetry history.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/events/export"
            download="sentra-events-export.json"
            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-bold"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export JSON</span>
          </a>

          {!confirmClearEvents ? (
            <button
              type="button"
              onClick={() => setConfirmClearEvents(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 border border-destructive/40 px-3 py-1.5 text-xs font-bold text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear Events</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await clearStoredTelemetryEvents();
                setConfirmClearEvents(false);
                runDiagnosticsRefresh();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground"
            >
              Confirm Delete Telemetry
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
