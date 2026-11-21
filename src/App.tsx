/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraView, CameraViewHandle } from './components/CameraView';
import { AssistantHomeView } from './components/AssistantHomeView';
import { LiveVisionView } from './components/LiveVisionView';
import { SpatialWorldView } from './components/SpatialWorldView';
import { ContextualMemoryView } from './components/ContextualMemoryView';
import { DeviceStatusView } from './components/DeviceStatusView';
import { SettingsDiagnosticsView } from './components/SettingsDiagnosticsView';
import {
  DetectedObject,
  GoalTask,
  HazardAlert,
  SentraMemoryItem,
  SentraMode,
  SentraOperation,
  SentraSettings,
  SentraStats,
  SpatialLandmark,
  SpatialRelationship,
  VerificationStep,
} from './types/sentra';
import type { CameraSourceType, PathSafetyStatus } from './types/deviceProtocol';
import { parseVoiceIntent } from './utils/parser';
import {
  assessFrameVisibility,
  deriveUnifiedSessionPhase,
  parseDirectSessionControl,
  shouldSpeakContinuousUpdate,
} from './utils/sessionControls';
import {
  isSpeaking,
  playChime,
  setAudioConfig,
  speakText,
  stopSpeaking,
  subscribeSpeakingState,
} from './utils/audio';
import { useDeviceTelemetry } from './hooks/useDeviceTelemetry';
import { useVoiceAssistant } from './hooks/useVoiceAssistant';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import {
  analyzeSentraObservation,
  clearAllMemories,
  createMemory,
  deleteMemory,
  fetchMemories,
  updateAudioOwnership,
} from './services/deviceApi';
import { useFirebase } from './contexts/FirebaseContext';
import { useGeminiLiveVoice } from './hooks/useGeminiLiveVoice';
import type { LiveVoiceName } from './lib/firebase';
import {
  AlertTriangle,
  ArrowLeft,
  LogOut,
  PhoneCall,
  PhoneOff,
  User as UserIcon,
} from 'lucide-react';

type ActiveTopView = 'assistant' | 'device' | 'settings';

const STATS_STORAGE_KEY = 'sentra.stats.v2';
const MEMORY_STORAGE_KEY = 'sentra.memory.v2';
const SETTINGS_STORAGE_KEY = 'sentra.settings.v2';
const INITIAL_ASSISTANT_MESSAGE =
  'Press Start Sentra to turn on your camera and microphone, then say “Hey Sentra” and ask anything about your surroundings.';

const DEFAULT_STATS: SentraStats = {
  calls: 0,
  totalMs: 0,
  hazards: 0,
  findsStarted: 0,
  findsDone: 0,
};

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
  autoContinuousFind: true,
  continuousWatchMode: false,
  reachGuidanceEnabled: true,
};

const LANDMARK_KEYWORDS = [
  'door',
  'doorway',
  'desk',
  'table',
  'chair',
  'sofa',
  'couch',
  'bed',
  'counter',
  'sink',
  'window',
  'stairs',
  'shelf',
  'cabinet',
];

function isLandmarkable(label: string): boolean {
  const lower = label.toLowerCase();
  return LANDMARK_KEYWORDS.some((kw) => lower.includes(kw));
}

export default function App() {
  const cameraRef = useRef<CameraViewHandle | null>(null);
  const firebase = useFirebase();

  const [activeView, setActiveView] = useState<ActiveTopView>('assistant');
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const [liveVoicePersona, setLiveVoicePersona] = useState<LiveVoiceName>('Zephyr');

  // Unified session state
  const isOnline = useOnlineStatus();
  const [sessionActive, setSessionActive] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);
  const [isAudioSpeaking, setIsAudioSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [spokenTranscript, setSpokenTranscript] = useState<string>('');
  const [assistantResponse, setAssistantResponse] = useState<string>(INITIAL_ASSISTANT_MESSAGE);
  const [lastAppError, setLastAppError] = useState<string | null>(null);
  const [typedQuery, setTypedQuery] = useState('');

  // Perception & World Model State (strictly populated from real observations)
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [detectionTimestamp, setDetectionTimestamp] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [activeHazard, setActiveHazard] = useState<HazardAlert | null>(null);
  const [activePerceptionPrompt, setActivePerceptionPrompt] = useState<string | null>(null);
  const [sceneDescription, setSceneDescription] = useState<string>(
    'No observation analyzed yet. Start Sentra to observe your surroundings.'
  );
  const [rawPathStatus, setRawPathStatus] = useState<PathSafetyStatus>('unknown');

  // Continuing Task State
  const [currentGoal, setCurrentGoal] = useState<GoalTask | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraContainerRef = useRef<HTMLDivElement | null>(null);

  // Spatial context populated only from real detections
  const [landmarks, setLandmarks] = useState<SpatialLandmark[]>([]);
  const [relationships, setRelationships] = useState<SpatialRelationship[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('Home');

  // Persistence state
  const [memories, setMemories] = useState<SentraMemoryItem[]>(() => {
    try {
      const stored = localStorage.getItem(MEMORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [stats, setStats] = useState<SentraStats>(() => {
    try {
      const stored = localStorage.getItem(STATS_STORAGE_KEY);
      return stored ? { ...DEFAULT_STATS, ...JSON.parse(stored) } : DEFAULT_STATS;
    } catch {
      return DEFAULT_STATS;
    }
  });

  const [settings, setSettings] = useState<SentraSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Mutable refs for safe async callbacks & avoiding stale closures
  const sessionActiveRef = useRef(sessionActive);
  sessionActiveRef.current = sessionActive;
  const isSwitchingSourceRef = useRef(isSwitchingSource);
  isSwitchingSourceRef.current = isSwitchingSource;
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
  const assistantResponseRef = useRef(assistantResponse);
  assistantResponseRef.current = assistantResponse;
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const targetWasVisibleRef = useRef<boolean>(false);
  const lastSpokenMetaRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const analyzeAbortRef = useRef<AbortController | null>(null);

  // Sync audio mute & volume config and reactive speaking state
  useEffect(() => {
    setAudioConfig({
      muted: settings.voiceMuted,
      volume: settings.voiceVolume,
    });
  }, [settings.voiceMuted, settings.voiceVolume]);

  useEffect(() => {
    return subscribeSpeakingState(setIsAudioSpeaking);
  }, []);

  useEffect(() => {
    return () => {
      analyzeAbortRef.current?.abort();
    };
  }, []);

  // Load persisted backend memories on mount
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
      .catch(() => {
        // Silently retain local memories if backend memory route is unreachable on boot
      });
    return () => {
      active = false;
    };
  }, []);

  // Sync Firebase profile & merge Cloud Firestore memories on sign-in
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

  const updateStats = useCallback((updater: (prev: SentraStats) => SentraStats) => {
    setStats((prev) => {
      const updated = updater(prev);
      try {
        localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const updateSettings = useCallback((next: SentraSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const [audioOwnership, setAudioOwnership] = useState<'browser' | 'wearable' | 'test'>('browser');
  const audioOwnershipRef = useRef(audioOwnership);
  audioOwnershipRef.current = audioOwnership;

  const speakAndDisplay = useCallback((message: string, opts?: { speak?: boolean }) => {
    setAssistantResponse(message);
    const shouldSpeak = opts?.speak !== false;
    if (
      shouldSpeak &&
      (audioOwnershipRef.current !== 'wearable' || !activeDeviceRef.current?.connected)
    ) {
      lastSpokenMetaRef.current = { text: message, at: Date.now() };
      speakText(message, settingsRef.current.speechRate);
    }
  }, []);

  // Device Telemetry & Analytics Gateway Hook (SSE + fallback polling)
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
      if (audioOwnershipRef.current !== 'wearable' || !activeDeviceRef.current?.connected) {
        speakText(alert.description, settingsRef.current.speechRate);
      }
      updateStats((s) => ({ ...s, hazards: s.hazards + 1 }));
    },
    [updateStats]
  );

  const handleAudioOwnershipChange = useCallback(async (mode: 'browser' | 'wearable' | 'test') => {
    setAudioOwnership(mode);
    try {
      let token: string | undefined;
      try {
        token = sessionStorage.getItem('sentra.operator.token') || undefined;
      } catch {}
      await updateAudioOwnership(mode, token);
    } catch {}
  }, []);

  const handleWearableVoiceTurn = useCallback((turn: any) => {
    if (turn.transcript) setSpokenTranscript(turn.transcript);
    if (turn.spokenResponse) setAssistantResponse(turn.spokenResponse);
    if (turn.analysis?.hazard) setActiveHazard(turn.analysis.hazard);
  }, []);

  const handleWearableGoalUpdate = useCallback((update: { deviceId: string; goal: GoalTask | null }) => {
    if (
      !settingsRef.current.selectedWearableDeviceId ||
      update.deviceId === settingsRef.current.selectedWearableDeviceId
    ) {
      setCurrentGoal(update.goal);
    }
  }, []);

  const {
    devices,
    activeDevice,
    sseConnected,
    telemetryError,
    analytics,
    analyticsRange,
    setAnalyticsRange,
    includeSimulatedAnalytics,
    setIncludeSimulatedAnalytics,
    refreshAnalytics,
  } = useDeviceTelemetry({
    selectedDeviceId: settings.selectedWearableDeviceId,
    onAlert: handleTelemetryAlert,
    onVoiceTurn: handleWearableVoiceTurn,
    onGoalUpdate: handleWearableGoalUpdate,
  });

  const activeDeviceRef = useRef(activeDevice);
  activeDeviceRef.current = activeDevice;

  // Detect mid-session wearable disconnect honestly and pause wearable visual guidance
  const prevWearableConnectedRef = useRef<boolean>(false);
  useEffect(() => {
    const nowConnected = Boolean(activeDevice?.connected);
    const wasConnected = prevWearableConnectedRef.current;
    prevWearableConnectedRef.current = nowConnected;

    if (
      wasConnected &&
      !nowConnected &&
      sessionActiveRef.current &&
      settingsRef.current.cameraSource === 'esp32_camera'
    ) {
      analyzeAbortRef.current?.abort();
      setDetectedObjects([]);
      setDetectionTimestamp(null);
      setActivePerceptionPrompt(null);
      targetWasVisibleRef.current = false;
      if (currentGoalRef.current && currentGoalRef.current.state === 'active') {
        setCurrentGoal((prev) =>
          prev
            ? { ...prev, state: 'need_observation', updatedAt: Date.now() }
            : null
        );
      }
      const msg =
        'Wearable camera disconnected. Visual guidance is paused. Switch to Mobile Camera or check Device Setup.';
      setLastAppError(msg);
      speakAndDisplay(msg);
    }
  }, [activeDevice?.connected, speakAndDisplay]);

  // Clear hardware sensor hazard automatically when ToF returns clear
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

  const effectivePathStatus: PathSafetyStatus = useMemo(() => {
    if (activeHazard?.severity === 'critical' && activeHazard.source === 'sensor_hardware') {
      return 'confirmed_sensor_alert';
    }
    if (!isCameraReady && rawPathStatus === 'observation_available') {
      return 'observation_unavailable';
    }
    return rawPathStatus;
  }, [activeHazard, isCameraReady, rawPathStatus]);

  // Memory CRUD wired to backend + Cloud Firestore when signed in
  const handleAddMemory = useCallback(
    async (label: string, note: string, room?: string) => {
      const heading = cameraRef.current?.heading ?? activeDeviceRef.current?.sensors.imu?.heading ?? null;
      try {
        const created = await createMemory({
          label,
          note,
          room: room || currentRoom,
          heading,
          source: 'user_manual',
        });
        saveMemoriesLocally([created, ...memoriesRef.current]);
        if (firebase.user) {
          firebase.saveMemory(created).catch(() => {});
        }
      } catch {
        const localFallback: SentraMemoryItem = {
          id: `mem-${Date.now()}`,
          label,
          note,
          room: room || currentRoom,
          at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now(),
          heading,
          source: 'user_manual',
        };
        saveMemoriesLocally([localFallback, ...memoriesRef.current]);
        if (firebase.user) {
          firebase.saveMemory(localFallback).catch(() => {});
        }
      }
    },
    [currentRoom, saveMemoriesLocally, firebase]
  );

  const handleDeleteMemory = useCallback(
    async (id: string) => {
      saveMemoriesLocally(memoriesRef.current.filter((m) => m.id !== id));
      try {
        await deleteMemory(id);
      } catch {}
      if (firebase.user) {
        firebase.removeMemory(id).catch(() => {});
      }
    },
    [saveMemoriesLocally, firebase]
  );

  const handleClearMemories = useCallback(async () => {
    const existingIds = memoriesRef.current.map((m) => m.id);
    saveMemoriesLocally([]);
    try {
      await clearAllMemories();
    } catch {}
    if (firebase.user) {
      Promise.all(existingIds.map((id) => firebase.removeMemory(id))).catch(() => {});
    }
  }, [saveMemoriesLocally, firebase]);

  // Core Multimodal Conversational Analysis Pipeline (no brittle keyword gate)
  const executeAnalysis = useCallback(
    async (
      mode: SentraMode,
      query = '',
      goalTargetOverride?: string | null,
      operationOverride?: SentraOperation,
      options?: { isContinuousCheck?: boolean; interruptExisting?: boolean }
    ): Promise<boolean> => {
      if (isSwitchingSourceRef.current) return false;
      if (isProcessingRef.current) {
        if (options?.interruptExisting) {
          analyzeAbortRef.current?.abort();
        } else {
          return false;
        }
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      const startTime = performance.now();

      const curSettings = settingsRef.current;
      const curGoal = currentGoalRef.current;
      const curMemories = memoriesRef.current;
      const curDevice = activeDeviceRef.current;

      if (!options?.isContinuousCheck && curSettings.audioFeedback) {
        playChime('capture');
      }

      // Guard: if wearable source is selected and offline, never fabricate visual guidance
      if (curSettings.cameraSource === 'esp32_camera' && !curDevice?.connected) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        const msg =
          'Wearable camera is not connected, so I cannot see your surroundings right now. Switch to Mobile Camera or open Device Setup.';
        setLastAppError(msg);
        if (!options?.isContinuousCheck) {
          speakAndDisplay(msg);
        }
        return false;
      }

      const snapshot = (await cameraRef.current?.captureSnapshot()) || {
        dataUrl: null,
        quality: null,
        width: 0,
        height: 0,
        timestamp: null,
        source: curSettings.cameraSource,
      };

      // Honest optical quality check: pause movement guidance if frame is unusable dark or blurry
      if (snapshot.dataUrl) {
        const visibility = assessFrameVisibility(snapshot.quality);
        if (!visibility.usable && visibility.spokenGuidance) {
          isProcessingRef.current = false;
          setIsProcessing(false);
          setActivePerceptionPrompt(visibility.spokenGuidance);
          if (curGoal) {
            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    state: 'need_observation',
                    requiredObservation: visibility.spokenGuidance,
                    updatedAt: Date.now(),
                  }
                : null
            );
          }
          const shouldSpeak =
            !options?.isContinuousCheck ||
            shouldSpeakContinuousUpdate({
              nextText: visibility.spokenGuidance,
              lastSpokenText: lastSpokenMetaRef.current.text,
              lastSpokenAt: lastSpokenMetaRef.current.at,
              now: Date.now(),
              foundTarget: false,
              targetLostFromView: false,
              hasHazard: false,
            });
          speakAndDisplay(visibility.spokenGuidance, { speak: shouldSpeak });
          return false;
        }
      }

      const sensorsSummary = cameraRef.current?.getSensorsSummary() || '';
      const heading = cameraRef.current?.heading ?? curDevice?.sensors.imu?.heading ?? null;
      const activeGoalTarget =
        goalTargetOverride !== undefined ? goalTargetOverride : curGoal?.targetObject ?? null;

      // Always allow Gemini to inspect the live frame whenever one is captured;
      // only route pure device_status queries without requiring camera vision.
      const parsedHint = query ? parseVoiceIntent(query) : null;
      const inferredOp: SentraOperation =
        operationOverride ??
        (parsedHint?.operation === 'device_status'
          ? 'device_status'
          : activeGoalTarget
          ? 'object_query'
          : snapshot.dataUrl || curSettings.cameraSource === 'esp32_camera'
          ? 'scene_analysis'
          : 'conversation');

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
            history: historyRef.current.slice(-10),
            heading,
            useWearableFrame: curSettings.cameraSource === 'esp32_camera',
            wearableDeviceId: curSettings.selectedWearableDeviceId,
          },
          abortController.signal
        );

        // Discard response if session stopped or source changed mid-flight
        if (abortController.signal.aborted || isSwitchingSourceRef.current) {
          isProcessingRef.current = false;
          setIsProcessing(false);
          return false;
        }

        isProcessingRef.current = false;
        setIsProcessing(false);

        const latency = performance.now() - startTime;
        updateStats((s) => ({
          ...s,
          calls: s.calls + 1,
          totalMs: s.totalMs + latency,
        }));

        if (data.status !== 'ok' || data.errorCode) {
          const errorDetail = data.errorMessage || 'Visual AI service is currently unavailable.';
          setLastAppError(errorDetail);
          const spoken =
            data.spokenResponse ||
            data.text ||
            'I could not complete that check right now. Please try again in a moment.';
          if (data.pathStatus) setRawPathStatus(data.pathStatus);
          if (!options?.isContinuousCheck) {
            speakAndDisplay(spoken);
          }
          return false;
        }

        setLastAppError(null);
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

        if (data.sceneDescription) setSceneDescription(data.sceneDescription);
        if (data.pathStatus) setRawPathStatus(data.pathStatus);
        setActivePerceptionPrompt(data.activePerceptionRequest || null);

        // Update spatial landmarks when heading is known
        if (heading != null && data.detectedObjects && data.detectedObjects.length > 0) {
          const landmarkObjects = data.detectedObjects.filter(
            (o) => isLandmarkable(o.label) || o.isTargetGoal
          );
          if (landmarkObjects.length > 0) {
            setLandmarks((prev) => {
              const updated = [...prev];
              for (const obj of landmarkObjects) {
                const existingIdx = updated.findIndex(
                  (l) => l.name.toLowerCase() === obj.label.toLowerCase()
                );
                const lmItem: SpatialLandmark = {
                  id: existingIdx >= 0 ? updated[existingIdx].id : `lm-${Date.now()}-${obj.id}`,
                  name: obj.label,
                  heading,
                  distanceEst: obj.relativeDistance.replace('_', ' '),
                  room: currentRoom,
                  lastSeenAt: frameTs,
                  verified: true,
                };
                if (existingIdx >= 0) updated[existingIdx] = lmItem;
                else updated.push(lmItem);
              }
              return updated.slice(-24);
            });
          }
        }

        // Reach guidance
        if (
          data.reachGuidance &&
          data.reachGuidance.active &&
          curSettings.reachGuidanceEnabled &&
          !data.hazard &&
          !spoken.includes(data.reachGuidance.handInstruction)
        ) {
          spoken = `${spoken} ${data.reachGuidance.handInstruction}`.trim();
        }

        // Vision hazard alert (never overrides confirmed hardware ToF hazard)
        const hasActiveHardwareHazard =
          activeHazard?.severity === 'critical' && activeHazard.source === 'sensor_hardware';
        const hasNewHazard = Boolean(data.hazard && !hasActiveHardwareHazard);
        if (data.hazard && !hasActiveHardwareHazard) {
          setActiveHazard({ ...data.hazard, source: 'vision_ai', timestamp: Date.now() });
          if (curSettings.audioFeedback) playChime('hazard');
          updateStats((s) => ({ ...s, hazards: s.hazards + 1 }));
        } else if (!data.hazard && !hasActiveHardwareHazard) {
          setActiveHazard(null);
        }

        // Save memory whenever Gemini extracts rememberedData (naturally via conversation)
        if (data.rememberedData && data.rememberedData.label) {
          const rem = data.rememberedData;
          try {
            const saved = await createMemory({
              label: rem.label,
              note: rem.note || spoken,
              room: rem.room || currentRoom,
              heading,
              source: 'live_verified',
            });
            if (saved.room) setCurrentRoom(saved.room);
            saveMemoriesLocally([saved, ...memoriesRef.current.filter((m) => m.id !== saved.id)]);
            if (firebase.user) firebase.saveMemory(saved).catch(() => {});
          } catch {
            const localItem: SentraMemoryItem = {
              id: `mem-${Date.now()}`,
              label: rem.label,
              note: rem.note || spoken,
              room: rem.room || currentRoom,
              at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              timestamp: Date.now(),
              heading,
              source: 'live_verified',
            };
            saveMemoriesLocally([localItem, ...memoriesRef.current]);
            if (firebase.user) firebase.saveMemory(localItem).catch(() => {});
          }
        }

        // Continuing step-by-step task lifecycle driven by Gemini intent & live observations
        const aiGoal = data.goalUpdate;
        const effectiveTarget = aiGoal?.targetObject || activeGoalTarget;
        let targetLostFromView = false;

        if (effectiveTarget) {
          const targetObj = data.detectedObjects?.find(
            (o) =>
              o.isTargetGoal ||
              o.label.toLowerCase().includes(effectiveTarget.toLowerCase())
          );

          const isNowVisible = Boolean(data.foundTarget || targetObj);
          if (targetWasVisibleRef.current && !isNowVisible && curGoal) {
            targetLostFromView = true;
            if (!/lost|no longer|can't see|cannot see|disappear|unclear/i.test(spoken)) {
              spoken = `I lost sight of the ${effectiveTarget}. Pausing movement guidance. Slowly adjust the camera slightly left or right.`;
            }
          }
          targetWasVisibleRef.current = isNowVisible;

          const aiState = aiGoal?.state?.toLowerCase();
          const shouldComplete =
            aiState === 'completed' ||
            (data.foundTarget && Boolean(data.reachGuidance?.inArmReach));

          const nextState: GoalTask['state'] = shouldComplete
            ? 'completed'
            : targetLostFromView || aiState === 'need_observation' || aiState === 'paused' || Boolean(data.activePerceptionRequest)
            ? 'need_observation'
            : 'active';

          const step: VerificationStep = {
            id: `step-${Date.now()}`,
            timestamp: Date.now(),
            stepName: shouldComplete
              ? 'Reached Target'
              : targetLostFromView
              ? 'Target Lost'
              : isNowVisible
              ? 'Target Spotted'
              : 'Scanning',
            note: spoken,
            state: nextState,
            outcome: shouldComplete
              ? 'success'
              : targetLostFromView || data.activePerceptionRequest
              ? 're_aim_needed'
              : 'attempted',
            actionCategory: shouldComplete ? 'completed' : 'active',
            heading,
            clockPosition: targetObj?.clockPosition,
            confidence: targetObj?.confidence,
          };

          if (curGoal && curGoal.targetObject?.toLowerCase() === effectiveTarget.toLowerCase()) {
            setCurrentGoal({
              ...curGoal,
              state: nextState,
              confidence: targetObj?.confidence ?? curGoal.confidence,
              requiredObservation: data.activePerceptionRequest || null,
              updatedAt: Date.now(),
              history: [...curGoal.history.slice(-12), { timestamp: Date.now(), note: spoken, state: nextState }],
              verificationSteps: [...curGoal.verificationSteps.slice(-12), step],
            });
          } else if (!shouldComplete && (aiGoal?.targetObject || mode === 'find' || mode === 'navigate')) {
            const startedGoal: GoalTask = {
              id: String(Date.now()),
              intent: query || `Find ${effectiveTarget}`,
              targetObject: effectiveTarget,
              state: nextState,
              confidence: targetObj?.confidence ?? null,
              requiredObservation: data.activePerceptionRequest || null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              history: [{ timestamp: Date.now(), note: spoken, state: nextState }],
              verificationSteps: [step],
            };
            setCurrentGoal(startedGoal);
            currentGoalRef.current = startedGoal;
            updateStats((s) => ({ ...s, findsStarted: s.findsStarted + 1 }));
          }

          if (shouldComplete) {
            targetWasVisibleRef.current = false;
            updateStats((s) => ({ ...s, findsDone: s.findsDone + 1 }));
            if (curSettings.audioFeedback) playChime('found');
          }
        }

        // Spatial relationships observed together
        if (data.spatialRelations && data.spatialRelations.length > 0) {
          const validRels: SpatialRelationship[] = data.spatialRelations.map((sr, i) => ({
            id: `rel-${Date.now()}-${i}`,
            subject: sr.subject,
            relation: sr.relation as SpatialRelationship['relation'],
            object: sr.object,
            timestamp: Date.now(),
            verifiedLive: true,
          }));
          setRelationships((prev) => [...prev, ...validRels].slice(-18));
        }

        if (query && !options?.isContinuousCheck) {
          historyRef.current.push({ role: 'user', text: query });
        }
        historyRef.current.push({ role: 'assistant', text: spoken });
        if (historyRef.current.length > 20) {
          historyRef.current = historyRef.current.slice(-20);
        }

        const shouldSpeak =
          !options?.isContinuousCheck ||
          shouldSpeakContinuousUpdate({
            nextText: spoken,
            lastSpokenText: lastSpokenMetaRef.current.text,
            lastSpokenAt: lastSpokenMetaRef.current.at,
            now: Date.now(),
            foundTarget: Boolean(data.foundTarget),
            targetLostFromView,
            hasHazard: hasNewHazard,
          });

        speakAndDisplay(spoken, { speak: shouldSpeak });
        return true;
      } catch (err: any) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        if (err?.name === 'AbortError') return false;

        const offlineMsg = !navigator.onLine
          ? 'Internet connection lost. Visual AI needs a network connection to answer.'
          : `Could not reach Sentra AI right now (${err?.message || 'network error'}). Please try again.`;
        setLastAppError(offlineMsg);
        if (!options?.isContinuousCheck) {
          speakAndDisplay(offlineMsg);
        }
        return false;
      }
    },
    [activeHazard, currentRoom, firebase, saveMemoriesLocally, speakAndDisplay, updateStats]
  );

  // Unified Cancel Task (returns cleanly to listening without ending the session)
  const handleCancelTask = useCallback(() => {
    analyzeAbortRef.current?.abort();
    isProcessingRef.current = false;
    setIsProcessing(false);
    setCurrentGoal(null);
    currentGoalRef.current = null;
    setActivePerceptionPrompt(null);
    targetWasVisibleRef.current = false;
    stopSpeaking();
    if (settingsRef.current.audioFeedback) playChime('stop_listen');
    speakAndDisplay('Task canceled. Listening for your next question.');
  }, [speakAndDisplay]);

  // Repeat last spoken response without re-calling AI
  const handleRepeat = useCallback(() => {
    const current = assistantResponseRef.current?.trim();
    if (!current) return;
    stopSpeaking();
    lastSpokenMetaRef.current = { text: current, at: Date.now() };
    speakText(current, settingsRef.current.speechRate);
  }, []);

  // Forward-declared ref for voice hook stop callback
  const stopSessionFnRef = useRef<() => void>(() => {});

  // Unified Open-Ended User Query Handler (Voice or Text)
  const handleUserQuery = useCallback(
    async (queryText: string) => {
      const trimmed = queryText.trim();
      if (!trimmed) return;
      setSpokenTranscript(trimmed);

      // 1. Immediate meta-controls (Stop Sentra, Cancel this task, Stop speaking, Repeat)
      const directControl = parseDirectSessionControl(trimmed);
      if (directControl === 'stop_session') {
        stopSessionFnRef.current();
        return;
      }
      if (directControl === 'cancel_task') {
        handleCancelTask();
        return;
      }
      if (directControl === 'stop_speaking') {
        stopSpeaking();
        if (settingsRef.current.audioFeedback) playChime('stop_listen');
        setAssistantResponse('Speech stopped. Listening.');
        return;
      }
      if (directControl === 'repeat') {
        handleRepeat();
        return;
      }

      // 2. Interrupt any current speech immediately for a fresh question
      stopSpeaking();
      setLastAppError(null);

      // 3. If user asks a question while Mobile Camera isn't started yet, start it automatically
      if (
        settingsRef.current.cameraSource === 'browser_camera' &&
        !isCameraReadyRef.current &&
        cameraRef.current
      ) {
        const started = await cameraRef.current.startBrowserCamera();
        if (started) {
          setSessionActive(true);
          sessionActiveRef.current = true;
          // Give video element a brief moment to deliver its first decoded frame
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      // 4. Let Gemini understand natural intent (no fixed menu!)
      const intentHint = parseVoiceIntent(trimmed);

      // Only clear a previous task if the user is clearly asking about a brand-new find target
      if (
        (intentHint.mode === 'find' || intentHint.mode === 'navigate') &&
        intentHint.goal &&
        currentGoalRef.current?.targetObject?.toLowerCase() !== intentHint.goal.toLowerCase()
      ) {
        targetWasVisibleRef.current = false;
        const newGoal: GoalTask = {
          id: String(Date.now()),
          intent: trimmed,
          targetObject: intentHint.goal,
          state: 'active',
          confidence: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          history: [{ timestamp: Date.now(), note: `Started locating ${intentHint.goal}`, state: 'active' }],
          verificationSteps: [],
        };
        setCurrentGoal(newGoal);
        currentGoalRef.current = newGoal;
        updateStats((s) => ({ ...s, findsStarted: s.findsStarted + 1 }));
        await executeAnalysis(intentHint.mode, trimmed, intentHint.goal, 'object_query', {
          interruptExisting: true,
        });
        return;
      }

      // Pass open-ended query + active goal context + live frame directly to Gemini
      await executeAnalysis(
        intentHint.mode,
        trimmed,
        currentGoalRef.current?.state === 'active' || currentGoalRef.current?.state === 'need_observation'
          ? currentGoalRef.current.targetObject
          : null,
        intentHint.operation === 'device_status' ? 'device_status' : undefined,
        { interruptExisting: true }
      );
    },
    [executeAnalysis, handleCancelTask, handleRepeat, updateStats]
  );

  // Voice Interrupt Handler (handles "Stop", "Cancel this task", "Stop Sentra" spoken aloud)
  const handleVoiceInterrupt = useCallback(
    (interruptText?: string) => {
      stopSpeaking();
      if (!interruptText) return;
      const control = parseDirectSessionControl(interruptText);
      if (control === 'stop_session') {
        stopSessionFnRef.current();
      } else if (control === 'cancel_task') {
        handleCancelTask();
      } else if (control === 'repeat') {
        handleRepeat();
      } else {
        setAssistantResponse('Speech stopped. Listening.');
      }
    },
    [handleCancelTask, handleRepeat]
  );

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
    isProcessing,
    isSpeaking: isAudioSpeaking,
    onCommand: handleUserQuery,
    onInterrupt: handleVoiceInterrupt,
  });

  const liveVoice = useGeminiLiveVoice({
    deviceId: settings.selectedWearableDeviceId,
    cameraSource: settings.cameraSource,
    voiceName: liveVoicePersona,
    muted: settings.voiceMuted,
    volume: settings.voiceVolume,
    captureBrowserSnapshot: async () => {
      const snap = await cameraRef.current?.captureSnapshot();
      return { dataUrl: snap?.dataUrl ?? null, timestamp: snap?.timestamp ?? null };
    },
    onMemorySaved: (item) => {
      saveMemoriesLocally([item, ...memoriesRef.current.filter((m) => m.id !== item.id)]);
      if (firebase.user) firebase.saveMemory(item).catch(() => {});
    },
    onHardwareEvent: (evt) => {
      if (evt.event === 'PROXIMITY_CRITICAL' && evt.distanceCm != null) {
        setActiveHazard({
          id: `live-hw-${Date.now()}`,
          type: 'obstacle',
          severity: 'critical',
          description: `Forward sensor measures an obstacle within ${Math.round(evt.distanceCm)} cm.`,
          clockPosition: "12 o'clock",
          source: 'sensor_hardware',
          timestamp: Date.now(),
        });
      }
    },
    onTurnComplete: ({ userTranscript, assistantTranscript }) => {
      if (userTranscript) setSpokenTranscript(userTranscript);
      setAssistantResponse(assistantTranscript);
      if (firebase.user) {
        firebase
          .logLiveConversationTurn({
            sessionId: `live-${Date.now()}`,
            deviceId: activeDeviceRef.current?.deviceId || settingsRef.current.selectedWearableDeviceId,
            model: 'gemini-3.8-live',
            userTranscript,
            assistantTranscript,
            forwardDistanceCm: activeDeviceRef.current?.sensors.forwardDistanceCm ?? null,
          })
          .catch(() => {});
      }
    },
  });

  // Single-action Start Sentra Session (starts camera + mic + announces readiness)
  const startSentraSession = useCallback(async () => {
    if (isStartingSession) return;
    setIsStartingSession(true);
    setLastAppError(null);
    stopSpeaking();

    const source = settingsRef.current.cameraSource;
    let cameraNote = '';
    let cameraOk = false;

    if (source === 'browser_camera') {
      cameraOk = Boolean(await cameraRef.current?.startBrowserCamera());
      if (!cameraOk) {
        const diag = cameraRef.current?.getCameraDiagnostics();
        cameraNote =
          diag?.browserError ||
          'Camera permission was denied or no camera is available. Allow camera access in browser settings.';
      }
    } else {
      cameraOk = Boolean(activeDeviceRef.current?.connected);
      if (!cameraOk) {
        cameraNote =
          'Wearable camera is not connected. Open Device Setup or switch to Mobile Camera.';
      }
    }

    let micStarted = false;
    if (voice.compatibility.foregroundWakeSupported) {
      micStarted = await voice.enableWakeWord();
    }

    setSessionActive(true);
    sessionActiveRef.current = true;
    setIsStartingSession(false);

    if (settingsRef.current.audioFeedback) {
      playChime('start_listen');
    }

    if (!cameraOk && cameraNote) {
      setLastAppError(cameraNote);
      const msg = micStarted
        ? `Sentra is listening, but ${cameraNote}`
        : `Sentra started with limited input: ${cameraNote}`;
      speakAndDisplay(msg);
      return;
    }

    if (micStarted) {
      speakAndDisplay(
        'Sentra is ready. Say Hey Sentra and ask any question, or tap the microphone button.'
      );
    } else if (voice.compatibility.speechRecognitionSupported) {
      speakAndDisplay(
        'Sentra is ready with camera active. Tap the microphone button whenever you want to speak, or type a question below.'
      );
    } else {
      speakAndDisplay(
        'Sentra camera is active. Voice recognition is unavailable in this browser, so use the text box below.'
      );
    }
  }, [isStartingSession, speakAndDisplay, voice]);

  // Complete Stop Sentra Session (releases camera, mic, streams, tasks, and in-flight requests)
  const stopSentraSession = useCallback(() => {
    analyzeAbortRef.current?.abort();
    isProcessingRef.current = false;
    setIsProcessing(false);
    setIsStartingSession(false);
    setIsSwitchingSource(false);
    setSessionActive(false);
    sessionActiveRef.current = false;

    setCurrentGoal(null);
    currentGoalRef.current = null;
    setDetectedObjects([]);
    setDetectionTimestamp(null);
    setActiveHazard(null);
    setActivePerceptionPrompt(null);
    targetWasVisibleRef.current = false;

    voice.disableWakeWord();
    if (liveVoice.status === 'connected' || liveVoice.status === 'connecting') {
      liveVoice.disconnect();
    }
    cameraRef.current?.stopBrowserCamera();
    stopSpeaking();

    if (settingsRef.current.audioFeedback) {
      playChime('stop_listen');
    }
    const stoppedMsg = 'Sentra stopped. Camera and microphone are off.';
    setAssistantResponse(stoppedMsg);
    speakText('Sentra stopped.', settingsRef.current.speechRate);
  }, [liveVoice, voice]);

  stopSessionFnRef.current = stopSentraSession;

  // Tap-to-Talk button handler while session is active
  const handleTapToTalk = useCallback(() => {
    if (!sessionActiveRef.current) {
      startSentraSession();
      return;
    }
    stopSpeaking();
    if (isProcessingRef.current) {
      analyzeAbortRef.current?.abort();
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
    if (!voice.compatibility.speechRecognitionSupported) {
      speakAndDisplay('Speech recognition is not supported in this browser. Type your question below.');
      return;
    }
    voice.activateCommandWindow();
  }, [speakAndDisplay, startSentraSession, voice]);

  // Safe Camera Source Switching (pauses guidance, releases previous stream, discards stale frames, announces result)
  const handleCameraSourceChange = useCallback(
    async (nextSource: CameraSourceType) => {
      if (settingsRef.current.cameraSource === nextSource) return;

      const wasActive = sessionActiveRef.current;
      setIsSwitchingSource(true);
      isSwitchingSourceRef.current = true;
      setLastAppError(null);

      // Pause visual guidance & abort stale requests immediately
      analyzeAbortRef.current?.abort();
      isProcessingRef.current = false;
      setIsProcessing(false);
      stopSpeaking();
      setDetectedObjects([]);
      setDetectionTimestamp(null);
      setActivePerceptionPrompt(null);
      targetWasVisibleRef.current = false;

      if (currentGoalRef.current && currentGoalRef.current.state === 'active') {
        setCurrentGoal((prev) =>
          prev ? { ...prev, state: 'need_observation', updatedAt: Date.now() } : null
        );
      }

      // Release previous mobile stream cleanly when leaving mobile camera
      if (settingsRef.current.cameraSource === 'browser_camera') {
        cameraRef.current?.stopBrowserCamera();
      }

      updateSettings({ ...settingsRef.current, cameraSource: nextSource });

      if (!wasActive) {
        setIsSwitchingSource(false);
        isSwitchingSourceRef.current = false;
        if (nextSource === 'esp32_camera' && !activeDeviceRef.current?.connected) {
          setAssistantResponse(
            'Wearable Camera selected, but no wearable is connected. Open Device Setup or switch back to Mobile Camera.'
          );
        } else {
          setAssistantResponse(
            nextSource === 'browser_camera'
              ? 'Mobile Camera selected. Press Start Sentra when ready.'
              : 'Wearable Camera selected and connected. Press Start Sentra when ready.'
          );
        }
        return;
      }

      // Allow React props to flush before starting the new camera source
      await new Promise((r) => setTimeout(r, 150));

      if (nextSource === 'browser_camera') {
        const ok = Boolean(await cameraRef.current?.startBrowserCamera());
        setIsSwitchingSource(false);
        isSwitchingSourceRef.current = false;
        if (ok) {
          speakAndDisplay('Switched to Mobile Camera. Ready to guide.');
        } else {
          const msg =
            'Could not switch to Mobile Camera. Check browser camera permissions and try again.';
          setLastAppError(msg);
          speakAndDisplay(msg);
        }
      } else {
        const connected = Boolean(activeDeviceRef.current?.connected);
        setIsSwitchingSource(false);
        isSwitchingSourceRef.current = false;
        if (connected) {
          speakAndDisplay('Switched to Wearable Camera. Observing from wearable feed.');
        } else {
          const msg =
            'Wearable camera is not connected. Visual guidance is paused. Open Device Setup or return to Mobile Camera.';
          setLastAppError(msg);
          speakAndDisplay(msg);
        }
      }
    },
    [speakAndDisplay, updateSettings]
  );

  // Continuing Step-by-Step Object Finding / Task Reassessment Loop
  const activeGoalId = currentGoal?.id ?? null;
  const activeGoalState = currentGoal?.state ?? null;

  useEffect(() => {
    if (!sessionActive) return;
    if (!activeGoalId || (activeGoalState !== 'active' && activeGoalState !== 'need_observation')) return;
    if (!settings.autoContinuousFind) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      if (!sessionActiveRef.current || isSwitchingSourceRef.current) return;
      const goal = currentGoalRef.current;
      if (!goal || (goal.state !== 'active' && goal.state !== 'need_observation')) return;
      if (isProcessingRef.current || isSpeaking()) return;
      if (!isCameraReadyRef.current) return;

      await executeAnalysis(
        'find',
        `Continuing step-by-step guidance for "${goal.targetObject || goal.intent}". Reassess from this fresh camera view and give one calm next step.`,
        goal.targetObject ?? null,
        'object_query',
        { isContinuousCheck: true }
      );
    }, 5500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionActive, activeGoalId, activeGoalState, settings.autoContinuousFind, executeAnalysis]);

  // Toggle optional Gemini Live voice session (available in Settings & Diagnostics)
  const handleToggleLiveVoice = useCallback(async () => {
    if (liveVoice.status === 'connected' || liveVoice.status === 'connecting') {
      liveVoice.disconnect();
      return;
    }
    stopSpeaking();
    if (settingsRef.current.wakeWordEnabled) {
      voice.disableWakeWord();
    }
    await liveVoice.connect();
  }, [liveVoice, voice]);

  const handleToggleWakeWord = useCallback(
    async (nextEnabled: boolean) => {
      if (nextEnabled) {
        if (liveVoice.status === 'connected' || liveVoice.status === 'connecting') {
          liveVoice.disconnect();
        }
        await voice.enableWakeWord();
      } else {
        voice.disableWakeWord();
      }
    },
    [voice, liveVoice]
  );

  // Keyboard shortcut: Escape stops speech; Space (outside inputs) taps to talk when session active
  useEffect(() => {
    const isEditable = (el: Element | null) =>
      el != null &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        (el as HTMLElement).isContentEditable);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSpeaking()) {
        stopSpeaking();
        return;
      }
      if (
        e.code === 'Space' &&
        !e.repeat &&
        !isEditable(document.activeElement) &&
        document.activeElement?.tagName !== 'BUTTON' &&
        sessionActiveRef.current
      ) {
        e.preventDefault();
        handleTapToTalk();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTapToTalk]);

  const wearableConnected = Boolean(activeDevice?.connected);
  const wearableUnavailableSelected =
    settings.cameraSource === 'esp32_camera' && !wearableConnected;

  const phaseDisplay = useMemo(
    () =>
      deriveUnifiedSessionPhase({
        sessionActive,
        isStartingSession,
        isSwitchingSource,
        isProcessing,
        isSpeaking: isAudioSpeaking,
        voiceState: voice.assistantState,
        activeGoal: currentGoal,
        hasBlockingError: Boolean(voice.voiceError || wearableUnavailableSelected),
        wakeWordSupported: voice.compatibility.foregroundWakeSupported,
      }),
    [
      sessionActive,
      isStartingSession,
      isSwitchingSource,
      isProcessing,
      isAudioSpeaking,
      voice.assistantState,
      voice.voiceError,
      voice.compatibility.foregroundWakeSupported,
      currentGoal,
      wearableUnavailableSelected,
    ]
  );

  const shouldShowCameraVisually =
    activeView === 'device' || (activeView === 'assistant' && showCameraPreview);

  useEffect(() => {
    if (cameraContainerRef.current) {
      cameraContainerRef.current.inert = !shouldShowCameraVisually;
    }
  }, [shouldShowCameraVisually]);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/25">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground"
      >
        Skip to main assistant
      </a>

      <div
        className={`mx-auto flex min-h-screen flex-col gap-5 px-4 sm:px-6 safe-top pb-8 transition-[max-width] duration-200 ${
          activeView === 'assistant' ? 'max-w-[520px]' : 'max-w-4xl'
        }`}
      >
        {/* TOP AREA: Matches Visual Reference Exactly */}
        <header className="space-y-4">
          {/* Row 1: Brand Left + Sign In / Account Right */}
          <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-4">
            <div className="min-w-0">
              <h1 className="text-[26px] sm:text-[28px] font-extrabold tracking-wide text-primary leading-none">
                SENTRA
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                Voice-First Assistive Companion
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {firebase.user ? (
                <div className="flex items-center gap-2">
                  <span className="hidden min-[400px]:inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground">
                    <UserIcon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                    <span className="max-w-[110px] truncate">
                      {firebase.user.displayName?.split(' ')[0] ||
                        firebase.user.email?.split('@')[0] ||
                        'Account'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={firebase.signOut}
                    aria-label="Sign out of your account"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-primary/50 bg-[#252010] px-4 text-xs sm:text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground whitespace-nowrap"
                  >
                    <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={firebase.signIn}
                  disabled={!firebase.authReady}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-primary/60 bg-[#252010] px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50 whitespace-nowrap"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>

          {/* Row 2: WEARABLE Section (2 equal dark cards matching reference) */}
          <nav aria-label="Wearable tools" className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                WEARABLE
              </span>
              {activeView !== 'assistant' && (
                <button
                  type="button"
                  onClick={() => setActiveView('assistant')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-primary/60 bg-[#252010] px-3.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground whitespace-nowrap"
                >
                  <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Back to Assistant</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setActiveView(activeView === 'device' ? 'assistant' : 'device')}
                aria-current={activeView === 'device' ? 'page' : undefined}
                className={`min-h-[52px] rounded-xl border px-4 py-3 text-left text-xs sm:text-sm font-semibold transition-colors ${
                  activeView === 'device'
                    ? 'border-primary bg-[#1C2128] text-primary'
                    : 'border-border bg-card text-foreground hover:border-primary/70 hover:bg-secondary'
                }`}
              >
                Device &amp; Analytics
              </button>
              <button
                type="button"
                onClick={() => setActiveView(activeView === 'settings' ? 'assistant' : 'settings')}
                aria-current={activeView === 'settings' ? 'page' : undefined}
                className={`min-h-[52px] rounded-xl border px-4 py-3 text-left text-xs sm:text-sm font-semibold transition-colors ${
                  activeView === 'settings'
                    ? 'border-primary bg-[#1C2128] text-primary'
                    : 'border-border bg-card text-foreground hover:border-primary/70 hover:bg-secondary'
                }`}
              >
                Settings &amp; Diagnostics
              </button>
            </div>
          </nav>

          {/* Row 3: Prominent Two-Option Camera Source Switch */}
          <div className="space-y-2">
            <div
              role="radiogroup"
              aria-label="Camera source"
              className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-card p-1.5"
            >
              <button
                type="button"
                role="radio"
                aria-checked={settings.cameraSource === 'browser_camera'}
                disabled={isSwitchingSource}
                onClick={() => handleCameraSourceChange('browser_camera')}
                className={`min-h-[48px] rounded-xl px-4 py-2.5 text-left text-sm font-bold transition-colors ${
                  settings.cameraSource === 'browser_camera'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground font-semibold hover:bg-secondary hover:text-foreground'
                }`}
              >
                Mobile Camera
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.cameraSource === 'esp32_camera'}
                disabled={isSwitchingSource}
                onClick={() => handleCameraSourceChange('esp32_camera')}
                className={`min-h-[48px] rounded-xl px-4 py-2.5 text-left text-sm font-bold transition-colors ${
                  settings.cameraSource === 'esp32_camera'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground font-semibold hover:bg-secondary hover:text-foreground'
                }`}
              >
                Wearable Camera
              </button>
            </div>

            <p className="px-0.5 text-xs sm:text-sm text-muted-foreground">
              {settings.cameraSource === 'esp32_camera' ? (
                wearableConnected ? (
                  <>
                    Using wearable camera ({activeDevice?.sourceMode === 'simulator' ? 'Simulator' : activeDevice?.deviceId})
                  </>
                ) : (
                  <span className="font-semibold text-foreground">Wearable not connected</span>
                )
              ) : (
                'Using your phone camera'
              )}
            </p>
          </div>

          {/* Honest Action Banner When Wearable Camera Is Selected While Disconnected */}
          {wearableUnavailableSelected && (
            <div
              role="status"
              className="space-y-2.5 rounded-2xl border border-border bg-card px-4 py-3.5 text-sm"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-foreground">
                  <strong>Wearable not connected.</strong> Connect your wearable in Device Setup or return to Mobile Camera.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCameraSourceChange('browser_camera')}
                  className="min-h-[44px] rounded-xl bg-primary px-3.5 text-xs font-bold text-primary-foreground whitespace-nowrap"
                >
                  Return to Mobile Camera
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('device')}
                  className="min-h-[44px] rounded-xl border border-border bg-secondary px-3.5 text-xs font-semibold text-foreground hover:border-primary whitespace-nowrap"
                >
                  Device Setup
                </button>
              </div>
            </div>
          )}
        </header>

        <OfflineIndicator />

        {/* MAIN CONTENT AREA */}
        <main id="main-content" className="flex-1 space-y-5">
          {/* Single Conversational Assistant Home Screen */}
          {activeView === 'assistant' && (
            <AssistantHomeView
              sessionActive={sessionActive}
              isStartingSession={isStartingSession}
              isSwitchingSource={isSwitchingSource}
              phaseDisplay={phaseDisplay}
              cameraSource={settings.cameraSource}
              isCameraReady={isCameraReady}
              wearableConnected={wearableConnected}
              wakeWordEnabled={settings.wakeWordEnabled}
              wakeWordSupported={voice.compatibility.foregroundWakeSupported}
              wakeLimitationNote={voice.compatibility.limitationNote}
              liveTranscript={voice.liveTranscript}
              spokenTranscript={spokenTranscript}
              assistantResponse={assistantResponse}
              hasConversationActivity={Boolean(
                spokenTranscript || assistantResponse !== INITIAL_ASSISTANT_MESSAGE
              )}
              isProcessing={isProcessing}
              isSpeaking={isAudioSpeaking}
              voiceMuted={settings.voiceMuted}
              onToggleMute={() => updateSettings({ ...settings, voiceMuted: !settings.voiceMuted })}
              voiceError={voice.voiceError}
              lastError={lastAppError}
              isOnline={isOnline}
              activeGoal={currentGoal}
              activeHazard={activeHazard}
              typedQuery={typedQuery}
              onTypedQueryChange={setTypedQuery}
              onSubmitTypedQuery={handleUserQuery}
              onStartSession={startSentraSession}
              onStopSession={stopSentraSession}
              onTapToTalk={handleTapToTalk}
              onRepeat={handleRepeat}
              onStopSpeaking={stopSpeaking}
              onCancelTask={handleCancelTask}
              onDismissHazard={() => setActiveHazard(null)}
              onRetryMic={voice.restartMicrophone}
              onSwitchToMobileCamera={() => handleCameraSourceChange('browser_camera')}
              onOpenDeviceSetup={() => setActiveView('device')}
              showCameraPreview={showCameraPreview}
              onToggleCameraPreview={() => setShowCameraPreview((v) => !v)}
            />
          )}

          {/* Persistent CameraView (stays mounted & decoding frames cleanly without display:none; visible when preview toggled or inside Device & Analytics) */}
          <div
            ref={cameraContainerRef}
            className={
              shouldShowCameraVisually
                ? 'mx-auto w-full max-w-3xl'
                : 'pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0'
            }
            aria-hidden={!shouldShowCameraVisually}
          >
            <CameraView
              ref={cameraRef}
              cameraSource={settings.cameraSource}
              onChangeCameraSource={handleCameraSourceChange}
              findingGoal={currentGoal?.targetObject || null}
              onStopFinding={handleCancelTask}
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
          </div>

          {/* Secondary View 1: Device & Analytics (Preserved Wearable Telemetry, Vision Details & Spatial Context) */}
          {activeView === 'device' && (
            <div className="space-y-5">
              <DeviceStatusView
                devices={devices}
                activeDevice={activeDevice}
                selectedDeviceId={settings.selectedWearableDeviceId}
                onSelectDeviceId={(id) => updateSettings({ ...settings, selectedWearableDeviceId: id })}
                sseConnected={sseConnected}
                telemetryError={telemetryError}
                analytics={analytics}
                analyticsRange={analyticsRange}
                onChangeAnalyticsRange={setAnalyticsRange}
                includeSimulatedAnalytics={includeSimulatedAnalytics}
                onToggleIncludeSimulated={setIncludeSimulatedAnalytics}
                onRefreshAnalytics={() => refreshAnalytics(null)}
                audioOwnership={audioOwnership}
                onChangeAudioOwnership={handleAudioOwnershipChange}
              />

              <LiveVisionView
                detectedObjects={detectedObjects}
                sceneDescription={sceneDescription}
                pathStatus={effectivePathStatus}
                detectionTimestamp={detectionTimestamp}
                detectionStale={detectionStale}
                hazard={activeHazard}
                onSelectObject={(obj) => {
                  const msg = `${obj.label}, at your ${obj.clockPosition}, ${obj.relativeDistance.replace('_', ' ')}`;
                  speakAndDisplay(msg);
                }}
              />

              <SpatialWorldView
                heading={cameraRef.current?.heading ?? activeDevice?.sensors.imu?.heading ?? null}
                landmarks={landmarks}
                relationships={relationships}
                detectedObjects={detectedObjects}
                currentRoom={currentRoom}
              />
            </div>
          )}

          {/* Secondary View 2: Settings & Diagnostics (Preserved Diagnostics, Memory Management & Optional Live Voice Call) */}
          {activeView === 'settings' && (
            <div className="space-y-5">
              {/* Optional Full-Duplex Gemini Live Call Controls */}
              <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <h2 className="text-sm font-bold text-foreground">
                      Continuous Live Audio Call ({liveVoice.modelUsed})
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Optional full-duplex audio bridge with server-side wearable tools.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Live voice persona"
                      value={liveVoicePersona}
                      onChange={(e) => setLiveVoicePersona(e.target.value as LiveVoiceName)}
                      disabled={liveVoice.status === 'connected' || liveVoice.status === 'connecting'}
                      className="min-h-[44px] rounded-xl border border-border bg-secondary px-3 text-xs font-semibold text-foreground disabled:opacity-50"
                    >
                      {(['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'] as const).map((v) => (
                        <option key={v} value={v}>
                          Voice: {v}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleToggleLiveVoice}
                      className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-xs font-bold transition-colors ${
                        liveVoice.status === 'connected' || liveVoice.status === 'connecting'
                          ? 'border-destructive bg-destructive text-destructive-foreground'
                          : 'border-primary bg-primary text-primary-foreground'
                      }`}
                    >
                      {liveVoice.status === 'connected' || liveVoice.status === 'connecting' ? (
                        <>
                          <PhoneOff className="h-4 w-4" aria-hidden="true" />
                          <span>{liveVoice.status === 'connecting' ? 'Connecting…' : 'End Live Call'}</span>
                        </>
                      ) : (
                        <>
                          <PhoneCall className="h-4 w-4" aria-hidden="true" />
                          <span>Start Live Call</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {liveVoice.error && (
                  <p className="rounded-xl border border-destructive/60 bg-destructive/15 px-3 py-2 text-xs text-foreground">
                    {liveVoice.error}
                  </p>
                )}
              </section>

              <SettingsDiagnosticsView
                settings={settings}
                onUpdateSettings={updateSettings}
                activeDevice={activeDevice}
                cameraDiagnostics={cameraRef.current?.getCameraDiagnostics() || null}
                lastAppError={lastAppError}
                voiceState={voice.assistantState}
                voiceError={voice.voiceError}
                voiceCompatibility={voice.compatibility}
                micTestActive={voice.micTestActive}
                micTestTranscript={voice.micTestTranscript}
                micTestError={voice.micTestError}
                onStartMicTest={voice.startMicTest}
                onStopMicTest={voice.stopMicTest}
                onToggleWakeWord={handleToggleWakeWord}
                onRestartMicrophone={voice.restartMicrophone}
                onDeviceRegistered={(deviceId) => {
                  updateSettings({ ...settings, selectedWearableDeviceId: deviceId });
                  refreshAnalytics(null);
                }}
              />

              <ContextualMemoryView
                memories={memories}
                onAddMemory={handleAddMemory}
                onDeleteMemory={handleDeleteMemory}
                onClearAll={handleClearMemories}
                onSpeakMemory={(item) => speakAndDisplay(`${item.label}: ${item.note}`)}
                onFindMemoryTarget={(label) => {
                  setActiveView('assistant');
                  handleUserQuery(`Find my ${label}`);
                }}
              />
            </div>
          )}
        </main>

        {/* Quiet Centered Footer */}
        <footer className="flex flex-col items-center gap-2 pt-2 text-center text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span>SENTRA · VOICE-FIRST ASSISTIVE COMPANION</span>
            <PWAInstallButton compact />
          </div>
        </footer>
      </div>
    </div>
  );
}
