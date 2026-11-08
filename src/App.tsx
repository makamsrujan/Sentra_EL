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
} from './types/sentra';
import { parseVoiceIntent } from './utils/parser';
import { isSpeaking, playChime, speakText, stopSpeaking } from './utils/audio';
import { analyzeLocalScene } from './utils/localVision';
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
};

const DEFAULT_SETTINGS: SentraSettings = {
  speechRate: 1.05,
  audioFeedback: true,
  hapticFeedback: true,
  cameraFacing: 'environment',
  autoContinuousFind: true,
  wakeWordEnabled: false,
  selectedInputSource: 'browser_camera',
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
  const [activeHazard, setActiveHazard] = useState<HazardAlert | null>(null);
  const [activePerceptionPrompt, setActivePerceptionPrompt] = useState<string | null>(null);
  const [sceneDescription, setSceneDescription] = useState<string>(
    'Aim camera forward to observe surroundings.'
  );
  const [pathIsClear, setPathIsClear] = useState<boolean>(true);

  // Goal Task Management State
  const [currentGoal, setCurrentGoal] = useState<GoalTask | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);

  // Spatial World Model
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

  // Persistence
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

  // Helpers for persistence
  const updateMemories = (newMemories: SentraMemoryItem[]) => {
    setMemories(newMemories);
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(newMemories));
    } catch {}
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
  };

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
          const localFallback = analyzeLocalScene(
            cameraRef.current?.getVideoElement() || null,
            heading,
            memories,
            mode,
            query,
            activeGoalTarget ?? null
          );
          spoken = localFallback.text;
          setIsLocalAssistActive(true);
        }

        // Update perception state
        if (data.detectedObjects) {
          setDetectedObjects(data.detectedObjects);
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

        // Process memory storage
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
              actionCategory: 'completed',
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

            // Record verified observation
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
              actionCategory: 'active',
              heading,
            };

            // Needs additional observation
            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    state: 'need_observation',
                    requiredObservation: data.activePerceptionRequest,
                    updatedAt: Date.now(),
                    history: [
                      ...prev.history,
                      { timestamp: Date.now(), note: `Perception adjustment: ${data.activePerceptionRequest}`, state: 'need_observation' },
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
              actionCategory: 'attempted',
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

        // Process conversational goal updates from Gemini
        if (data.goalUpdate) {
          if (!currentGoal && data.goalUpdate.state === 'active') {
            const newGoal: GoalTask = {
              id: String(Date.now()),
              intent: query || data.goalUpdate.targetObject,
              targetObject: data.goalUpdate.targetObject,
              state: data.goalUpdate.state,
              nextSafeAction: data.goalUpdate.nextAction,
              confidence: 0.6,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              history: [{ timestamp: Date.now(), note: `Goal initiated: ${data.goalUpdate.targetObject}`, state: 'active' }],
              verificationSteps: [
                {
                  id: `step-${Date.now()}-init`,
                  timestamp: Date.now(),
                  stepName: 'Goal Initiated',
                  note: spoken || `Searching for ${data.goalUpdate.targetObject}.`,
                  state: 'active',
                  outcome: 'pending',
                  heading,
                },
              ],
            };
            setCurrentGoal(newGoal);
          } else if (currentGoal) {
            setCurrentGoal((prev) =>
              prev
                ? {
                    ...prev,
                    state: data.goalUpdate!.state || prev.state,
                    nextSafeAction: data.goalUpdate!.nextAction || prev.nextSafeAction,
                    updatedAt: Date.now(),
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
        if (historyRef.current.length > 20) {
          historyRef.current = historyRef.current.slice(-20);
        }

        setAssistantResponse(spoken);
        speakText(spoken, settings.speechRate, () => {
          // If wake word is enabled, re-enable listening seamlessly
          if (settings.wakeWordEnabled) {
            startListening();
          }
        });

        return true;
      } catch (err) {
        setIsProcessing(false);
        setIsLocalAssistActive(true);

        const localResult = analyzeLocalScene(
          cameraRef.current?.getVideoElement() || null,
          heading,
          memories,
          mode,
          query,
          activeGoalTarget ?? null
        );

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

    // Stop command
    if (/\b(stop|cancel|never mind|pause|be quiet|shut up)\b/i.test(queryText)) {
      setCurrentGoal(null);
      stopSpeaking();
      const stoppedMsg = 'Stopped current task.';
      setAssistantResponse(stoppedMsg);
      speakText(stoppedMsg, settings.speechRate);
      return;
    }

    const intent = parseVoiceIntent(queryText);

    if ((intent.mode === 'find' || intent.mode === 'navigate') && intent.goal) {
      const heading = cameraRef.current?.heading ?? telemetry.imu.heading ?? null;
      const initialStep: VerificationStep = {
        id: `step-${Date.now()}-1`,
        timestamp: Date.now(),
        stepName: `Search Initiated`,
        note: `Goal set for "${intent.goal}". Starting visual search at heading ${heading != null ? Math.round(heading) + '°' : 'view'}.`,
        state: 'active',
        outcome: 'pending',
        actionCategory: 'active',
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
      await executeAnalysis(intent.mode, queryText, intent.goal);
      return;
    }

    await executeAnalysis(intent.mode, queryText, currentGoal?.targetObject);
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

    if (!SpeechRecognitionClass) {
      const msg = "Voice recognition isn't supported in this browser. Please use quick action buttons or text input.";
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
        // Filter wake word if present
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
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
              telemetry.connected
                ? 'bg-success/20 text-success border border-success/40'
                : 'bg-secondary text-muted-foreground'
            }`}
          >
            <Radio className="h-3 w-3" />
            <span>{telemetry.connected ? 'Wearable Link' : 'Standby'}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
              isLocalAssistActive
                ? 'bg-primary/20 text-primary border border-primary/40'
                : 'bg-secondary text-foreground'
            }`}
          >
            {isLocalAssistActive ? <Cpu className="h-3 w-3" /> : <Sparkles className="h-3 w-3 text-primary" />}
            <span>{isLocalAssistActive ? 'On-Device' : 'Gemini AI'}</span>
          </span>
        </div>
      </header>

      {/* Navigation Tabs (Requirement 11: 7 Functional Areas) */}
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

      {/* Main Camera Viewport (Always visible for real visual perception) */}
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
        hazard={activeHazard}
        activePerceptionPrompt={activePerceptionPrompt}
        useWearableFeed={useWearableFeed}
        wearableFrame={null}
        onCameraStatusChange={setIsCameraReady}
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
                const target = prompt('What object should SENTRA locate? (e.g. water bottle, spectacles)');
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
          sceneDescription={sceneDescription}
          pathIsClear={pathIsClear}
          hazard={activeHazard}
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
          onDeleteMemory={(id) => updateMemories(memories.filter((m) => m.id !== id))}
          onClearAll={() => updateMemories([])}
          onSpeakMemory={(item) => speakText(`${item.label}: ${item.note}`, settings.speechRate)}
          onFindMemoryTarget={(label) => handleUserQuery(`Find ${label}`)}
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
    </main>
  );
}
