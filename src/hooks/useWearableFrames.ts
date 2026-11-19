import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFrameStatus, fetchLatestFrameBlob } from '../services/deviceApi';
import type { DeviceSourceMode } from '../types/deviceProtocol';

export function validateWearableFramePayload(params: {
  expectedDeviceId: string;
  responseDeviceIdHeader: string | null;
  mimeType: string;
  byteSize: number;
  frameAgeMs: number | null;
  staleFlag: boolean;
}): { ok: boolean; reason?: string } {
  if (
    params.responseDeviceIdHeader &&
    params.responseDeviceIdHeader.trim() !== params.expectedDeviceId.trim()
  ) {
    return {
      ok: false,
      reason: `Mismatched frame device ID (${params.responseDeviceIdHeader} != ${params.expectedDeviceId})`,
    };
  }
  if (params.byteSize <= 0 || !params.mimeType.toLowerCase().startsWith('image/')) {
    return {
      ok: false,
      reason: `Invalid wearable image payload (${params.mimeType || 'unknown type'}, ${params.byteSize} bytes)`,
    };
  }
  return { ok: true };
}

function verifyImageUrlDecodes(objectUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error('Decoded wearable frame had zero dimensions.'));
      }
    };
    img.onerror = () => reject(new Error('Corrupted wearable image payload failed to decode.'));
    img.src = objectUrl;
  });
}

interface UseWearableFramesOptions {
  deviceId: string;
  enabled: boolean;
  pollIntervalMs?: number;
}

export function useWearableFrames({
  deviceId,
  enabled,
  pollIntervalMs = 1000,
}: UseWearableFramesOptions) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sequence, setSequence] = useState<number | null>(null);
  const [lastReceivedTimestamp, setLastReceivedTimestamp] = useState<number | null>(null);
  const [frameAgeMs, setFrameAgeMs] = useState<number | null>(null);
  const [isStale, setIsStale] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<DeviceSourceMode>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  const objectUrlRef = useRef<string | null>(null);
  const latestBlobRef = useRef<Blob | null>(null);
  const lastSequenceRef = useRef<number | null>(null);
  const lastStatusRef = useRef<DeviceSourceMode>('disconnected');
  const inFlightRef = useRef<boolean>(false);
  const sessionIdRef = useRef<number>(0);
  const backoffMsRef = useRef<number>(pollIntervalMs);

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    latestBlobRef.current = null;
  }, []);

  useEffect(() => {
    sessionIdRef.current += 1;
    const currentSession = sessionIdRef.current;

    if (!enabled) {
      revokeCurrentUrl();
      setImageUrl(null);
      setSequence(null);
      setFrameAgeMs(null);
      setIsStale(true);
      setDimensions(null);
      setErrorMessage(null);
      lastSequenceRef.current = null;
      lastStatusRef.current = 'disconnected';
      return;
    }

    // Reset sequence & previous URL when deviceId changes or re-enabled
    revokeCurrentUrl();
    setImageUrl(null);
    setSequence(null);
    lastSequenceRef.current = null;
    lastStatusRef.current = 'disconnected';
    backoffMsRef.current = pollIntervalMs;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const abortController = new AbortController();

    const pollOnce = async () => {
      if (cancelled || sessionIdRef.current !== currentSession || inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const status = await fetchFrameStatus(deviceId, abortController.signal);
        if (cancelled || sessionIdRef.current !== currentSession) return;

        // If device reconnected after disconnect, force reload even if sequence restarted at 0/1
        if (lastStatusRef.current === 'disconnected' && status.connectionStatus !== 'disconnected') {
          lastSequenceRef.current = null;
        }
        lastStatusRef.current = status.connectionStatus;

        setConnectionStatus(status.connectionStatus);
        setFrameAgeMs(status.frameAgeMs);
        setIsStale(status.stale || !status.frameAvailable);
        setLastReceivedTimestamp(status.lastReceivedTimestamp);
        setErrorMessage(null);
        backoffMsRef.current = pollIntervalMs;

        const shouldFetchFrame =
          status.frameAvailable &&
          status.sequence !== null &&
          (status.sequence !== lastSequenceRef.current || status.sequence < (lastSequenceRef.current ?? 0));

        if (shouldFetchFrame) {
          const latest = await fetchLatestFrameBlob(deviceId, abortController.signal);
          if (cancelled || sessionIdRef.current !== currentSession) return;

          const check = validateWearableFramePayload({
            expectedDeviceId: deviceId,
            responseDeviceIdHeader: latest.deviceIdHeader,
            mimeType: latest.blob.type,
            byteSize: latest.blob.size,
            frameAgeMs: status.frameAgeMs,
            staleFlag: latest.stale,
          });
          if (!check.ok) {
            setErrorMessage(check.reason || 'Invalid wearable frame received.');
            return;
          }

          const candidateUrl = URL.createObjectURL(latest.blob);
          try {
            const decodedDims = await verifyImageUrlDecodes(candidateUrl);
            if (cancelled || sessionIdRef.current !== currentSession) {
              URL.revokeObjectURL(candidateUrl);
              return;
            }
            const prevUrl = objectUrlRef.current;
            objectUrlRef.current = candidateUrl;
            latestBlobRef.current = latest.blob;
            lastSequenceRef.current = latest.sequence ?? status.sequence;

            setImageUrl(candidateUrl);
            setDimensions(decodedDims);
            setSequence(lastSequenceRef.current);
            setIsStale(latest.stale);
            if (prevUrl) {
              URL.revokeObjectURL(prevUrl);
            }
          } catch (decodeErr: any) {
            URL.revokeObjectURL(candidateUrl);
            if (!cancelled && sessionIdRef.current === currentSession) {
              setErrorMessage(decodeErr?.message || 'Wearable JPEG failed image decode validation.');
            }
          }
        } else if (!status.frameAvailable) {
          revokeCurrentUrl();
          setImageUrl(null);
          setSequence(null);
          lastSequenceRef.current = null;
        }
      } catch (err: any) {
        if (cancelled || sessionIdRef.current !== currentSession || err?.name === 'AbortError') return;
        setErrorMessage(err?.message || 'Wearable frame poll error');
        backoffMsRef.current = Math.min(8000, backoffMsRef.current * 2);
      } finally {
        inFlightRef.current = false;
        if (!cancelled && sessionIdRef.current === currentSession) {
          timerId = setTimeout(pollOnce, backoffMsRef.current);
        }
      }
    };

    pollOnce();

    return () => {
      cancelled = true;
      abortController.abort();
      if (timerId) clearTimeout(timerId);
      inFlightRef.current = false;
    };
  }, [deviceId, enabled, pollIntervalMs, revokeCurrentUrl]);

  // Update age & staleness locally every second when frame exists
  useEffect(() => {
    if (!enabled || lastReceivedTimestamp === null) return;
    const interval = setInterval(() => {
      const age = Math.max(0, Date.now() - lastReceivedTimestamp);
      setFrameAgeMs(age);
      if (age > 5000) {
        setIsStale(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [enabled, lastReceivedTimestamp]);

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      revokeCurrentUrl();
    };
  }, [revokeCurrentUrl]);

  const captureLatestFrameDataUrl = useCallback(async (): Promise<{
    dataUrl: string | null;
    timestamp: number | null;
    width: number;
    height: number;
  }> => {
    if (!enabled || !latestBlobRef.current || isStale) {
      return { dataUrl: null, timestamp: null, width: 0, height: 0 };
    }
    const blob = latestBlobRef.current;
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    return {
      dataUrl,
      timestamp: lastReceivedTimestamp,
      width: dimensions?.width ?? 640,
      height: dimensions?.height ?? 480,
    };
  }, [enabled, isStale, lastReceivedTimestamp, dimensions]);

  return {
    imageUrl,
    sequence,
    lastReceivedTimestamp,
    frameAgeMs,
    isStale,
    connectionStatus,
    errorMessage,
    dimensions,
    setDimensions,
    captureLatestFrameDataUrl,
  };
}
