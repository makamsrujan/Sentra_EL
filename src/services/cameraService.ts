import { FrameQuality } from '../types/sentra';
import { analyzeFrameQuality } from '../utils/sensors';

export interface CameraDeviceOption {
  deviceId: string;
  label: string;
}

export interface CapturedFrameResult {
  dataUrl: string | null;
  quality: FrameQuality | null;
  width: number;
  height: number;
  timestamp: number | null;
}

export type BrowserCameraErrorType =
  | 'permission_denied'
  | 'os_permission_denied'
  | 'blocked_by_embed'
  | 'https_required'
  | 'unavailable'
  | 'invalid_device_id'
  | 'unsupported'
  | 'in_use'
  | 'disconnected'
  | 'playback_failed'
  | null;

export interface CameraEnvironmentInfo {
  isSecureContext: boolean;
  apiSupported: boolean;
  isEmbeddedIframe: boolean;
  permissionsPolicyBlocked: boolean;
  permissionState: PermissionState | 'unknown';
}

export function isCameraApiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')
  );
}

export function isEmbeddedContext(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export async function inspectCameraEnvironment(): Promise<CameraEnvironmentInfo> {
  const isSecureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : true;
  const apiSupported = isCameraApiSupported();
  const isEmbeddedIframe = isEmbeddedContext();

  let permissionsPolicyBlocked = false;
  if (typeof document !== 'undefined') {
    const docAny = document as any;
    if (docAny.permissionsPolicy && typeof docAny.permissionsPolicy.allowsFeature === 'function') {
      try {
        permissionsPolicyBlocked = docAny.permissionsPolicy.allowsFeature('camera') === false;
      } catch {}
    } else if (docAny.featurePolicy && typeof docAny.featurePolicy.allowsFeature === 'function') {
      try {
        permissionsPolicyBlocked = docAny.featurePolicy.allowsFeature('camera') === false;
      } catch {}
    }
  }

  let permissionState: PermissionState | 'unknown' = 'unknown';
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      permissionState = status.state;
    } catch {
      permissionState = 'unknown';
    }
  }

  return {
    isSecureContext,
    apiSupported,
    isEmbeddedIframe,
    permissionsPolicyBlocked,
    permissionState,
  };
}

export function classifyCameraError(
  err: any,
  env: CameraEnvironmentInfo,
  ctx: { hadExplicitDeviceId?: boolean } = {}
): { type: Exclude<BrowserCameraErrorType, null>; message: string } {
  if (!env.isSecureContext) {
    return {
      type: 'https_required',
      message: 'Camera access requires a secure HTTPS context (or localhost). Open SENTRA over HTTPS.',
    };
  }

  if (!env.apiSupported) {
    return {
      type: 'unsupported',
      message: 'Browser camera acquisition (navigator.mediaDevices.getUserMedia) is not supported in this browser.',
    };
  }

  const name = String(err?.name || '');
  const rawMsg = String(err?.message || '').toLowerCase();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    // Only blame embedded Permissions Policy when PermissionsPolicy explicitly blocks it
    // or the browser error message explicitly names a frame/policy restriction.
    const confirmedEmbedPolicyBlock =
      env.permissionsPolicyBlocked ||
      rawMsg.includes('permissions policy') ||
      rawMsg.includes('feature policy') ||
      rawMsg.includes('disallowed') ||
      rawMsg.includes('iframe');

    if (confirmedEmbedPolicyBlock) {
      return {
        type: 'blocked_by_embed',
        message:
          'Camera access is blocked by this embedded preview frame (Permissions Policy). Open SENTRA directly in a top-level HTTPS browser tab.',
      };
    }

    if (env.permissionState === 'granted') {
      return {
        type: 'os_permission_denied',
        message:
          'Site camera permission shows as granted, but OS privacy controls or browser security blocked hardware access. Check system Camera Privacy settings (or open a top-level HTTPS tab) and retry.',
      };
    }

    return {
      type: 'permission_denied',
      message:
        'Camera permission was denied for this site. Allow camera access in your browser site settings and tap Retry Camera.',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      type: 'in_use',
      message: 'Camera hardware is currently in use by another app or tab. Close other camera apps and tap Retry Camera.',
    };
  }

  if (name === 'OverconstrainedError' || (name === 'NotFoundError' && ctx.hadExplicitDeviceId)) {
    return {
      type: 'invalid_device_id',
      message:
        'The previously selected camera device ID is unavailable or unsupported. Resetting to Auto camera selection and retrying may resolve this.',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      type: 'unavailable',
      message: 'No compatible camera device was detected on this device.',
    };
  }

  return {
    type: 'unavailable',
    message: err?.message || 'Unable to start browser camera.',
  };
}

export async function enumerateCameraDevices(): Promise<CameraDeviceOption[]> {
  if (!isCameraApiSupported() || !navigator.mediaDevices.enumerateDevices) {
    return [];
  }
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'videoinput' && d.deviceId !== '')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label?.trim() || `Camera ${idx + 1}`,
      }));
  } catch {
    return [];
  }
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
  } catch {
    // Ignore track stop errors during cleanup
  }
}

/**
 * Captures a single JPEG snapshot for on-demand AI visual analysis without duplicating video frames continuously.
 */
export function captureVideoSnapshot(
  video: HTMLVideoElement | null,
  maxWidth = 1024
): CapturedFrameResult {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return { dataUrl: null, quality: null, width: 0, height: 0, timestamp: null };
  }

  const quality = analyzeFrameQuality(video);
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: null, quality, width: 0, height: 0, timestamp: null };
  }

  ctx.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
  return {
    dataUrl,
    quality,
    width,
    height,
    timestamp: Date.now(),
  };
}

export function captureImageElementSnapshot(
  img: HTMLImageElement | null,
  maxWidth = 1024
): CapturedFrameResult {
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) {
    return { dataUrl: null, quality: null, width: 0, height: 0, timestamp: null };
  }

  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: null, quality: null, width: 0, height: 0, timestamp: null };
  }

  ctx.drawImage(img, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.84),
    quality: null,
    width,
    height,
    timestamp: Date.now(),
  };
}

/**
 * Computes exact pixel box inside an object-fit: cover viewport so normalized [ymin, xmin, ymax, xmax]
 * bounding boxes from the source image never drift or distort when aspect ratios differ.
 */
export function computeObjectCoverBox(
  box2d: [number, number, number, number],
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number
): { x: number; y: number; width: number; height: number } | null {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const [rawYmin, rawXmin, rawYmax, rawXmax] = box2d;
  if ([rawYmin, rawXmin, rawYmax, rawXmax].some((n) => !Number.isFinite(n))) {
    return null;
  }

  const ymin = Math.max(0, Math.min(1000, rawYmin)) / 1000;
  const xmin = Math.max(0, Math.min(1000, rawXmin)) / 1000;
  const ymax = Math.max(0, Math.min(1000, rawYmax)) / 1000;
  const xmax = Math.max(0, Math.min(1000, rawXmax)) / 1000;

  if (ymax <= ymin || xmax <= xmin) return null;

  const scale = Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  const x1 = Math.max(0, Math.min(containerWidth, offsetX + xmin * renderedWidth));
  const y1 = Math.max(0, Math.min(containerHeight, offsetY + ymin * renderedHeight));
  const x2 = Math.max(0, Math.min(containerWidth, offsetX + xmax * renderedWidth));
  const y2 = Math.max(0, Math.min(containerHeight, offsetY + ymax * renderedHeight));

  if (x2 - x1 < 4 || y2 - y1 < 4) return null;

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}
