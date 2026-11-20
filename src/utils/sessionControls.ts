import type { FrameQuality, GoalTask } from '../types/sentra';
import type { VoiceAssistantState } from '../hooks/useVoiceAssistant';

export type DirectSessionControlAction =
  | 'stop_session'
  | 'cancel_task'
  | 'stop_speaking'
  | 'repeat'
  | null;

export type UnifiedSessionPhase =
  | 'idle'
  | 'starting'
  | 'switching_source'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'guiding'
  | 'error';

export interface UnifiedPhaseDisplay {
  phase: UnifiedSessionPhase;
  label: string;
  detail: string;
}

/**
 * Recognizes ONLY immediate local session/audio meta-controls that must execute
 * without waiting for AI inference. All open-ended questions, scene checks, reading,
 * locating, memory queries, and follow-ups return null and flow to Gemini AI.
 */
export function parseDirectSessionControl(rawText: string): DirectSessionControlAction {
  const cleaned = rawText
    .trim()
    .replace(/^(?:hey|okay|ok)\s*,?\s*(?:sentra|centra|sendra)\b[\s,.:;!?-]*/i, '')
    .replace(/[?.!,]+$/g, '')
    .trim()
    .toLowerCase();

  if (!cleaned) return null;

  if (
    /^(?:stop sentra|end sentra|end session|stop session|shut down sentra|turn off sentra|quit sentra|exit sentra)$/i.test(
      cleaned
    )
  ) {
    return 'stop_session';
  }

  if (
    /^(?:cancel this task|cancel task|cancel finding|stop finding|stop guiding|stop this task|cancel search|stop search|never mind|nevermind|forget it|abort task)$/i.test(
      cleaned
    )
  ) {
    return 'cancel_task';
  }

  if (/^(?:repeat|repeat that|say that again|say again|what did you say|pardon)$/i.test(cleaned)) {
    return 'repeat';
  }

  if (/^(?:stop|be quiet|quiet|silence|stop talking|stop speaking|pause|shh|mute)$/i.test(cleaned)) {
    return 'stop_speaking';
  }

  return null;
}

export interface FrameVisibilityAssessment {
  usable: boolean;
  issue: 'too_dark' | 'too_blurry' | null;
  spokenGuidance: string | null;
}

/**
 * Evaluates local optical frame quality so SENTRA pauses movement guidance
 * instead of giving directions from an unusable dark or severely blurred frame.
 */
export function assessFrameVisibility(quality: FrameQuality | null): FrameVisibilityAssessment {
  if (!quality) {
    return { usable: true, issue: null, spokenGuidance: null };
  }
  if (quality.brightness < 0.09) {
    return {
      usable: false,
      issue: 'too_dark',
      spokenGuidance:
        'The camera image is too dark to see clearly. Pausing guidance. Turn on a light or aim toward a brighter area.',
    };
  }
  if (quality.sharpness < 18) {
    return {
      usable: false,
      issue: 'too_blurry',
      spokenGuidance:
        'The camera image is too blurry to assess safely. Pausing guidance. Hold the camera steady for a moment.',
    };
  }
  return { usable: true, issue: null, spokenGuidance: null };
}

function normalizeSentenceForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prevents repetitive, distracting narration during active continuing tasks.
 * Speaks only when an answer changes meaningfully, a target is newly found or lost,
 * a hazard appears, or enough time has elapsed while searching.
 */
export function shouldSpeakContinuousUpdate(params: {
  nextText: string;
  lastSpokenText: string;
  lastSpokenAt: number;
  now: number;
  foundTarget: boolean;
  targetLostFromView: boolean;
  hasHazard: boolean;
  minRepeatIntervalMs?: number;
}): boolean {
  if (params.hasHazard || params.foundTarget || params.targetLostFromView) {
    return true;
  }
  const normalizedNext = normalizeSentenceForComparison(params.nextText);
  const normalizedLast = normalizeSentenceForComparison(params.lastSpokenText);
  if (!normalizedNext) return false;
  if (normalizedNext !== normalizedLast) return true;
  const minInterval = params.minRepeatIntervalMs ?? 18000;
  return params.now - params.lastSpokenAt >= minInterval;
}

/**
 * Computes a single unified session phase so visual state, screen-reader cues,
 * and controls stay completely synchronized across mobile and wearable modes.
 */
export function deriveUnifiedSessionPhase(params: {
  sessionActive: boolean;
  isStartingSession: boolean;
  isSwitchingSource: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  voiceState: VoiceAssistantState;
  activeGoal: GoalTask | null;
  hasBlockingError: boolean;
  wakeWordSupported: boolean;
}): UnifiedPhaseDisplay {
  if (params.isSwitchingSource) {
    return {
      phase: 'switching_source',
      label: 'Switching Camera',
      detail: 'Pausing visual guidance while connecting the selected camera source.',
    };
  }
  if (params.isStartingSession) {
    return {
      phase: 'starting',
      label: 'Starting Sentra',
      detail: 'Connecting camera and microphone permissions.',
    };
  }
  if (!params.sessionActive) {
    return {
      phase: 'idle',
      label: 'Ready to Start',
      detail: 'Press Start Sentra to begin observing and listening.',
    };
  }
  if (params.hasBlockingError) {
    return {
      phase: 'error',
      label: 'Attention Needed',
      detail: 'Check camera, microphone, or connection notice below.',
    };
  }
  if (params.isProcessing) {
    return {
      phase: 'thinking',
      label: 'Thinking',
      detail: 'Checking the current camera view and your question.',
    };
  }
  if (params.isSpeaking) {
    return {
      phase: 'speaking',
      label: 'Speaking',
      detail: 'Say Stop to interrupt, or ask a follow-up right after.',
    };
  }
  if (params.voiceState === 'command_listening') {
    return {
      phase: 'hearing',
      label: 'Listening to You',
      detail: 'Speak your question naturally.',
    };
  }
  if (
    params.activeGoal &&
    (params.activeGoal.state === 'active' || params.activeGoal.state === 'need_observation')
  ) {
    const target = params.activeGoal.targetObject || params.activeGoal.intent;
    return {
      phase: 'guiding',
      label: 'Guiding',
      detail: `Active task: ${target}. Say "Cancel this task" to stop guiding.`,
    };
  }
  if (params.voiceState === 'wake_listening') {
    return {
      phase: 'listening',
      label: 'Listening',
      detail: 'Say "Hey Sentra" followed by any question, or tap the microphone.',
    };
  }
  return {
    phase: 'listening',
    label: params.wakeWordSupported ? 'Session Active' : 'Tap to Talk Ready',
    detail: params.wakeWordSupported
      ? 'Tap the microphone to talk, or enable "Hey Sentra" listening.'
      : 'Tap the microphone button to speak, or type a question below.',
  };
}
