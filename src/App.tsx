/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraView, CameraViewHandle } from './components/CameraView';
import {
  DetectedObject,
  GoalTask,
  HazardAlert,
  SentraMemoryItem,
  SentraMode,
  SentraOperation,
  SentraSettings,
  VerificationStep,
  ReachGuidance,
} from './types/sentra';
import type { CameraSourceType } from './types/deviceProtocol';
import { parseVoiceIntent } from './utils/parser';
import {
  playChime,
  setAudioConfig,
  speakText,
  stopSpeaking,
  subscribeSpeakingState,
} from './utils/audio';
import { analyzeLocalScene } from './utils/localVision';
import { useDeviceTelemetry } from './hooks/useDeviceTelemetry';
import { useVoiceAssistant, VoiceAssistantState } from './hooks/useVoiceAssistant';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import {
  analyzeSentraObservation,
  createMemory,
  fetchMemories,
} from './services/deviceApi';
import { useFirebase } from './contexts/FirebaseContext';
import type { LiveVoiceName } from './lib/firebase';
import {
  Mic,
  MicOff,
  Eye,
  Crosshair,
  Cpu,
  RotateCcw,
  Volume2,
  VolumeX,
  Send,
  Radio,
  AlertTriangle,
  Wifi,
  FlaskConical,
  RefreshCw,
  LogIn,
  LogOut,
  User as UserIcon,
  Smartphone,
} from 'lucide-react';

const MEMORY_STORAGE_KEY = 'sentra.memory.v2';
const SETTINGS_STORAGE_KEY = 'sentra.settings.v2';

const SUPPORTED_LANGUAGES = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ' },
  { code: 'ta-IN', label: 'தமிழ்' },
  { code: 'te-IN', label: 'తెలుగు' },
  { code: 'mr-IN', label: 'मराठी' },
  { code: 'ml-IN', label: 'മലയാളം' },
] as const;

const DEFAULT_SETTINGS: SentraSettings = {
  speechRate: 1.05,
  audioFeedback: true,
  voiceMuted: false,
  voiceVolume: 0.9,
  wakeWordEnabled: false,
  cameraFacing: 'environment',
  selectedCameraDeviceId: null,
  cameraSource: 'browser_camera',
  selectedWearableDeviceId: 'ESP32-S3-SENTRA-001',
  autoContinuousFind: false,
  continuousWatchMode: false,
  reachGuidanceEnabled: true,
  language: 'en-IN',
};

export default function App() {
  const cameraRef = useRef<CameraViewHandle | null>(null);
  const firebase = useFirebase();

  const [liveVoicePersona] = useState<LiveVoiceName>('Zephyr');

  // Core assistant state
  const [isAudioSpeaking, setIsAudioSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [spokenTranscript, setSpokenTranscript] = useState<string>('');
  const [assistantResponse, setAssistantResponse] = useState<string>(
    'Standby. Press TAP TO SPEAK or say "Hey Sentra" to activate.'
  );

  // Perception state (strictly empty until real observations arrive)
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [detectionTimestamp, setDetectionTimestamp] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [activeHazard, setActiveHazard] = useState<HazardAlert | null>(null);
  const [activePerceptionPrompt, setActivePerceptionPrompt] = useState<string | null>(null);

  // Goal Task Management
  const [currentGoal, setCurrentGoal] = useState<GoalTask | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [reachGuidance, setReachGuidance] = useState<ReachGuidance | null>(null);
  const [currentRoom, setCurrentRoom] = useState<string>('Current Area');

  // Inline typed fallback (hidden unless mic unavailable or toggled)
  const [typedQuery, setTypedQuery] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);

  // Persistence state
  const [memories, setMemories] = useState<SentraMemoryItem[]>(() => {
    try {
      const stored = localStorage.getItem(MEMORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });


  const [settings, setSettings] = useState<SentraSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return stored
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored), continuousWatchMode: false, autoContinuousFind: false }
        : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Mutable refs for safe async loops & keyboard shortcuts without stale closures
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  const currentGoalRef = useRef(currentGoal);
  currentGoalRef.current = currentGoal;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const isCameraReadyRef = useRef(isCameraReady);
  isCameraReadyRef.current = isCameraReady;
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

  // Sync audio mute, volume & language config and reactive speaking state
  useEffect(() => {
    setAudioConfig({
      muted: settings.voiceMuted,
      volume: settings.voiceVolume,
      lang: settings.language || 'en-IN',
    });
  }, [settings.voiceMuted, settings.voiceVolume, settings.language]);

  useEffect(() => {
    return subscribeSpeakingState(setIsAudioSpeaking);
  }, []);

  // Load persisted SQLite memories on mount
  useEffect(() => {
    let active = true;
    fetchMemories()
      .then((serverMemories) => {
        if (!active) return;
        setMemories(serverMemories);
        try {
          localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(serverMemories));
        } catch {}
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Sync Firebase user account profile & merge Cloud Firestore memories on sign-in
  useEffect(() => {
    if (!firebase.authReady || !firebase.user) return;
    firebase.syncProfile(settingsRef.current, liveVoicePersona).catch(() => {});
  }, [firebase.authReady, firebase.user, liveVoicePersona, firebase.syncProfile]);

  useEffect(() => {
    if (!firebase.user || firebase.firestoreMemories.length === 0) return;
    setMemories((prev) => {
      const byId = new Map<string, SentraMemoryItem>();
      for (const item of firebase.firestoreMemories) byId.set(item.id, item);
      for (const item of prev) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
      const merged = Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
      try {
        localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }, [firebase.user, firebase.firestoreMemories]);

  // Periodic tick to evaluate detection staleness
  useEffect(() => {
    if (!detectionTimestamp) return;
    const timer = setInterval(() => setNowTick(Date.now()), 3000);
    return () => clearInterval(timer);
  }, [detectionTimestamp]);

  const detectionStale = useMemo(() => {
    if (!detectionTimestamp) return false;
    if (!isCameraReady) return true;
    return nowTick - detectionTimestamp > 15000;
  }, [detectionTimestamp, isCameraReady, nowTick]);

  const saveMemoriesLocally = useCallback((items: SentraMemoryItem[]) => {
    setMemories(items);
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, []);

  const updateSettings = useCallback((next: SentraSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  // Device Telemetry Gateway Hook (SSE + fallback polling)
  const handleTelemetryAlert = useCallback(
    (alert: {
      deviceId: string;
      sourceMode: 'hardware' | 'simulator';
      type: string;
      severity: 'caution' | 'critical';
      description: string;
    }) => {
      const mappedType: HazardAlert['type'] =
        alert.type.includes('cliff') || alert.type.includes('drop') ? 'dropoff' : 'obstacle';
      const hazard: HazardAlert = {
        id: `${alert.deviceId}-${Date.now()}`,
        type: mappedType,
        severity: alert.severity,
        description: alert.description,
        clockPosition: "12 o'clock",
        source: alert.sourceMode === 'hardware' ? 'sensor_hardware' : 'sensor_simulator',
        timestamp: Date.now(),
      };
      setActiveHazard(hazard);
      if (settingsRef.current.audioFeedback) {
        playChime('hazard');
      }
      speakText(alert.description, settingsRef.current.speechRate);
    },
    []
  );

  const handleWearableVoiceTurn = useCallback((turn: any) => {
    if (turn.transcript) {
      setSpokenTranscript(turn.transcript);
    }
    if (turn.spokenResponse) {
      setAssistantResponse(turn.spokenResponse);
    }
    if (turn.analysis?.hazard) {
      setActiveHazard(turn.analysis.hazard);
    }
  }, []);

  const handleWearableGoalUpdate = useCallback((update: { deviceId: string; goal: GoalTask | null }) => {
    if (
      !settingsRef.current.selectedWearableDeviceId ||
      update.deviceId === settingsRef.current.selectedWearableDeviceId
    ) {
      setCurrentGoal(update.goal);
    }
  }, []);

  const { activeDevice, sseConnected } = useDeviceTelemetry({
    selectedDeviceId: settings.selectedWearableDeviceId,
    onAlert: handleTelemetryAlert,
    onVoiceTurn: handleWearableVoiceTurn,
    onGoalUpdate: handleWearableGoalUpdate,
  });

  const activeDeviceRef = useRef(activeDevice);
  activeDeviceRef.current = activeDevice;

  // Clear stale vision hazard automatically if ToF recovers cleanly
  useEffect(() => {
    if (!activeDevice || !activeDevice.connected) return;
    const fwd = activeDevice.sensors.forwardDistanceCm;
    const down = activeDevice.sensors.downwardDistanceMm;
    const criticalCm = activeDevice.runtimeConfig?.proximityCriticalCm ?? 45;
    if (
      activeHazard &&
      (activeHazard.source === 'sensor_hardware' || activeHazard.source === 'sensor_simulator') &&
      (fwd == null || fwd >= criticalCm) &&
      (down == null || down <= 200)
    ) {
      setActiveHazard(null);
    }
  }, [activeDevice, activeHazard]);

  const analyzeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      analyzeAbortRef.current?.abort();
    };
  }, []);

  // Core Multimodal Analysis Pipeline
  const executeAnalysis = useCallback(
    async (
      mode: SentraMode,
      query = '',
      goalTargetOverride?: string | null,
      operationOverride?: SentraOperation
    ): Promise<boolean> => {
      if (isProcessingRef.current) return false;
      isProcessingRef.current = true;
      setIsProcessing(true);

      const curSettings = settingsRef.current;
      const curGoal = currentGoalRef.current;
      const curMemories = memoriesRef.current;
      const curDevice = activeDeviceRef.current;

      if (curSettings.audioFeedback) {
        playChime('capture');
      }

      const inferredOp: SentraOperation =
        operationOverride ??
        (query
          ? parseVoiceIntent(query).operation
          : mode === 'find' || mode === 'navigate'
          ? 'object_query'
          : 'scene_analysis');

      // Activate mobile phone camera automatically on demand when a visual voice request is triggered
      if (
        curSettings.cameraSource === 'browser_camera' &&
        (inferredOp === 'object_query' || inferredOp === 'scene_analysis') &&
        !isCameraReadyRef.current
      ) {
        const started = await cameraRef.current?.startBrowserCamera();
        if (started) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      const snapshot = (await cameraRef.current?.captureSnapshot()) || {
        dataUrl: null,
        quality: null,
        width: 0,
        height: 0,
        timestamp: null,
        source: curSettings.cameraSource,
      };

      const sensorsSummary = cameraRef.current?.getSensorsSummary() || '';
      const heading = cameraRef.current?.heading ?? curDevice?.sensors.imu?.heading ?? null;
      const activeGoalTarget =
        goalTargetOverride !== undefined ? goalTargetOverride : curGoal?.targetObject ?? null;

      analyzeAbortRef.current?.abort();
      const abortController = new AbortController();
      analyzeAbortRef.current = abortController;

      try {
        const data = await analyzeSentraObservation(
          {
            mode,
            operation: inferredOp,
            query,
            image: snapshot.dataUrl,
            imageTimestamp: snapshot.timestamp,
            imageDimensions:
              snapshot.width > 0 && snapshot.height > 0
                ? { width: snapshot.width, height: snapshot.height }
                : null,
            sensors: sensorsSummary,
            goal: activeGoalTarget,
            memory: curMemories.slice(-30),
            history: historyRef.current.slice(-6),
            heading,
            useWearableFrame: curSettings.cameraSource === 'esp32_camera',
            wearableDeviceId: curSettings.selectedWearableDeviceId,
            language: curSettings.language || 'en-IN',
          },
          abortController.signal
        );

        isProcessingRef.current = false;
        setIsProcessing(false);

        if (data.status !== 'ok' || data.errorCode) {
          let spoken = data.spokenResponse || data.text || 'Unable to analyze scene right now.';
          // Only invoke optical local heuristics when Gemini API is unavailable/exhausted AND a camera stream exists
          if (
            (data.errorCode === 'MISSING_API_KEY' ||
              data.errorCode === 'QUOTA_EXHAUSTED' ||
              data.errorCode === 'UPSTREAM_ERROR' ||
              data.errorCode === 'TIMEOUT') &&
            cameraRef.current?.getVideoElement()
          ) {
            const localFallback = analyzeLocalScene(
              cameraRef.current.getVideoElement(),
              heading,
              curMemories,
              mode,
              query,
              activeGoalTarget
            );
            spoken = `${spoken} ${localFallback.text}`.trim();
          }

          setAssistantResponse(spoken);
          speakText(spoken, curSettings.speechRate);
          return false;
        }

        // Successful Gemini analysis
        const frameTs = data.frameTimestamp || snapshot.timestamp || Date.now();
        let spoken = data.spokenResponse || data.text || 'Observation complete.';

        if (snapshot.dataUrl) {
          const stampedDetections: DetectedObject[] = (data.detectedObjects || []).map((obj) => ({
            ...obj,
            frameTimestamp: frameTs,
            sourceWidth: snapshot.width || undefined,
            sourceHeight: snapshot.height || undefined,
          }));
          setDetectedObjects(stampedDetections);
          setDetectionTimestamp(frameTs);
        }

        setActivePerceptionPrompt(data.activePerceptionRequest || null);

        // Reach guidance
        if (data.reachGuidance && data.reachGuidance.active) {
          setReachGuidance(data.reachGuidance);
          if (curSettings.reachGuidanceEnabled && !data.hazard) {
            spoken = `${spoken} ${data.reachGuidance.handInstruction}`.trim();
            if (curSettings.audioFeedback) playChime('found');
          }
        } else {
          setReachGuidance(null);
        }

        // Vision hazard alert (never overrides hardware sensor alert already present)
        const hasActiveHardwareHazard =
          activeHazard?.severity === 'critical' && activeHazard.source === 'sensor_hardware';
        if (data.hazard && !hasActiveHardwareHazard) {
          setActiveHazard({ ...data.hazard, source: 'vision_ai', timestamp: Date.now() });
          if (!data.spokenResponse) {
            spoken = `Caution: ${data.hazard.description} at ${data.hazard.clockPosition}.`;
          }
          if (curSettings.audioFeedback) playChime('hazard');
        } else if (!data.hazard && !hasActiveHardwareHazard) {
          setActiveHazard(null);
        }

        // Explicit remember command -> persist to SQLite & Cloud Firestore
        if (mode === 'remember' && data.rememberedData) {
          try {
            const saved = await createMemory({
              label: data.rememberedData.label || 'Saved Location',
              note: data.rememberedData.note || spoken,
              room: data.rememberedData.room || currentRoom,
              heading,
              source: 'live_verified',
            });
            if (saved.room) setCurrentRoom(saved.room);
            saveMemoriesLocally([saved, ...memoriesRef.current]);
            if (firebase.user) {
              firebase.saveMemory(saved).catch(() => {});
            }
            spoken = `Saved to memory: ${saved.label}.`;
          } catch {
            const localItem: SentraMemoryItem = {
              id: `mem-${Date.now()}`,
              label: data.rememberedData.label || 'Saved Location',
              note: data.rememberedData.note || spoken,
              room: data.rememberedData.room || currentRoom,
              at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              timestamp: Date.now(),
              heading,
              source: 'live_verified',
            };
            saveMemoriesLocally([localItem, ...memoriesRef.current]);
            if (firebase.user) {
              firebase.saveMemory(localItem).catch(() => {});
            }
            spoken = `Saved to memory: ${localItem.label}.`;
          }
        }

        // Goal verification & step tracking
        if ((mode === 'find' || mode === 'navigate') && curGoal) {
          if (data.foundTarget) {
            const targetObj = data.detectedObjects?.find(
              (o) =>
                o.isTargetGoal ||
                (activeGoalTarget && o.label.toLowerCase().includes(activeGoalTarget.toLowerCase()))
            );
            const verifiedStep: VerificationStep = {
              id: `step-${Date.now()}`,
              timestamp: Date.now(),
              stepName: 'Visual Confirmation',
              note: spoken,
              state: 'completed',
              outcome: 'success',
              actionCategory: 'completed',
              heading,
              clockPosition: targetObj?.clockPosition || "12 o'clock",
              confidence: targetObj?.confidence,
            };

            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    state: 'completed',
                    confidence: targetObj?.confidence ?? null,
                    updatedAt: Date.now(),
                    history: [
                      ...prev.history,
                      { timestamp: Date.now(), note: 'Verified in camera view.', state: 'completed' },
                    ],
                    verificationSteps: [...prev.verificationSteps, verifiedStep],
                  }
                : null
            );

            if (curSettings.audioFeedback) playChime('found');

            if (activeGoalTarget) {
              try {
                const autoSaved = await createMemory({
                  label: `${activeGoalTarget} seen`,
                  note: spoken,
                  room: currentRoom,
                  heading,
                  source: 'live_verified',
                });
                saveMemoriesLocally([autoSaved, ...memoriesRef.current]);
              } catch {}
            }
          } else if (data.activePerceptionRequest) {
            const directiveStep: VerificationStep = {
              id: `step-${Date.now()}`,
              timestamp: Date.now(),
              stepName: 'Re-aim Advisory',
              note: data.activePerceptionRequest,
              state: 'need_observation',
              outcome: 're_aim_needed',
              actionCategory: 'active',
              heading,
            };

            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    state: 'need_observation',
                    requiredObservation: data.activePerceptionRequest,
                    updatedAt: Date.now(),
                    history: [
                      ...prev.history,
                      {
                        timestamp: Date.now(),
                        note: `Re-aim requested: ${data.activePerceptionRequest}`,
                        state: 'need_observation',
                      },
                    ],
                    verificationSteps: [...prev.verificationSteps, directiveStep],
                  }
                : null
            );
          } else {
            const scanStep: VerificationStep = {
              id: `step-${Date.now()}`,
              timestamp: Date.now(),
              stepName: 'Observation Scan',
              note: spoken || 'Target not yet visible in analyzed frame.',
              state: 'active',
              outcome: 'attempted',
              actionCategory: 'attempted',
              heading,
            };
            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    updatedAt: Date.now(),
                    verificationSteps: [...prev.verificationSteps, scanStep],
                  }
                : null
            );
          }
        }

        if (query) {
          historyRef.current.push({ role: 'user', text: query });
        }
        historyRef.current.push({ role: 'assistant', text: spoken });
        if (historyRef.current.length > 20) {
          historyRef.current = historyRef.current.slice(-20);
        }

        setAssistantResponse(spoken);
        speakText(spoken, curSettings.speechRate);
        return true;
      } catch (err: any) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        if (err?.name === 'AbortError') {
          return false;
        }

        const localResult = analyzeLocalScene(
          cameraRef.current?.getVideoElement() || null,
          heading,
          curMemories,
          mode,
          query,
          activeGoalTarget
        );

        setAssistantResponse(localResult.text);
        speakText(localResult.text, curSettings.speechRate);
        return false;
      }
    },
    [activeHazard, currentRoom, firebase, saveMemoriesLocally]
  );

  // Handle incoming user voice or text query
  const handleUserQuery = useCallback(
    async (queryText: string) => {
      const trimmed = queryText.trim();
      if (!trimmed) return;
      setSpokenTranscript(trimmed);

      if (/\b(stop|cancel|never mind|pause|be quiet|stop talking|stop speaking)\b/i.test(trimmed)) {
        setCurrentGoal(null);
        stopSpeaking();
        setAssistantResponse('Task and voice output stopped.');
        if (settingsRef.current.audioFeedback) {
          playChime('stop_listen');
        }
        return;
      }

      const intent = parseVoiceIntent(trimmed);

      if ((intent.mode === 'find' || intent.mode === 'navigate') && intent.goal) {
        const heading = cameraRef.current?.heading ?? activeDeviceRef.current?.sensors.imu?.heading ?? null;
        const initialStep: VerificationStep = {
          id: `step-${Date.now()}-1`,
          timestamp: Date.now(),
          stepName: 'Search Initiated',
          note: `Goal set for "${intent.goal}"${heading != null ? ` at heading ${Math.round(heading)}°` : ''}.`,
          state: 'active',
          outcome: 'pending',
          actionCategory: 'active',
          heading,
        };

        const newGoal: GoalTask = {
          id: String(Date.now()),
          intent: trimmed,
          targetObject: intent.goal,
          state: 'active',
          confidence: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          history: [
            { timestamp: Date.now(), note: `Initiated ${intent.mode} for ${intent.goal}`, state: 'active' },
          ],
          verificationSteps: [initialStep],
        };
        setCurrentGoal(newGoal);
        currentGoalRef.current = newGoal;
        await executeAnalysis(intent.mode, trimmed, intent.goal, intent.operation);
        return;
      }

      await executeAnalysis(intent.mode, trimmed, currentGoalRef.current?.targetObject, intent.operation);
    },
    [executeAnalysis]
  );

  const handleVoiceInterrupt = useCallback(() => {
    stopSpeaking();
  }, []);

  const handleWakeWordEnabledChange = useCallback(
    (enabled: boolean) => {
      updateSettings({ ...settingsRef.current, wakeWordEnabled: enabled });
    },
    [updateSettings]
  );

  const voice = useVoiceAssistant({
    wakeWordEnabled: settings.wakeWordEnabled,
    onWakeWordEnabledChange: handleWakeWordEnabledChange,
    audioFeedback: settings.audioFeedback,
    language: settings.language || 'en-IN',
    isProcessing,
    isSpeaking: isAudioSpeaking,
    onCommand: handleUserQuery,
    onInterrupt: handleVoiceInterrupt,
    onUnsupportedFallback: () => setShowTextInput(true),
  });

  const handleToggleWakeWord = useCallback(
    async (nextEnabled: boolean) => {
      if (nextEnabled) {
        await voice.enableWakeWord();
      } else {
        voice.disableWakeWord();
      }
    },
    [voice]
  );

  const handleTapToSpeak = useCallback(() => {
    if (voice.listenMode === 'command' || voice.listenMode === 'ptt') {
      voice.stopCommandWindow();
      return;
    }
    voice.activateCommandWindow();
  }, [voice]);

  // Spacebar shortcut for Tap to Speak (skips form inputs cleanly)
  useEffect(() => {
    const isEditable = (el: Element | null) =>
      el != null &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        (el as HTMLElement).isContentEditable);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isEditable(document.activeElement)) {
        e.preventDefault();
        handleTapToSpeak();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleTapToSpeak]);

  // Derived header device status badge (strictly separated)
  const wearableBadge = !activeDevice || !activeDevice.connected
    ? {
        label: 'No Hardware',
        classes: 'bg-secondary text-muted-foreground border-border',
        Icon: Radio,
      }
    : activeDevice.sourceMode === 'simulator'
    ? {
        label: 'Simulator',
        classes: 'bg-accent/15 text-accent border-accent/40',
        Icon: FlaskConical,
      }
    : {
        label: 'Hardware Live',
        classes: 'bg-success/15 text-success border-success/40',
        Icon: Wifi,
      };
  const WearableIcon = wearableBadge.Icon;

  const voiceStateMeta: Record<
    VoiceAssistantState,
    { label: string; classes: string; pulse?: boolean }
  > = {
    disabled: {
      label: 'Voice Disabled',
      classes: 'bg-secondary text-muted-foreground border-border',
    },
    starting: {
      label: 'Starting Mic…',
      classes: 'bg-secondary text-primary border-primary/40',
    },
    wake_listening: {
      label: 'Listening for "Hey SENTRA"',
      classes: 'bg-accent/15 text-accent border-accent/50',
      pulse: true,
    },
    command_listening: {
      label: 'Listening — Speak Now',
      classes: 'bg-primary/20 text-primary border-primary',
      pulse: true,
    },
    processing: {
      label: 'Processing…',
      classes: 'bg-primary/15 text-primary border-primary/50',
    },
    speaking: {
      label: 'Speaking',
      classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/50',
    },
    permission_blocked: {
      label: 'Mic Permission Blocked',
      classes: 'bg-destructive/15 text-destructive border-destructive/50',
    },
    unsupported: {
      label: 'Voice Unsupported',
      classes: 'bg-secondary text-muted-foreground border-border',
    },
    error: {
      label: 'Microphone Error',
      classes: 'bg-destructive/15 text-destructive border-destructive/50',
    },
  };
  const currentVoiceMeta = voiceStateMeta[voice.assistantState];

  const handleCameraSourceChange = (nextSource: CameraSourceType) => {
    updateSettings({ ...settings, cameraSource: nextSource });
    setDetectedObjects([]);
    setDetectionTimestamp(null);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 sm:gap-4 px-3.5 sm:px-5 safe-top pb-8 text-foreground selection:bg-primary/20">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border pb-3">
        <div>
          <h1 className="text-xl sm:text-3xl font-extrabold tracking-widest text-primary">
            SENTRA
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground">
            Voice-First Assistive Companion
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-bold font-mono">
          {/* Wearable Connection Status */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${wearableBadge.classes}`}
          >
            <WearableIcon className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">{wearableBadge.label}</span>
            <span className="xs:hidden">{wearableBadge.label === 'No Hardware' ? 'No HW' : wearableBadge.label}</span>
          </span>

          {/* English + Mother Tongue Language Selector */}
          <select
            aria-label="Spoken language"
            title="Spoken language (English or mother tongue)"
            value={settings.language || 'en-IN'}
            onChange={(e) => updateSettings({ ...settings, language: e.target.value })}
            className="min-h-[36px] rounded-lg border border-border bg-secondary px-2 py-1.5 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>

          {/* Quick Mute / Unmute Button */}
          <button
            type="button"
            onClick={() => updateSettings({ ...settings, voiceMuted: !settings.voiceMuted })}
            className={`inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border px-2 py-1.5 transition-colors ${
              settings.voiceMuted
                ? 'bg-destructive/15 text-destructive border-destructive/40'
                : 'bg-secondary text-foreground border-border hover:border-primary'
            }`}
            aria-label={settings.voiceMuted ? 'Unmute SENTRA audio' : 'Mute SENTRA audio'}
            title={settings.voiceMuted ? 'Unmute SENTRA audio' : 'Mute SENTRA audio'}
          >
            {settings.voiceMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-primary" />}
          </button>

          {/* Firebase Google Sign-In / Signed-In Account Badge */}
          {firebase.user ? (
            <button
              type="button"
              onClick={firebase.signOut}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1.5 text-success hover:bg-success/20 transition-colors"
              title={`Signed in as ${firebase.user.email || firebase.user.displayName}. Click to sign out.`}
            >
              <UserIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[110px] truncate">
                {firebase.user.displayName?.split(' ')[0] || firebase.user.email?.split('@')[0] || 'Account'}
              </span>
              <LogOut className="h-3 w-3 opacity-80" />
            </button>
          ) : (
            <button
              type="button"
              onClick={firebase.signIn}
              disabled={!firebase.authReady}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/15 px-2.5 py-1.5 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign In</span>
            </button>
          )}

          <PWAInstallButton compact />
        </div>
      </header>

      <OfflineIndicator />

      {/* First Input Section: Mobile Phone or Wearable Device */}
      <section
        aria-label="Input Source Selection"
        className="rounded-2xl bg-card border border-border p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold text-foreground">Input Device</h2>
          <p className="text-xs text-muted-foreground">
            Choose whether SENTRA uses your mobile phone camera or the ESP32-S3 wearable headband.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Choose Mobile Phone or Wearable Device input"
          className="grid grid-cols-2 gap-1.5 rounded-xl bg-secondary p-1 border border-border/80 sm:min-w-[320px]"
        >
          <button
            type="button"
            role="radio"
            aria-checked={settings.cameraSource === 'browser_camera'}
            onClick={() => handleCameraSourceChange('browser_camera')}
            className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-bold transition-colors whitespace-nowrap ${
              settings.cameraSource === 'browser_camera'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Smartphone className="h-4 w-4 shrink-0" />
            <span>Mobile Phone</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.cameraSource === 'esp32_camera'}
            onClick={() => handleCameraSourceChange('esp32_camera')}
            className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-bold transition-colors whitespace-nowrap ${
              settings.cameraSource === 'esp32_camera'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Cpu className="h-4 w-4 shrink-0" />
            <span>Wearable Device</span>
          </button>
        </div>
      </section>

      {/* Main Two-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start flex-1">
        {/* Left Column: Wearable Info & Camera Preview (as it is) */}
        <div className="lg:col-span-5 space-y-3">
          <CameraView
            ref={cameraRef}
            cameraSource={settings.cameraSource}
            onChangeCameraSource={handleCameraSourceChange}
            findingGoal={currentGoal?.targetObject || null}
            onStopFinding={() => setCurrentGoal(null)}
            facingMode={settings.cameraFacing}
            onToggleFacingMode={() => {
              const next = settings.cameraFacing === 'environment' ? 'user' : 'environment';
              updateSettings({ ...settings, cameraFacing: next, selectedCameraDeviceId: null });
            }}
            selectedDeviceId={settings.selectedCameraDeviceId}
            onSelectDeviceId={(id) => updateSettings({ ...settings, selectedCameraDeviceId: id })}
            wearableDeviceId={settings.selectedWearableDeviceId}
            detectedObjects={detectedObjects}
            detectionTimestamp={detectionTimestamp}
            detectionStale={detectionStale}
            hazard={activeHazard}
            activePerceptionPrompt={activePerceptionPrompt}
            onCameraActiveChange={setIsCameraReady}
          />

          {/* Wearable Info Strip (as it is) */}
          <div className="rounded-xl bg-card border border-border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-muted-foreground">
              Forward ToF:{' '}
              <strong className="text-foreground tabular-nums">
                {activeDevice?.connected && activeDevice.sensors.forwardDistanceCm != null
                  ? `${activeDevice.sensors.forwardDistanceCm} cm`
                  : '—'}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Downward:{' '}
              <strong className="text-foreground tabular-nums">
                {activeDevice?.connected && activeDevice.sensors.downwardDistanceMm != null
                  ? `${activeDevice.sensors.downwardDistanceMm} mm`
                  : '—'}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Stream:{' '}
              <strong className={sseConnected ? 'text-success' : 'text-muted-foreground'}>
                {sseConnected ? 'SSE Live' : 'Polling'}
              </strong>
            </span>
          </div>
        </div>

        {/* Right Column: TAP TO SPEAK & Spoken Response */}
        <div className="lg:col-span-7 space-y-4">
              {/* Primary Voice Activation Section: ONE Big TAP TO SPEAK Button + Hey Sentra Wake Call */}
              <section className="rounded-2xl bg-card border border-border p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-muted-foreground">
                    <span>{currentVoiceMeta.label}</span>
                    <span aria-hidden="true"> · </span>
                    <span>
                      {settings.cameraSource === 'esp32_camera'
                        ? 'Wearable Input'
                        : 'Mobile Phone Input'}
                    </span>
                    {voice.wakeActivatedNotice && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="text-primary font-bold">"Hey Sentra" detected</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isAudioSpeaking && (
                      <button
                        type="button"
                        onClick={stopSpeaking}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground whitespace-nowrap shrink-0"
                      >
                        <VolumeX className="h-3.5 w-3.5" />
                        <span>Stop Speaking</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleToggleWakeWord(!settings.wakeWordEnabled)}
                      disabled={!voice.compatibility.speechRecognitionSupported}
                      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-40 whitespace-nowrap shrink-0 ${
                        settings.wakeWordEnabled
                          ? 'bg-accent text-accent-foreground border-accent'
                          : 'bg-secondary text-foreground border-border hover:border-primary'
                      }`}
                    >
                      {settings.wakeWordEnabled ? (
                        <Mic className="h-3.5 w-3.5" />
                      ) : (
                        <MicOff className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {settings.wakeWordEnabled ? '"Hey Sentra" Active' : 'Enable "Hey Sentra"'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* ONE Big Dominant TAP TO SPEAK Button */}
                <button
                  type="button"
                  onClick={handleTapToSpeak}
                  disabled={isProcessing}
                  aria-label="Tap to speak to SENTRA"
                  className={`flex h-28 sm:h-32 w-full select-none flex-col items-center justify-center gap-1.5 rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60 ${
                    voice.listenMode === 'command' || voice.listenMode === 'ptt'
                      ? 'sentra-listening ring-4 ring-primary/40'
                      : 'hover:brightness-105'
                  }`}
                >
                  <div className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-wide">
                    <Mic
                      className={`h-8 w-8 shrink-0 ${
                        voice.listenMode === 'command' || voice.listenMode === 'ptt'
                          ? 'animate-bounce'
                          : ''
                      }`}
                    />
                    <span>
                      {voice.listenMode === 'command' || voice.listenMode === 'ptt'
                        ? 'LISTENING — SPEAK NOW'
                        : isProcessing
                        ? 'ANALYZING…'
                        : 'TAP TO SPEAK'}
                    </span>
                  </div>
                  <span className="text-xs sm:text-sm font-semibold opacity-85">
                    {settings.wakeWordEnabled
                      ? 'Tap button or say "Hey Sentra" to activate'
                      : 'Activates only when you press this button or call "Hey Sentra"'}
                  </span>
                </button>

                {voice.liveTranscript && (
                  <p className="text-xs font-mono text-primary bg-primary/10 border border-primary/30 rounded-xl px-3 py-2">
                    Hearing: "{voice.liveTranscript}"
                  </p>
                )}

                {voice.voiceError && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-destructive/15 border border-destructive/40 px-3 py-2 text-xs text-destructive">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="break-words">{voice.voiceError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={voice.restartMicrophone}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground shrink-0"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Restart Mic</span>
                    </button>
                  </div>
                )}

                {/* Spoken Response Display */}
                <div
                  aria-live="polite"
                  className="relative rounded-xl bg-secondary/70 border border-border/80 p-3.5"
                >
                  {spokenTranscript && (
                    <p className="mb-1 text-xs font-semibold text-muted-foreground pr-20">
                      You: <span className="text-foreground">"{spokenTranscript}"</span>
                    </p>
                  )}

                  <p className="text-base sm:text-lg font-bold leading-relaxed text-foreground select-text pr-20">
                    {isProcessing ? (
                      <span className="flex items-center gap-2 text-primary">
                        <Eye className="h-5 w-5" />
                        <span>Observing and reasoning…</span>
                      </span>
                    ) : (
                      assistantResponse
                    )}
                  </p>

                  {!isProcessing && assistantResponse && (
                    <div className="absolute right-2.5 top-2.5 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => speakText(assistantResponse, settings.speechRate)}
                        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-primary hover:bg-card transition-colors"
                        aria-label="Replay spoken response"
                        title="Speak again"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={stopSpeaking}
                        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-card transition-colors"
                        aria-label="Silence speech output"
                        title="Stop speaking"
                      >
                        <VolumeX className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Reach Guidance Card (when target is in arm's reach) */}
              {reachGuidance && reachGuidance.active && (
                <div className="rounded-2xl bg-emerald-950/40 border border-emerald-500/70 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/50">
                      <Crosshair className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-emerald-400">
                        Reach Guidance · {reachGuidance.clockPosition}
                      </div>
                      <p className="text-base font-bold text-emerald-100">
                        {reachGuidance.handInstruction}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => speakText(reachGuidance.handInstruction, settings.speechRate)}
                    className="min-h-[40px] rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 shrink-0"
                  >
                    Repeat
                  </button>
                </div>
              )}

              {/* Active Hazard Banner */}
              {activeHazard && (
                <div className="rounded-2xl bg-destructive/15 border border-destructive/60 p-3.5 flex items-center justify-between gap-2 text-sm font-bold text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <span>
                      Hazard ({activeHazard.source === 'sensor_hardware' ? 'Hardware ToF' : activeHazard.source === 'sensor_simulator' ? 'Simulator' : 'Vision'}): {activeHazard.description}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveHazard(null)}
                    className="text-xs underline shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Optional Typed Fallback (for devices where microphone speech recognition is unavailable) */}
              <div className="pt-1">
                {!showTextInput ? (
                  <button
                    type="button"
                    onClick={() => setShowTextInput(true)}
                    className="w-full py-2 text-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Microphone unavailable? Open typed test bar
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (typedQuery.trim()) {
                        handleUserQuery(typedQuery.trim());
                        setTypedQuery('');
                      }
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={typedQuery}
                      onChange={(e) => setTypedQuery(e.target.value)}
                      placeholder='Try "Find the water bottle", "Help me to walk near door", or "Help me finding obstacles"...'
                      className="flex-1 rounded-xl bg-card px-4 py-2.5 text-sm border border-border focus:border-primary focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isProcessing || !typedQuery.trim()}
                      className="min-h-[44px] rounded-xl bg-primary px-4 text-primary-foreground hover:brightness-110 disabled:opacity-50"
                      aria-label="Send query"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                )}
          </div>
        </div>
      </div>
    </main>
  );
}
