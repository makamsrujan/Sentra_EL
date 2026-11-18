import { FrameQuality } from '../types/sentra';

/**
 * Evaluates frame brightness (average luminance) and sharpness (Laplacian variance)
 * using an efficient 160px offscreen canvas.
 */
export function analyzeFrameQuality(video: HTMLVideoElement): FrameQuality {
  if (!video.videoWidth || !video.videoHeight) {
    return { brightness: 0.5, sharpness: 100 };
  }

  const width = 160;
  const height = Math.max(1, Math.round((160 * video.videoHeight) / video.videoWidth));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { brightness: 0.5, sharpness: 100 };
  }

  ctx.drawImage(video, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height).data;

  // Compute grayscale luminosity
  const gray = new Float32Array(width * height);
  let totalLuminance = 0;

  for (let i = 0; i < gray.length; i++) {
    const r = imgData[i * 4] ?? 0;
    const g = imgData[i * 4 + 1] ?? 0;
    const b = imgData[i * 4 + 2] ?? 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum;
    totalLuminance += lum;
  }

  // Laplacian kernel filter for sharpness (edge variance)
  let sumLap = 0;
  let sumLapSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = gray[idx] ?? 0;
      const lap =
        4 * center -
        (gray[idx - 1] ?? 0) -
        (gray[idx + 1] ?? 0) -
        (gray[idx - width] ?? 0) -
        (gray[idx + width] ?? 0);

      sumLap += lap;
      sumLapSq += lap * lap;
      count++;
    }
  }

  const mean = count > 0 ? sumLap / count : 0;
  const variance = count > 0 ? sumLapSq / count - mean * mean : 0;
  const brightness = totalLuminance / (width * height) / 255;

  return {
    brightness,
    sharpness: Math.max(0, variance),
  };
}

/**
 * Format sensor telemetry for the AI model
 */
export function formatSensorsString(
  motionMps: number,
  headingDeg: number | null,
  quality: FrameQuality | null
): string {
  const motionDesc =
    motionMps > 1.5 ? 'walking/moving' : motionMps > 0.4 ? 'slight movement' : 'still';

  const headingDesc =
    headingDeg == null ? 'unknown' : `${Math.round(headingDeg)}° (${getCompassDirection(headingDeg)})`;

  let qualityDesc = 'no camera';
  if (quality) {
    const brightPct = Math.round(quality.brightness * 100);
    const brightNote = quality.brightness < 0.15 ? '(too dark)' : quality.brightness > 0.9 ? '(very bright)' : '(normal)';
    const sharpNote = quality.sharpness < 50 ? '(blurry)' : '(clear)';
    qualityDesc = `brightness=${brightPct}% ${brightNote}; sharpness=${Math.round(quality.sharpness)} ${sharpNote}`;
  }

  return `motion=${motionDesc} (${motionMps.toFixed(2)} m/s²); heading=${headingDesc}; ${qualityDesc}`;
}

export function getCompassDirection(deg: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return directions[index] || 'N';
}
