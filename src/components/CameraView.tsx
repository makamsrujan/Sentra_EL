import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Camera,
  CameraOff,
  RefreshCw,
  Zap,
  ZapOff,
  X,
  Compass,
  AlertCircle,
  Eye,
  CornerDownRight,
  Crosshair,
  Upload,
  Cpu,
  Clock,
  FlaskConical,
  ExternalLink,
} from 'lucide-react';
import { formatSensorsString, getCompassDirection } from '../utils/sensors';
import { DetectedObject, FrameQuality, HazardAlert } from '../types/sentra';
import { CameraSourceType } from '../types/deviceProtocol';
import { generateDemoRoomDataUrl } from '../utils/demoRoom';
import { useCamera, BrowserCameraErrorType, BrowserCameraStatus } from '../hooks/useCamera';
import { useWearableFrames } from '../hooks/useWearableFrames';
import {
  CameraDeviceOption,
  captureImageElementSnapshot,
  computeObjectCoverBox,
} from '../services/cameraService';

export interface CameraSnapshotPayload {
  dataUrl: string | null;
  quality: FrameQuality | null;
  width: number;
  height: number;
  timestamp: number | null;
  source: CameraSourceType | 'inspection_image';
}

export interface CameraViewHandle {
  captureSnapshot: () => Promise<CameraSnapshotPayload>;
  startBrowserCamera: () => Promise<boolean>;
  stopBrowserCamera: () => void;
  getSensorsSummary: () => string;
  heading: number | null;
  getVideoElement: () => HTMLVideoElement | null;
  getCameraDiagnostics: () => {
    source: CameraSourceType;
    browserStatus: BrowserCameraStatus;
    browserErrorType: BrowserCameraErrorType;
    browserError: string | null;
    isEmbedded: boolean;
    resolution: { width: number; height: number } | null;
    wearableFrameAgeMs: number | null;
    wearableFrameStale: boolean;
    wearableConnected: boolean;
  };
}

interface CameraViewProps {
  cameraSource: CameraSourceType;
  onChangeCameraSource: (source: CameraSourceType) => void;
  findingGoal: string | null;
  onStopFinding: () => void;
  facingMode: 'environment' | 'user';
  onToggleFacingMode: () => void;
  selectedDeviceId: string | null;
  onSelectDeviceId: (deviceId: string | null) => void;
  wearableDeviceId: string;
  detectedObjects: DetectedObject[];
  detectionTimestamp: number | null;
  detectionStale: boolean;
  hazard: HazardAlert | null;
  activePerceptionPrompt: string | null;
  onCameraActiveChange?: (active: boolean) => void;
}

export const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(
  (
    {
      cameraSource,
      onChangeCameraSource,
      findingGoal,
      onStopFinding,
      facingMode,
      onToggleFacingMode,
      selectedDeviceId,
      onSelectDeviceId,
      wearableDeviceId,
      detectedObjects,
      detectionTimestamp,
      detectionStale,
      hazard,
      activePerceptionPrompt,
      onCameraActiveChange,
    },
    ref
  ) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const inspectionImgRef = useRef<HTMLImageElement | null>(null);
    const wearableImgRef = useRef<HTMLImageElement | null>(null);

    const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
      width: 480,
      height: 360,
    });

    // Separate optional developer/testbench inspection image (never conflated with live camera)
    const [inspectionImageUrl, setInspectionImageUrl] = useState<string | null>(null);
    const [inspectionLabel, setInspectionLabel] = useState<string | null>(null);
    const [showTestbenchTools, setShowTestbenchTools] = useState(false);
    const [panOffset, setPanOffset] = useState(0);

    // Device motion & compass sensors
    const motionMpsRef = useRef<number>(0);
    const headingDegRef = useRef<number | null>(null);
    const [displayHeading, setDisplayHeading] = useState<number | null>(null);
    const [displayMotion, setDisplayMotion] = useState<'still' | 'moving'>('still');

    const camera = useCamera({
      facingMode,
      selectedDeviceId,
      autoStart: false,
    });

    const wearableFrames = useWearableFrames({
      deviceId: wearableDeviceId,
      enabled: cameraSource === 'esp32_camera',
      pollIntervalMs: 900,
    });

    // Track viewport container pixel size for exact object-fit: cover bounding box projection
    useEffect(() => {
      const el = viewportRef.current;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const update = () => {
        setViewportSize({ width: el.clientWidth, height: el.clientHeight });
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    // Report active live status cleanly
    useEffect(() => {
      const isLiveActive =
        (cameraSource === 'browser_camera' && camera.isStreaming) ||
        (cameraSource === 'esp32_camera' &&
          Boolean(wearableFrames.imageUrl) &&
          !wearableFrames.isStale);
      onCameraActiveChange?.(isLiveActive);
    }, [
      cameraSource,
      camera.isStreaming,
      wearableFrames.imageUrl,
      wearableFrames.isStale,
      onCameraActiveChange,
    ]);

    // Stop browser camera automatically if switching away from browser_camera
    useEffect(() => {
      if (cameraSource !== 'browser_camera' && camera.status !== 'idle' && camera.status !== 'stopped') {
        camera.stopCamera();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraSource]);

    // Device motion & orientation listeners
    useEffect(() => {
      const handleMotion = (e: DeviceMotionEvent) => {
        const acc = e.acceleration || e.accelerationIncludingGravity;
        if (acc) {
          const current = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
          motionMpsRef.current = motionMpsRef.current * 0.85 + current * 0.15;
          setDisplayMotion(motionMpsRef.current > 0.8 ? 'moving' : 'still');
        }
      };

      const handleOrientation = (e: DeviceOrientationEvent) => {
        if (e.alpha != null) {
          headingDegRef.current = e.alpha;
          setDisplayHeading(Math.round(e.alpha));
        }
      };

      window.addEventListener('devicemotion', handleMotion);
      window.addEventListener('deviceorientation', handleOrientation);
      return () => {
        window.removeEventListener('devicemotion', handleMotion);
        window.removeEventListener('deviceorientation', handleOrientation);
      };
    }, []);

    const handleSwitchFacing = async () => {
      const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
      onToggleFacingMode();
      onSelectDeviceId(null);
      if (camera.isStreaming) {
        await camera.startCamera(null, nextFacing);
      }
    };

    const handleDeviceSelectChange = async (nextId: string) => {
      const val = nextId || null;
      onSelectDeviceId(val);
      if (cameraSource === 'browser_camera' && camera.isStreaming) {
        await camera.startCamera(val, facingMode);
      }
    };

    const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result;
        if (typeof result === 'string') {
          camera.stopCamera();
          onChangeCameraSource('none');
          setInspectionImageUrl(result);
          setInspectionLabel(`Static Image: ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    };

    const handleLoadTestRoom = (offset = 0) => {
      camera.stopCamera();
      onChangeCameraSource('none');
      setPanOffset(offset);
      setInspectionImageUrl(generateDemoRoomDataUrl(offset));
      setInspectionLabel('Synthetic Testbench Scene (Not Live Camera)');
    };

    const clearInspectionImage = () => {
      setInspectionImageUrl(null);
      setInspectionLabel(null);
    };

    const captureSnapshot = useCallback(async (): Promise<CameraSnapshotPayload> => {
      if (inspectionImageUrl && inspectionImgRef.current) {
        const snap = captureImageElementSnapshot(inspectionImgRef.current);
        return { ...snap, source: 'inspection_image' };
      }

      if (cameraSource === 'esp32_camera') {
        const wearableSnap = await wearableFrames.captureLatestFrameDataUrl();
        return {
          dataUrl: wearableSnap.dataUrl,
          quality: null,
          width: wearableSnap.width,
          height: wearableSnap.height,
          timestamp: wearableSnap.timestamp,
          source: 'esp32_camera',
        };
      }

      if (cameraSource === 'browser_camera' && camera.isStreaming) {
        const snap = camera.captureSnapshot();
        return { ...snap, source: 'browser_camera' };
      }

      return {
        dataUrl: null,
        quality: null,
        width: 0,
        height: 0,
        timestamp: null,
        source: cameraSource,
      };
    }, [inspectionImageUrl, cameraSource, wearableFrames, camera]);

    useImperativeHandle(
      ref,
      () => ({
        captureSnapshot,
        startBrowserCamera: () => camera.startCamera(),
        stopBrowserCamera: camera.stopCamera,
        getSensorsSummary: () => {
          const snap = camera.isStreaming ? camera.captureSnapshot() : null;
          return formatSensorsString(motionMpsRef.current, headingDegRef.current, snap?.quality ?? null);
        },
        heading: headingDegRef.current,
        getVideoElement: () => camera.videoRef.current,
        getCameraDiagnostics: () => ({
          source: cameraSource,
          browserStatus: camera.status,
          browserErrorType: camera.errorType,
          browserError: camera.errorMessage,
          isEmbedded: camera.isEmbedded,
          resolution: camera.resolution,
          wearableFrameAgeMs: wearableFrames.frameAgeMs,
          wearableFrameStale: wearableFrames.isStale,
          wearableConnected: wearableFrames.connectionStatus !== 'disconnected',
        }),
      }),
      [captureSnapshot, camera, cameraSource, wearableFrames]
    );

    // Resolve current rendered source dimensions for bounding-box alignment
    const currentSourceDims =
      cameraSource === 'browser_camera' && camera.resolution
        ? camera.resolution
        : cameraSource === 'esp32_camera' && wearableFrames.dimensions
        ? wearableFrames.dimensions
        : inspectionImgRef.current?.naturalWidth
        ? {
            width: inspectionImgRef.current.naturalWidth,
            height: inspectionImgRef.current.naturalHeight,
          }
        : { width: viewportSize.width, height: viewportSize.height };

    const showOverlayBoxes =
      detectedObjects.length > 0 &&
      (camera.isStreaming ||
        (cameraSource === 'esp32_camera' && Boolean(wearableFrames.imageUrl)) ||
        Boolean(inspectionImageUrl));

    return (
      <div className="space-y-2.5">
        {/* Camera Source Selector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card border border-border px-3 py-2">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border/50">
            <button
              type="button"
              onClick={() => {
                clearInspectionImage();
                onChangeCameraSource('browser_camera');
              }}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                cameraSource === 'browser_camera'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Live Camera
            </button>
            <button
              type="button"
              onClick={() => {
                clearInspectionImage();
                onChangeCameraSource('esp32_camera');
              }}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                cameraSource === 'esp32_camera'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Wearable Camera
            </button>
            <button
              type="button"
              onClick={() => {
                camera.stopCamera();
                onChangeCameraSource('none');
              }}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                cameraSource === 'none' && !inspectionImageUrl
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              No Camera
            </button>
          </div>

          {/* Browser Camera Controls */}
          <div className="flex items-center gap-2">
            {cameraSource === 'browser_camera' && !inspectionImageUrl && (
              <>
                {camera.devices.length > 1 && (
                  <select
                    aria-label="Select browser camera device"
                    value={camera.activeDeviceId || selectedDeviceId || ''}
                    onChange={(e) => handleDeviceSelectChange(e.target.value)}
                    className="max-w-[160px] truncate rounded-lg bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="">Auto ({facingMode === 'environment' ? 'Rear' : 'Front'})</option>
                    {camera.devices.map((dev: CameraDeviceOption) => (
                      <option key={dev.deviceId} value={dev.deviceId}>
                        {dev.label}
                      </option>
                    ))}
                  </select>
                )}

                {camera.isStreaming ? (
                  <button
                    type="button"
                    onClick={camera.stopCamera}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 border border-destructive/40 px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/25 whitespace-nowrap"
                  >
                    <CameraOff className="h-3.5 w-3.5" />
                    <span>Stop Camera</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => camera.startCamera()}
                    disabled={camera.status === 'starting'}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 disabled:opacity-60 whitespace-nowrap"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>{camera.status === 'starting' ? 'Starting…' : 'Start Camera'}</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => setShowTestbenchTools((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground whitespace-nowrap"
              title="Open developer image inspection / testbench"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Test Input</span>
            </button>
          </div>
        </div>

        {/* Collapsible Developer / Inspection Test Input Panel */}
        {showTestbenchTools && (
          <div className="rounded-xl bg-secondary/70 border border-border p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-foreground">
                Static Inspection & Synthetic Test Source (Not Live Hardware)
              </span>
              {inspectionImageUrl && (
                <button
                  type="button"
                  onClick={clearInspectionImage}
                  className="text-destructive font-semibold hover:underline"
                >
                  Clear Test Image
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-1.5 rounded-lg bg-card border border-border px-3 py-1.5 font-semibold text-foreground hover:border-primary cursor-pointer">
                <Upload className="h-3.5 w-3.5 text-primary" />
                <span>Upload Still Photo to Inspect</span>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              </label>

              <button
                type="button"
                onClick={() => handleLoadTestRoom(0)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-card border border-border px-3 py-1.5 font-semibold text-foreground hover:border-primary"
              >
                <FlaskConical className="h-3.5 w-3.5 text-accent" />
                <span>Load Synthetic Test Scene</span>
              </button>

              {inspectionImageUrl && inspectionLabel?.includes('Synthetic') && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleLoadTestRoom(panOffset - 60)}
                    className="rounded-lg bg-card border border-border px-2.5 py-1.5 font-semibold"
                  >
                    Pan Left
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadTestRoom(panOffset + 60)}
                    className="rounded-lg bg-card border border-border px-2.5 py-1.5 font-semibold"
                  >
                    Pan Right
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <div
          ref={viewportRef}
          className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-card border border-border shadow-md"
        >
          {/* 1. Static Inspection / Test Image */}
          {inspectionImageUrl ? (
            <div className="relative h-full w-full bg-slate-950">
              <img
                ref={inspectionImgRef}
                src={inspectionImageUrl}
                alt={inspectionLabel || 'Inspection snapshot'}
                className="h-full w-full object-cover"
              />
              <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-background/90 border border-border px-2.5 py-1 text-xs font-semibold text-foreground">
                <FlaskConical className="h-3.5 w-3.5 text-accent" />
                <span>{inspectionLabel}</span>
              </div>
            </div>
          ) : cameraSource === 'esp32_camera' ? (
            /* 2. Wearable ESP32-S3 JPEG Stream */
            wearableFrames.imageUrl ? (
              <div className="relative h-full w-full bg-slate-950">
                <img
                  ref={wearableImgRef}
                  src={wearableFrames.imageUrl}
                  alt="ESP32-S3 Wearable Camera Frame"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) {
                      wearableFrames.setDimensions({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                      });
                    }
                  }}
                  className={`h-full w-full object-cover ${wearableFrames.isStale ? 'opacity-65 grayscale-[30%]' : ''}`}
                />
                <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-background/90 border border-border px-2.5 py-1 text-xs font-mono tabular-nums">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  <span>
                    {wearableDeviceId} · Seq #{wearableFrames.sequence ?? '—'}
                  </span>
                  {wearableFrames.isStale && (
                    <span className="text-destructive font-bold">
                      · STALE ({wearableFrames.frameAgeMs ? Math.round(wearableFrames.frameAgeMs / 1000) : '?'}s)
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-card text-muted-foreground space-y-2">
                <Cpu className="h-10 w-10 text-muted-foreground/60" />
                <p className="text-base font-bold text-foreground">
                  {wearableFrames.connectionStatus === 'disconnected'
                    ? 'Wearable Camera Disconnected'
                    : 'Waiting for Wearable JPEG Frames'}
                </p>
                <p className="text-xs max-w-sm">
                  Listening for authenticated JPEG frames on <span className="font-mono">POST /api/device/frame</span> for{' '}
                  <span className="font-mono text-foreground">{wearableDeviceId}</span>.
                </p>
                {wearableFrames.errorMessage && (
                  <p className="text-xs text-destructive font-mono">{wearableFrames.errorMessage}</p>
                )}
              </div>
            )
          ) : cameraSource === 'browser_camera' ? (
            /* 3. Real Browser Camera Video Stream */
            <>
              <video
                ref={camera.videoRef}
                playsInline
                muted
                autoPlay
                className={`h-full w-full object-cover transition-opacity duration-200 ${
                  camera.isStreaming ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {!camera.isStreaming && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-5 text-center bg-card">
                  <div className="max-w-sm space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary border border-border text-primary">
                      {camera.status === 'error' ? (
                        <AlertCircle className="h-6 w-6 text-destructive" />
                      ) : (
                        <Camera className="h-6 w-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-foreground">
                        {camera.status === 'starting'
                          ? 'Starting Live Camera…'
                          : camera.errorType === 'blocked_by_embed'
                          ? 'Camera Blocked by Embedded Preview'
                          : camera.errorType === 'permission_denied'
                          ? 'Camera Permission Denied'
                          : camera.errorType === 'https_required'
                          ? 'HTTPS Required for Camera'
                          : camera.errorType === 'unsupported'
                          ? 'Camera Unsupported in This Browser'
                          : camera.errorType === 'in_use'
                          ? 'Camera Already in Use'
                          : camera.errorType === 'disconnected'
                          ? 'Camera Disconnected'
                          : camera.errorType === 'playback_failed'
                          ? 'Video Playback Failed'
                          : camera.status === 'error'
                          ? 'Camera Unavailable'
                          : 'Live Camera Stopped'}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {camera.errorMessage ||
                          'Tap Start Camera to open a live preview from this device. Frames are only sent for AI Visual Analysis when you ask or trigger a scan.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          camera.status === 'error' ? camera.retryCamera() : camera.startCamera()
                        }
                        disabled={camera.status === 'starting'}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-60"
                      >
                        {camera.status === 'error' ? (
                          <RefreshCw className="h-4 w-4" />
                        ) : (
                          <Camera className="h-4 w-4" />
                        )}
                        <span>
                          {camera.status === 'starting'
                            ? 'Connecting…'
                            : camera.status === 'error'
                            ? 'Retry Camera'
                            : 'Start Camera'}
                        </span>
                      </button>

                      {camera.errorType === 'blocked_by_embed' && typeof window !== 'undefined' && (
                        <a
                          href={window.location.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-secondary border border-border px-4 py-2.5 text-xs font-bold text-foreground hover:border-primary"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-primary" />
                          <span>Open Direct HTTPS Tab</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* 4. No Camera Selected */
            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-card text-muted-foreground space-y-2">
              <CameraOff className="h-10 w-10 opacity-50" />
              <p className="text-base font-bold text-foreground">No Camera Active</p>
              <p className="text-xs max-w-sm">
                Select Live Camera or Wearable Camera above to enable visual perception.
              </p>
            </div>
          )}

          {/* Accurate Object-Fit: Cover Bounding Box Overlay */}
          {showOverlayBoxes && (
            <svg
              className="absolute inset-0 pointer-events-none h-full w-full z-10"
              width={viewportSize.width}
              height={viewportSize.height}
            >
              {detectedObjects.map((obj) => {
                if (!obj.box2d) return null;
                const srcW = obj.sourceWidth || currentSourceDims.width;
                const srcH = obj.sourceHeight || currentSourceDims.height;
                const rect = computeObjectCoverBox(
                  obj.box2d,
                  viewportSize.width,
                  viewportSize.height,
                  srcW,
                  srcH
                );
                if (!rect) return null;

                const isTarget =
                  obj.isTargetGoal ||
                  Boolean(findingGoal && obj.label.toLowerCase().includes(findingGoal.toLowerCase()));
                const strokeColor = detectionStale
                  ? '#94a3b8'
                  : isTarget
                  ? '#ffd15c'
                  : '#38bdf8';

                const labelText = `${obj.label} (${Math.round(obj.confidence * 100)}%) · ${obj.clockPosition}${
                  detectionStale ? ' [Stale]' : ''
                }`;
                const boxWidth = Math.min(viewportSize.width - rect.x - 4, Math.max(120, labelText.length * 6.8 + 14));
                const labelY = rect.y > 26 ? rect.y - 24 : rect.y + 4;

                return (
                  <g key={obj.id} opacity={detectionStale ? 0.55 : 1}>
                    <rect
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      fill={isTarget ? 'rgba(255, 209, 92, 0.12)' : 'rgba(56, 189, 248, 0.08)'}
                      stroke={strokeColor}
                      strokeWidth={2.5}
                      strokeDasharray={detectionStale || isTarget ? '6 4' : undefined}
                      rx={6}
                    />
                    <rect
                      x={rect.x}
                      y={labelY}
                      width={boxWidth}
                      height={20}
                      rx={4}
                      fill="#0f172a"
                      fillOpacity={0.9}
                      stroke={strokeColor}
                      strokeWidth={1}
                    />
                    <text
                      x={rect.x + 6}
                      y={labelY + 14}
                      fill={isTarget ? '#ffd15c' : '#f8fafc'}
                      fontSize={11}
                      fontWeight={700}
                      fontFamily="var(--font-mono)"
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {/* Hazard Alert Banner */}
          {hazard && (
            <div className="absolute left-3 right-3 top-3 z-30 flex items-center gap-3 rounded-xl bg-destructive px-3.5 py-2.5 text-destructive-foreground shadow-lg">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-extrabold uppercase tracking-wider">
                  {hazard.source === 'vision_ai' ? 'Visual Caution' : 'Sensor Hazard Alert'}
                </p>
                <p className="text-sm font-semibold truncate">
                  {hazard.description} ({hazard.clockPosition})
                </p>
              </div>
            </div>
          )}

          {/* Active Perception Directive */}
          {activePerceptionPrompt && !hazard && (
            <div className="absolute left-3 right-3 top-3 z-20 flex items-center gap-2.5 rounded-xl bg-card/95 border border-primary px-3 py-2 text-foreground shadow-md">
              <CornerDownRight className="h-4 w-4 text-primary shrink-0" />
              <p className="text-xs font-bold text-primary">
                Camera Adjustment: <span className="text-foreground">{activePerceptionPrompt}</span>
              </p>
            </div>
          )}

          {/* Active Finding Goal Bar */}
          {findingGoal && !hazard && !activePerceptionPrompt && (
            <div className="absolute left-3 right-3 top-3 z-20 flex items-center justify-between gap-3 rounded-xl bg-card/95 border border-accent px-3 py-2 text-foreground shadow-md">
              <div className="flex items-center gap-2 min-w-0">
                <Crosshair className="h-4 w-4 text-accent shrink-0" />
                <p className="text-sm font-bold truncate">Locating: {findingGoal}</p>
              </div>
              <button
                type="button"
                onClick={onStopFinding}
                className="inline-flex items-center gap-1 shrink-0 rounded-lg bg-secondary px-2.5 py-1 text-xs font-bold text-foreground hover:bg-secondary/80"
              >
                <X className="h-3.5 w-3.5" />
                <span>Stop</span>
              </button>
            </div>
          )}

          {/* Bottom Telemetry & Camera Controls Bar */}
          {(camera.isStreaming ||
            (cameraSource === 'esp32_camera' && Boolean(wearableFrames.imageUrl)) ||
            Boolean(inspectionImageUrl)) && (
            <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-background/90 border border-border/70 px-2.5 py-1 text-xs font-mono tabular-nums text-foreground">
                <span className="inline-flex items-center gap-1">
                  <Compass className="h-3.5 w-3.5 text-primary" />
                  {displayHeading != null
                    ? `${displayHeading}° ${getCompassDirection(displayHeading)}`
                    : 'Heading N/A'}
                </span>
                <span className="text-muted-foreground">·</span>
                <span>{displayMotion === 'moving' ? 'Moving' : 'Still'}</span>
                {cameraSource === 'browser_camera' && camera.resolution && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span>
                      {camera.resolution.width}×{camera.resolution.height}
                    </span>
                  </>
                )}
                {detectionTimestamp && detectedObjects.length > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className={detectionStale ? 'text-muted-foreground' : 'text-primary font-bold'}>
                      <Clock className="inline h-3 w-3 mr-0.5" />
                      {new Date(detectionTimestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                      {detectionStale ? ' (Stale)' : ''}
                    </span>
                  </>
                )}
              </div>

              {cameraSource === 'browser_camera' && camera.isStreaming && (
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  {camera.hasTorch && (
                    <button
                      type="button"
                      onClick={camera.toggleTorch}
                      className={`rounded-lg p-2 border border-border/70 ${
                        camera.isTorchOn
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background/90 text-foreground hover:bg-background'
                      }`}
                      aria-label={camera.isTorchOn ? 'Turn off torch' : 'Turn on torch'}
                    >
                      {camera.isTorchOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSwitchFacing}
                    className="rounded-lg bg-background/90 p-2 text-foreground border border-border/70 hover:bg-background"
                    aria-label="Switch front or rear camera"
                    title="Switch front/rear camera"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

CameraView.displayName = 'CameraView';
