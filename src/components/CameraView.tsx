import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Camera,
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
  Sparkles,
} from 'lucide-react';
import { analyzeFrameQuality, formatSensorsString, getCompassDirection } from '../utils/sensors';
import { DetectedObject, FrameQuality, HazardAlert, TrackedObject, SlamTrackingStatus, PerceptionMode } from '../types/sentra';
import { generateDemoRoomDataUrl } from '../utils/demoRoom';

export interface CameraViewHandle {
  captureFrame: () => { dataUrl: string | null; quality: FrameQuality | null };
  startCamera: () => Promise<boolean>;
  stopCamera: () => void;
  getSensorsSummary: () => string;
  isReady: boolean;
  heading: number | null;
  getVideoElement: () => HTMLVideoElement | null;
  enableDemoFeed: () => void;
  isDemoFeed: boolean;
}

interface CameraViewProps {
  findingGoal: string | null;
  onStopFinding: () => void;
  facingMode: 'environment' | 'user';
  onToggleFacingMode: () => void;
  detectedObjects?: DetectedObject[];
  trackedObjects?: TrackedObject[];
  hazard?: HazardAlert | null;
  activePerceptionPrompt?: string | null;
  useWearableFeed?: boolean;
  wearableFrame?: string | null;
  onCameraStatusChange?: (active: boolean) => void;
  slamStatus?: SlamTrackingStatus;
  slamFeatureCount?: number;
  perceptionMode?: PerceptionMode;
}

export const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(
  (
    {
      findingGoal,
      onStopFinding,
      facingMode,
      onToggleFacingMode,
      detectedObjects = [],
      trackedObjects = [],
      hazard = null,
      activePerceptionPrompt = null,
      useWearableFeed = false,
      wearableFrame = null,
      onCameraStatusChange,
      slamStatus,
      slamFeatureCount = 0,
      perceptionMode = 'online_gemini',
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isPermissionDenied, setIsPermissionDenied] = useState(false);
    const [hasTorch, setHasTorch] = useState(false);
    const [isTorchOn, setIsTorchOn] = useState(false);

    // Simulated / Demo Room Feed fallback
    const [isDemoFeedActive, setIsDemoFeedActive] = useState(false);
    const [demoFrameUrl, setDemoFrameUrl] = useState<string | null>(null);
    const [panOffset, setPanOffset] = useState<number>(0);

    // Sensors
    const motionMpsRef = useRef<number>(0);
    const headingDegRef = useRef<number | null>(null);
    const [displayHeading, setDisplayHeading] = useState<number | null>(null);
    const [displayMotion, setDisplayMotion] = useState<'still' | 'moving'>('still');

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

    // Stop current camera tracks
    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsCameraActive(false);
      setIsTorchOn(false);
      setHasTorch(false);
      onCameraStatusChange?.(false);
    };

    // Enable Demo Room Feed
    const enableDemoRoomFeed = () => {
      stopCamera();
      setIsDemoFeedActive(true);
      setCameraError(null);
      setIsPermissionDenied(false);
      const frame = generateDemoRoomDataUrl(panOffset);
      setDemoFrameUrl(frame);
      onCameraStatusChange?.(true);
    };

    // Start camera with requested facingMode
    const startCamera = async (): Promise<boolean> => {
      stopCamera();
      setCameraError(null);
      setIsPermissionDenied(false);

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera not supported in this browser environment.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setIsCameraActive(true);
        setIsDemoFeedActive(false);
        setDemoFrameUrl(null);
        onCameraStatusChange?.(true);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const capabilities = (videoTrack.getCapabilities?.() as any) || {};
          if ('torch' in capabilities) {
            setHasTorch(true);
          }
        }

        return true;
      } catch (err: any) {
        const isPerm = err.name === 'NotAllowedError' || err.message?.includes('denied');
        setIsPermissionDenied(isPerm);
        
        // Use console.warn for graceful permission prompt handling
        console.warn('Camera permission status:', err.name || err.message);

        const msg = isPerm
          ? 'Camera permission was not granted. Tap Enable Camera below, or use the Demo Room Feed to test SENTRA.'
          : 'Could not open camera. Please ensure camera is not in use by another app.';
        setCameraError(msg);
        setIsCameraActive(false);
        onCameraStatusChange?.(false);
        return false;
      }
    };

    // Toggle torch if supported
    const toggleTorch = async () => {
      if (!streamRef.current) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          const newTorchState = !isTorchOn;
          await (track as any).applyConstraints({
            advanced: [{ torch: newTorchState }],
          });
          setIsTorchOn(newTorchState);
        } catch (e) {
          console.warn('Could not toggle torch:', e);
        }
      }
    };

    // Handle user photo upload for offline inspection
    const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          stopCamera();
          setIsDemoFeedActive(true);
          setDemoFrameUrl(dataUrl);
          setCameraError(null);
          setIsPermissionDenied(false);
          onCameraStatusChange?.(true);
        }
      };
      reader.readAsDataURL(file);
    };

    // Handle panning in demo room mode
    const handleDemoPan = (direction: 'left' | 'right') => {
      const newOffset = panOffset + (direction === 'left' ? -60 : 60);
      setPanOffset(newOffset);
      const frame = generateDemoRoomDataUrl(newOffset);
      setDemoFrameUrl(frame);
    };

    useEffect(() => {
      if (!useWearableFeed && !isDemoFeedActive) {
        startCamera();
      }
      return () => {
        stopCamera();
      };
    }, [facingMode, useWearableFeed]);

    useImperativeHandle(ref, () => ({
      captureFrame: () => {
        if (useWearableFeed && wearableFrame) {
          return { dataUrl: wearableFrame, quality: { brightness: 0.7, sharpness: 90 } };
        }

        if (isDemoFeedActive && demoFrameUrl) {
          return { dataUrl: demoFrameUrl, quality: { brightness: 0.85, sharpness: 92 } };
        }

        const video = videoRef.current;
        if (!video || !isCameraActive || !video.videoWidth) {
          return { dataUrl: null, quality: null };
        }

        const quality = analyzeFrameQuality(video);
        const scale = Math.min(1, 1024 / video.videoWidth);
        const width = Math.round(video.videoWidth * scale);
        const height = Math.round(video.videoHeight * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { dataUrl: null, quality };

        ctx.drawImage(video, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

        return { dataUrl, quality };
      },
      startCamera,
      stopCamera,
      enableDemoFeed: enableDemoRoomFeed,
      isDemoFeed: isDemoFeedActive,
      getSensorsSummary: () => {
        const video = videoRef.current;
        const quality = video && video.videoWidth ? analyzeFrameQuality(video) : null;
        return formatSensorsString(motionMpsRef.current, headingDegRef.current, quality);
      },
      isReady: isCameraActive || isDemoFeedActive || (useWearableFeed && Boolean(wearableFrame)),
      heading: headingDegRef.current,
      getVideoElement: () => videoRef.current,
    }));

    return (
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl bg-card border-2 border-border shadow-2xl">
        {/* Wearable Camera Feed vs Demo Room Feed vs Browser Video Feed */}
        {useWearableFeed ? (
          wearableFrame ? (
            <img
              src={wearableFrame}
              alt="Wearable Headband Camera Feed"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-card text-muted-foreground">
              <Eye className="h-12 w-12 text-primary animate-pulse mb-3" />
              <p className="text-lg font-bold text-foreground">Waiting for Wearable Camera</p>
              <p className="text-xs mt-1">ESP32-S3 Headband video stream will appear here</p>
            </div>
          )
        ) : isDemoFeedActive && demoFrameUrl ? (
          <div className="relative h-full w-full bg-slate-900">
            <img
              src={demoFrameUrl}
              alt="Demonstration Room Feed"
              className="h-full w-full object-cover transition-transform duration-300"
            />
            {/* Demo Room Mode Badge */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-xl bg-slate-900/90 backdrop-blur-md px-3 py-1.5 border border-primary/40 shadow-lg">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-xs font-bold text-foreground">Demo Room Active</span>
              <button
                onClick={() => startCamera()}
                className="ml-2 text-xs font-semibold text-primary underline hover:text-primary/80"
              >
                Switch to Live Webcam
              </button>
            </div>

            {/* Quick Pan Controls for Demo Room */}
            <div className="absolute top-14 left-3 z-20 flex items-center gap-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md px-2 py-1 border border-border/50">
              <span className="text-[10px] uppercase font-bold text-muted-foreground mr-1">Pan Room:</span>
              <button
                onClick={() => handleDemoPan('left')}
                className="px-2 py-0.5 rounded bg-secondary text-foreground text-xs font-bold hover:bg-secondary/80"
                title="Pan camera left"
              >
                ◀ Left
              </button>
              <button
                onClick={() => handleDemoPan('right')}
                className="px-2 py-0.5 rounded bg-secondary text-foreground text-xs font-bold hover:bg-secondary/80"
                title="Pan camera right"
              >
                Right ▶
              </button>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              isCameraActive ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          />
        )}

        {/* Real-time Bounding Box & Detected Objects Overlay */}
        {(isCameraActive || isDemoFeedActive || useWearableFeed) && detectedObjects.length > 0 && (
          <svg
            className="absolute inset-0 pointer-events-none h-full w-full z-10"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {detectedObjects.map((obj) => {
              if (!obj.box2d) return null;
              const [ymin, xmin, ymax, xmax] = obj.box2d;
              const width = Math.max(20, xmax - xmin);
              const height = Math.max(20, ymax - ymin);
              const isTarget =
                obj.isTargetGoal ||
                Boolean(findingGoal && obj.label.toLowerCase().includes(findingGoal.toLowerCase()));

              const matchedTrack = trackedObjects.find((t) => t.label.toLowerCase() === obj.label.toLowerCase());

              const strokeColor = isTarget ? '#ffd15c' : '#7dd3fc';
              const fillColor = isTarget ? 'rgba(255, 209, 92, 0.15)' : 'rgba(125, 211, 252, 0.12)';

              const trackTag = matchedTrack
                ? `[${matchedTrack.trackId}] ${matchedTrack.movement !== 'stationary' ? `(${matchedTrack.movement})` : ''}`
                : '';

              return (
                <g key={obj.id}>
                  {/* Bounding box rectangle */}
                  <rect
                    x={xmin}
                    y={ymin}
                    width={width}
                    height={height}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth="3.5"
                    strokeDasharray={isTarget ? '8 4' : undefined}
                    rx="12"
                  />
                  {/* Corner accent reticles */}
                  <circle cx={xmin} cy={ymin} r="4" fill={strokeColor} />
                  <circle cx={xmin + width} cy={ymin} r="4" fill={strokeColor} />
                  <circle cx={xmin + width} cy={ymin + height} r="4" fill={strokeColor} />
                  <circle cx={xmin} cy={ymin + height} r="4" fill={strokeColor} />

                  {/* Object label background pill */}
                  <rect
                    x={xmin}
                    y={Math.max(8, ymin - 38)}
                    width={Math.min(460, Math.max(140, (obj.label.length + trackTag.length) * 14 + 75))}
                    height="32"
                    fill="#14151a"
                    stroke={strokeColor}
                    strokeWidth="1.5"
                    rx="8"
                    opacity="0.94"
                  />
                  {/* Label & confidence text with Temporal Track */}
                  <text
                    x={xmin + 10}
                    y={Math.max(28, ymin - 16)}
                    fill={isTarget ? '#ffd15c' : '#ffffff'}
                    fontSize="16"
                    fontWeight="bold"
                    fontFamily="sans-serif"
                  >
                    {obj.label} {trackTag} ({Math.round(obj.confidence * 100)}%) • {obj.clockPosition}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {/* Camera Inactive / Permission Required Overlay */}
        {!isCameraActive && !useWearableFeed && !isDemoFeedActive && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-card">
            <div className="max-w-xs space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {isPermissionDenied ? (
                  <AlertCircle className="h-9 w-9 text-destructive" />
                ) : (
                  <Camera className="h-9 w-9" />
                )}
              </div>

              <div>
                <h3 className="text-xl font-bold text-foreground">
                  {isPermissionDenied ? 'Camera Access Needed' : 'Camera is Inactive'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {cameraError ||
                    'Allow camera access so SENTRA can observe your surroundings and guide you.'}
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() => startCamera()}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground shadow-lg hover:brightness-110 active:scale-95 transition-all"
                >
                  <Camera className="h-5 w-5" />
                  <span>{isPermissionDenied ? 'Enable Camera Access' : 'Start Camera'}</span>
                </button>

                <button
                  onClick={enableDemoRoomFeed}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-bold text-foreground hover:bg-secondary/80 active:scale-95 transition-all border border-border/60"
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>Use Demo Room Feed (No Camera Needed)</span>
                </button>

                <label className="w-full flex items-center justify-center gap-2 rounded-xl bg-background border border-border/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-all">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload Room Photo to Inspect</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* SLAM Odometry & Perception Mode Status Badges in Top-Right */}
        {(isCameraActive || isDemoFeedActive || useWearableFeed) && (
          <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5 pointer-events-none">
            {slamStatus && (
              <div className="flex items-center gap-1.5 rounded-full bg-background/85 backdrop-blur-md px-2.5 py-1 text-[10px] font-bold border border-border/50 text-foreground shadow-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    slamStatus === 'tracking'
                      ? 'bg-emerald-400 animate-pulse'
                      : slamStatus === 'degraded'
                      ? 'bg-amber-400'
                      : 'bg-rose-400'
                  }`}
                />
                <span className="uppercase">SLAM: {slamStatus}</span>
                {slamFeatureCount > 0 && <span className="text-muted-foreground font-mono">({slamFeatureCount} pts)</span>}
              </div>
            )}

            <div className="flex items-center gap-1 rounded-full bg-background/85 backdrop-blur-md px-2.5 py-0.5 text-[10px] font-bold border border-border/50 shadow-sm">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  perceptionMode === 'offline_local' ? 'bg-amber-400' : 'bg-primary animate-pulse'
                }`}
              />
              <span className="text-muted-foreground">
                {perceptionMode === 'offline_local' ? 'Offline Local Vision' : 'Online Gemini 3.8'}
              </span>
            </div>
          </div>
        )}

        {/* Hazard Caution Overlay Banner */}
        {hazard && (
          <div className="absolute left-3 right-3 top-3 z-30 flex items-center gap-3 rounded-2xl bg-destructive px-4 py-3 text-destructive-foreground shadow-2xl animate-pulse">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <div className="flex-1">
              <p className="text-base font-extrabold tracking-wide uppercase">Hazard Warning</p>
              <p className="text-sm font-semibold">
                {hazard.description} ({hazard.clockPosition})
              </p>
            </div>
          </div>
        )}

        {/* Active Perception Directive: Prompts user to tilt, pan, or adjust */}
        {activePerceptionPrompt && !hazard && (
          <div className="absolute left-3 right-3 top-3 z-20 flex items-center gap-2.5 rounded-2xl bg-card/95 border border-primary px-3.5 py-2.5 text-foreground backdrop-blur-md shadow-xl">
            <CornerDownRight className="h-5 w-5 text-primary shrink-0 animate-bounce" />
            <p className="text-sm font-bold text-primary leading-tight">
              Adjustment: <span className="text-foreground">{activePerceptionPrompt}</span>
            </p>
          </div>
        )}

        {/* Active Finding Goal Bar */}
        {findingGoal && !hazard && !activePerceptionPrompt && (
          <div className="absolute left-3 right-3 top-3 z-20 flex items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-accent-foreground shadow-xl">
            <div className="flex items-center gap-2 overflow-hidden">
              <Crosshair className="h-5 w-5 animate-spin text-accent-foreground" />
              <p className="text-lg font-bold truncate">Locating: {findingGoal}</p>
            </div>
            <button
              onClick={onStopFinding}
              className="flex items-center gap-1 shrink-0 rounded-xl bg-background/90 px-3 py-1.5 text-base font-bold text-foreground hover:bg-background transition-colors active:scale-90"
              aria-label="Stop searching"
            >
              <X className="h-5 w-5" />
              <span>Stop</span>
            </button>
          </div>
        )}

        {/* Sensor & Camera overlay pill in bottom area */}
        {(isCameraActive || isDemoFeedActive || useWearableFeed) && (
          <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
            {/* Compass & Motion Badge */}
            <div className="flex items-center gap-2 rounded-xl bg-background/85 backdrop-blur-md px-3 py-1.5 text-sm font-semibold text-foreground border border-border/50 shadow-md">
              <Compass className="h-4 w-4 text-primary" />
              <span>
                {displayHeading != null
                  ? `${displayHeading}° ${getCompassDirection(displayHeading)}`
                  : 'Compass'}
              </span>
              <span className="text-muted-foreground">•</span>
              <span className={displayMotion === 'moving' ? 'text-accent' : 'text-muted-foreground'}>
                {displayMotion === 'moving' ? 'Moving' : 'Still'}
              </span>
              {detectedObjects.length > 0 && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-primary font-bold">{detectedObjects.length} in view</span>
                </>
              )}
            </div>

            {/* Camera controls */}
            <div className="flex items-center gap-2 pointer-events-auto">
              {hasTorch && !useWearableFeed && !isDemoFeedActive && (
                <button
                  onClick={toggleTorch}
                  className={`rounded-xl p-2.5 backdrop-blur-md border border-border/50 transition-all ${
                    isTorchOn
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'bg-background/80 text-foreground hover:bg-background'
                  }`}
                  aria-label={isTorchOn ? 'Turn off torch' : 'Turn on torch'}
                  title={isTorchOn ? 'Turn off torch' : 'Turn on torch'}
                >
                  {isTorchOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                </button>
              )}

              {!useWearableFeed && !isDemoFeedActive && (
                <button
                  onClick={onToggleFacingMode}
                  className="rounded-xl bg-background/80 backdrop-blur-md p-2.5 text-foreground border border-border/50 hover:bg-background transition-all active:rotate-180"
                  aria-label={`Switch camera, currently ${facingMode === 'environment' ? 'back' : 'front'}`}
                  title="Switch camera"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

CameraView.displayName = 'CameraView';
