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
  Sparkles,
  Square,
  Database,
  LogIn,
  LogOut,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { GeminiDiagnosticResult, SentraSettings, SystemHealthStatus } from '../types/sentra';
import type { DeviceLiveState, DeviceRuntimeConfig } from '../types/deviceProtocol';
import { speakText } from '../utils/audio';
import { evaluateSensorFusion, DEFAULT_DEVICE_RUNTIME_CONFIG } from '../utils/sensorFusion';
import {
  clearStoredTelemetryEvents,
  fetchDeviceConfig,
  fetchHealthStatus,
  registerHardwareDevice,
  runGeminiDiagnostic,
  sendDeviceCommand,
  updateDeviceConfig,
} from '../services/deviceApi';
import type { BrowserCameraErrorType, BrowserCameraStatus } from '../hooks/useCamera';
import type { VoiceAssistantState, VoiceCompatibilityInfo } from '../hooks/useVoiceAssistant';
import { PWAInstallButton } from './PWAInstallButton';

const OPERATOR_TOKEN_SESSION_KEY = 'sentra.operator.token';

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
  micTestActive: boolean;
  micTestTranscript: string;
  micTestError: string | null;
  onStartMicTest: () => void | Promise<unknown>;
  onStopMicTest: () => void;
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
  micTestActive,
  micTestTranscript,
  micTestError,
  onStartMicTest,
  onStopMicTest,
  onToggleWakeWord,
  onRestartMicrophone,
  onDeviceRegistered,
}) => {
  const firebase = useFirebase();
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [geminiDiag, setGeminiDiag] = useState<GeminiDiagnosticResult | null>(null);
  const [checkingGemini, setCheckingGemini] = useState(false);
  const [geminiDiagError, setGeminiDiagError] = useState<string | null>(null);

  const [operatorToken, setOperatorToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(OPERATOR_TOKEN_SESSION_KEY) || '';
    } catch {
      return '';
    }
  });

  // Hardware Device Registration Form (Aligned to Physical Baseline Hardware)
  const [regDeviceId, setRegDeviceId] = useState('ESP32-S3-SENTRA-001');
  const [regName, setRegName] = useState('SENTRA Headband Unit');
  const [regCaps, setRegCaps] = useState({
    camera: true,
    forwardToF: true,
    downwardToF: false,
    imu: true,
    audioOutput: false,
    vl53l5cx: false,
  });
  const [provisionedResult, setProvisionedResult] = useState<{
    deviceId: string;
    token: string;
  } | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [confirmClearEvents, setConfirmClearEvents] = useState(false);
  const [clearEventsError, setClearEventsError] = useState<string | null>(null);

  // Wearable Runtime Configuration & Remote Commands
  const [runtimeConfig, setRuntimeConfig] = useState<DeviceRuntimeConfig>(
    activeDevice?.runtimeConfig || DEFAULT_DEVICE_RUNTIME_CONFIG
  );
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [commandStatus, setCommandStatus] = useState<string | null>(null);

  const handleOperatorTokenChange = (val: string) => {
    setOperatorToken(val);
    try {
      sessionStorage.setItem(OPERATOR_TOKEN_SESSION_KEY, val);
    } catch {}
  };

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

  const handleRunGeminiDiagnostic = useCallback(async () => {
    setCheckingGemini(true);
    setGeminiDiagError(null);
    try {
      const result = await runGeminiDiagnostic();
      setGeminiDiag(result);
      await runDiagnosticsRefresh();
    } catch (err: any) {
      setGeminiDiagError(err?.message || 'Gemini diagnostic request failed');
    } finally {
      setCheckingGemini(false);
    }
  }, [runDiagnosticsRefresh]);

  useEffect(() => {
    runDiagnosticsRefresh();
  }, [runDiagnosticsRefresh]);

  useEffect(() => {
    const targetId = activeDevice?.deviceId || settings.selectedWearableDeviceId;
    if (!targetId) return;
    fetchDeviceConfig(targetId)
      .then((res) => setRuntimeConfig(res.config))
      .catch(() => {});
  }, [activeDevice?.deviceId, settings.selectedWearableDeviceId]);

  const handleSaveRuntimeConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = activeDevice?.deviceId || settings.selectedWearableDeviceId;
    setSavingConfig(true);
    setConfigStatus(null);
    try {
      const res = await updateDeviceConfig({
        deviceId: targetId,
        config: runtimeConfig,
        operatorToken: operatorToken.trim() || undefined,
      });
      setRuntimeConfig(res.config);
      if (firebase.user) {
        await firebase
          .saveWearableProfile({
            deviceId: res.deviceId,
            friendlyName: activeDevice?.name || res.deviceId,
            firmwareVersion: activeDevice?.firmwareVersion,
            runtimeConfig: res.config,
          })
          .catch(() => {});
      }
      setConfigStatus(
        `Saved & queued config_update (${res.queuedActionId || 'synced'}) for ${res.deviceId}.`
      );
    } catch (err: any) {
      setConfigStatus(err?.message || 'Failed to save runtime configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTriggerDeviceCommand = async (
    type: 'CAPTURE_FRAME' | 'RECALIBRATE_IMU' | 'REQUEST_OBSERVATION'
  ) => {
    const targetId = activeDevice?.deviceId || settings.selectedWearableDeviceId;
    setCommandStatus(null);
    try {
      const res = await sendDeviceCommand({
        deviceId: targetId,
        type,
        operatorToken: operatorToken.trim() || undefined,
      });
      setCommandStatus(`Queued ${res.action.type} (${res.action.id}) for ${res.deviceId}.`);
    } catch (err: any) {
      setCommandStatus(err?.message || `Failed to queue ${type}`);
    }
  };

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
        operatorToken: operatorToken.trim() || undefined,
      });
      setProvisionedResult({ deviceId: res.deviceId, token: res.provisionedToken });
      onDeviceRegistered?.(res.deviceId);
    } catch (err: any) {
      setRegError(err?.message || 'Device registration failed');
    }
  };

  const geminiVerifiedHealthy = Boolean(geminiDiag?.ok && geminiDiag?.apiReachable);
  const geminiDetail = (() => {
    if (geminiDiag) {
      if (geminiDiag.ok) {
        return `Verified Connected · Configured: ${geminiDiag.configuredModel} · Working Model: ${geminiDiag.modelUsed}${
          geminiDiag.usedFallback ? ' (Fallback used)' : ''
        } (${geminiDiag.latencyMs ?? '?'} ms)`;
      }
      return `Failed (${geminiDiag.errorCode || 'ERROR'}): ${geminiDiag.errorMessage || 'Check failed'}`;
    }
    if (!health) return 'Checking configuration…';
    if (!health.modelConfigValid) {
      return `Invalid SENTRA_GEMINI_MODEL: ${health.modelConfigError}`;
    }
    if (!health.hasApiKey) {
      return 'Missing GEMINI_API_KEY on server';
    }
    return `Key present (unverified until live test) · Configured: ${health.configuredModel}${
      health.lastWorkingModel ? ` · Last Working: ${health.lastWorkingModel}` : ''
    }`;
  })();

  const voiceHealthy =
    speechRecSupported &&
    speechSynthSupported &&
    voiceState !== 'error' &&
    voiceState !== 'permission_blocked' &&
    voiceState !== 'unsupported';

  const fusion = activeDevice ? evaluateSensorFusion(activeDevice) : null;

  const readinessChecklist: Array<{
    step: string;
    state: 'pass' | 'warn' | 'fail';
    evidence: string;
  }> = [
    {
      step: '1. Backend & SQLite Ready',
      state: health && health.databaseAvailable ? 'pass' : 'fail',
      evidence: health?.databaseAvailable ? 'Express + SQLite WAL online' : 'Backend/DB check incomplete',
    },
    {
      step: '2. Operator & Device Auth',
      state: health?.operatorAuthConfigured ? 'pass' : 'warn',
      evidence: health?.operatorAuthConfigured
        ? 'SENTRA_OPERATOR_TOKEN configured'
        : 'Set SENTRA_OPERATOR_TOKEN to provision physical units',
    },
    {
      step: '3. Physical ESP32-S3 Connected',
      state:
        activeDevice?.sourceMode === 'hardware' && activeDevice.connected
          ? 'pass'
          : activeDevice?.sourceMode === 'simulator' && activeDevice.connected
          ? 'warn'
          : 'fail',
      evidence:
        activeDevice?.sourceMode === 'hardware' && activeDevice.connected
          ? `${activeDevice.deviceId} (${activeDevice.firmwareVersion || 'fw unknown'})`
          : activeDevice?.sourceMode === 'simulator'
          ? 'Simulator active (physical hardware not connected)'
          : 'No ESP32-S3 device connected',
    },
    {
      step: '4. OV2640 Camera & Fresh Frames',
      state:
        cameraDiagnostics?.wearableConnected &&
        cameraDiagnostics.wearableFrameAgeMs !== null &&
        !cameraDiagnostics.wearableFrameStale
          ? 'pass'
          : cameraDiagnostics?.wearableConnected
          ? 'warn'
          : 'fail',
      evidence:
        cameraDiagnostics?.wearableFrameAgeMs != null
          ? `Age ${Math.round(cameraDiagnostics.wearableFrameAgeMs)} ms (${
              cameraDiagnostics.wearableFrameStale ? 'stale' : 'live'
            })`
          : 'No wearable JPEG frames uploaded',
    },
    {
      step: '5. Single Forward VL53L0X ToF',
      state: fusion?.forwardStatus === 'valid' ? 'pass' : fusion ? 'warn' : 'fail',
      evidence: fusion
        ? `${fusion.forwardStatus} (${
            fusion.forwardDistanceCm !== null ? `${Math.round(fusion.forwardDistanceCm)} cm` : 'null'
          })`
        : 'Device offline',
    },
    {
      step: '6. GY-521 MPU6050 IMU & Calibration',
      state:
        fusion?.imuStatus === 'valid' && fusion.imuCalibrated
          ? 'pass'
          : fusion?.imuStatus === 'valid'
          ? 'warn'
          : 'fail',
      evidence: fusion
        ? `${fusion.imuStatus}, ${fusion.imuCalibrated ? 'calibrated' : 'uncalibrated'}, pitch ${
            fusion.headPitchDeg !== null ? `${Math.round(fusion.headPitchDeg)}°` : 'N/A'
          }`
        : 'Device offline',
    },
    {
      step: '7. Optional Modules Isolated (VL53L5CX / WM8960)',
      state: 'pass',
      evidence: `VL53L5CX: ${activeDevice?.capabilities.vl53l5cx ? 'enabled' : 'disabled/optional'} · WM8960: ${
        activeDevice?.capabilities.audioOutput ? 'enabled' : 'disabled/optional'
      }`,
    },
    {
      step: '8. Gemini Model & Vision API',
      state: geminiVerifiedHealthy ? 'pass' : health?.hasApiKey ? 'warn' : 'fail',
      evidence: geminiDetail,
    },
    {
      step: '9. "Hey SENTRA" & Voice Output',
      state: voiceHealthy ? 'pass' : 'warn',
      evidence: voiceError ? voiceError : `${voiceState} · ${voiceCompatibility.modeSummary}`,
    },
  ];

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
      label: 'Gemini API & Model Access',
      healthy: geminiVerifiedHealthy,
      detail: geminiDiagError ? geminiDiagError : geminiDetail,
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
      label: 'Gemini 3.8 Live Real-Time Voice (WS /api/live/voice)',
      healthy: Boolean(health?.hasApiKey),
      detail: health?.hasApiKey
        ? `Ready · Live Model: ${health.liveModel || 'gemini-3.8-live'} · 16 kHz / 24 kHz PCM`
        : 'Missing GEMINI_API_KEY on server for Live API sessions',
    },
    {
      label: 'Firebase Auth & Cloud Firestore Sync',
      healthy: Boolean(firebase.firestoreOnline && firebase.user && !firebase.authError),
      detail: firebase.authError
        ? `Firebase Error: ${firebase.authError}`
        : !firebase.firestoreOnline
        ? 'Firestore offline — check Firebase configuration'
        : firebase.user
        ? `Signed in as ${firebase.user.displayName || firebase.user.email || firebase.user.uid} · Memories: ${firebase.firestoreMemories.length}`
        : 'Firestore online · Sign in with Google to sync profile, memories & hardware thresholds',
    },
    {
      label: 'Voice Wake Word & Speech Engine',
      healthy: voiceHealthy,
      detail: voiceError
        ? `Voice Error: ${voiceError}`
        : `State: ${voiceState} · ${voiceCompatibility.modeSummary}`,
    },
  ];

  return (
    <div className="space-y-4 text-foreground">
      {/* Live System Diagnostics */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg text-accent">
            <ShieldCheck className="h-5 w-5" />
            <span>Settings & Diagnostics</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunGeminiDiagnostic}
              disabled={checkingGemini}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 disabled:opacity-60"
            >
              <Sparkles className={`h-3.5 w-3.5 ${checkingGemini ? 'animate-spin' : ''}`} />
              <span>{checkingGemini ? 'Testing Gemini…' : 'Verify Gemini API'}</span>
            </button>
            <button
              type="button"
              onClick={runDiagnosticsRefresh}
              disabled={checkingHealth}
              className="inline-flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-bold hover:border-primary"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
              <span>Re-check Health</span>
            </button>
            {firebase.user ? (
              <button
                type="button"
                onClick={() => {
                  void firebase.signOut();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-bold hover:border-primary"
              >
                <LogOut className="h-3.5 w-3.5 text-primary" />
                <span>Sign Out ({firebase.user.displayName?.split(' ')[0] || 'Google'})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void firebase.signIn();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-bold hover:border-primary"
              >
                <LogIn className="h-3.5 w-3.5 text-primary" />
                <Database className="h-3.5 w-3.5 text-accent" />
                <span>Sign In to Sync</span>
              </button>
            )}
          </div>
        </div>

        {health?.supportedModels && (
          <p className="text-[11px] font-mono text-muted-foreground">
            Configured Model: <span className="text-foreground">{health.configuredModel}</span> · Supported:{' '}
            {health.supportedModels.join(', ')}
          </p>
        )}

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
              <div className="min-w-0">
                <p className="font-bold text-foreground">{row.label}</p>
                <p className="text-muted-foreground font-mono break-words">{row.detail}</p>
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
                    State: <span className="font-mono text-foreground">{voiceState}</span> · {voiceCompatibility.modeSummary}
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

          {/* Live Microphone Recognition Test (displays recognized words without running assistant commands) */}
          <div className="rounded-xl bg-secondary/60 border border-border/70 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">Microphone Recognition Test</p>
                <p className="text-xs text-muted-foreground">
                  Speak clearly to verify live speech-to-text recognition without sending commands.
                </p>
              </div>
              {micTestActive ? (
                <button
                  type="button"
                  onClick={onStopMicTest}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span>Stop Mic Test</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartMicTest}
                  disabled={!voiceCompatibility.speechRecognitionSupported}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-card border border-border px-3 py-1.5 text-xs font-bold hover:border-primary disabled:opacity-40"
                >
                  <Mic className="h-3.5 w-3.5 text-primary" />
                  <span>Test Microphone</span>
                </button>
              )}
            </div>
            {(micTestActive || micTestTranscript) && (
              <div className="rounded-lg bg-card border border-border px-3 py-2 text-xs font-mono">
                <span className="text-muted-foreground">Recognized: </span>
                <span className="text-primary">
                  {micTestTranscript ? `"${micTestTranscript}"` : 'Listening for speech…'}
                </span>
              </div>
            )}
            {micTestError && (
              <p className="text-xs font-mono text-destructive">{micTestError}</p>
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
          Requires operator authorization (<span className="font-mono">SENTRA_OPERATOR_TOKEN</span> configured on server) to register an ESP32-S3 unit and generate a one-time device token for{' '}
          <span className="font-mono">POST /api/device/telemetry</span> and{' '}
          <span className="font-mono">POST /api/device/frame</span>.
        </p>

        {health && !health.operatorAuthConfigured && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 px-3 py-2 text-xs text-amber-300">
            Server notice: <span className="font-mono">SENTRA_OPERATOR_TOKEN</span> is not set in server environment. Registration and telemetry deletion remain locked until set on the server.
          </div>
        )}

        <form onSubmit={handleRegisterSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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
            <input
              type="password"
              value={operatorToken}
              onChange={(e) => handleOperatorTokenChange(e.target.value)}
              placeholder="Operator Token (SENTRA_OPERATOR_TOKEN)"
              className="rounded-lg bg-secondary border border-border px-3 py-2 text-xs font-mono text-foreground"
              required
            />
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            {(
              [
                ['camera', 'OV2640 Camera'],
                ['forwardToF', 'Forward VL53L0X'],
                ['imu', 'MPU6050 6-axis IMU'],
                ['downwardToF', 'Downward ToF (Opt)'],
                ['vl53l5cx', 'VL53L5CX Depth (Opt)'],
                ['audioOutput', 'WM8960 Audio (Opt)'],
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

      {/* Hardware Integration Readiness Checklist & Wearable Tuning */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-4">
        <div className="flex items-center gap-2 font-bold text-base text-foreground">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <span>Hardware Integration Readiness Checklist</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {readinessChecklist.map((item) => (
            <div
              key={item.step}
              className="rounded-lg bg-secondary/50 border border-border/60 p-2.5 flex items-start justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="font-bold text-foreground">{item.step}</p>
                <p className="text-[11px] font-mono text-muted-foreground break-words">{item.evidence}</p>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase ${
                  item.state === 'pass'
                    ? 'bg-success/15 text-success border border-success/40'
                    : item.state === 'warn'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                    : 'bg-destructive/15 text-destructive border border-destructive/40'
                }`}
              >
                {item.state}
              </span>
            </div>
          ))}
        </div>

        {/* Remote Wearable Configuration & Commands */}
        <div className="pt-3 border-t border-border/50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              Wearable Runtime Config & Remote Commands ({activeDevice?.deviceId || settings.selectedWearableDeviceId})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['CAPTURE_FRAME', 'Trigger Camera Snapshot'],
                  ['RECALIBRATE_IMU', 'Recalibrate MPU6050'],
                  ['REQUEST_OBSERVATION', 'Request Active Observation'],
                ] as const
              ).map(([cmd, label]) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => handleTriggerDeviceCommand(cmd)}
                  className="rounded-lg bg-secondary border border-border px-2.5 py-1 text-[11px] font-bold hover:border-primary"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {commandStatus && (
            <p className="text-xs font-mono text-primary">{commandStatus}</p>
          )}

          <form onSubmit={handleSaveRuntimeConfig} className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <label className="space-y-1">
              <span className="text-muted-foreground font-mono">VL53L0X Poll (ms)</span>
              <input
                type="number"
                min={50}
                max={5000}
                step={50}
                value={runtimeConfig.tofSampleIntervalMs}
                onChange={(e) =>
                  setRuntimeConfig({ ...runtimeConfig, tofSampleIntervalMs: Number(e.target.value) })
                }
                className="w-full rounded-lg bg-secondary border border-border px-2.5 py-1.5 font-mono text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground font-mono">Camera Upload (ms)</span>
              <input
                type="number"
                min={250}
                max={30000}
                step={100}
                value={runtimeConfig.frameUploadIntervalMs}
                onChange={(e) =>
                  setRuntimeConfig({ ...runtimeConfig, frameUploadIntervalMs: Number(e.target.value) })
                }
                className="w-full rounded-lg bg-secondary border border-border px-2.5 py-1.5 font-mono text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground font-mono">JPEG Quality (4-63)</span>
              <input
                type="number"
                min={4}
                max={63}
                value={runtimeConfig.jpegQuality}
                onChange={(e) =>
                  setRuntimeConfig({ ...runtimeConfig, jpegQuality: Number(e.target.value) })
                }
                className="w-full rounded-lg bg-secondary border border-border px-2.5 py-1.5 font-mono text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground font-mono">Alert Threshold (cm)</span>
              <input
                type="number"
                min={10}
                max={150}
                value={runtimeConfig.proximityCriticalCm}
                onChange={(e) =>
                  setRuntimeConfig({ ...runtimeConfig, proximityCriticalCm: Number(e.target.value) })
                }
                className="w-full rounded-lg bg-secondary border border-border px-2.5 py-1.5 font-mono text-foreground"
              />
            </label>

            <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 font-mono">
                  <span>Resolution:</span>
                  <select
                    value={runtimeConfig.frameSize}
                    onChange={(e) =>
                      setRuntimeConfig({
                        ...runtimeConfig,
                        frameSize: e.target.value as DeviceRuntimeConfig['frameSize'],
                      })
                    }
                    className="rounded bg-secondary border border-border px-2 py-1 text-foreground"
                  >
                    <option value="QVGA">QVGA (320×240)</option>
                    <option value="VGA">VGA (640×480)</option>
                    <option value="SVGA">SVGA (800×600)</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-1.5 font-mono">
                  <span>Stale Window (ms):</span>
                  <input
                    type="number"
                    min={1000}
                    max={60000}
                    step={500}
                    value={runtimeConfig.sensorStaleMs}
                    onChange={(e) =>
                      setRuntimeConfig({ ...runtimeConfig, sensorStaleMs: Number(e.target.value) })
                    }
                    className="w-24 rounded bg-secondary border border-border px-2 py-1 text-foreground"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={savingConfig}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                {savingConfig ? 'Saving…' : 'Push Config to Device'}
              </button>
            </div>
          </form>

          {configStatus && (
            <p className="text-xs font-mono text-muted-foreground">{configStatus}</p>
          )}
        </div>
      </div>

      {/* Stored Event Management */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-bold text-sm text-foreground">Stored Telemetry & Audit Records</p>
            <p className="text-xs text-muted-foreground">
              Export persisted SQLite records or clear telemetry history (requires Operator Token above).
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
                onClick={() => {
                  setClearEventsError(null);
                  setConfirmClearEvents(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 border border-destructive/40 px-3 py-1.5 text-xs font-bold text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear Events</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  setClearEventsError(null);
                  try {
                    await clearStoredTelemetryEvents(operatorToken.trim() || undefined);
                    setConfirmClearEvents(false);
                    runDiagnosticsRefresh();
                  } catch (err: any) {
                    setClearEventsError(err?.message || 'Failed to clear events');
                    setConfirmClearEvents(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground"
              >
                Confirm Delete Telemetry
              </button>
            )}
          </div>
        </div>
        {clearEventsError && (
          <p className="text-xs font-mono text-destructive">{clearEventsError}</p>
        )}
      </div>
    </div>
  );
};

