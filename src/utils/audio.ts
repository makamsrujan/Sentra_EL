// Audio cue chimes and controlled single-queue speech synthesis utilities for SENTRA

let audioCtx: AudioContext | null = null;
let audioMuted = false;
let audioVolume = 0.9;
let activeSpeechToken = 0;
let activeEndSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let speakingState = false;
const speakingListeners = new Set<(speaking: boolean) => void>();

function notifySpeakingState(next: boolean) {
  if (speakingState === next) return;
  speakingState = next;
  speakingListeners.forEach((listener) => {
    try {
      listener(next);
    } catch {}
  });
}

export function subscribeSpeakingState(listener: (speaking: boolean) => void): () => void {
  speakingListeners.add(listener);
  return () => {
    speakingListeners.delete(listener);
  };
}

export function setAudioConfig(config: { muted?: boolean; volume?: number }) {
  if (typeof config.muted === 'boolean') {
    audioMuted = config.muted;
    if (audioMuted) {
      stopSpeaking();
    }
  }
  if (typeof config.volume === 'number' && Number.isFinite(config.volume)) {
    audioVolume = Math.max(0, Math.min(1, config.volume));
    if (audioVolume === 0) {
      stopSpeaking();
    }
  }
}

export function getAudioConfig(): { muted: boolean; volume: number } {
  return { muted: audioMuted, volume: audioVolume };
}

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Play pleasant auditory feedback chimes for key assistant events
 */
export function playChime(type: 'start_listen' | 'stop_listen' | 'found' | 'hazard' | 'capture') {
  if (audioMuted || audioVolume <= 0.01) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const volScale = audioVolume;
    const now = ctx.currentTime;

    if (type === 'start_listen') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.08 * volScale, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'stop_listen') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0.06 * volScale, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'found') {
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(freq, now + idx * 0.08);
        g.gain.setValueAtTime(0.07 * volScale, now + idx * 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + idx * 0.08);
        o.stop(now + idx * 0.08 + 0.3);
      });
    } else if (type === 'hazard') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.12 * volScale, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'capture') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.04 * volScale, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  } catch {
    // Ignore audio context errors
  }
}

export interface SpeakOptions {
  rate?: number;
  volume?: number;
  force?: boolean;
  onEnd?: () => void;
  onError?: (reason: string) => void;
}

/**
 * Controlled single-queue Text-to-Speech using window.speechSynthesis.
 * Respects mute/volume configuration, cancels overlapping utterances cleanly,
 * and reliably notifies listeners when speaking starts and ends.
 */
export function speakText(
  text: string,
  rateOrOptions: number | SpeakOptions = 1.05,
  legacyOnEnd?: () => void
) {
  const opts: SpeakOptions =
    typeof rateOrOptions === 'number'
      ? { rate: rateOrOptions, onEnd: legacyOnEnd }
      : { ...rateOrOptions, onEnd: rateOrOptions.onEnd ?? legacyOnEnd };

  const cleanText = text?.trim() || '';
  if (!cleanText) {
    opts.onEnd?.();
    return;
  }

  if (!opts.force && (audioMuted || (opts.volume ?? audioVolume) <= 0.01)) {
    opts.onEnd?.();
    return;
  }

  if (typeof window === 'undefined' || !window.speechSynthesis) {
    opts.onError?.('Speech synthesis is unavailable in this browser.');
    opts.onEnd?.();
    return;
  }

  try {
    activeSpeechToken += 1;
    const token = activeSpeechToken;
    if (activeEndSafetyTimer) {
      clearTimeout(activeEndSafetyTimer);
      activeEndSafetyTimer = null;
    }

    window.speechSynthesis.cancel();

    const rate = opts.rate ?? 1.05;
    const volume = Math.max(0, Math.min(1, opts.volume ?? audioVolume));

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.volume = volume;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
      voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Natural') ||
            v.name.includes('Neural') ||
            v.name.includes('Google') ||
            v.name.includes('Siri'))
      ) || voices.find((v) => v.lang.startsWith('en'));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    let finished = false;
    const finalize = (errorMsg?: string) => {
      if (finished) return;
      finished = true;
      if (activeEndSafetyTimer) {
        clearTimeout(activeEndSafetyTimer);
        activeEndSafetyTimer = null;
      }
      if (token === activeSpeechToken) {
        notifySpeakingState(false);
      }
      if (errorMsg) {
        opts.onError?.(errorMsg);
      }
      opts.onEnd?.();
    };

    utterance.onstart = () => {
      if (token === activeSpeechToken) {
        notifySpeakingState(true);
      }
    };

    utterance.onend = () => finalize();
    utterance.onerror = (ev) => {
      const errCode = (ev as any)?.error;
      if (errCode && errCode !== 'canceled' && errCode !== 'interrupted') {
        finalize(`Speech output error: ${errCode}`);
      } else {
        finalize();
      }
    };

    // Safety ceiling timeout in case mobile browsers fail to dispatch utterance.onend
    const wordCount = cleanText.split(/\s+/).length;
    const estimatedMs = Math.max(2500, Math.min(35000, Math.round((wordCount / (2.2 * rate)) * 1000) + 2500));
    activeEndSafetyTimer = setTimeout(() => {
      if (!finished && token === activeSpeechToken && !window.speechSynthesis.speaking) {
        finalize();
      }
    }, estimatedMs);

    notifySpeakingState(true);
    window.speechSynthesis.speak(utterance);
  } catch (err: any) {
    notifySpeakingState(false);
    opts.onError?.(err?.message || 'SpeechSynthesis error');
    opts.onEnd?.();
  }
}

export function stopSpeaking() {
  activeSpeechToken += 1;
  if (activeEndSafetyTimer) {
    clearTimeout(activeEndSafetyTimer);
    activeEndSafetyTimer = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  notifySpeakingState(false);
}

export function isSpeaking(): boolean {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    return speakingState || window.speechSynthesis.speaking;
  }
  return speakingState;
}
