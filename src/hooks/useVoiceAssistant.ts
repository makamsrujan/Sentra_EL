import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playChime } from '../utils/audio';

export type VoiceAssistantState =
  | 'standby'
  | 'wake_listening'
  | 'command_listening'
  | 'processing'
  | 'speaking'
  | 'error';

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
 * Pure parser that detects "Hey SENTRA" wake phrases, extracts any inline command,
 * and recognizes interruption commands ("Stop", "Cancel", "Be quiet").
 */
export function extractWakePhraseCommand(transcript: string): WakeParseResult {
  const clean = transcript.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return { detected: false, command: '', isInterrupt: false };
  }

  const wakeMatch = clean.match(WAKE_PHRASE_REGEX);
  if (wakeMatch) {
    const trailing = (wakeMatch[1] || '').trim();
    const isInterrupt = Boolean(trailing && INTERRUPT_REGEX.test(trailing) && trailing.split(/\s+/).length <= 4);
    return {
      detected: true,
      command: trailing,
      isInterrupt,
    };
  }

  // Standalone short interruption utterances
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

export function classifySpeechError(
  errorCode: string,
  env: {
    isSecureContext: boolean;
    isEmbedded: boolean;
    permissionsPolicyBlocked: boolean;
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
    if (env.permissionsPolicyBlocked || env.isEmbedded) {
      return {
        type: 'blocked_by_embed',
        message:
          'Microphone access is blocked inside this embedded preview or permission denied. Open SENTRA directly in an HTTPS tab or grant mic access.',
        fatalForLoop: true,
      };
    }
    return {
      type: 'permission_denied',
      message: 'Microphone permission was denied. Allow microphone access in browser settings and tap Restart Mic.',
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
    return {
      type: 'network',
      message: 'Speech recognition requires network connectivity to the browser speech service.',
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
  onInterrupt: () => void;
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
  const [listenMode, setListenMode] = useState<'idle' | 'wake' | 'command' | 'ptt'>('idle');
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [voiceErrorType, setVoiceErrorType] = useState<VoiceErrorType>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [wakeActivatedNotice, setWakeActivatedNotice] = useState(false);

  const compatibility = useMemo(() => getVoiceCompatibilityInfo(), []);

  // Mutable refs for race-free single-session management
  const recognitionRef = useRef<any>(null);
  const sessionIdRef = useRef<number>(0);
  const listenModeRef = useRef<'idle' | 'wake' | 'command' | 'ptt'>('idle');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const setMode = useCallback((next: 'idle' | 'wake' | 'command' | 'ptt') => {
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
  }, []);

  const cleanupRecognition = useCallback(() => {
    sessionIdRef.current += 1;
    clearAllTimers();
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
        permissionsPolicyBlocked = !policy.allowsFeature('microphone');
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
    (targetMode: 'wake' | 'command' | 'ptt') => {
      const SpeechRecognitionClass =
        typeof window !== 'undefined'
          ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
          : null;

      if (!SpeechRecognitionClass) {
        setVoiceErrorType('unsupported');
        setVoiceError('Web Speech Recognition is not supported in this browser. Use typed input below.');
        setMode('idle');
        onUnsupportedFallbackRef.current?.();
        return false;
      }

      const env = getMicEnvironmentFlags();
      if (!env.isSecureContext) {
        setVoiceErrorType('https_required');
        setVoiceError('Microphone access requires HTTPS or localhost.');
        setMode('idle');
        return false;
      }
      if (env.permissionsPolicyBlocked) {
        setVoiceErrorType('blocked_by_embed');
        setVoiceError('Microphone is blocked by this embedded iframe Permissions Policy.');
        setMode('idle');
        return false;
      }

      // Enforce single active recognition instance
      cleanupRecognition();

      const mySessionId = sessionIdRef.current;
      try {
        const rec = new SpeechRecognitionClass();
        rec.lang = navigator.language || 'en-US';
        rec.continuous = targetMode === 'wake';
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        recognitionRef.current = rec;
        pttCapturedRef.current = '';
        lastSessionStartRef.current = Date.now();
        setMode(targetMode);
        setVoiceError(null);
        setVoiceErrorType(null);

        if (targetMode === 'command') {
          if (audioFeedbackRef.current) {
            playChime('start_listen');
          }
          commandTimeoutRef.current = setTimeout(() => {
            if (sessionIdRef.current !== mySessionId) return;
            cleanupRecognition();
            setLiveTranscript('');
            if (audioFeedbackRef.current) {
              playChime('stop_listen');
            }
            setMode('idle');
          }, 8000);
        } else if (targetMode === 'ptt') {
          if (audioFeedbackRef.current) {
            playChime('start_listen');
          }
        }

        rec.onresult = (event: any) => {
          if (sessionIdRef.current !== mySessionId) return;

          // Never allow assistant speech to self-trigger wake recognition
          if (targetMode === 'wake' && isSpeakingRef.current) {
            return;
          }

          let latestText = '';
          let hasFinal = false;

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const piece = (res?.[0]?.transcript || '').trim();
            if (piece) {
              latestText = latestText ? `${latestText} ${piece}` : piece;
            }
            if (res.isFinal) {
              hasFinal = true;
            }
          }

          if (!latestText) return;
          rapidEmptyRestartsRef.current = 0;

          if (targetMode === 'ptt') {
            pttCapturedRef.current = latestText;
            setLiveTranscript(latestText);
            if (hasFinal) {
              cleanupRecognition();
              setMode('idle');
              setLiveTranscript('');
              submitTranscriptOnce(latestText);
            }
            return;
          }

          if (targetMode === 'command') {
            setLiveTranscript(latestText);
            if (hasFinal) {
              cleanupRecognition();
              setMode('idle');
              setLiveTranscript('');
              const wakeCheck = extractWakePhraseCommand(latestText);
              if (wakeCheck.isInterrupt) {
                onInterruptRef.current();
              } else {
                submitTranscriptOnce(wakeCheck.detected && wakeCheck.command ? wakeCheck.command : latestText);
              }
            }
            return;
          }

          // targetMode === 'wake'
          const parsed = extractWakePhraseCommand(latestText);
          if (parsed.isInterrupt) {
            cleanupRecognition();
            setMode('idle');
            setLiveTranscript('');
            onInterruptRef.current();
            return;
          }

          if (parsed.detected) {
            flashWakeActivated();
            setLiveTranscript(parsed.command ? parsed.command : 'Hey SENTRA…');

            if (wakeSettleTimerRef.current) {
              clearTimeout(wakeSettleTimerRef.current);
              wakeSettleTimerRef.current = null;
            }

            if (parsed.command && hasFinal) {
              cleanupRecognition();
              setMode('idle');
              setLiveTranscript('');
              if (audioFeedbackRef.current) {
                playChime('start_listen');
              }
              submitTranscriptOnce(parsed.command);
              return;
            }

            if (!parsed.command) {
              if (hasFinal) {
                // User paused after saying "Hey SENTRA" -> transition cleanly to active command window
                cleanupRecognition();
                setLiveTranscript('');
                startSession('command');
              } else {
                // Wait briefly in case user continues speaking "...find my keys" in same phrase
                wakeSettleTimerRef.current = setTimeout(() => {
                  if (sessionIdRef.current !== mySessionId) return;
                  cleanupRecognition();
                  setLiveTranscript('');
                  startSession('command');
                }, 750);
              }
            }
          }
        };

        rec.onerror = (ev: any) => {
          if (sessionIdRef.current !== mySessionId) return;
          const classified = classifySpeechError(ev?.error || '', env);

          if (classified.fatalForLoop) {
            cleanupRecognition();
            setMode('idle');
            setVoiceErrorType(classified.type);
            setVoiceError(classified.message);
            if (targetMode === 'wake') {
              onWakeWordEnabledChange(false);
            }
          } else {
            // Transient no-speech or aborted inside wake mode; let onend decide safely
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

          // Prevent infinite fast restart loops on browsers that immediately terminate Web Speech
          if (rapidEmptyRestartsRef.current >= 12) {
            setVoiceErrorType('service_not_allowed');
            setVoiceError(
              'Continuous foreground listening ended repeatedly on this browser. Use Hold to Talk or tap Restart Mic.'
            );
            onWakeWordEnabledChange(false);
            return;
          }

          if (
            wakeWordEnabledRef.current &&
            !isProcessingRef.current &&
            !isSpeakingRef.current
          ) {
            const backoffMs = Math.min(2500, 350 + rapidEmptyRestartsRef.current * 250);
            restartTimerRef.current = setTimeout(() => {
              if (
                wakeWordEnabledRef.current &&
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
        setVoiceErrorType('service_not_allowed');
        setVoiceError(err?.message || 'Unable to start speech recognition.');
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
      setVoiceError('Microphone is blocked inside this embedded iframe preview.');
      return false;
    }

    // Request explicit microphone permission via getUserMedia and immediately release stream
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
    if (!isProcessingRef.current && !isSpeakingRef.current) {
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
        // Call stop() rather than abort() so Safari/Chrome flush any buffered final transcript
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

  // Keep wake listening cleanly paused during TTS & Gemini processing, and resume afterward
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
      !voiceErrorType &&
      listenModeRef.current === 'idle' &&
      compatibility.speechRecognitionSupported
    ) {
      const resumeTimer = setTimeout(() => {
        if (
          wakeWordEnabledRef.current &&
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
    voiceErrorType,
    compatibility.speechRecognitionSupported,
    cleanupRecognition,
    setMode,
    startSession,
  ]);

  // Clean shutdown on unmount
  useEffect(() => {
    return () => {
      cleanupRecognition();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [cleanupRecognition]);

  const assistantState: VoiceAssistantState = voiceErrorType
    ? 'error'
    : isProcessing
    ? 'processing'
    : isSpeaking
    ? 'speaking'
    : listenMode === 'command' || listenMode === 'ptt'
    ? 'command_listening'
    : listenMode === 'wake' || wakeWordEnabled
    ? 'wake_listening'
    : 'standby';

  return {
    assistantState,
    listenMode,
    liveTranscript,
    wakeActivatedNotice,
    voiceError,
    voiceErrorType,
    compatibility,
    enableWakeWord,
    disableWakeWord,
    restartMicrophone,
    startPushToTalk,
    stopPushToTalk,
    activateCommandWindow,
  };
}
