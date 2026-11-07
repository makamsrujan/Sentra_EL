/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  SentraSection,
  SentraSettings,
  SentraStats,
  SpatialLandmark,
  SpatialRelationship,
  VerificationStep,
  WearableTelemetry,
  TrackedObject,
  SlamState,
  NavigationRoute,
  NavigationNode,
  LocalVisionAnalysis,
  WakeWordState,
  PerceptionMode,
} from './types/sentra';
import { parseVoiceIntent } from './utils/parser';
import {
  isSpeaking,
  playChime,
  registerSpeechListener,
  speakText,
  stopSpeaking,
} from './utils/audio';
import { analyzeLocalScene } from './utils/localVision';
import { memoryService } from './services/indexedDbMemoryService';
import { wakeWordService } from './services/wakeWordService';
import { temporalTracker } from './services/temporalTrackerService';
import { visualSlamService } from './services/visualSlamService';
import { indoorNavigation } from './services/indoorNavigationService';
import { offlineVision } from './services/offlineVisionService';
import { streamingConversation } from './services/streamingConversationService';
import { authService, AuthState } from './services/authService';
import { AuthModal } from './components/AuthModal';
import {
  Mic,
  Eye,
  Crosshair,
  Compass,
  Bookmark,
  Cpu,
  Sliders,
  RotateCcw,
  VolumeX,
  Send,
  Sparkles,
  Layers,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Zap,
  User,
  Database,
} from 'lucide-react';

const STATS_STORAGE_KEY = 'sentra.stats.v1';
const MEMORY_STORAGE_KEY = 'sentra.memory.v1';
const SETTINGS_STORAGE_KEY = 'sentra.settings.v1';

const DEFAULT_STATS: SentraStats = {
  calls: 0,
  totalMs: 0,
  hazards: 0,
  findsStarted: 0,
  findsDone: 0,
  findMs: 0,
  retakes: 0,
  trackingUpdates: 0,
  offlineScans: 0,
};

const DEFAULT_SETTINGS: SentraSettings = {
  speechRate: 1.05,
  audioFeedback: true,
  hapticFeedback: true,
  cameraFacing: 'environment',
  autoContinuousFind: true,
  wakeWordEnabled: true, // "Hey SENTRA" enabled by default
  selectedInputSource: 'browser_camera',
  streamingVoiceEnabled: true,
  wakeWordSensitivity: 0.7,
  preferredPerceptionMode: 'hybrid',
};

const DEFAULT_TELEMETRY: WearableTelemetry = {
  deviceId: 'ESP32-S3-SENTRA-001',
  connected: false,
  isSimulated: true,
  lastHeartbeat: Date.now(),
  batteryLevel: 88,
  batteryCharging: false,
  forwardToFDistanceCm: 140,
  downwardCliffSensorMm: 80,
  imu: {
    ax: 0.02,
    ay: 0.05,
    az: 9.81,
    gx: 0,
    gy: 0,
    gz: 0,
    heading: 90,
  },
  headPitchAngle: 0,
  earphoneConnected: true,
  audioVolume: 85,
};

export default function App() {
  const cameraRef = useRef<CameraViewHandle | null>(null);

  // Active navigation area
  const [activeSection, setActiveSection] = useState<SentraSection>('assistant');

  // Core assistant state
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [spokenTranscript, setSpokenTranscript] = useState<string>('');
  const [assistantResponse, setAssistantResponse] = useState<string>(
    'Tap Start camera, then hold the button or say "Hey SENTRA" to speak.'
  );

  // Perception & World Model State
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [activeHazard, setActiveHazard] = useState<HazardAlert | null>(null);
  const [activePerceptionPrompt, setActivePerceptionPrompt] = useState<string | null>(null);
  const [sceneDescription, setSceneDescription] = useState<string>(
    'Aim camera forward to observe surroundings.'
  );
  const [pathIsClear, setPathIsClear] = useState<boolean>(true);

  // Goal Task Management State
  const [currentGoal, setCurrentGoal] = useState<GoalTask | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);

  // Feature 5: Real Visual-Inertial SLAM State
  const [slamState, setSlamState] = useState<SlamState>(() => visualSlamService.getState());

  // Feature 6: Topological Route & Navigation State
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);

  // Feature 7: Offline Local Vision Analysis State
  const [localAnalysis, setLocalAnalysis] = useState<LocalVisionAnalysis | null>(null);

  // Feature 1: Wake-Word Detection State
  const [wakeWordState, setWakeWordState] = useState<WakeWordState>('idle');

  // Spatial World Model Landmarks & Relationships
  const [landmarks, setLandmarks] = useState<SpatialLandmark[]>([
    {
      id: 'lm-1',
      name: 'Front Door',
      heading: 90,
      distanceEst: '3 steps ahead',
      room: 'Entrance',
      lastSeenAt: Date.now() - 600000,
      verified: true,
    },
    {
      id: 'lm-2',
      name: 'Study Desk',
      heading: 270,
      distanceEst: 'Arm reach',
      room: 'Study Room',
      lastSeenAt: Date.now() - 1200000,
      verified: true,
    },
  ]);
  const [relationships, setRelationships] = useState<SpatialRelationship[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('Main Room');

  // Wearable Telemetry & Device Gateway State
  const [telemetry, setTelemetry] = useState<WearableTelemetry>(DEFAULT_TELEMETRY);
  const [useWearableFeed, setUseWearableFeed] = useState(false);

  // Fallback Local Mode
  const [isLocalAssistActive, setIsLocalAssistActive] = useState(false);

  // Text fallback input
  const [typedQuery, setTypedQuery] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);

  // Authentication & Database Sync State
  const [authState, setAuthState] = useState<AuthState>(() => authService.getState());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    const unsub = authService.subscribe((state) => {
      setAuthState(state);
      if (state.isAuthenticated) {
        // Load settings and memories from database
        authService.loadUserSettings().then((dbSettings) => {
          if (dbSettings) {
            setSettings((prev) => ({ ...prev, ...dbSettings }));
          }
        });
        authService.fetchMemoriesFromDatabase().then((dbMems) => {
          if (dbMems && dbMems.length > 0) {
            setMemories(dbMems.map((m) => ({
              id: m.id,
              label: m.title,
              note: m.details,
              at: new Date(m.createdAt).toLocaleDateString(),
              timestamp: m.createdAt,
              heading: m.metadata?.heading ?? 0,
              room: m.metadata?.room ?? 'Unknown',
              source: m.metadata?.source ?? 'remembered_historical',
            })));
          }
        });
      }
    });
    return unsub;
  }, []);

  // Feature 4: Contextual Memory with IndexedDB persistence
  const [memories, setMemories] = useState<SentraMemoryItem[]>(() => {
    try {
      const stored = localStorage.getItem(MEMORY_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
      return [
        {
          id: 'mem-default-1',
          label: 'Front Door Key Rack',
          note: 'Located beside the entrance at 3 o’clock, at chest height.',
          at: 'Earlier today',
          timestamp: Date.now() - 3600000,
          heading: 90,
          room: 'Entrance',
          source: 'live_verified',
        },
      ];
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

  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const recognitionRef = useRef<any>(null);

  // Load IndexedDB memories on initial mount
  useEffect(() => {
    let isMounted = true;
    memoryService
      .getAllObjectMemories()
      .then((stored) => {
        if (isMounted && stored && stored.length > 0) {
          setMemories(stored);
        }
      })
      .catch((err) => {
        console.warn('Could not read from IndexedDB, using local state:', err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Helpers for persistence
  const updateMemories = (newMemories: SentraMemoryItem[]) => {
    setMemories(newMemories);
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(newMemories));
    } catch {}
    const latest = newMemories[newMemories.length - 1];
    if (latest) {
      memoryService.saveObjectMemory(latest).catch(() => {});
    }
    // Also sync to backend SQLite database if user is logged in
    if (authService.getState().isAuthenticated) {
      authService.syncMemoriesToDatabase(newMemories.map((m) => ({
        id: m.id,
        type: 'object',
        title: m.label,
        details: m.note,
        tags: [m.room, m.source],
        metadata: {
          heading: m.heading,
          room: m.room,
          source: m.source,
        },
        createdAt: m.timestamp,
        updatedAt: Date.now(),
      }))).catch(() => {});
    }
  };

  const updateStats = (updater: (prev: SentraStats) => SentraStats) => {
    setStats((prev) => {
      const updated = updater(prev);
      try {
        localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const updateSettings = (newSettings: SentraSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch {}
    // Also sync settings to backend SQLite database if user is logged in
    if (authService.getState().isAuthenticated) {
      authService.saveUserSettings(newSettings).catch(() => {});
    }
  };

  // Sync speech status with WakeWordService
  useEffect(() => {
    const unregister = registerSpeechListener((speaking) => {
      if (speaking) {
        wakeWordService.notifySpeechSynthesisStart();
      } else {
        // Pass false so the assistant speaking doesn't trigger spurious follow-up loops
        wakeWordService.notifySpeechSynthesisEnd(false);
      }
    });
    return unregister;
  }, []);

  // Configure Wake-Word Service Callbacks (Feature 1)
  useEffect(() => {
    wakeWordService.setCallbacks({
      onWakeWordDetected: (event) => {
        if (settings.audioFeedback) {
          playChime('start_listen');
        }
        setIsListening(true);
        setAssistantResponse('Listening…');
      },
      onUtterance: (query: string) => {
        setIsListening(false);
        if (query && query.trim()) {
          setSpokenTranscript(query.trim());
          handleUserQuery(query.trim());
        }
      },
      onCommandDetected: (cmd) => {
        if (cmd === 'stop' || cmd === 'cancel') {
          streamingConversation.cancelActiveStream();
          stopSpeaking();
          setCurrentGoal(null);
          setActiveRoute(null);
          const stoppedMsg = 'Stopped current task.';
          setAssistantResponse(stoppedMsg);
          speakText(stoppedMsg, settings.speechRate);
        } else if (cmd === 'repeat') {
          speakText(assistantResponse, settings.speechRate);
        } else if (cmd === 'continue') {
          speakText('Continuing current task.', settings.speechRate);
        }
      },
      onStateChange: (state) => {
        setWakeWordState(state);
      },
      onError: (err) => {
        console.warn('Wake word listener notice:', err);
      },
    });

    wakeWordService.setSensitivity(settings.wakeWordSensitivity ?? 0.7);

    if (settings.wakeWordEnabled) {
      wakeWordService.start();
    } else {
      wakeWordService.stop();
    }

    return () => {
      wakeWordService.stop();
    };
  }, [settings.wakeWordEnabled, settings.wakeWordSensitivity, settings.speechRate, settings.audioFeedback, assistantResponse]);

  // Configure Temporal Tracker Callbacks (Feature 3)
  useEffect(() => {
    temporalTracker.setCallbacks({
      onTargetLost: (targetLabel: string, _lastClockPosition: string) => {
        if (
          currentGoal &&
          currentGoal.targetObject &&
          targetLabel.toLowerCase().includes(currentGoal.targetObject.toLowerCase())
        ) {
          const step: VerificationStep = {
            id: `step-${Date.now()}`,
            timestamp: Date.now(),
            stepName: 'Target Lost Alert',
            note: `${targetLabel} moved out of the active camera field of view. Slowly pan to re-acquire.`,
            state: 'need_observation',
            outcome: 're_aim_needed',
          };
          setCurrentGoal((prev) =>
            prev
              ? {
                  ...prev,
                  state: 'need_observation',
                  verificationSteps: [...(prev.verificationSteps || []), step],
                }
              : null
          );
        }
      },
      onTargetReacquired: (target: TrackedObject) => {
        if (
          currentGoal &&
          currentGoal.targetObject &&
          target.label.toLowerCase().includes(currentGoal.targetObject.toLowerCase())
        ) {
          if (settings.audioFeedback) {
            playChime('capture');
          }
        }
      },
    });
  }, [currentGoal, settings.audioFeedback]);

  // Real Visual-Inertial SLAM Tracking Loop (Feature 5)
  useEffect(() => {
    if (!isCameraReady) return;

    const slamTimer = setInterval(() => {
      const video = cameraRef.current?.getVideoElement();
      if (video && video.readyState >= 2 && !video.paused) {
        const nextSlam = visualSlamService.processFrame(video);
        setSlamState({ ...nextSlam });
      }
    }, 350);

    return () => clearInterval(slamTimer);
  }, [isCameraReady]);

  // Sync Hardware Telemetry from Wearable Gateway
  const syncWearableTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/device/status');
      if (res.ok) {
        const data = await res.json();
        if (data.telemetry) {
          setTelemetry(data.telemetry);

          // Check for proximity hazard alerts from ToF sensor (< 45cm)
          if (data.telemetry.forwardToFDistanceCm > 0 && data.telemetry.forwardToFDistanceCm < 45) {
            const warning = 'Stop. Obstacle directly in front of you.';
            if (activeHazard?.type !== 'obstacle') {
              setActiveHazard({
                id: String(Date.now()),
                type: 'obstacle',
                severity: 'critical',
                description: 'Physical obstacle detected',
                clockPosition: '12 o’clock',
              });
              if (settings.hapticFeedback && navigator.vibrate) {
                navigator.vibrate([300, 100, 300]);
              }
              speakText(warning, settings.speechRate);
            }
          }

          // Check for cliff / stairs drop-off (> 200mm)
          if (data.telemetry.downwardCliffSensorMm > 200) {
            const cliffWarning = 'Caution! Drop-off or descending stairs detected.';
            if (activeHazard?.type !== 'dropoff') {
              setActiveHazard({
                id: String(Date.now()),
                type: 'dropoff',
                severity: 'critical',
                description: 'Floor level drop-off or steps down',
                clockPosition: '12 o’clock',
              });
              if (settings.hapticFeedback && navigator.vibrate) {
                navigator.vibrate([500, 100, 500]);
              }
              speakText(cliffWarning, settings.speechRate);
            }
          }
        }
      }
    } catch {
      // Ignore background sync errors
    }
  }, [activeHazard, settings]);

  useEffect(() => {
    const timer = setInterval(syncWearableTelemetry, 3500);
    return () => clearInterval(timer);
  }, [syncWearableTelemetry]);

  // Update Simulated Telemetry from Simulator
  const handleUpdateSimulatedTelemetry = async (updated: Partial<WearableTelemetry>) => {
    const next = { ...telemetry, ...updated };
    setTelemetry(next);
    try {
      await fetch('/api/device/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      syncWearableTelemetry();
    } catch {}
  };

  // Feature 6: Plan and Execute Route Navigation
  const handleNavigateToDestination = (destName: string) => {
    const nodes = indoorNavigation.getAllNodes();
    const targetNode = nodes.find(
      (n: NavigationNode) =>
        n.name.toLowerCase().includes(destName.toLowerCase()) ||
        n.room.toLowerCase().includes(destName.toLowerCase())
    );

    if (!targetNode) {
      const msg = `Destination "${destName}" not recognized in topological map.`;
      setAssistantResponse(msg);
      speakText(msg, settings.speechRate);
      return;
    }

    const startNode =
      indoorNavigation.findNearestNodeByCoords(slamState.pose.x, slamState.pose.z) || nodes[0];
    const route = indoorNavigation.planRoute(startNode.name, targetNode.name);

    if (route && route.steps && route.steps.length > 0) {
      setActiveRoute(route);
      const firstStepText = indoorNavigation.formatGuidanceStep(route.steps[0]);
      const guidance = `Navigating to ${targetNode.name}. ${firstStepText}. Caution: Keep white cane sweeping.`;
      setAssistantResponse(guidance);
      speakText(guidance, settings.speechRate);

      const navGoal: GoalTask = {
        id: String(Date.now()),
        intent: `Navigate to ${targetNode.name}`,
        targetObject: targetNode.name,
        state: 'active',
        confidence: 0.85,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        history: [{ timestamp: Date.now(), note: `Initiated navigation to ${targetNode.name}`, state: 'active' }],
        verificationSteps: [
          {
            id: `step-${Date.now()}`,
            timestamp: Date.now(),
            stepName: 'Path Computed',
            note: `A* route found (${route.steps.length} checkpoints, ~${route.totalSteps} steps).`,
            state: 'active',
            outcome: 'success',
          },
        ],
      };
      setCurrentGoal(navGoal);
      setActiveSection('spatial');
    } else {
      const msg = `Unable to compute a safe path to ${destName}. Obstacles may be blocking all routes.`;
      setAssistantResponse(msg);
      speakText(msg, settings.speechRate);
    }
  };

  // Feature 4: Memory Backup Export/Import Handlers
  const handleExportMemory = async () => {
    try {
      const jsonStr = await memoryService.exportBackupJson();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sentra-memory-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      speakText('Exported memory backup file.', settings.speechRate);
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  const handleImportMemory = async (file: File) => {
    try {
      const text = await file.text();
      const ok = await memoryService.importBackupJson(text);
      if (ok) {
        const updated = await memoryService.getAllObjectMemories();
        setMemories(updated);
        speakText('Memory backup restored successfully.', settings.speechRate);
      } else {
        speakText('Failed to parse memory backup file.', settings.speechRate);
      }
    } catch (err) {
      console.error('Import error:', err);
    }
  };

  // Execute Vision-Language Perception Pipeline (UNDERSTAND → OBSERVE → REASON → ACT → VERIFY → UPDATE)
  const executeAnalysis = useCallback(
    async (mode: SentraMode, query = '', goalTargetOverride?: string | null): Promise<boolean> => {
      if (isProcessing) return false;
      setIsProcessing(true);
      const startTime = performance.now();

      if (settings.audioFeedback) {
        playChime('capture');
      }

      const capture = cameraRef.current?.captureFrame() || { dataUrl: null, quality: null };
      const sensorsSummary = cameraRef.current?.getSensorsSummary() || '';
      const heading = cameraRef.current?.heading ?? telemetry.imu.heading ?? null;
      const activeGoalTarget = goalTargetOverride !== undefined ? goalTargetOverride : currentGoal?.targetObject;

      try {
        const res = await fetch('/api/sentra/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            query,
            image: capture.dataUrl,
            sensors: sensorsSummary,
            goal: activeGoalTarget,
            memory: memories.slice(-30),
            history: historyRef.current.slice(-6),
            heading,
            useWearableFrame: useWearableFeed,
          }),
        });

        if (!res.ok) {
          throw new Error(`Perception service status ${res.status}`);
        }

        const data = await res.json();
        setIsProcessing(false);

        setIsLocalAssistActive(Boolean(data.quotaExhausted));

        const latency = performance.now() - startTime;
        updateStats((s) => ({
          ...s,
          calls: s.calls + 1,
          totalMs: s.totalMs + latency,
        }));

        let spoken = data.spokenResponse || data.text || '';

        // If server produced no text, compute on-device local vision
        if (!spoken) {
          const videoEl = cameraRef.current?.getVideoElement() || null;
          const localFallback = analyzeLocalScene(
            videoEl,
            heading,
            memories,
            mode,
            query,
            activeGoalTarget ?? null
          );
          spoken = localFallback.text;
          setIsLocalAssistActive(true);

          const analysis = offlineVision.analyzeVideoFrame(videoEl, heading);
          setLocalAnalysis(analysis);
          updateStats((s) => ({ ...s, offlineScans: s.offlineScans + 1 }));
        }

        // Feature 3: Update Detected & Temporally Tracked Objects
        if (data.detectedObjects) {
          setDetectedObjects(data.detectedObjects);
          const updatedTracks = temporalTracker.update(data.detectedObjects);
          setTrackedObjects(updatedTracks);
          updateStats((s) => ({
            ...s,
            trackingUpdates: s.trackingUpdates + updatedTracks.length,
          }));
        }

        if (data.sceneDescription) {
          setSceneDescription(data.sceneDescription);
        }
        if (data.pathIsClear !== undefined) {
          setPathIsClear(data.pathIsClear);
        }
        setActivePerceptionPrompt(data.activePerceptionRequest || null);

        // Process hazard alert
        if (data.hazard) {
          setActiveHazard(data.hazard);
          spoken = 'Caution! ' + data.hazard.description + ' at ' + data.hazard.clockPosition;
          if (settings.hapticFeedback && navigator.vibrate) {
            navigator.vibrate([400, 100, 400]);
          }
          if (settings.audioFeedback) {
            playChime('hazard');
          }
          updateStats((s) => ({ ...s, hazards: s.hazards + 1 }));
        } else {
          setActiveHazard(null);
        }

        // Process memory storage (Feature 4: Contextual Memory)
        if (mode === 'remember' && data.rememberedData) {
          const newMemory: SentraMemoryItem = {
            id: String(Date.now()),
            label: data.rememberedData.label || 'Saved Landmark',
            note: data.rememberedData.note || spoken,
            room: data.rememberedData.room || currentRoom,
            at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now(),
            heading,
            source: 'live_verified',
          };
          updateMemories([...memories, newMemory]);
          spoken = `Saved to memory: ${newMemory.label}.`;
        }

        // Process goal verification & task completion
        if ((mode === 'find' || mode === 'navigate') && currentGoal) {
          if (data.foundTarget) {
            const targetObj = data.detectedObjects?.find(
              (o: any) =>
                o.isTargetGoal ||
                (activeGoalTarget && o.label.toLowerCase().includes(activeGoalTarget.toLowerCase()))
            );

            const verifiedStep: VerificationStep = {
              id: `step-${Date.now()}`,
              timestamp: Date.now(),
              stepName: `Visual Confirmation`,
              note: spoken || `Verified ${activeGoalTarget} confirmed in camera observation.`,
              state: 'completed',
              outcome: 'success',
              heading,
              clockPosition: targetObj?.clockPosition || "12 o'clock",
              confidence: targetObj?.confidence || 0.95,
            };

            // Task completed with verified evidence
            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    state: 'completed',
                    confidence: 0.95,
                    updatedAt: Date.now(),
                    history: [
                      ...prev.history,
                      { timestamp: Date.now(), note: 'Verified in camera view.', state: 'completed' },
                    ],
                    verificationSteps: [...(prev.verificationSteps || []), verifiedStep],
                  }
                : null
            );

            if (settings.hapticFeedback && navigator.vibrate) {
              navigator.vibrate([100, 60, 100]);
            }
            if (settings.audioFeedback) {
              playChime('found');
            }

            // Record verified observation in persistent memory
            if (activeGoalTarget) {
              const autoMemory: SentraMemoryItem = {
                id: String(Date.now()),
                label: `${activeGoalTarget} seen`,
                note: spoken,
                at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                timestamp: Date.now(),
                heading,
                room: currentRoom,
                source: 'live_verified',
              };
              updateMemories([...memories, autoMemory]);
            }
          } else if (data.activePerceptionRequest) {
            const directiveStep: VerificationStep = {
              id: `step-${Date.now()}`,
              timestamp: Date.now(),
              stepName: `Re-aim Advisory`,
              note: data.activePerceptionRequest,
              state: 'need_observation',
              outcome: 're_aim_needed',
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
                        note: `Perception adjustment: ${data.activePerceptionRequest}`,
                        state: 'need_observation',
                      },
                    ],
                    verificationSteps: [...(prev.verificationSteps || []), directiveStep],
                  }
                : null
            );
          } else {
            const scanStep: VerificationStep = {
              id: `step-${Date.now()}`,
              timestamp: Date.now(),
              stepName: `Observation Scan`,
              note: spoken || `Scanned view; target not yet confirmed.`,
              state: 'active',
              outcome: 'attempted',
              heading,
            };

            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    updatedAt: Date.now(),
                    verificationSteps: [...(prev.verificationSteps || []), scanStep],
                  }
                : null
            );
          }
        }

        // Update spatial relationships if returned
        if (data.spatialRelations && data.spatialRelations.length > 0) {
          const newRels = data.spatialRelations.map((sr: any) => ({
            id: `rel-${Date.now()}-${Math.random()}`,
            subject: sr.subject,
            relation: sr.relation,
            object: sr.object,
            timestamp: Date.now(),
            verifiedLive: true,
          }));
          setRelationships((prev) => [...prev, ...newRels].slice(-15));
        }

        if (query) {
          historyRef.current.push({ role: 'user', text: query });
        }
        historyRef.current.push({ role: 'assistant', text: spoken });

        setAssistantResponse(spoken);
        speakText(spoken, settings.speechRate, () => {
          if (settings.wakeWordEnabled) {
            wakeWordService.start();
          }
        });

        return true;
      } catch (err) {
        setIsProcessing(false);
        setIsLocalAssistActive(true);

        const videoEl = cameraRef.current?.getVideoElement() || null;
        const localResult = analyzeLocalScene(
          videoEl,
          heading,
          memories,
          mode,
          query,
          activeGoalTarget ?? null
        );

        const localScan = offlineVision.analyzeVideoFrame(videoEl, heading);
        setLocalAnalysis(localScan);
        updateStats((s) => ({ ...s, offlineScans: s.offlineScans + 1 }));

        const safeSpeech = localResult.text;
        setAssistantResponse(safeSpeech);
        speakText(safeSpeech, settings.speechRate);

        if (query) {
          historyRef.current.push({ role: 'user', text: query });
        }
        historyRef.current.push({ role: 'assistant', text: safeSpeech });

        return true;
      }
    },
    [memories, currentGoal, isProcessing, settings, telemetry, useWearableFeed, currentRoom]
  );

  // User Query Handler
  const handleUserQuery = async (queryText: string) => {
    if (!queryText.trim()) return;
    setSpokenTranscript(queryText);

    // Stop / Cancel commands
    if (/\b(stop|cancel|never mind|pause|be quiet|shut up)\b/i.test(queryText)) {
      streamingConversation.cancelActiveStream();
      setCurrentGoal(null);
      setActiveRoute(null);
      stopSpeaking();
      const stoppedMsg = 'Stopped current task.';
      setAssistantResponse(stoppedMsg);
      speakText(stoppedMsg, settings.speechRate);
      return;
    }

    // Repeat command
    if (/\b(repeat|say that again|what did you say)\b/i.test(queryText)) {
      speakText(assistantResponse, settings.speechRate);
      return;
    }

    // Navigation command check ("navigate to ...", "guide me to ...")
    const navMatch = queryText.match(
      /\b(?:navigate to|guide me to|take me to|path to|go to|directions to)\s+(.+)/i
    );
    if (navMatch && navMatch[1]) {
      handleNavigateToDestination(navMatch[1].trim());
      return;
    }

    const intent = parseVoiceIntent(queryText);

    if ((intent.mode === 'find' || intent.mode === 'navigate') && intent.goal) {
      const heading = cameraRef.current?.heading ?? telemetry.imu.heading ?? null;
      const initialStep: VerificationStep = {
        id: `step-${Date.now()}-1`,
        timestamp: Date.now(),
        stepName: `Search Initiated`,
        note: `Goal set for "${intent.goal}". Starting visual search at heading ${
          heading != null ? Math.round(heading) + '°' : 'view'
        }.`,
        state: 'active',
        outcome: 'pending',
        heading,
      };

      const newGoal: GoalTask = {
        id: String(Date.now()),
        intent: queryText,
        targetObject: intent.goal,
        state: 'active',
        confidence: 0.5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        history: [{ timestamp: Date.now(), note: `Initiated ${intent.mode} for ${intent.goal}`, state: 'active' }],
        verificationSteps: [initialStep],
      };
      setCurrentGoal(newGoal);
      updateStats((s) => ({ ...s, findsStarted: s.findsStarted + 1 }));
    }

    // Feature 7: Offline Local Mode Check
    const isOffline =
      !navigator.onLine || settings.preferredPerceptionMode === 'offline_local';
    if (isOffline) {
      const video = cameraRef.current?.getVideoElement() || null;
      const heading = cameraRef.current?.heading ?? telemetry.imu.heading ?? null;
      const analysis = offlineVision.analyzeVideoFrame(video, heading);
      setLocalAnalysis(analysis);
      updateStats((s) => ({ ...s, offlineScans: s.offlineScans + 1 }));

      const memMatch = memories.find((m) =>
        queryText.toLowerCase().includes(m.label.toLowerCase())
      );
      const memNote = memMatch ? `I remember ${memMatch.label} was in the ${memMatch.room || 'area'}.` : null;

      const offlineSpeech = offlineVision.generateOfflineResponse(intent.mode, analysis, memNote);
      setAssistantResponse(offlineSpeech);
      speakText(offlineSpeech, settings.speechRate);
      setIsLocalAssistActive(true);
      return;
    }

    // When user asks to find, locate, describe, or search for objects, execute full visual analysis with bounding boxes & confidence
    if (intent.mode === 'find' || intent.mode === 'describe' || intent.mode === 'navigate') {
      await executeAnalysis(intent.mode, queryText, intent.goal || currentGoal?.targetObject);
      return;
    }

    // Feature 2: Real-time Streaming AI Conversation for general open-ended conversational questions
    if (settings.streamingVoiceEnabled && intent.mode !== 'remember') {
      setIsProcessing(true);
      const capture = cameraRef.current?.captureFrame() || { dataUrl: null, quality: null };
      const sensorsSummary = cameraRef.current?.getSensorsSummary() || '';
      const heading = cameraRef.current?.heading ?? telemetry.imu.heading ?? null;

      try {
        await streamingConversation.streamTurn(
          {
            query: queryText,
            image: capture.dataUrl,
            mode: intent.mode,
            goal: intent.goal || currentGoal?.targetObject,
            memory: memories.slice(-30),
            history: historyRef.current.slice(-6),
            heading,
            sensors: sensorsSummary,
            useWearableFrame: useWearableFeed,
          },
          {
            onChunk: (_chunk, fullText) => {
              setAssistantResponse(fullText);
            },
            onSentence: (sentence) => {
              speakText(sentence, settings.speechRate);
            },
            onComplete: (fullText) => {
              setIsProcessing(false);
              historyRef.current.push({ role: 'user', text: queryText });
              historyRef.current.push({ role: 'assistant', text: fullText });
              updateStats((s) => ({ ...s, calls: s.calls + 1 }));
            },
            onError: (err) => {
              console.warn('Streaming error, falling back to batch analysis:', err);
              setIsProcessing(false);
              executeAnalysis(intent.mode, queryText, intent.goal || currentGoal?.targetObject);
            },
          }
        );
        return;
      } catch (err) {
        console.warn('Streaming failed, fallback:', err);
        setIsProcessing(false);
      }
    }

    await executeAnalysis(intent.mode, queryText, intent.goal || currentGoal?.targetObject);
  };

  // Continuous active perception search loop
  const currentGoalRef = useRef(currentGoal);
  currentGoalRef.current = currentGoal;

  useEffect(() => {
    if (!currentGoal || currentGoal.state === 'completed' || currentGoal.state === 'cancelled') {
      return;
    }

    let isMounted = true;
    let lastHeading: number | null = null;
    let stationaryCount = 0;

    const intervalSearch = async () => {
      while (isMounted && currentGoalRef.current && currentGoalRef.current.state === 'active') {
        await new Promise((r) => setTimeout(r, 5500));
        if (!isMounted || !currentGoalRef.current || currentGoalRef.current.state !== 'active') break;

        while (isSpeaking()) {
          await new Promise((r) => setTimeout(r, 400));
          if (!isMounted || !currentGoalRef.current || currentGoalRef.current.state !== 'active') break;
        }

        if (!isMounted || !currentGoalRef.current || currentGoalRef.current.state !== 'active') break;

        const currentHeading = cameraRef.current?.heading ?? telemetry.imu.heading ?? null;
        if (currentHeading != null && lastHeading != null) {
          const delta = Math.abs((currentHeading - lastHeading + 360) % 360);
          const angularDiff = delta > 180 ? 360 - delta : delta;

          if (angularDiff < 10) {
            stationaryCount++;
            if (stationaryCount >= 2) {
              const guidance = `Still searching for ${currentGoal.targetObject}. Slowly pan the camera left or right.`;
              setAssistantResponse(guidance);
              speakText(guidance, settings.speechRate);

              const stationaryStep: VerificationStep = {
                id: `step-${Date.now()}`,
                timestamp: Date.now(),
                stepName: `Pan Adjustment Advisory`,
                note: `Camera stationary across multiple observations. Prompted pan left/right.`,
                state: 'active',
                outcome: 're_aim_needed',
                heading: currentHeading,
              };

              setCurrentGoal((prev) =>
                prev
                  ? {
                      ...prev,
                      updatedAt: Date.now(),
                      verificationSteps: [...(prev.verificationSteps || []), stationaryStep],
                    }
                  : null
              );

              stationaryCount = 0;
              continue;
            }
          } else {
            stationaryCount = 0;
          }
        }
        lastHeading = currentHeading;

        await executeAnalysis('find', '', currentGoal.targetObject);
      }
    };

    intervalSearch();

    return () => {
      isMounted = false;
    };
  }, [currentGoal, executeAnalysis, settings.speechRate, telemetry.imu.heading]);

  // Speech Recognition (Hold to Talk & Hands-Free)
  const startListening = () => {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    stopSpeaking();
    streamingConversation.cancelActiveStream();

    if (!SpeechRecognitionClass) {
      const msg =
        "Voice recognition isn't supported in this browser. Please use quick action buttons or text input.";
      setAssistantResponse(msg);
      speakText(msg, settings.speechRate);
      setShowTextInput(true);
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let transcript = event.results[0]?.[0]?.transcript || '';
        if (transcript.toLowerCase().startsWith('hey sentra')) {
          transcript = transcript.replace(/^hey sentra[, ]*/i, '');
        }
        if (transcript) {
          handleUserQuery(transcript);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);

      if (settings.audioFeedback) {
        playChime('start_listen');
      }
    } catch {
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
    if (settings.audioFeedback) {
      playChime('stop_listen');
    }
  };

  // Spacebar accessibility shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        startListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        stopListening();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-between gap-3 p-3.5 text-foreground selection:bg-primary/20">
      {/* Top Header */}
      <header className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 rounded-full bg-primary animate-pulse" />
          <h1 className="text-3xl font-extrabold tracking-widest text-primary">SENTRA</h1>
        </div>

        {/* Status Pills */}
        <div className="flex items-center gap-1.5 text-xs font-bold font-mono">
          {/* SLAM Odometry Badge */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
              slamState.status === 'tracking'
                ? 'bg-success/20 text-success border border-success/40'
                : slamState.status === 'degraded'
                ? 'bg-warning/20 text-warning border border-warning/40'
                : 'bg-secondary text-muted-foreground'
            }`}
            title={`Visual SLAM Odometry (${slamState.featureCount} points)`}
          >
            <Compass className="h-3 w-3" />
            <span>SLAM {slamState.featureCount}p</span>
          </span>

          {/* Wearable Link Badge */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
              telemetry.connected
                ? 'bg-success/20 text-success border border-success/40'
                : 'bg-secondary text-muted-foreground'
            }`}
          >
            <Radio className="h-3 w-3" />
            <span>{telemetry.connected ? 'Wearable' : 'Standby'}</span>
          </span>

          {/* AI Perception Engine Badge */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
              isLocalAssistActive || settings.preferredPerceptionMode === 'offline_local'
                ? 'bg-primary/20 text-primary border border-primary/40'
                : 'bg-secondary text-foreground'
            }`}
          >
            {isLocalAssistActive || settings.preferredPerceptionMode === 'offline_local' ? (
              <Cpu className="h-3 w-3 text-primary" />
            ) : (
              <Sparkles className="h-3 w-3 text-primary" />
            )}
            <span>
              {isLocalAssistActive || settings.preferredPerceptionMode === 'offline_local'
                ? 'Local'
                : 'Gemini'}
            </span>
          </span>

          {/* User Account / Database Sync Button */}
          <button
            onClick={() => setIsAuthModalOpen(true)}
            title={authState.isAuthenticated ? `Logged in as ${authState.user?.name} (SQLite synced)` : 'Sign in to sync memories & settings'}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition cursor-pointer ${
              authState.isAuthenticated
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-neutral-800'
            }`}
          >
            <User className="h-3 w-3" />
            <span>{authState.isAuthenticated ? authState.user?.name.split(' ')[0] : 'Sign In'}</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs (7 Functional Areas) */}
      <nav
        aria-label="Application Sections"
        className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar border-b border-border/40 text-xs font-bold"
      >
        <button
          onClick={() => setActiveSection('assistant')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'assistant'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Mic className="h-3.5 w-3.5" />
          <span>Assistant</span>
        </button>

        <button
          onClick={() => setActiveSection('vision')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'vision'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Live Vision ({detectedObjects.length})</span>
        </button>

        <button
          onClick={() => setActiveSection('finder')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'finder'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Crosshair className="h-3.5 w-3.5" />
          <span>Object Finder</span>
        </button>

        <button
          onClick={() => setActiveSection('spatial')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'spatial'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Compass className="h-3.5 w-3.5" />
          <span>Spatial World</span>
        </button>

        <button
          onClick={() => setActiveSection('memory')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'memory'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>Memory ({memories.length})</span>
        </button>

        <button
          onClick={() => setActiveSection('device')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'device'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>Wearable</span>
        </button>

        <button
          onClick={() => setActiveSection('settings')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all ${
            activeSection === 'settings'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Main Camera Viewport with SLAM & Tracking Overlays */}
      <CameraView
        ref={cameraRef}
        findingGoal={currentGoal?.targetObject || null}
        onStopFinding={() => setCurrentGoal(null)}
        facingMode={settings.cameraFacing}
        onToggleFacingMode={() => {
          const next = settings.cameraFacing === 'environment' ? 'user' : 'environment';
          updateSettings({ ...settings, cameraFacing: next });
        }}
        detectedObjects={detectedObjects}
        trackedObjects={trackedObjects}
        hazard={activeHazard}
        activePerceptionPrompt={activePerceptionPrompt}
        useWearableFeed={useWearableFeed}
        wearableFrame={null}
        onCameraStatusChange={setIsCameraReady}
        slamStatus={slamState.status}
        slamFeatureCount={slamState.featureCount}
        perceptionMode={settings.preferredPerceptionMode || 'hybrid'}
      />

      {/* Tab Content Display */}
      {activeSection === 'assistant' && (
        <div className="space-y-3 animate-fade-in">
          {/* Spoken Response & Transcript Card */}
          <section
            aria-live="polite"
            className="relative flex min-h-[6.5rem] flex-col justify-center rounded-2xl bg-card border-2 border-border/60 p-4 shadow-lg transition-all"
          >
            {spokenTranscript && (
              <p className="mb-1 text-sm font-semibold text-muted-foreground">
                You: <span className="text-foreground">"{spokenTranscript}"</span>
              </p>
            )}

            <p className="text-xl font-bold leading-relaxed text-foreground select-text">
              {isProcessing ? (
                <span className="flex items-center gap-2 text-primary animate-pulse">
                  <Eye className="h-5 w-5" />
                  <span>Observing & reasoning…</span>
                </span>
              ) : (
                assistantResponse
              )}
            </p>

            {/* Audio action controls */}
            {!isProcessing && assistantResponse && (
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <button
                  onClick={() => speakText(assistantResponse, settings.speechRate)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
                  aria-label="Replay audio"
                  title="Speak again"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  onClick={stopSpeaking}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
                  aria-label="Silence audio"
                  title="Stop speaking"
                >
                  <VolumeX className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>

          {/* Huge Accessible Hold to Talk Button */}
          <button
            onPointerDown={startListening}
            onPointerUp={stopListening}
            onPointerLeave={() => isListening && stopListening()}
            disabled={isProcessing}
            className={`flex h-28 w-full select-none items-center justify-center gap-3 rounded-3xl bg-primary text-3xl font-extrabold text-primary-foreground shadow-2xl transition-all duration-200 active:scale-95 disabled:opacity-60 ${
              isListening ? 'sentra-listening ring-8 ring-primary/40' : 'hover:brightness-105'
            }`}
            aria-label="Hold to talk to SENTRA"
          >
            <Mic className={`h-8 w-8 ${isListening ? 'animate-bounce' : ''}`} />
            <span>{isListening ? 'Listening…' : isProcessing ? 'Thinking…' : 'Hold to talk'}</span>
          </button>

          {/* Hands-Free Wake-Word Status Bar */}
          <div className="flex items-center justify-between rounded-xl bg-secondary/80 px-3 py-2 text-xs font-semibold text-muted-foreground border border-border/50">
            <button
              onClick={() => {
                const next = !settings.wakeWordEnabled;
                updateSettings({ ...settings, wakeWordEnabled: next });
              }}
              className="flex items-center gap-1.5 hover:text-foreground cursor-pointer transition text-left"
              title="Click to toggle Hey SENTRA wake word"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  !settings.wakeWordEnabled
                    ? 'bg-neutral-500'
                    : wakeWordState === 'listening' || wakeWordState === 'detected'
                    ? 'bg-primary animate-ping'
                    : wakeWordState === 'standby'
                    ? 'bg-emerald-400'
                    : 'bg-amber-400'
                }`}
              />
              <span>
                {!settings.wakeWordEnabled
                  ? 'Wake Word: Paused (Tap to enable)'
                  : wakeWordState === 'standby'
                  ? 'Say "Hey SENTRA"'
                  : wakeWordState === 'listening'
                  ? 'Listening for command…'
                  : `Wake Word: ${wakeWordState}`}
              </span>
            </button>
            <button
              onClick={() => {
                const next = !settings.wakeWordEnabled;
                updateSettings({ ...settings, wakeWordEnabled: next });
              }}
              className={`text-[11px] font-mono px-2 py-0.5 rounded cursor-pointer transition ${
                settings.wakeWordEnabled
                  ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                  : 'bg-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {settings.wakeWordEnabled ? 'Active' : 'Turn On'}
            </button>
          </div>

          {/* Quick Voice Mode Buttons Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => executeAnalysis('describe')}
              disabled={isProcessing}
              className="flex items-center justify-center gap-2 rounded-2xl bg-secondary p-3 text-base font-bold border border-border/50 hover:bg-secondary/80 active:scale-95 transition-all shadow-sm"
            >
              <Eye className="h-5 w-5 text-primary" />
              <span>Describe</span>
            </button>
            <button
              onClick={() => {
                const target = prompt(
                  'What object should SENTRA locate? (e.g. water bottle, spectacles)'
                );
                if (target?.trim()) {
                  handleUserQuery(`Find ${target.trim()}`);
                }
              }}
              disabled={isProcessing}
              className="flex items-center justify-center gap-2 rounded-2xl bg-secondary p-3 text-base font-bold border border-border/50 hover:bg-secondary/80 active:scale-95 transition-all shadow-sm"
            >
              <Crosshair className="h-5 w-5 text-accent" />
              <span>Find Object</span>
            </button>
          </div>

          {/* Text Input Toggle */}
          <div>
            {!showTextInput ? (
              <button
                onClick={() => setShowTextInput(true)}
                className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground underline transition-colors"
              >
                Or type a question / command instead of speaking
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
                className="flex items-center gap-2 rounded-2xl bg-secondary p-2 border border-border"
              >
                <input
                  type="text"
                  placeholder="Ask SENTRA (e.g., 'What is in front of me?')"
                  value={typedQuery}
                  onChange={(e) => setTypedQuery(e.target.value)}
                  className="flex-1 bg-transparent px-3 py-1 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!typedQuery.trim() || isProcessing}
                  className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50 shadow-sm"
                  aria-label="Submit query"
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
          trackedObjects={trackedObjects}
          sceneDescription={sceneDescription}
          pathIsClear={pathIsClear}
          hazard={activeHazard}
          slamState={slamState}
          perceptionMode={settings.preferredPerceptionMode || 'hybrid'}
          localAnalysis={localAnalysis}
          onSelectObject={(obj) => handleUserQuery(`What is this ${obj.label}?`)}
        />
      )}

      {activeSection === 'finder' && (
        <ObjectFinderView
          currentGoal={currentGoal}
          onStartSearch={(target) => handleUserQuery(`Find ${target}`)}
          onCancelSearch={() => setCurrentGoal(null)}
          activePerceptionPrompt={activePerceptionPrompt}
          detectedObjects={detectedObjects}
          isSearching={Boolean(currentGoal)}
        />
      )}

      {activeSection === 'spatial' && (
        <SpatialWorldView
          heading={cameraRef.current?.heading ?? telemetry.imu.heading ?? null}
          landmarks={landmarks}
          relationships={relationships}
          detectedObjects={detectedObjects}
          currentRoom={currentRoom}
          slamState={slamState}
          activeRoute={activeRoute}
          onSelectDestination={handleNavigateToDestination}
          onCancelRoute={() => setActiveRoute(null)}
        />
      )}

      {activeSection === 'memory' && (
        <ContextualMemoryView
          memories={memories}
          onAddMemory={(label, note, room) => {
            const item: SentraMemoryItem = {
              id: String(Date.now()),
              label,
              note,
              room,
              at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              timestamp: Date.now(),
              heading: cameraRef.current?.heading ?? null,
              source: 'user_manual',
            };
            updateMemories([...memories, item]);
          }}
          onDeleteMemory={(id) => {
            memoryService.deleteObjectMemory(id).catch(() => {});
            updateMemories(memories.filter((m) => m.id !== id));
          }}
          onClearAll={() => {
            memoryService.clearAllObjectMemories().catch(() => {});
            updateMemories([]);
          }}
          onSpeakMemory={(item) => speakText(`${item.label}: ${item.note}`, settings.speechRate)}
          onFindMemoryTarget={(label) => handleUserQuery(`Find ${label}`)}
          onExportData={handleExportMemory}
          onImportData={handleImportMemory}
        />
      )}

      {activeSection === 'device' && (
        <DeviceStatusView
          telemetry={telemetry}
          useWearableFeed={useWearableFeed}
          onToggleFeedSource={(use) => setUseWearableFeed(use)}
          onUpdateSimulatedTelemetry={handleUpdateSimulatedTelemetry}
          cameraReady={isCameraReady || Boolean(cameraRef.current?.isReady)}
        />
      )}

      {activeSection === 'settings' && (
        <SettingsDiagnosticsView
          settings={settings}
          onUpdateSettings={updateSettings}
          telemetry={telemetry}
          cameraReady={isCameraReady || Boolean(cameraRef.current?.isReady)}
        />
      )}

      {/* Authentication & SQLite Database Sync Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        authState={authState}
        onLoginSuccess={() => {
          // Re-fetch data on login
        }}
      />
    </main>
  );
}
