import { describe, expect, it } from 'vitest';
import {
  assessFrameVisibility,
  deriveUnifiedSessionPhase,
  parseDirectSessionControl,
  shouldSpeakContinuousUpdate,
} from '../src/utils/sessionControls';
import type { GoalTask } from '../src/types/sentra';

describe('parseDirectSessionControl', () => {
  it('recognizes explicit Stop Sentra session termination phrases', () => {
    expect(parseDirectSessionControl('Stop Sentra')).toBe('stop_session');
    expect(parseDirectSessionControl('Hey Sentra, stop Sentra.')).toBe('stop_session');
    expect(parseDirectSessionControl('end session')).toBe('stop_session');
    expect(parseDirectSessionControl('shut down sentra')).toBe('stop_session');
  });

  it('recognizes Cancel this task phrases separately from ending the session', () => {
    expect(parseDirectSessionControl('Cancel this task')).toBe('cancel_task');
    expect(parseDirectSessionControl('Hey Sentra, cancel this task!')).toBe('cancel_task');
    expect(parseDirectSessionControl('stop finding')).toBe('cancel_task');
    expect(parseDirectSessionControl('never mind')).toBe('cancel_task');
  });

  it('recognizes Repeat and Stop speaking meta-controls', () => {
    expect(parseDirectSessionControl('Repeat')).toBe('repeat');
    expect(parseDirectSessionControl('Hey Sentra, say that again?')).toBe('repeat');
    expect(parseDirectSessionControl('Stop')).toBe('stop_speaking');
    expect(parseDirectSessionControl('Stop talking')).toBe('stop_speaking');
  });

  it('does NOT intercept open-ended user questions or follow-ups', () => {
    const openQuestions = [
      'Find my bottle',
      'Help me find the TV remote',
      'Get me the remote',
      'Is the door open?',
      'What is in front of me?',
      'Read this label',
      'Where did I leave my keys?',
      'What do you mean?',
      'Hey Sentra, can you see my mug on the counter?',
      'Stop the microwave? Wait is the timer done?',
    ];

    for (const question of openQuestions) {
      expect(parseDirectSessionControl(question)).toBeNull();
    }
  });
});

describe('assessFrameVisibility', () => {
  it('returns usable=false with honest pause guidance when image is too dark', () => {
    const res = assessFrameVisibility({
      brightness: 0.04,
      sharpness: 60,
    });
    expect(res.usable).toBe(false);
    expect(res.issue).toBe('too_dark');
    expect(res.spokenGuidance).toMatch(/too dark/i);
    expect(res.spokenGuidance).toMatch(/pausing guidance/i);
  });

  it('returns usable=false with honest pause guidance when image is severely blurry', () => {
    const res = assessFrameVisibility({
      brightness: 0.45,
      sharpness: 8,
    });
    expect(res.usable).toBe(false);
    expect(res.issue).toBe('too_blurry');
    expect(res.spokenGuidance).toMatch(/too blurry/i);
    expect(res.spokenGuidance).toMatch(/pausing guidance/i);
  });

  it('returns usable=true for adequate lighting and sharpness or null quality', () => {
    expect(assessFrameVisibility(null).usable).toBe(true);
    expect(
      assessFrameVisibility({
        brightness: 0.5,
        sharpness: 95,
      }).usable
    ).toBe(true);
  });
});

describe('shouldSpeakContinuousUpdate', () => {
  it('suppresses duplicate narration within the quiet interval', () => {
    const speak = shouldSpeakContinuousUpdate({
      nextText: 'I cannot see it yet. Slowly pan right.',
      lastSpokenText: 'I cannot see it yet. Slowly pan right!',
      lastSpokenAt: 10000,
      now: 15000,
      foundTarget: false,
      targetLostFromView: false,
      hasHazard: false,
    });
    expect(speak).toBe(false);
  });

  it('speaks immediately when instruction meaningfully changes', () => {
    const speak = shouldSpeakContinuousUpdate({
      nextText: 'I see a bottle on the table to your right.',
      lastSpokenText: 'I cannot see it yet. Slowly pan right.',
      lastSpokenAt: 10000,
      now: 14000,
      foundTarget: false,
      targetLostFromView: false,
      hasHazard: false,
    });
    expect(speak).toBe(true);
  });

  it('always speaks when target is found, target is lost from view, or a hazard occurs', () => {
    const base = {
      nextText: 'Same message',
      lastSpokenText: 'Same message',
      lastSpokenAt: 10000,
      now: 11000,
      foundTarget: false,
      targetLostFromView: false,
      hasHazard: false,
    };

    expect(shouldSpeakContinuousUpdate({ ...base, foundTarget: true })).toBe(true);
    expect(shouldSpeakContinuousUpdate({ ...base, targetLostFromView: true })).toBe(true);
    expect(shouldSpeakContinuousUpdate({ ...base, hasHazard: true })).toBe(true);
  });
});

describe('deriveUnifiedSessionPhase', () => {
  const sampleGoal: GoalTask = {
    id: 'goal-1',
    intent: 'Find my bottle',
    targetObject: 'bottle',
    state: 'active',
    confidence: 0.7,
    createdAt: 1000,
    updatedAt: 1000,
    history: [],
    verificationSteps: [],
  };

  it('reflects idle, starting, switching_source, error, thinking, speaking, guiding, and listening phases', () => {
    expect(
      deriveUnifiedSessionPhase({
        sessionActive: false,
        isStartingSession: false,
        isSwitchingSource: false,
        isProcessing: false,
        isSpeaking: false,
        voiceState: 'disabled',
        activeGoal: null,
        hasBlockingError: false,
        wakeWordSupported: true,
      }).phase
    ).toBe('idle');

    expect(
      deriveUnifiedSessionPhase({
        sessionActive: true,
        isStartingSession: false,
        isSwitchingSource: true,
        isProcessing: false,
        isSpeaking: false,
        voiceState: 'wake_listening',
        activeGoal: sampleGoal,
        hasBlockingError: false,
        wakeWordSupported: true,
      }).phase
    ).toBe('switching_source');

    expect(
      deriveUnifiedSessionPhase({
        sessionActive: true,
        isStartingSession: false,
        isSwitchingSource: false,
        isProcessing: true,
        isSpeaking: false,
        voiceState: 'wake_listening',
        activeGoal: sampleGoal,
        hasBlockingError: false,
        wakeWordSupported: true,
      }).phase
    ).toBe('thinking');

    expect(
      deriveUnifiedSessionPhase({
        sessionActive: true,
        isStartingSession: false,
        isSwitchingSource: false,
        isProcessing: false,
        isSpeaking: true,
        voiceState: 'wake_listening',
        activeGoal: sampleGoal,
        hasBlockingError: false,
        wakeWordSupported: true,
      }).phase
    ).toBe('speaking');

    expect(
      deriveUnifiedSessionPhase({
        sessionActive: true,
        isStartingSession: false,
        isSwitchingSource: false,
        isProcessing: false,
        isSpeaking: false,
        voiceState: 'wake_listening',
        activeGoal: sampleGoal,
        hasBlockingError: false,
        wakeWordSupported: true,
      }).phase
    ).toBe('guiding');

    expect(
      deriveUnifiedSessionPhase({
        sessionActive: true,
        isStartingSession: false,
        isSwitchingSource: false,
        isProcessing: false,
        isSpeaking: false,
        voiceState: 'wake_listening',
        activeGoal: null,
        hasBlockingError: false,
        wakeWordSupported: true,
      }).phase
    ).toBe('listening');

    expect(
      deriveUnifiedSessionPhase({
        sessionActive: true,
        isStartingSession: false,
        isSwitchingSource: false,
        isProcessing: false,
        isSpeaking: false,
        voiceState: 'disabled',
        activeGoal: null,
        hasBlockingError: true,
        wakeWordSupported: false,
      }).phase
    ).toBe('error');
  });
});
