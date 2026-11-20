/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraView, CameraViewHandle } from './components/CameraView';
import { LiveVisionView } from './components/LiveVisionView';
import { ObjectFinderView } from './components/ObjectFinderView';
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
  SentraSection,
  SentraSettings,
  SentraStats,
  SpatialLandmark,
  SpatialRelationship,
  VerificationStep,
  ReachGuidance,
} from './types/sentra';
import type { CameraSourceType, PathSafetyStatus } from './types/deviceProtocol';
import { parseVoiceIntent } from './utils/parser';
import {
  isSpeaking,
  playChime,
  setAudioConfig,
  speakText,
  stopSpeaking,
  subscribeSpeakingState,
} from './utils/audio';
import { analyzeLocalScene } from './utils/localVision';
import { useDeviceTelemetry } from './hooks/useDeviceTelemetry';
import { useVoiceAssistant, VoiceAssistantState } from './hooks/useVoiceAssistant';
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
  Mic,
  MicOff,
  Eye,
  Crosshair,
  Compass,
  Bookmark,
  Cpu,
  Sliders,
  RotateCcw,
  Volume2,
  VolumeX,
  Send,
  Sparkles,
  Layers,
  Radio,
  AlertTriangle,
  Wifi,
  WifiOff,
  FlaskConical,
  Menu,
  RefreshCw,
  X,
  PhoneCall,
  PhoneOff,
  LogIn,
  LogOut,
  User as UserIcon,
} from 'lucide-react';

const STATS_STORAGE_KEY = 'sentra.stats.v2';
const MEMORY_STORAGE_KEY = 'sentra.memory.v2';
const SETTINGS_STORAGE_KEY = 'sentra.settings.v2';

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

  const [activeSection, setActiveSection] = useState<SentraSection>('assistant');
  const [liveVoicePersona, setLiveVoicePersona] = useState<LiveVoiceName>('Zephyr');

  // Core assistant state
  const isOnline = useOnlineStatus();
  const [isAudioSpeaking, setIsAudioSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showMobileMoreMenu, setShowMobileMoreMenu] = useState(false);
  const [spokenTranscript, setSpokenTranscript] = useState<string>('');
  const [assistantResponse, setAssistantResponse] = useState<string>(
    'Enable "Hey SENTRA" hands-free voice, hold Talk, or type a question. Camera is only needed for visual tasks.'
  );
  const [lastAppError, setLastAppError] = useState<string | null>(null);

  // Perception & World Model State (strictly empty until real observations arrive)
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [detectionTimestamp, setDetectionTimestamp] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [activeHazard, setActiveHazard] = useState<HazardAlert | null>(null);
  const [activePerceptionPrompt, setActivePerceptionPrompt] = useState<string | null>(null);
  const [sceneDescription, setSceneDescription] = useState<string>(
    'No observation analyzed yet. Start a camera stream and capture or ask SENTRA to describe surroundings.'
  );
  const [rawPathStatus, setRawPathStatus] = useState<PathSafetyStatus>('unknown');

  // Goal Task Management
  const [currentGoal, setCurrentGoal] = useState<GoalTask | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [reachGuidance, setReachGuidance] = useState<ReachGuidance | null>(null);

  // Spatial World Model (only populated from real detections)
  const [landmarks, setLandmarks] = useState<SpatialLandmark[]>([]);
  const [relationships, setRelationships] = useState<SpatialRelationship[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('Current Area');

  // Offline/degraded vision indicator
  const [isLocalAssistActive, setIsLocalAssistActive] = useState(false);

  // Inline inputs (never window.prompt)
  const [typedQuery, setTypedQuery] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [showQuickFindInput, setShowQuickFindInput] = useState(false);
  const [quickFindValue, setQuickFindValue] = useState('');

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
      .catch((err) => {
        if (!active) return;
        setLastAppError(`Memory sync fallback: ${err?.message || 'Unable to reach /api/memories'}`);
      });
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

  const [audioOwnership, setAudioOwnership] = useState<'browser' | 'wearable' | 'test'>('wearable');
  const audioOwnershipRef = useRef(audioOwnership);
  audioOwnershipRef.current = audioOwnership;

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
    if (!settingsRef.current.selectedWearableDeviceId ||
        update.deviceId === settingsRef.current.selectedWearableDeviceId) {
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

  // Hardware-level alerts can NEVER be overridden to safe by vision status
  const effectivePathStatus: PathSafetyStatus = useMemo(() => {
    if (activeHazard?.severity === 'critical' && activeHazard.source === 'sensor_hardware') {
      return 'confirmed_sensor_alert';
    }
    if (!isCameraReady && rawPathStatus === 'observation_available') {
      return 'observation_unavailable';
    }
    return rawPathStatus;
  }, [activeHazard, isCameraReady, rawPathStatus]);

  // Memory CRUD wired to SQLite backend + Cloud Firestore when authenticated
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
          firebase
            .saveMemory({
              id: created.id,
              label: created.label,
              note: created.note,
              room: created.room,
              source: created.source,
            })
            .catch(() => {});
        }
      } catch (err: any) {
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
          firebase
            .saveMemory({
              id: localFallback.id,
              label: localFallback.label,
              note: localFallback.note,
              room: localFallback.room,
              source: localFallback.source,
            })
            .catch(() => {});
        } else {
          setLastAppError(`Memory saved locally (server sync failed): ${err?.message || 'unknown'}`);
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
      } catch (err: any) {
        setLastAppError(`Memory delete sync error: ${err?.message || 'unknown'}`);
      }
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
    } catch (err: any) {
      setLastAppError(`Memory clear sync error: ${err?.message || 'unknown'}`);
    }
    if (firebase.user) {
      Promise.all(existingIds.map((id) => firebase.removeMemory(id))).catch(() => {});
    }
  }, [saveMemoriesLocally, firebase]);

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
      const startTime = performance.now();

      const curSettings = settingsRef.current;
      const curGoal = currentGoalRef.current;
      const curMemories = memoriesRef.current;
      const curDevice = activeDeviceRef.current;

      if (curSettings.audioFeedback) {
        playChime('capture');
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

      const inferredOp: SentraOperation =
        operationOverride ??
        (query
          ? parseVoiceIntent(query).operation
          : mode === 'find' || mode === 'navigate'
          ? 'object_query'
          : 'scene_analysis');

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
          },
          abortController.signal
        );

        isProcessingRef.current = false;
        setIsProcessing(false);

        const latency = performance.now() - startTime;
        updateStats((s) => ({
          ...s,
          calls: s.calls + 1,
          totalMs: s.totalMs + latency,
        }));

        if (data.status !== 'ok' || data.errorCode) {
          setIsLocalAssistActive(Boolean(data.errorCode && data.errorCode !== 'NO_FRESH_IMAGE'));
          if (data.errorMessage) {
            setLastAppError(`${data.errorCode || 'ANALYSIS_ERROR'}: ${data.errorMessage}`);
          }

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

          if (data.pathStatus) {
            setRawPathStatus(data.pathStatus);
          }

          setAssistantResponse(spoken);
          speakText(spoken, curSettings.speechRate);
          return false;
        }

        // Successful Gemini analysis
        setIsLocalAssistActive(false);
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

        if (data.sceneDescription) {
          setSceneDescription(data.sceneDescription);
        }
        if (data.pathStatus) {
          setRawPathStatus(data.pathStatus);
        }
        setActivePerceptionPrompt(data.activePerceptionRequest || null);

        // Update Spatial Landmarks from verified visible detections when heading is known
        if (heading != null && data.detectedObjects && data.detectedObjects.length > 0) {
          const landmarkObjects = data.detectedObjects.filter(
            (o) => isLandmarkable(o.label) || o.isTargetGoal
          );
          if (landmarkObjects.length > 0) {
            setLandmarks((prev) => {
              const updated = [...prev];
              for (const obj of landmarkObjects) {
                const distText =
                  obj.relativeDistance === 'arm_reach'
                    ? 'Arm reach'
                    : obj.relativeDistance === 'near'
                    ? '1 step ahead'
                    : obj.relativeDistance === 'mid'
                    ? '3 steps ahead'
                    : '4 steps ahead';
                const existingIdx = updated.findIndex(
                  (l) => l.name.toLowerCase() === obj.label.toLowerCase()
                );
                const lmItem: SpatialLandmark = {
                  id: existingIdx >= 0 ? updated[existingIdx].id : `lm-${Date.now()}-${obj.id}`,
                  name: obj.label,
                  heading,
                  distanceEst: distText,
                  room: currentRoom,
                  lastSeenAt: frameTs,
                  verified: true,
                };
                if (existingIdx >= 0) {
                  updated[existingIdx] = lmItem;
                } else {
                  updated.push(lmItem);
                }
              }
              return updated.slice(-24);
            });
          }
        }

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
          spoken = `Caution: ${data.hazard.description} at ${data.hazard.clockPosition}.`;
          if (curSettings.audioFeedback) playChime('hazard');
          updateStats((s) => ({ ...s, hazards: s.hazards + 1 }));
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

            updateStats((s) => ({ ...s, findsDone: s.findsDone + 1 }));
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

        if (query) {
          historyRef.current.push({ role: 'user', text: query });
        }
        historyRef.current.push({ role: 'assistant', text: spoken });
        if (historyRef.current.length > 20) {
          historyRef.current = historyRef.current.slice(-20);
        }

        setAssistantResponse(spoken);
        if (audioOwnershipRef.current !== 'wearable' || !activeDeviceRef.current?.connected) {
          speakText(spoken, curSettings.speechRate);
        }
        return true;
      } catch (err: any) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        if (err?.name === 'AbortError') {
          return false;
        }
        setIsLocalAssistActive(true);
        setLastAppError(`Analysis request error: ${err?.message || 'Network failure'}`);

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
    [activeHazard, currentRoom, saveMemoriesLocally, updateStats]
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
        updateStats((s) => ({ ...s, findsStarted: s.findsStarted + 1 }));
        await executeAnalysis(intent.mode, trimmed, intent.goal, intent.operation);
        return;
      }

      await executeAnalysis(intent.mode, trimmed, currentGoalRef.current?.targetObject, intent.operation);
    },
    [executeAnalysis, updateStats]
  );

  // Active Object-Find Verification Loop (only triggers when goal & autoContinuousFind & live camera are active)
  const activeGoalId = currentGoal?.id ?? null;
  const activeGoalState = currentGoal?.state ?? null;

  useEffect(() => {
    if (!activeGoalId || activeGoalState !== 'active') return;
    if (!settings.autoContinuousFind) return;

    let cancelled = false;
    let lastHeading: number | null = null;
    let stationaryCount = 0;

    const timer = setInterval(async () => {
      if (cancelled) return;
      const goal = currentGoalRef.current;
      if (!goal || goal.state !== 'active') return;
      if (isProcessingRef.current || isSpeaking()) return;
      if (!isCameraReadyRef.current) return;

      const curHeading = cameraRef.current?.heading ?? activeDeviceRef.current?.sensors.imu?.heading ?? null;
      if (curHeading != null && lastHeading != null) {
        const delta = Math.abs((curHeading - lastHeading + 360) % 360);
        const angularDiff = delta > 180 ? 360 - delta : delta;
        if (angularDiff < 10) {
          stationaryCount++;
          if (stationaryCount >= 2 && goal.targetObject) {
            const guidance = `Still looking for ${goal.targetObject}. Slowly pan the camera left or right.`;
            setAssistantResponse(guidance);
            speakText(guidance, settingsRef.current.speechRate);
            stationaryCount = 0;
            return;
          }
        } else {
          stationaryCount = 0;
        }
      }
      lastHeading = curHeading;

      await executeAnalysis('find', '', goal.targetObject ?? null, 'object_query');
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeGoalId, activeGoalState, settings.autoContinuousFind, executeAnalysis]);

  // Continuous Scene Watch Mode (non-overlapping, rate-limited)
  useEffect(() => {
    if (!settings.continuousWatchMode) return;

    const timer = setInterval(async () => {
      if (!settingsRef.current.continuousWatchMode) return;
      if (!isCameraReadyRef.current) return;
      if (isProcessingRef.current || isSpeaking()) return;
      if (currentGoalRef.current?.state === 'active') return;

      await executeAnalysis('describe', 'Periodic continuous watch observation', null, 'scene_analysis');
    }, 7000);

    return () => clearInterval(timer);
  }, [settings.continuousWatchMode, executeAnalysis]);

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
    isProcessing,
    isSpeaking: isAudioSpeaking,
    onCommand: handleUserQuery,
    onInterrupt: handleVoiceInterrupt,
    onUnsupportedFallback: () => setShowTextInput(true),
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
      if (firebase.user) {
        firebase.saveMemory(item).catch(() => {});
      }
    },
    onHardwareEvent: (evt) => {
      if (evt.event === 'PROXIMITY_CRITICAL' && evt.distanceCm != null) {
        setActiveHazard({
          id: `live-hw-${Date.now()}`,
          type: 'obstacle',
          severity: 'critical',
          description: `Forward VL53L0X measures obstacle within ${Math.round(evt.distanceCm)} cm.`,
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

  // Spacebar push-to-talk shortcut (skips form inputs cleanly)
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
        voice.startPushToTalk();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditable(document.activeElement)) {
        e.preventDefault();
        voice.stopPushToTalk();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [voice]);

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

  const assistantNavItems: Array<{
    id: SentraSection;
    label: string;
    mobileLabel: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'assistant', label: 'Assistant', mobileLabel: 'Assistant', Icon: Mic },
    { id: 'vision', label: `Live Vision (${detectedObjects.length})`, mobileLabel: 'Vision', Icon: Eye },
    { id: 'finder', label: 'Object Finder', mobileLabel: 'Finder', Icon: Crosshair },
    { id: 'spatial', label: 'Spatial Awareness', mobileLabel: 'Spatial', Icon: Compass },
    { id: 'memory', label: `Contextual Memory (${memories.length})`, mobileLabel: 'Memory', Icon: Bookmark },
  ];

  const companionNavItems: Array<{
    id: SentraSection;
    label: string;
    mobileLabel: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'device', label: 'Device & Analytics', mobileLabel: 'Device', Icon: Cpu },
    { id: 'settings', label: 'Settings & Diagnostics', mobileLabel: 'Settings', Icon: Sliders },
  ];

  const handleCameraSourceChange = (nextSource: CameraSourceType) => {
    updateSettings({ ...settings, cameraSource: nextSource });
    setDetectedObjects([]);
    setDetectionTimestamp(null);
  };

  const showCameraOnMobile =
    activeSection === 'assistant' || activeSection === 'vision' || activeSection === 'finder';

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 sm:gap-4 px-3.5 sm:px-5 safe-top pb-24 md:pb-6 text-foreground selection:bg-primary/20">
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

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-bold font-mono">
          {/* Wearable Connection Status */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${wearableBadge.classes}`}
          >
            <WearableIcon className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">{wearableBadge.label}</span>
            <span className="xs:hidden">{wearableBadge.label === 'No Hardware' ? 'No HW' : wearableBadge.label}</span>
          </span>

          {/* Clear AI Visual Analysis Status Badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
              !isOnline
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                : isLocalAssistActive
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-secondary text-foreground border-border'
            }`}
          >
            {!isOnline ? (
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
            ) : isLocalAssistActive ? (
              <Cpu className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            )}
            <span>
              {!isOnline
                ? 'Offline'
                : isLocalAssistActive
                ? 'Local Analysis'
                : 'AI Visual Analysis'}
            </span>
          </span>

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

      {/* Desktop Navigation Clearly Separating AI Assistant vs Wearable Companion */}
      <nav
        aria-label="Primary Sections"
        className="hidden md:flex flex-wrap items-center justify-between gap-2 text-xs font-bold"
      >
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground pr-1 shrink-0">
            Assistant
          </span>
          {assistantNavItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg shrink-0 transition-colors border ${
                activeSection === id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-muted-foreground border-border/60 hover:text-foreground hover:bg-card'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 py-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground pr-1 shrink-0">
            Wearable
          </span>
          {companionNavItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg shrink-0 transition-colors border ${
                activeSection === id
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-secondary text-muted-foreground border-border/60 hover:text-foreground hover:bg-card'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Two-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start flex-1">
        {/* Left Column: Persistent CameraView (stays mounted on mobile across tab switches so stream never drops) */}
        <div className={`lg:col-span-5 space-y-3 ${showCameraOnMobile ? 'block' : 'hidden lg:block'}`}>
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

          {/* Compact Telemetry Summary Strip below Camera */}
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

        {/* Right Column: Active Section Content */}
        <div className="lg:col-span-7 space-y-3">
          {activeSection === 'assistant' && (
            <div className="space-y-3">
              {/* Clear Voice Assistant State & Hands-Free Status Bar */}
              <div className="rounded-xl bg-card border border-border p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${currentVoiceMeta.classes}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          currentVoiceMeta.pulse
                            ? 'bg-current animate-ping'
                            : voice.assistantState === 'error' ||
                              voice.assistantState === 'permission_blocked'
                            ? 'bg-destructive'
                            : 'bg-current opacity-60'
                        }`}
                      />
                      <span>{currentVoiceMeta.label}</span>
                    </span>

                    {voice.wakeActivatedNotice && (
                      <span className="text-xs font-bold text-primary animate-pulse">
                        "Hey SENTRA" detected
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isAudioSpeaking && (
                      <button
                        type="button"
                        onClick={stopSpeaking}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground"
                      >
                        <VolumeX className="h-3.5 w-3.5" />
                        <span>Stop Speaking</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleToggleWakeWord(!settings.wakeWordEnabled)}
                      disabled={!voice.compatibility.speechRecognitionSupported}
                      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
                        settings.wakeWordEnabled
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-secondary text-foreground border-border hover:border-primary'
                      }`}
                    >
                      {settings.wakeWordEnabled ? (
                        <Mic className="h-3.5 w-3.5" />
                      ) : (
                        <MicOff className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {settings.wakeWordEnabled ? 'Hey SENTRA: ON' : 'Enable "Hey SENTRA"'}
                      </span>
                    </button>
                  </div>
                </div>

                {voice.liveTranscript && (
                  <p className="text-xs font-mono text-primary bg-primary/10 border border-primary/30 rounded-lg px-2.5 py-1.5">
                    Hearing: "{voice.liveTranscript}"
                  </p>
                )}

                {voice.voiceError && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/15 border border-destructive/40 px-3 py-2 text-xs text-destructive">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="break-words">{voice.voiceError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={voice.restartMicrophone}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground shrink-0"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Restart Mic</span>
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  {settings.wakeWordEnabled
                    ? 'Say "Hey SENTRA" followed by your question while this tab is open. Say "Stop" or "Be quiet" to interrupt.'
                    : 'Camera preview stays on your device. Gemini AI analyzes a snapshot only when you ask a visual question or enable Watch.'}
                </p>
              </div>

              {/* Real-Time Two-Way Gemini 3.8 Live Conversation Bar */}
              <div className="rounded-xl bg-card border border-primary/40 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-primary">
                      <PhoneCall className="h-4 w-4" />
                      <span>Real-Time Voice Conversation ({liveVoice.modelUsed})</span>
                      {liveVoice.status === 'connected' && (
                        <span className="inline-flex items-center gap-1 rounded bg-success/15 border border-success/40 px-1.5 py-0.5 text-[10px] font-mono text-success">
                          {liveVoice.isModelSpeaking ? 'SPEAKING' : 'LIVE MIC'}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Full-duplex 16kHz/24kHz audio + live {settings.cameraSource === 'esp32_camera' ? 'OV2640 & VL53L0X hardware stream' : 'camera & sensor context'}.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Live voice persona"
                      value={liveVoicePersona}
                      onChange={(e) => setLiveVoicePersona(e.target.value as LiveVoiceName)}
                      disabled={liveVoice.status === 'connected' || liveVoice.status === 'connecting'}
                      className="rounded-lg bg-secondary border border-border px-2 py-1.5 text-xs font-mono text-foreground disabled:opacity-50"
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
                      className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold border transition-colors ${
                        liveVoice.status === 'connected' || liveVoice.status === 'connecting'
                          ? 'bg-destructive text-destructive-foreground border-destructive'
                          : 'bg-primary text-primary-foreground border-primary hover:brightness-110'
                      }`}
                    >
                      {liveVoice.status === 'connected' || liveVoice.status === 'connecting' ? (
                        <>
                          <PhoneOff className="h-3.5 w-3.5" />
                          <span>{liveVoice.status === 'connecting' ? 'Connecting…' : 'End Live Call'}</span>
                        </>
                      ) : (
                        <>
                          <PhoneCall className="h-3.5 w-3.5" />
                          <span>Start Live Voice</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {liveVoice.error && (
                  <p className="rounded-lg bg-destructive/15 border border-destructive/40 px-2.5 py-1.5 text-xs font-mono text-destructive">
                    {liveVoice.error}
                  </p>
                )}

                {liveVoice.status === 'connected' && (
                  <div className="rounded-lg bg-secondary/70 border border-border p-2.5 space-y-1 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-muted-foreground">
                      <span>
                        Hardware Link:{' '}
                        <strong className={liveVoice.hardwareLinked ? 'text-success' : 'text-foreground'}>
                          {liveVoice.hardwareLinked ? `${settings.selectedWearableDeviceId} Connected` : 'Standby'}
                        </strong>
                      </span>
                      <span>
                        Firestore Log: {firebase.user ? 'Auto-syncing turns' : 'Sign in to save history'}
                      </span>
                    </div>
                    {liveVoice.userTranscript && (
                      <p className="text-foreground">
                        <span className="font-bold text-primary">You:</span> {liveVoice.userTranscript}
                      </p>
                    )}
                    {liveVoice.assistantTranscript && (
                      <p className="text-foreground">
                        <span className="font-bold text-accent">SENTRA:</span> {liveVoice.assistantTranscript}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Spoken Response & Transcript Card */}
              <section
                aria-live="polite"
                className="relative flex min-h-[6.5rem] flex-col justify-center rounded-xl bg-card border border-border p-4"
              >
                {spokenTranscript && (
                  <p className="mb-1 text-sm font-semibold text-muted-foreground pr-20">
                    You: <span className="text-foreground">"{spokenTranscript}"</span>
                  </p>
                )}

                <p className="text-base sm:text-xl font-bold leading-relaxed text-foreground select-text pr-20">
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
                  <div className="absolute right-3 top-3 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => speakText(assistantResponse, settings.speechRate)}
                      className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
                      aria-label="Replay spoken response"
                      title="Speak again"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={stopSpeaking}
                      className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
                      aria-label="Silence speech output"
                      title="Stop speaking"
                    >
                      <VolumeX className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </section>

              {/* Reach Guidance Card (when target is in arm's reach) */}
              {reachGuidance && reachGuidance.active && (
                <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/70 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/50">
                      <Crosshair className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
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

              {/* Primary Voice Controls: Large Hold-to-Talk + Tap-to-Ask Command Window */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onPointerDown={voice.startPushToTalk}
                  onPointerUp={voice.stopPushToTalk}
                  onPointerCancel={voice.stopPushToTalk}
                  onPointerLeave={() => voice.listenMode === 'ptt' && voice.stopPushToTalk()}
                  disabled={isProcessing}
                  className={`sm:col-span-2 flex h-20 sm:h-24 w-full select-none items-center justify-center gap-3 rounded-2xl bg-primary text-xl sm:text-2xl font-extrabold text-primary-foreground shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60 ${
                    voice.listenMode === 'ptt' ? 'sentra-listening ring-4 ring-primary/40' : 'hover:brightness-105'
                  }`}
                  aria-label="Hold to talk to SENTRA (or hold Spacebar)"
                >
                  <Mic className={`h-7 w-7 ${voice.listenMode === 'ptt' ? 'animate-bounce' : ''}`} />
                  <span>
                    {voice.listenMode === 'ptt'
                      ? 'Release to Send…'
                      : isProcessing
                      ? 'Analyzing…'
                      : 'Hold to Talk'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={voice.activateCommandWindow}
                  disabled={isProcessing}
                  className={`flex min-h-[60px] sm:h-24 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm sm:text-base font-bold transition-colors disabled:opacity-60 ${
                    voice.listenMode === 'command'
                      ? 'bg-accent text-accent-foreground border-accent ring-2 ring-accent/40'
                      : 'bg-secondary text-foreground border-border hover:border-primary'
                  }`}
                >
                  <Mic className="h-5 w-5 shrink-0" />
                  <span>{voice.listenMode === 'command' ? 'Speak Query…' : 'Tap to Ask'}</span>
                </button>
              </div>

              {/* Continuous Watch Mode Toggle */}
              <div className="flex items-center justify-between gap-3 rounded-xl bg-card border border-border p-3.5">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                      settings.continuousWatchMode
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'bg-secondary text-muted-foreground border-border'
                    }`}
                  >
                    <Radio className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-foreground">
                      Continuous Watch Mode
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Periodic AI Visual Analysis snapshots every 7s while camera streams
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const next = !settings.continuousWatchMode;
                    updateSettings({ ...settings, continuousWatchMode: next });
                    speakText(
                      next ? 'Continuous watch mode activated.' : 'Continuous watch mode paused.',
                      settings.speechRate
                    );
                  }}
                  className={`min-h-[42px] rounded-lg px-3.5 py-2 font-bold text-xs border transition-colors shrink-0 ${
                    settings.continuousWatchMode
                      ? 'bg-destructive/15 text-destructive border-destructive/40 hover:bg-destructive/25'
                      : 'bg-primary text-primary-foreground border-primary hover:brightness-110'
                  }`}
                >
                  {settings.continuousWatchMode ? 'Pause Watch' : 'Enable Watch'}
                </button>
              </div>

              {/* Quick Voice Mode Actions */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => executeAnalysis('describe', '', null, 'scene_analysis')}
                  disabled={isProcessing}
                  className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-secondary p-3.5 text-sm sm:text-base font-bold border border-border hover:bg-card transition-colors disabled:opacity-60"
                >
                  <Eye className="h-5 w-5 text-primary shrink-0" />
                  <span>Describe Scene</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickFindInput((v) => !v)}
                  disabled={isProcessing}
                  className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-secondary p-3.5 text-sm sm:text-base font-bold border border-border hover:bg-card transition-colors disabled:opacity-60"
                >
                  <Crosshair className="h-5 w-5 text-accent shrink-0" />
                  <span>Find Object</span>
                </button>
                <button
                  type="button"
                  onClick={() => executeAnalysis('read', 'Read any visible text', null, 'scene_analysis')}
                  disabled={isProcessing}
                  className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-secondary p-3.5 text-sm sm:text-base font-bold border border-border hover:bg-card transition-colors disabled:opacity-60"
                >
                  <Layers className="h-5 w-5 text-emerald-400 shrink-0" />
                  <span>Read Text</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    executeAnalysis(
                      'remember',
                      'Remember the main objects and landmarks visible here',
                      null,
                      'scene_analysis'
                    )
                  }
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-2 rounded-xl bg-secondary p-3.5 text-base font-bold border border-border hover:bg-card transition-colors disabled:opacity-60"
                >
                  <Bookmark className="h-5 w-5 text-primary" />
                  <span>Remember Spot</span>
                </button>
              </div>

              {/* Inline Quick Find Input (replaces window.prompt) */}
              {showQuickFindInput && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (quickFindValue.trim()) {
                      handleUserQuery(`Find ${quickFindValue.trim()}`);
                      setQuickFindValue('');
                      setShowQuickFindInput(false);
                    }
                  }}
                  className="flex gap-2 rounded-xl bg-card border border-primary/50 p-2.5"
                >
                  <input
                    type="text"
                    value={quickFindValue}
                    onChange={(e) => setQuickFindValue(e.target.value)}
                    placeholder="Object to find (e.g., water bottle, keys)..."
                    className="flex-1 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground border border-border focus:border-primary focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
                  >
                    Locate
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickFindInput(false)}
                    aria-label="Close find input"
                    className="rounded-lg bg-secondary p-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              )}

              {/* Active Hazard Banner */}
              {activeHazard && (
                <div className="rounded-xl bg-destructive/15 border border-destructive/60 p-3 flex items-center justify-between gap-2 text-sm font-bold text-destructive">
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

              {/* Keyboard / Typed Fallback Input */}
              <div className="pt-1">
                {!showTextInput ? (
                  <button
                    type="button"
                    onClick={() => setShowTextInput(true)}
                    className="w-full py-1.5 text-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Prefer typing? Open text query bar
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
                      placeholder="Ask SENTRA (e.g., 'Describe surroundings' or 'Where are my keys?')..."
                      className="flex-1 rounded-lg bg-card px-4 py-2.5 text-sm border border-border focus:border-primary focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isProcessing || !typedQuery.trim()}
                      className="rounded-lg bg-primary px-4 text-primary-foreground hover:brightness-110 disabled:opacity-50"
                      aria-label="Send query"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {activeSection === 'vision' && (
            <LiveVisionView
              detectedObjects={detectedObjects}
              sceneDescription={sceneDescription}
              pathStatus={effectivePathStatus}
              detectionTimestamp={detectionTimestamp}
              detectionStale={detectionStale}
              hazard={activeHazard}
              onSelectObject={(obj) => {
                const msg = `${obj.label}, at your ${obj.clockPosition}, ${obj.relativeDistance.replace('_', ' ')}`;
                speakText(msg, settings.speechRate);
                setAssistantResponse(msg);
              }}
            />
          )}

          {activeSection === 'finder' && (
            <ObjectFinderView
              currentGoal={currentGoal}
              onStartSearch={(target) => {
                handleUserQuery(`Find ${target}`);
              }}
              onCancelSearch={() => setCurrentGoal(null)}
              activePerceptionPrompt={activePerceptionPrompt}
              detectedObjects={detectedObjects}
              isSearching={isProcessing}
            />
          )}

          {activeSection === 'spatial' && (
            <SpatialWorldView
              heading={cameraRef.current?.heading ?? activeDevice?.sensors.imu?.heading ?? null}
              landmarks={landmarks}
              relationships={relationships}
              detectedObjects={detectedObjects}
              currentRoom={currentRoom}
            />
          )}

          {activeSection === 'memory' && (
            <ContextualMemoryView
              memories={memories}
              onAddMemory={handleAddMemory}
              onDeleteMemory={handleDeleteMemory}
              onClearAll={handleClearMemories}
              onSpeakMemory={(item) =>
                speakText(`${item.label}: ${item.note}`, settings.speechRate)
              }
              onFindMemoryTarget={(label) => {
                handleUserQuery(`Find ${label}`);
                setActiveSection('finder');
              }}
            />
          )}

          {activeSection === 'device' && (
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
          )}

          {activeSection === 'settings' && (
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
          )}
        </div>
      </div>

      {/* Footer Session Counters */}
      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-muted-foreground border-t border-border pt-3">
        <div>
          Queries: {stats.calls} · Avg:{' '}
          {stats.calls ? Math.round(stats.totalMs / stats.calls) : 0}ms · Alerts: {stats.hazards}
        </div>
        <div>SENTRA Phase-2 Prototype · Voice-First Accessibility Assistant</div>
      </footer>

      {/* Mobile More Drawer (Spatial Awareness, Contextual Memory, Settings & Diagnostics) */}
      {showMobileMoreMenu && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 flex items-end"
          onClick={() => setShowMobileMoreMenu(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-card border-t border-border p-4 pb-24 space-y-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-1 border-b border-border/60">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                More SENTRA Sections
              </span>
              <button
                type="button"
                onClick={() => setShowMobileMoreMenu(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {(
              [
                { id: 'spatial', label: 'Spatial Awareness (Landmarks & Map)', Icon: Compass, group: 'AI Assistant' },
                { id: 'memory', label: `Contextual Memory (${memories.length})`, Icon: Bookmark, group: 'AI Assistant' },
                { id: 'settings', label: 'Settings & Diagnostics', Icon: Sliders, group: 'Wearable & App' },
              ] as const
            ).map(({ id, label, Icon, group }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveSection(id);
                  setShowMobileMoreMenu(false);
                }}
                className={`w-full min-h-[48px] flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-bold border ${
                  activeSection === id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-foreground border-border'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </span>
                <span className="text-[11px] font-mono opacity-75">{group}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile-First Fixed Bottom Navigation Dock (large 44px+ touch targets) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom-nav bg-card/95 backdrop-blur-md border-t border-border px-2 pt-1.5"
      >
        <div className="grid grid-cols-5 gap-1 max-w-lg mx-auto">
          {(
            [
              { id: 'assistant', label: 'Assistant', Icon: Mic },
              { id: 'vision', label: 'Vision', Icon: Eye },
              { id: 'finder', label: 'Finder', Icon: Crosshair },
              { id: 'device', label: 'Wearable', Icon: Cpu },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = activeSection === id && !showMobileMoreMenu;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveSection(id);
                  setShowMobileMoreMenu(false);
                }}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-bold transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowMobileMoreMenu((v) => !v)}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-bold transition-colors ${
              showMobileMoreMenu ||
              activeSection === 'spatial' ||
              activeSection === 'memory' ||
              activeSection === 'settings'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Menu className="h-4 w-4" />
            <span>More</span>
          </button>
        </div>
      </nav>
    </main>
  );
}
