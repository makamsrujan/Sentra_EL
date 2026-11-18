import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFrameStatus, fetchLatestFrameBlob } from '../services/deviceApi';
import type { DeviceSourceMode } from '../types/deviceProtocol';

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
  const inFlightRef = useRef<boolean>(false);
  const backoffMsRef = useRef<number>(pollIntervalMs);

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    latestBlobRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      revokeCurrentUrl();
      setImageUrl(null);
      setSequence(null);
      setIsStale(true);
      setDimensions(null);
      lastSequenceRef.current = null;
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const abortController = new AbortController();

    const pollOnce = async () => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const status = await fetchFrameStatus(deviceId, abortController.signal);
        if (cancelled) return;

        setConnectionStatus(status.connectionStatus);
        setFrameAgeMs(status.frameAgeMs);
        setIsStale(status.stale || !status.frameAvailable);
        setLastReceivedTimestamp(status.lastReceivedTimestamp);
        setErrorMessage(null);
        backoffMsRef.current = pollIntervalMs;

        if (status.frameAvailable && status.sequence !== null && status.sequence !== lastSequenceRef.current) {
          const latest = await fetchLatestFrameBlob(deviceId, abortController.signal);
          if (cancelled) return;

          const nextUrl = URL.createObjectURL(latest.blob);
          const prevUrl = objectUrlRef.current;
          objectUrlRef.current = nextUrl;
          latestBlobRef.current = latest.blob;
          lastSequenceRef.current = latest.sequence ?? status.sequence;

          setImageUrl(nextUrl);
          setSequence(lastSequenceRef.current);
          setIsStale(latest.stale);
          if (prevUrl) {
            URL.revokeObjectURL(prevUrl);
          }
        } else if (!status.frameAvailable) {
          revokeCurrentUrl();
          setImageUrl(null);
          setSequence(null);
          lastSequenceRef.current = null;
        }
      } catch (err: any) {
        if (cancelled || err?.name === 'AbortError') return;
        setErrorMessage(err?.message || 'Wearable frame poll error');
        backoffMsRef.current = Math.min(8000, backoffMsRef.current * 2);
      } finally {
        inFlightRef.current = false;
        if (!cancelled) {
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
