import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playChime } from '../utils/audio';

export type VoiceAssistantState =
  | 'disabled'
  | 'starting'
  | 'wake_listening'
  | 'command_listening'
  | 'processing'
  | 'speaking'
  | 'permission_blocked'
  | 'unsupported'
  | 'error';

export type VoiceListenMode = 'idle' | 'wake' | 'command' | 'ptt' | 'mic_test';
export type RecognitionPhase = 'idle' | 'starting' | 'active';

export type VoiceErrorType =
  | 'unsupported'
  | 'permission_denied'
  | 'blocked_by_embed'
  | 'https_required'
  | 'mic_disconnected'
  | 'network'
  | 'service_not_allowed'
  | null;

export interface WakeParseResult {
  detected: boolean;
  command: string;
  isInterrupt: boolean;
}

export interface VoiceCompatibilityInfo {
  speechRecognitionSupported: boolean;
  speechSynthesisSupported: boolean;
  isMobile: boolean;
  isIOS: boolean;
  foregroundWakeSupported: boolean;
  modeSummary: string;
  limitationNote: string;
}

const INTERRUPT_REGEX = /\b(stop|cancel|never mind|be quiet|stop talking|stop speaking|pause)\b/i;
const WAKE_PHRASE_REGEX =
  /\b(?:hey|okay|ok)\s*,?\s*(?:sentra|centra|sendra)\b[\s,.:;!?-]*(.*)$/i;

/**
 * Pure parser that detects "Hey SENTRA" wake phrases across full or multi-segment transcripts,
 * extracts any inline command, and recognizes interruption commands ("Stop", "Cancel", "Be quiet").
 */
export function extractWakePhraseCommand(transcript: string): WakeParseResult {
  const clean = transcript.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return { detected: false, command: '', isInterrupt: false };
  }

  const wakeMatch = clean.match(WAKE_PHRASE_REGEX);
  if (wakeMatch) {
    const trailing = (wakeMatch[1] || '').trim();
    const isInterrupt = Boolean(
      trailing && INTERRUPT_REGEX.test(trailing) && trailing.split(/\s+/).length <= 4
    );
    return {
      detected: true,
      command: trailing,
      isInterrupt,
    };
  }

  if (INTERRUPT_REGEX.test(clean) && clean.split(/\s+/).length <= 5) {
    return {
      detected: false,
      command: clean,
      isInterrupt: true,
    };
  }

  return {
    detected: false,
    command: '',
    isInterrupt: false,
  };
}

/**
 * Combines segments from SpeechRecognitionEvent.results starting at `offsetIndex`
 * so phrases split across multiple result segments ("Hey" + "SENTRA, what is around me?") still match reliably.
 */
export function combineResultSegments(
  results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }>,
  offsetIndex = 0
): { fullText: string; latestSegmentFinal: boolean } {
  const pieces: string[] = [];
  let latestSegmentFinal = false;
  const start = Math.max(0, offsetIndex);
  for (let i = start; i < results.length; i++) {
    const item = results[i];
    const txt = (item?.[0]?.transcript || '').trim();
    if (txt) pieces.push(txt);
    latestSegmentFinal = Boolean(item?.isFinal);
  }
  return {
    fullText: pieces.join(' ').replace(/\s+/g, ' ').trim(),
    latestSegmentFinal,
  };
}

export function deriveVoiceAssistantState(params: {
  speechRecognitionSupported: boolean;
  voiceErrorType: VoiceErrorType;
  isProcessing: boolean;
  isSpeaking: boolean;
  listenMode: VoiceListenMode;
  recognitionPhase: RecognitionPhase;
  wakeWordEnabled: boolean;
}): VoiceAssistantState {
  if (!params.speechRecognitionSupported) {
    return 'unsupported';
  }
  if (
    params.voiceErrorType === 'permission_denied' ||
    params.voiceErrorType === 'blocked_by_embed' ||
    params.voiceErrorType === 'https_required' ||
    params.voiceErrorType === 'service_not_allowed'
  ) {
    return 'permission_blocked';
  }
  if (params.voiceErrorType) {
    return 'error';
  }
  if (params.isProcessing) {
    return 'processing';
  }
  if (params.isSpeaking) {
    return 'speaking';
  }
  if (params.listenMode === 'command' || params.listenMode === 'ptt') {
    return params.recognitionPhase === 'active' ? 'command_listening' : 'starting';
  }
  if (params.listenMode === 'wake') {
    // Never claim wake_listening until onstart actually fires ('active')
    return params.recognitionPhase === 'active' ? 'wake_listening' : 'starting';
  }
  if (params.listenMode === 'mic_test') {
    return params.recognitionPhase === 'active' ? 'command_listening' : 'starting';
  }
  return params.wakeWordEnabled ? 'disabled' : 'disabled';
}

export function classifySpeechError(
  errorCode: string,
  env: {
    isSecureContext: boolean;
    isEmbedded: boolean;
    permissionsPolicyBlocked: boolean;
    isOnline?: boolean;
  } = { isSecureContext: true, isEmbedded: false, permissionsPolicyBlocked: false }
): { type: VoiceErrorType; message: string; fatalForLoop: boolean } {
  const code = (errorCode || '').toLowerCase();

  if (code === 'no-speech' || code === 'aborted') {
    return { type: null, message: '', fatalForLoop: false };
  }

  if (code === 'not-allowed') {
    if (!env.isSecureContext) {
      return {
        type: 'https_required',
        message: 'Microphone speech recognition requires HTTPS or localhost.',
        fatalForLoop: true,
      };
    }
    if (env.permissionsPolicyBlocked) {
      return {
        type: 'blocked_by_embed',
        message:
          'Microphone access is blocked by this embedded preview Permissions Policy. Open SENTRA directly in a top-level HTTPS tab.',
        fatalForLoop: true,
      };
    }
    return {
      type: 'permission_denied',
      message:
        'Microphone permission was denied. Allow microphone access in browser settings and tap Restart Mic.',
      fatalForLoop: true,
    };
  }

  if (code === 'service-not-allowed') {
    return {
      type: 'service_not_allowed',
      message:
        'Browser speech recognition service is disabled or restricted on this device. Use Hold to Talk or typed input if available.',
      fatalForLoop: true,
    };
  }

  if (code === 'audio-capture') {
    return {
      type: 'mic_disconnected',
      message: 'No active microphone was detected or it is busy in another app.',
      fatalForLoop: true,
    };
  }

  if (code === 'network') {
    const offline =
      env.isOnline === false ||
      (typeof navigator !== 'undefined' && navigator.onLine === false);
    return {
      type: 'network',
      message: offline
        ? 'Browser appears offline. Speech recognition needs network connectivity; typed input remains available.'
        : 'Speech recognition requires network connectivity to the browser speech service.',
      fatalForLoop: true,
    };
  }

  return {
    type: 'network',
    message: `Speech recognition stopped (${errorCode || 'unknown error'}).`,
    fatalForLoop: true,
  };
}

export function getVoiceCompatibilityInfo(): VoiceCompatibilityInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      speechRecognitionSupported: false,
      speechSynthesisSupported: false,
      isMobile: false,
      isIOS: false,
      foregroundWakeSupported: false,
      modeSummary: 'Browser environment unavailable',
      limitationNote: 'Web Speech API runs only in interactive browser sessions.',
    };
  }

  const speechRecognitionSupported = Boolean(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
  const speechSynthesisSupported = Boolean(window.speechSynthesis);
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isIOS || /Android|Mobile/i.test(ua);

  const foregroundWakeSupported = speechRecognitionSupported && !isIOS;

  let modeSummary = 'Speech recognition unavailable — use typed input';
  if (speechRecognitionSupported && isIOS) {
    modeSummary = 'Hold-to-Talk supported (iOS Safari limits continuous wake loops)';
  } else if (speechRecognitionSupported && isMobile) {
    modeSummary = 'Foreground "Hey SENTRA" & Hold-to-Talk supported while app is open';
  } else if (speechRecognitionSupported) {
    modeSummary = 'Foreground "Hey SENTRA" & Hold-to-Talk supported in active tab';
  }

  return {
    speechRecognitionSupported,
    speechSynthesisSupported,
    isMobile,
    isIOS,
    foregroundWakeSupported,
    modeSummary,
    limitationNote:
      'Web apps can only listen for "Hey SENTRA" in an open foreground tab with microphone permission. Screen-off or OS background wake-word requires a native Android/iOS app.',
  };
}

interface UseVoiceAssistantOptions {
  wakeWordEnabled: boolean;
  onWakeWordEnabledChange: (enabled: boolean) => void;
  audioFeedback: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  onCommand: (commandText: string) => void | Promise<void>;
  onInterrupt: (interruptText?: string) => void;
  onUnsupportedFallback?: () => void;
}

export function useVoiceAssistant({
  wakeWordEnabled,
  onWakeWordEnabledChange,
  audioFeedback,
  isProcessing,
  isSpeaking,
  onCommand,
  onInterrupt,
  onUnsupportedFallback,
}: UseVoiceAssistantOptions) {
  const [listenMode, setListenMode] = useState<VoiceListenMode>('idle');
  const [recognitionPhase, setRecognitionPhase] = useState<RecognitionPhase>('idle');
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [voiceErrorType, setVoiceErrorType] = useState<VoiceErrorType>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [wakeActivatedNotice, setWakeActivatedNotice] = useState(false);

  // Explicit microphone recognition test state
  const [micTestActive, setMicTestActive] = useState(false);
  const [micTestTranscript, setMicTestTranscript] = useState<string>('');
  const [micTestError, setMicTestError] = useState<string | null>(null);

  const compatibility = useMemo(() => getVoiceCompatibilityInfo(), []);

  const recognitionRef = useRef<any>(null);
  const sessionIdRef = useRef<number>(0);
  const listenModeRef = useRef<VoiceListenMode>('idle');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineCommandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeOffsetRef = useRef<number>(0);

  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  wakeWordEnabledRef.current = wakeWordEnabled;
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;
  const audioFeedbackRef = useRef(audioFeedback);
  audioFeedbackRef.current = audioFeedback;

  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;
  const onUnsupportedFallbackRef = useRef(onUnsupportedFallback);
  onUnsupportedFallbackRef.current = onUnsupportedFallback;

  const lastSubmittedRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const pttCapturedRef = useRef<string>('');
  const rapidEmptyRestartsRef = useRef<number>(0);
  const lastSessionStartRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );

  const setMode = useCallback((next: VoiceListenMode) => {
    listenModeRef.current = next;
    setListenMode(next);
  }, []);

  const clearAllTimers = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (commandTimeoutRef.current) {
      clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = null;
    }
    if (wakeSettleTimerRef.current) {
      clearTimeout(wakeSettleTimerRef.current);
      wakeSettleTimerRef.current = null;
    }
    if (inlineCommandTimerRef.current) {
      clearTimeout(inlineCommandTimerRef.current);
      inlineCommandTimerRef.current = null;
    }
  }, []);

  const cleanupRecognition = useCallback(() => {
    sessionIdRef.current += 1;
    clearAllTimers();
    setRecognitionPhase('idle');
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onstart = null;
        rec.abort?.();
      } catch {
        try {
          rec.stop?.();
        } catch {}
      }
    }
  }, [clearAllTimers]);

  const getMicEnvironmentFlags = () => {
    const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : true;
    const isEmbedded =
      typeof window !== 'undefined'
        ? (() => {
            try {
              return window.self !== window.top;
            } catch {
              return true;
            }
          })()
        : false;
    let permissionsPolicyBlocked = false;
    try {
      const policy = (document as any).permissionsPolicy || (document as any).featurePolicy;
      if (policy && typeof policy.allowsFeature === 'function') {
        permissionsPolicyBlocked = policy.allowsFeature('microphone') === false;
      }
    } catch {}
    return { isSecureContext, isEmbedded, permissionsPolicyBlocked };
  };

  const submitTranscriptOnce = useCallback((rawText: string) => {
    const clean = rawText.trim();
    if (!clean) return;
    const now = Date.now();
    if (
      lastSubmittedRef.current.text.toLowerCase() === clean.toLowerCase() &&
      now - lastSubmittedRef.current.at < 2000
    ) {
      return;
    }
    lastSubmittedRef.current = { text: clean, at: now };
    onCommandRef.current(clean);
  }, []);

  const flashWakeActivated = useCallback(() => {
    setWakeActivatedNotice(true);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setWakeActivatedNotice(false), 2600);
  }, []);

  const startSession = useCallback(
    (targetMode: Exclude<VoiceListenMode, 'idle'>) => {
      const SpeechRecognitionClass =
        typeof window !== 'undefined'
          ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
          : null;

      if (!SpeechRecognitionClass) {
        setVoiceErrorType('unsupported');
        setVoiceError(
          'Web Speech Recognition is not supported in this browser. Use typed input below.'
        );
        if (targetMode === 'mic_test') {
          setMicTestActive(false);
          setMicTestError('Web Speech Recognition is not supported in this browser.');
        }
        setMode('idle');
        onUnsupportedFallbackRef.current?.();
        return false;
      }

      if (targetMode === 'wake' && !isVisibleRef.current) {
        setMode('idle');
        setRecognitionPhase('idle');
        return false;
      }

      const env = getMicEnvironmentFlags();
      if (!env.isSecureContext) {
        const msg = 'Microphone access requires HTTPS or localhost.';
        setVoiceErrorType('https_required');
        setVoiceError(msg);
        if (targetMode === 'mic_test') {
          setMicTestActive(false);
          setMicTestError(msg);
        }
        setMode('idle');
        return false;
      }
      if (env.permissionsPolicyBlocked) {
        const msg = 'Microphone is blocked by this embedded preview Permissions Policy.';
        setVoiceErrorType('blocked_by_embed');
        setVoiceError(msg);
        if (targetMode === 'mic_test') {
          setMicTestActive(false);
          setMicTestError(msg);
        }
        setMode('idle');
        return false;
      }

      cleanupRecognition();

      const mySessionId = sessionIdRef.current;
      try {
        const rec = new SpeechRecognitionClass();
        rec.lang = navigator.language || 'en-US';
        rec.continuous = targetMode === 'wake' || targetMode === 'mic_test';
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        recognitionRef.current = rec;
        pttCapturedRef.current = '';
        wakeOffsetRef.current = 0;
        lastSessionStartRef.current = Date.now();
        setMode(targetMode);
        setRecognitionPhase('starting');
        setVoiceError(null);
        setVoiceErrorType(null);

        if (targetMode === 'mic_test') {
          setMicTestActive(true);
          setMicTestError(null);
          setMicTestTranscript('');
        } else {
          setMicTestActive(false);
        }

        // Do not start the command timeout before the browser has actually
        // started recognition (permission prompts can take several seconds).
        if ((targetMode === 'command' || targetMode === 'ptt') && audioFeedbackRef.current) {
          playChime('start_listen');
        }

        rec.onstart = () => {
          if (sessionIdRef.current !== mySessionId) return;
          lastSessionStartRef.current = Date.now();
          setRecognitionPhase('active');
          if (targetMode === 'command') {
            commandTimeoutRef.current = setTimeout(() => {
              if (sessionIdRef.current !== mySessionId) return;
              cleanupRecognition();
              setLiveTranscript('');
              if (audioFeedbackRef.current) {
                playChime('stop_listen');
              }
              setMode('idle');
            }, 8000);
          }
        };

        rec.onresult = (event: any) => {
          if (sessionIdRef.current !== mySessionId) return;

          if (targetMode === 'mic_test') {
            const combined = combineResultSegments(event.results, 0);
            if (combined.fullText) {
              setMicTestTranscript(combined.fullText);
            }
            return;
          }

          // Never allow assistant speech output to self-trigger wake recognition
          if (targetMode === 'wake' && isSpeakingRef.current) {
            return;
          }

          const offset = targetMode === 'wake' ? wakeOffsetRef.current : 0;
          const { fullText: latestText, latestSegmentFinal } = combineResultSegments(
            event.results,
            offset
          );

          if (!latestText) return;
          rapidEmptyRestartsRef.current = 0;

          if (targetMode === 'ptt') {
            pttCapturedRef.current = latestText;
            setLiveTranscript(latestText);
            if (latestSegmentFinal) {
              cleanupRecognition();
              setMode('idle');
              setLiveTranscript('');
              submitTranscriptOnce(latestText);
            }
            return;
          }

          if (targetMode === 'command') {
            setLiveTranscript(latestText);
            if (latestSegmentFinal) {
              cleanupRecognition();
              setMode('idle');
              setLiveTranscript('');
              const wakeCheck = extractWakePhraseCommand(latestText);
              if (wakeCheck.isInterrupt) {
                onInterruptRef.current(wakeCheck.command || latestText);
              } else {
                submitTranscriptOnce(
                  wakeCheck.detected && wakeCheck.command ? wakeCheck.command : latestText
                );
              }
            }
            return;
          }

          // targetMode === 'wake'
          const parsed = extractWakePhraseCommand(latestText);
          if (parsed.isInterrupt) {
            wakeOffsetRef.current = event.results.length;
            cleanupRecognition();
            setMode('idle');
            setLiveTranscript('');
            onInterruptRef.current(parsed.command || latestText);
            return;
          }

          // Allow short standalone "Repeat" / "Say that again" without requiring wake word
          if (
            !parsed.detected &&
            latestSegmentFinal &&
            /^(?:repeat|repeat that|say that again|say again)$/i.test(latestText.trim())
          ) {
            wakeOffsetRef.current = event.results.length;
            cleanupRecognition();
            setMode('idle');
            setLiveTranscript('');
            submitTranscriptOnce(latestText.trim());
            return;
          }

          if (parsed.detected) {
            flashWakeActivated();
            setLiveTranscript(parsed.command ? parsed.command : 'Hey SENTRA…');

            if (wakeSettleTimerRef.current) {
              clearTimeout(wakeSettleTimerRef.current);
              wakeSettleTimerRef.current = null;
            }
            if (inlineCommandTimerRef.current) {
              clearTimeout(inlineCommandTimerRef.current);
              inlineCommandTimerRef.current = null;
            }

            if (parsed.command) {
              const capturedCmd = parsed.command;
              if (latestSegmentFinal) {
                wakeOffsetRef.current = event.results.length;
                cleanupRecognition();
                setMode('idle');
                setLiveTranscript('');
                if (audioFeedbackRef.current) {
                  playChime('start_listen');
                }
                submitTranscriptOnce(capturedCmd);
                return;
              }

              // Wait 1250ms after the last interim change before submitting so full questions
              // ("Hey SENTRA, what is around me?" / "Hey SENTRA, find my bottle") aren't clipped
              inlineCommandTimerRef.current = setTimeout(() => {
                if (sessionIdRef.current !== mySessionId) return;
                wakeOffsetRef.current = event.results.length;
                cleanupRecognition();
                setMode('idle');
                setLiveTranscript('');
                if (audioFeedbackRef.current) {
                  playChime('start_listen');
                }
                submitTranscriptOnce(capturedCmd);
              }, 1250);
              return;
            }

            // User said standalone "Hey SENTRA" without trailing command yet
            if (latestSegmentFinal) {
              wakeOffsetRef.current = event.results.length;
              cleanupRecognition();
              setLiveTranscript('');
              startSession('command');
            } else {
              // Give 900ms in case user continues speaking "...what is around me?" in the next interim chunk
              wakeSettleTimerRef.current = setTimeout(() => {
                if (sessionIdRef.current !== mySessionId) return;
                wakeOffsetRef.current = event.results.length;
                cleanupRecognition();
                setLiveTranscript('');
                startSession('command');
              }, 900);
            }
          } else if (latestSegmentFinal && event.results.length - wakeOffsetRef.current > 8) {
            // Keep sliding buffer compact during long quiet/ambient chatter
            wakeOffsetRef.current = Math.max(0, event.results.length - 2);
          }
        };

        rec.onerror = (ev: any) => {
          if (sessionIdRef.current !== mySessionId) return;
          const classified = classifySpeechError(ev?.error || '', env);

          if (targetMode === 'mic_test') {
            if (classified.type) {
              cleanupRecognition();
              setMode('idle');
              setMicTestActive(false);
              setMicTestError(classified.message);
              setVoiceErrorType(classified.type);
              setVoiceError(classified.message);
            }
            return;
          }

          if (classified.fatalForLoop) {
            cleanupRecognition();
            setMode('idle');
            setVoiceErrorType(classified.type);
            setVoiceError(classified.message);
            if (targetMode === 'wake') {
              onWakeWordEnabledChange(false);
            }
          } else {
            // Transient no-speech or aborted
            if (targetMode === 'ptt' || targetMode === 'command') {
              cleanupRecognition();
              setMode('idle');
              setLiveTranscript('');
            }
          }
        };

        rec.onend = () => {
          if (sessionIdRef.current !== mySessionId) return;
          recognitionRef.current = null;
          clearAllTimers();
          setRecognitionPhase('idle');

          if (targetMode === 'mic_test') {
            setMicTestActive(false);
            setMode('idle');
            return;
          }

          if (targetMode === 'ptt') {
            const captured = pttCapturedRef.current.trim();
            pttCapturedRef.current = '';
            setMode('idle');
            setLiveTranscript('');
            if (captured) {
              submitTranscriptOnce(captured);
            }
            return;
          }

          if (targetMode === 'command') {
            setMode('idle');
            setLiveTranscript('');
            return;
          }

          // targetMode === 'wake'
          setMode('idle');
          const uptime = Date.now() - lastSessionStartRef.current;
          if (uptime < 1200) {
            rapidEmptyRestartsRef.current += 1;
          } else {
            rapidEmptyRestartsRef.current = 0;
          }

          if (rapidEmptyRestartsRef.current >= 10) {
            setVoiceErrorType('service_not_allowed');
            setVoiceError(
              'Continuous foreground listening ended repeatedly on this browser. Use Hold to Talk or tap Restart Mic.'
            );
            onWakeWordEnabledChange(false);
            return;
          }

          if (
            wakeWordEnabledRef.current &&
            isVisibleRef.current &&
            !isProcessingRef.current &&
            !isSpeakingRef.current
          ) {
            const backoffMs = Math.min(3000, 350 + rapidEmptyRestartsRef.current * 300);
            restartTimerRef.current = setTimeout(() => {
              if (
                wakeWordEnabledRef.current &&
                isVisibleRef.current &&
                !isProcessingRef.current &&
                !isSpeakingRef.current &&
                listenModeRef.current === 'idle'
              ) {
                startSession('wake');
              }
            }, backoffMs);
          }
        };

        rec.start();
        return true;
      } catch (err: any) {
        cleanupRecognition();
        setMode('idle');
        const msg = err?.message || 'Unable to start speech recognition.';
        setVoiceErrorType('service_not_allowed');
        setVoiceError(msg);
        if (targetMode === 'mic_test') {
          setMicTestActive(false);
          setMicTestError(msg);
        }
        return false;
      }
    },
    [
      cleanupRecognition,
      clearAllTimers,
      flashWakeActivated,
      onWakeWordEnabledChange,
      setMode,
      submitTranscriptOnce,
    ]
  );

  // Explicit user gesture activation for "Hey SENTRA" wake mode
  const enableWakeWord = useCallback(async (): Promise<boolean> => {
    setVoiceError(null);
    setVoiceErrorType(null);
    setMicTestActive(false);

    if (!compatibility.speechRecognitionSupported) {
      setVoiceErrorType('unsupported');
      setVoiceError('Web Speech Recognition is not supported in this browser. Use typed queries below.');
      onUnsupportedFallbackRef.current?.();
      return false;
    }

    const env = getMicEnvironmentFlags();
    if (!env.isSecureContext) {
      setVoiceErrorType('https_required');
      setVoiceError('Microphone listening requires an HTTPS connection or localhost.');
      return false;
    }
    if (env.permissionsPolicyBlocked) {
      setVoiceErrorType('blocked_by_embed');
      setVoiceError('Microphone is blocked inside this embedded preview Permissions Policy.');
      return false;
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((t) => t.stop());
      } catch (err: any) {
        const name = err?.name || '';
        const classified = classifySpeechError(
          name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'audio-capture'
            : 'not-allowed',
          env
        );
        setVoiceErrorType(classified.type);
        setVoiceError(classified.message);
        onWakeWordEnabledChange(false);
        return false;
      }
    }

    rapidEmptyRestartsRef.current = 0;
    onWakeWordEnabledChange(true);
    if (isVisibleRef.current && !isProcessingRef.current && !isSpeakingRef.current) {
      return startSession('wake');
    }
    return true;
  }, [compatibility.speechRecognitionSupported, onWakeWordEnabledChange, startSession]);

  const disableWakeWord = useCallback(() => {
    onWakeWordEnabledChange(false);
    cleanupRecognition();
    setMode('idle');
    setLiveTranscript('');
  }, [cleanupRecognition, onWakeWordEnabledChange, setMode]);

  const restartMicrophone = useCallback(async () => {
    cleanupRecognition();
    setVoiceError(null);
    setVoiceErrorType(null);
    setMicTestError(null);
    rapidEmptyRestartsRef.current = 0;
    if (wakeWordEnabledRef.current) {
      return startSession('wake');
    }
    return enableWakeWord();
  }, [cleanupRecognition, enableWakeWord, startSession]);

  const startPushToTalk = useCallback(() => {
    onInterruptRef.current();
    setVoiceError(null);
    setVoiceErrorType(null);
    return startSession('ptt');
  }, [startSession]);

  const stopPushToTalk = useCallback(() => {
    if (listenModeRef.current !== 'ptt') return;
    const rec = recognitionRef.current;
    if (audioFeedbackRef.current) {
      playChime('stop_listen');
    }
    if (rec) {
      try {
        rec.stop();
      } catch {
        cleanupRecognition();
        setMode('idle');
      }
    } else {
      setMode('idle');
    }
  }, [cleanupRecognition, setMode]);

  const activateCommandWindow = useCallback(() => {
    onInterruptRef.current();
    flashWakeActivated();
    setVoiceError(null);
    setVoiceErrorType(null);
    return startSession('command');
  }, [flashWakeActivated, startSession]);

  const startMicTest = useCallback(async () => {
    onInterruptRef.current();
    setMicTestError(null);
    setMicTestTranscript('');
    setVoiceError(null);
    setVoiceErrorType(null);
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((t) => t.stop());
      } catch (err: any) {
        const env = getMicEnvironmentFlags();
        const name = err?.name || '';
        const classified = classifySpeechError(
          name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'audio-capture'
            : 'not-allowed',
          env
        );
        setMicTestActive(false);
        setMicTestError(classified.message);
        setVoiceErrorType(classified.type);
        setVoiceError(classified.message);
        return false;
      }
    }
    return startSession('mic_test');
  }, [startSession]);

  const stopMicTest = useCallback(() => {
    setMicTestActive(false);
    if (listenModeRef.current === 'mic_test') {
      cleanupRecognition();
      setMode('idle');
    }
  }, [cleanupRecognition, setMode]);

  // Visibility change handler: pause foreground wake recognition when hidden, resume cleanly when visible
  useEffect(() => {
    const handleVisibility = () => {
      const visible = document.visibilityState !== 'hidden';
      isVisibleRef.current = visible;
      if (!visible) {
        if (listenModeRef.current !== 'idle') {
          cleanupRecognition();
          setMode('idle');
          setMicTestActive(false);
        }
      } else if (
        wakeWordEnabledRef.current &&
        !voiceErrorType &&
        !isProcessingRef.current &&
        !isSpeakingRef.current &&
        listenModeRef.current === 'idle' &&
        compatibility.speechRecognitionSupported
      ) {
        setTimeout(() => {
          if (
            wakeWordEnabledRef.current &&
            isVisibleRef.current &&
            !isProcessingRef.current &&
            !isSpeakingRef.current &&
            listenModeRef.current === 'idle'
          ) {
            startSession('wake');
          }
        }, 350);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [cleanupRecognition, compatibility.speechRecognitionSupported, setMode, startSession, voiceErrorType]);

  // Pause wake listening during TTS & Gemini processing, and deterministically resume afterward
  useEffect(() => {
    if (isSpeaking || isProcessing) {
      if (listenModeRef.current === 'wake') {
        cleanupRecognition();
        setMode('idle');
      }
      return;
    }

    if (
      wakeWordEnabled &&
      isVisibleRef.current &&
      !voiceErrorType &&
      listenMode === 'idle' &&
      compatibility.speechRecognitionSupported
    ) {
      const resumeTimer = setTimeout(() => {
        if (
          wakeWordEnabledRef.current &&
          isVisibleRef.current &&
          !isProcessingRef.current &&
          !isSpeakingRef.current &&
          listenModeRef.current === 'idle'
        ) {
          startSession('wake');
        }
      }, 450);
      return () => clearTimeout(resumeTimer);
    }
  }, [
    wakeWordEnabled,
    isSpeaking,
    isProcessing,
    listenMode,
    voiceErrorType,
    compatibility.speechRecognitionSupported,
    cleanupRecognition,
    setMode,
    startSession,
  ]);

  useEffect(() => {
    return () => {
      cleanupRecognition();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [cleanupRecognition]);

  const assistantState: VoiceAssistantState = deriveVoiceAssistantState({
    speechRecognitionSupported: compatibility.speechRecognitionSupported,
    voiceErrorType,
    isProcessing,
    isSpeaking,
    listenMode,
    recognitionPhase,
    wakeWordEnabled,
  });

  return {
    assistantState,
    listenMode,
    recognitionPhase,
    liveTranscript,
    wakeActivatedNotice,
    voiceError,
    voiceErrorType,
    compatibility,
    micTestActive,
    micTestTranscript,
    micTestError,
    enableWakeWord,
    disableWakeWord,
    restartMicrophone,
    startPushToTalk,
    stopPushToTalk,
    activateCommandWindow,
    startMicTest,
    stopMicTest,
  };
}
