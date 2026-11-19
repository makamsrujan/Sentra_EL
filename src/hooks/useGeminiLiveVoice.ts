import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraSourceType } from '../types/deviceProtocol';
import type { SentraMemoryItem } from '../types/sentra';
import type { LiveVoiceName } from '../lib/firebase';

export type LiveVoiceStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface LiveVoiceHookOptions {
  deviceId: string;
  cameraSource: CameraSourceType;
  voiceName?: LiveVoiceName;
  muted?: boolean;
  volume?: number;
  captureBrowserSnapshot?: () => Promise<{ dataUrl: string | null; timestamp: number | null }>;
  onMemorySaved?: (item: SentraMemoryItem) => void;
  onHardwareEvent?: (evt: { event: string; distanceCm?: number | null; deviceId?: string }) => void;
  onTurnComplete?: (turn: { userTranscript: string; assistantTranscript: string }) => void;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLength = binary.length;
  const buffer = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(byteLength / 2);
  const view = new DataView(buffer);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function useGeminiLiveVoice(options: LiveVoiceHookOptions) {
  const [status, setStatus] = useState<LiveVoiceStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string>('gemini-3.8-live');
  const [hardwareLinked, setHardwareLinked] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const videoTimerRef = useRef<number | null>(null);

  const mutedRef = useRef(Boolean(options.muted));
  mutedRef.current = Boolean(options.muted);
  const volumeRef = useRef(typeof options.volume === 'number' ? options.volume : 0.9);
  volumeRef.current = typeof options.volume === 'number' ? options.volume : 0.9;
  const captureSnapshotRef = useRef(options.captureBrowserSnapshot);
  captureSnapshotRef.current = options.captureBrowserSnapshot;
  const cameraSourceRef = useRef(options.cameraSource);
  cameraSourceRef.current = options.cameraSource;
  const deviceIdRef = useRef(options.deviceId);
  deviceIdRef.current = options.deviceId;
  const onMemorySavedRef = useRef(options.onMemorySaved);
  onMemorySavedRef.current = options.onMemorySaved;
  const onHardwareEventRef = useRef(options.onHardwareEvent);
  onHardwareEventRef.current = options.onHardwareEvent;
  const onTurnCompleteRef = useRef(options.onTurnComplete);
  onTurnCompleteRef.current = options.onTurnComplete;

  const userTurnBufferRef = useRef('');
  const assistantTurnBufferRef = useRef('');

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = mutedRef.current ? 0 : volumeRef.current;
    }
  }, [options.muted, options.volume]);

  const stopPlaybackQueue = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    setIsModelSpeaking(false);
  }, []);

  const schedulePcm24kChunk = useCallback((base64Data: string) => {
    const outCtx = outputCtxRef.current;
    const gain = gainNodeRef.current;
    if (!outCtx || !gain) return;
    if (outCtx.state === 'suspended') {
      outCtx.resume().catch(() => {});
    }

    const samples = base64Pcm16ToFloat32(base64Data);
    if (samples.length === 0) return;

    const buffer = outCtx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const source = outCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const now = outCtx.currentTime;
    const startAt = Math.max(now + 0.01, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    setIsModelSpeaking(true);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setIsModelSpeaking(false);
      }
    };
    source.start(startAt);
  }, []);

  const disconnect = useCallback(() => {
    if (videoTimerRef.current !== null) {
      window.clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    stopPlaybackQueue();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      micStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
      gainNodeRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setStatus('disconnected');
    setHardwareLinked(false);
    setIsModelSpeaking(false);
  }, [stopPlaybackQueue]);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'set_source',
          deviceId: options.deviceId,
          source: options.cameraSource,
        })
      );
    }
  }, [options.deviceId, options.cameraSource]);

  const connect = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    disconnect();
    setStatus('connecting');
    setError(null);
    userTurnBufferRef.current = '';
    assistantTurnBufferRef.current = '';
    setUserTranscript('');
    setAssistantTranscript('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('Microphone capture is unavailable in this browser environment.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      const gain = outputCtx.createGain();
      gain.gain.value = mutedRef.current ? 0 : volumeRef.current;
      gain.connect(outputCtx.destination);

      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      gainNodeRef.current = gain;
      nextStartTimeRef.current = outputCtx.currentTime;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = new URLSearchParams({
        deviceId: deviceIdRef.current || 'ESP32-S3-SENTRA-001',
        source: cameraSourceRef.current,
        voice: options.voiceName || 'Zephyr',
      });
      const ws = new WebSocket(`${proto}//${window.location.host}/api/live/voice?${qs.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const pcm = ev.inputBuffer.getChannelData(0);
          const base64 = float32ToPcm16Base64(pcm);
          wsRef.current.send(JSON.stringify({ type: 'audio', data: base64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);

        // Stream browser video snapshots at max 1 FPS when browser camera is active
        videoTimerRef.current = window.setInterval(async () => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          if (cameraSourceRef.current !== 'browser_camera' || !captureSnapshotRef.current) return;
          try {
            const snap = await captureSnapshotRef.current();
            if (snap.dataUrl && snap.dataUrl.includes(',')) {
              const b64 = snap.dataUrl.split(',')[1];
              if (b64) {
                wsRef.current.send(JSON.stringify({ type: 'video', data: b64 }));
              }
            }
          } catch {}
        }, 1000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setStatus('connected');
            setModelUsed(msg.model || 'gemini-3.8-live');
            setHardwareLinked(Boolean(msg.hardwareConnected));
            return;
          }
          if (msg.type === 'audio' && typeof msg.data === 'string') {
            schedulePcm24kChunk(msg.data);
            return;
          }
          if (msg.type === 'input_transcript' && typeof msg.text === 'string') {
            userTurnBufferRef.current = `${userTurnBufferRef.current} ${msg.text}`.trim();
            setUserTranscript(userTurnBufferRef.current);
            return;
          }
          if (msg.type === 'output_transcript' && typeof msg.text === 'string') {
            assistantTurnBufferRef.current = `${assistantTurnBufferRef.current} ${msg.text}`.trim();
            setAssistantTranscript(assistantTurnBufferRef.current);
            return;
          }
          if (msg.type === 'interrupted') {
            stopPlaybackQueue();
            return;
          }
          if (msg.type === 'turn_complete') {
            const finalUser = userTurnBufferRef.current.trim();
            const finalAssistant = assistantTurnBufferRef.current.trim();
            if (finalAssistant) {
              onTurnCompleteRef.current?.({
                userTranscript: finalUser,
                assistantTranscript: finalAssistant,
              });
            }
            userTurnBufferRef.current = '';
            assistantTurnBufferRef.current = '';
            return;
          }
          if (msg.type === 'memory_saved' && msg.memory) {
            onMemorySavedRef.current?.(msg.memory);
            return;
          }
          if (msg.type === 'hardware_event') {
            onHardwareEventRef.current?.(msg);
            return;
          }
          if (msg.type === 'hardware_state') {
            setHardwareLinked(Boolean(msg.connected));
            return;
          }
          if (msg.type === 'error') {
            setStatus('error');
            setError(msg.message || 'Live voice session error.');
            return;
          }
          if (msg.type === 'closed') {
            disconnect();
          }
        } catch {}
      };

      ws.onerror = () => {
        setStatus('error');
        setError('WebSocket connection error during Gemini Live session.');
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          disconnect();
        }
      };
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || 'Unable to start microphone or Gemini Live session.');
      disconnect();
    }
  }, [disconnect, options.voiceName, schedulePcm24kChunk, stopPlaybackQueue]);

  const sendTextTurn = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    userTurnBufferRef.current = trimmed;
    setUserTranscript(trimmed);
    wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
    return true;
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    error,
    modelUsed,
    hardwareLinked,
    isModelSpeaking,
    userTranscript,
    assistantTranscript,
    connect,
    disconnect,
    sendTextTurn,
  };
}
