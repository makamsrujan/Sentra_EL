import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserCameraErrorType,
  CameraDeviceOption,
  captureVideoSnapshot,
  CapturedFrameResult,
  classifyCameraError,
  enumerateCameraDevices,
  inspectCameraEnvironment,
  isCameraApiSupported,
  isEmbeddedContext,
  stopMediaStream,
} from '../services/cameraService';

export type BrowserCameraStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'stopped'
  | 'error';

export type { BrowserCameraErrorType };

interface UseCameraOptions {
  facingMode: 'environment' | 'user';
  selectedDeviceId: string | null;
  autoStart?: boolean;
}

export function useCamera({
  facingMode,
  selectedDeviceId,
  autoStart = false,
}: UseCameraOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionTokenRef = useRef(0);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<BrowserCameraStatus>('idle');
  const [errorType, setErrorType] = useState<BrowserCameraErrorType>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDeviceOption[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(selectedDeviceId);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [lastFrameTimestamp, setLastFrameTimestamp] = useState<number | null>(null);
  const [isEmbedded] = useState<boolean>(() => isEmbeddedContext());

  const refreshDevices = useCallback(async () => {
    const list = await enumerateCameraDevices();
    if (mountedRef.current) {
      setDevices(list);
    }
    return list;
  }, []);

  const clearVideoElement = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    videoEl.onloadedmetadata = null;
    videoEl.onloadeddata = null;
    videoEl.oncanplay = null;
    videoEl.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    sessionTokenRef.current += 1;
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    clearVideoElement();
    if (mountedRef.current) {
      setStatus('stopped');
      setResolution(null);
      setHasTorch(false);
      setIsTorchOn(false);
    }
  }, [clearVideoElement]);

  const startCamera = useCallback(
    async (overrideDeviceId?: string | null, overrideFacing?: 'environment' | 'user'): Promise<boolean> => {
      const requestToken = ++sessionTokenRef.current;

      // Release any previous active stream first so two streams never compete
      if (streamRef.current) {
        stopMediaStream(streamRef.current);
        streamRef.current = null;
      }
      clearVideoElement();

      const env = await inspectCameraEnvironment();
      if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
        return false;
      }

      if (!env.isSecureContext) {
        setStatus('error');
        setErrorType('https_required');
        setErrorMessage(
          'Camera access requires a secure HTTPS context (or localhost). Open SENTRA over HTTPS.'
        );
        return false;
      }

      if (!env.apiSupported) {
        setStatus('error');
        setErrorType('unsupported');
        setErrorMessage(
          'Browser camera acquisition (navigator.mediaDevices.getUserMedia) is unsupported in this browser.'
        );
        return false;
      }

      if (env.permissionsPolicyBlocked) {
        setStatus('error');
        setErrorType('blocked_by_embed');
        setErrorMessage(
          'Camera access is blocked by the embedded preview Permissions Policy. Open SENTRA directly in a top-level HTTPS browser tab.'
        );
        return false;
      }

      setStatus('starting');
      setErrorType(null);
      setErrorMessage(null);
      setResolution(null);
      setHasTorch(false);
      setIsTorchOn(false);

      const availableDevices = await refreshDevices();
      if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
        return false;
      }

      const rawTargetId = overrideDeviceId !== undefined ? overrideDeviceId : selectedDeviceId;
      // Only use deviceId if it matches an actually enumerated device; avoid stale/rotated IDs
      const validTargetId =
        rawTargetId && availableDevices.some((d) => d.deviceId === rawTargetId)
          ? rawTargetId
          : null;
      const targetFacing = overrideFacing ?? facingMode;

      const candidateConstraints: MediaStreamConstraints[] = [];
      if (validTargetId) {
        candidateConstraints.push({
          video: { deviceId: { exact: validTargetId }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      }
      candidateConstraints.push({
        video: { facingMode: { ideal: targetFacing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      candidateConstraints.push({
        video: { facingMode: { ideal: targetFacing } },
        audio: false,
      });
      candidateConstraints.push({
        video: true,
        audio: false,
      });

      let stream: MediaStream | null = null;
      let lastErr: any = null;

      for (let i = 0; i < candidateConstraints.length; i++) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(candidateConstraints[i]);
          break;
        } catch (err: any) {
          lastErr = err;
          if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
            return false;
          }
          const name = String(err?.name || '');
          // Only fall back to simpler constraints for OverconstrainedError / NotFoundError
          const canFallback = name === 'OverconstrainedError' || name === 'NotFoundError';
          if (!canFallback || i === candidateConstraints.length - 1) {
            break;
          }
        }
      }

      if (!stream) {
        // Re-check permissions state after failure to accurately distinguish embed policy vs user denial
        const postEnv = await inspectCameraEnvironment();
        if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
          return false;
        }
        const classified = classifyCameraError(lastErr, postEnv);
        setStatus('error');
        setErrorType(classified.type);
        setErrorMessage(classified.message);
        return false;
      }

      // Check if superseded or unmounted while awaiting permission/stream
      if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
        stopMediaStream(stream);
        return false;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        stopMediaStream(stream);
        setStatus('error');
        setErrorType('unavailable');
        setErrorMessage('Camera opened without an active live video track.');
        return false;
      }

      streamRef.current = stream;

      videoTrack.onended = () => {
        if (!mountedRef.current || requestToken !== sessionTokenRef.current) return;
        stopMediaStream(stream);
        streamRef.current = null;
        clearVideoElement();
        setStatus('error');
        setErrorType('disconnected');
        setErrorMessage('Camera device disconnected or its video track ended unexpectedly.');
        setResolution(null);
      };

      const videoEl = videoRef.current;
      if (!videoEl) {
        stopMediaStream(stream);
        streamRef.current = null;
        setStatus('error');
        setErrorType('playback_failed');
        setErrorMessage('Video viewport element was not mounted when attaching stream.');
        return false;
      }

      // Ensure iOS Safari inline playback attributes are set imperatively before assigning srcObject
      videoEl.playsInline = true;
      videoEl.muted = true;
      videoEl.autoplay = true;

      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanupListeners = () => {
            videoEl.removeEventListener('loadedmetadata', handleMeta);
            videoEl.removeEventListener('loadeddata', checkReady);
            videoEl.removeEventListener('canplay', checkReady);
          };

          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanupListeners();
            resolve();
          };

          const fail = (reason: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanupListeners();
            reject(reason);
          };

          const timeoutId = setTimeout(() => {
            fail(new Error('Timed out waiting for live camera frames.'));
          }, 8000);

          const checkReady = () => {
            if (settled) return;
            if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
              finish();
            }
          };

          const handleMeta = () => {
            videoEl
              .play()
              .then(() => {
                checkReady();
              })
              .catch((playErr) => {
                fail(
                  playErr instanceof Error
                    ? playErr
                    : new Error('Video playback was blocked by browser autoplay rules.')
                );
              });
          };

          videoEl.addEventListener('loadedmetadata', handleMeta);
          videoEl.addEventListener('loadeddata', checkReady);
          videoEl.addEventListener('canplay', checkReady);

          // Assign stream AFTER attaching all listeners to eliminate metadata event races
          videoEl.srcObject = stream;
          if (videoEl.readyState >= 1) {
            handleMeta();
          }
        });
      } catch (playErr: any) {
        if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
          stopMediaStream(stream);
          return false;
        }
        stopMediaStream(stream);
        streamRef.current = null;
        clearVideoElement();
        setStatus('error');
        setErrorType('playback_failed');
        setErrorMessage(
          playErr?.message || 'Camera connected, but video playback failed before frames arrived.'
        );
        return false;
      }

      if (!mountedRef.current || requestToken !== sessionTokenRef.current) {
        stopMediaStream(stream);
        return false;
      }

      const settings = videoTrack.getSettings?.() || {};
      const capabilities = (videoTrack.getCapabilities?.() as any) || {};

      setActiveDeviceId(settings.deviceId || validTargetId || null);
      setResolution({
        width: videoEl.videoWidth,
        height: videoEl.videoHeight,
      });
      setHasTorch(Boolean('torch' in capabilities));
      setLastFrameTimestamp(Date.now());
      setStatus('streaming');
      setErrorType(null);
      setErrorMessage(null);

      await refreshDevices();
      return true;
    },
    [facingMode, selectedDeviceId, refreshDevices, clearVideoElement]
  );

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hasTorch) return;
    try {
      const next = !isTorchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      if (mountedRef.current) setIsTorchOn(next);
    } catch {
      // Torch constraint unsupported on this device/driver
    }
  }, [hasTorch, isTorchOn]);

  const captureSnapshot = useCallback((): CapturedFrameResult => {
    if (status !== 'streaming') {
      return { dataUrl: null, quality: null, width: 0, height: 0, timestamp: null };
    }
    const snap = captureVideoSnapshot(videoRef.current);
    if (snap.timestamp && mountedRef.current) {
      setLastFrameTimestamp(snap.timestamp);
    }
    return snap;
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    refreshDevices();

    const handleDeviceChange = () => {
      refreshDevices();
    };
    if (isCameraApiSupported() && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    if (autoStart) {
      startCamera();
    }

    return () => {
      mountedRef.current = false;
      if (isCameraApiSupported() && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
      stopCamera();
    };
    // Run only on mount/unmount; explicit source/facing changes trigger startCamera explicitly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    videoRef,
    status,
    isStreaming: status === 'streaming',
    errorType,
    errorMessage,
    isEmbedded,
    devices,
    activeDeviceId,
    resolution,
    hasTorch,
    isTorchOn,
    lastFrameTimestamp,
    startCamera,
    retryCamera: () => startCamera(activeDeviceId, facingMode),
    stopCamera,
    toggleTorch,
    captureSnapshot,
    refreshDevices,
  };
}
