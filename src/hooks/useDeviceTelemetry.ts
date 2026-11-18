import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAnalyticsSummary, fetchDeviceStatus } from '../services/deviceApi';
import type { AnalyticsSummary, DeviceLiveState } from '../types/deviceProtocol';

interface UseDeviceTelemetryOptions {
  selectedDeviceId: string;
  onAlert?: (alert: {
    deviceId: string;
    sourceMode: 'hardware' | 'simulator';
    type: string;
    severity: 'caution' | 'critical';
    description: string;
  }) => void;
}

export function useDeviceTelemetry({ selectedDeviceId, onAlert }: UseDeviceTelemetryOptions) {
  const [devices, setDevices] = useState<DeviceLiveState[]>([]);
  const [activeDevice, setActiveDevice] = useState<DeviceLiveState | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<'1h' | '24h' | '7d' | 'all'>('24h');
  const [includeSimulatedAnalytics, setIncludeSimulatedAnalytics] = useState(false);

  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const lastAlertKeyRef = useRef<{ key: string; ts: number }>({ key: '', ts: 0 });
  const selectedDeviceRef = useRef(selectedDeviceId);
  selectedDeviceRef.current = selectedDeviceId;

  const updateDeviceState = useCallback((incoming: DeviceLiveState) => {
    setDevices((prev) => {
      const idx = prev.findIndex((d) => d.deviceId === incoming.deviceId);
      if (idx === -1) return [...prev, incoming];
      const next = [...prev];
      next[idx] = incoming;
      return next;
    });
    if (incoming.deviceId === selectedDeviceRef.current || !selectedDeviceRef.current) {
      setActiveDevice(incoming);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchDeviceStatus(selectedDeviceRef.current || undefined);
      setDevices(data.devices || []);
      const match =
        data.devices?.find((d) => d.deviceId === selectedDeviceRef.current) ||
        data.telemetry ||
        null;
      setActiveDevice(match);
      setTelemetryError(null);
    } catch (err: any) {
      setTelemetryError(err?.message || 'Unable to fetch device telemetry');
    }
  }, []);

  const refreshAnalytics = useCallback(
    async (overrideDeviceId?: string | null) => {
      try {
        const targetId = overrideDeviceId !== undefined ? overrideDeviceId : selectedDeviceRef.current || null;
        const summary = await fetchAnalyticsSummary({
          deviceId: targetId,
          range: analyticsRange,
          includeSimulated: includeSimulatedAnalytics,
        });
        setAnalytics(summary);
      } catch {
        // Ignore transient analytics refresh errors
      }
    },
    [analyticsRange, includeSimulatedAnalytics]
  );

  // SSE subscription with fallback polling only when SSE fails
  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let fallbackPoll: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const startFallbackPoll = () => {
      if (fallbackPoll) return;
      refreshStatus();
      fallbackPoll = setInterval(refreshStatus, 4000);
    };

    const stopFallbackPoll = () => {
      if (fallbackPoll) {
        clearInterval(fallbackPoll);
        fallbackPoll = null;
      }
    };

    const connectSse = () => {
      if (closed || typeof EventSource === 'undefined') {
        startFallbackPoll();
        return;
      }

      es = new EventSource('/api/device/stream');

      es.addEventListener('open', () => {
        if (closed) return;
        setSseConnected(true);
        setTelemetryError(null);
        stopFallbackPoll();
      });

      es.addEventListener('snapshot', (ev: MessageEvent) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(ev.data);
          if (Array.isArray(parsed.devices)) {
            setDevices(parsed.devices);
            const match =
              parsed.devices.find((d: DeviceLiveState) => d.deviceId === selectedDeviceRef.current) ||
              parsed.telemetry ||
              null;
            setActiveDevice(match);
          }
        } catch {}
      });

      es.addEventListener('telemetry', (ev: MessageEvent) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(ev.data) as DeviceLiveState;
          updateDeviceState(parsed);
        } catch {}
      });

      es.addEventListener('device_list', (ev: MessageEvent) => {
        if (closed) return;
        try {
          const list = JSON.parse(ev.data) as DeviceLiveState[];
          setDevices(list);
        } catch {}
      });

      es.addEventListener('alert', (ev: MessageEvent) => {
        if (closed) return;
        try {
          const data = JSON.parse(ev.data);
          if (Array.isArray(data.alerts) && data.alerts.length > 0) {
            const first = data.alerts[0];
            const key = `${data.deviceId}:${first.type}:${first.description}`;
            const now = Date.now();
            if (lastAlertKeyRef.current.key !== key || now - lastAlertKeyRef.current.ts > 8000) {
              lastAlertKeyRef.current = { key, ts: now };
              onAlertRef.current?.({
                deviceId: data.deviceId,
                sourceMode: data.sourceMode,
                type: first.type,
                severity: first.severity,
                description: first.description,
              });
            }
          }
        } catch {}
      });

      es.onerror = () => {
        if (closed) return;
        setSseConnected(false);
        es?.close();
        es = null;
        startFallbackPoll();
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectSse();
          }, 5000);
        }
      };
    };

    connectSse();

    return () => {
      closed = true;
      stopFallbackPoll();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [refreshStatus, updateDeviceState]);

  // Keep activeDevice synced when selectedDeviceId changes
  useEffect(() => {
    const match = devices.find((d) => d.deviceId === selectedDeviceId) || null;
    setActiveDevice(match);
  }, [selectedDeviceId, devices]);

  useEffect(() => {
    refreshAnalytics(null);
  }, [refreshAnalytics]);

  return {
    devices,
    activeDevice,
    sseConnected,
    telemetryError,
    analytics,
    analyticsRange,
    setAnalyticsRange,
    includeSimulatedAnalytics,
    setIncludeSimulatedAnalytics,
    refreshStatus,
    refreshAnalytics,
  };
}
