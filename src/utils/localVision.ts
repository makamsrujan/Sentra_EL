import { SentraMemoryItem, SentraMode } from '../types/sentra';
import { getCompassDirection } from './sensors';

export interface LocalVisionResult {
  text: string;
  lightLevel: number; // 0 to 100%
  lightDirection: string;
  dominantColor: string;
  hasTextPattern: boolean;
  closestMemoryGuidance: string | null;
}

/**
 * Basic on-device optical heuristic engine (luminance, dominant center color, edge density).
 * Does NOT perform semantic object recognition or obstacle safety certification.
 */
export function analyzeLocalScene(
  video: HTMLVideoElement | null,
  currentHeading: number | null,
  memories: SentraMemoryItem[],
  mode: SentraMode,
  _query = '',
  goal: string | null = null
): LocalVisionResult {
  let lightLevel = 0;
  let lightDirection = 'unavailable';
  let dominantColor = 'unknown';
  let hasTextPattern = false;
  let hasValidVideo = false;

  if (video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
    try {
      hasValidVideo = true;
      const width = 120;
      const height = Math.max(1, Math.round((120 * video.videoHeight) / video.videoWidth));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height).data;

        let leftLum = 0;
        let centerLum = 0;
        let rightLum = 0;
        let leftCount = 0;
        let centerCount = 0;
        let rightCount = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let colorSamples = 0;
        let edgeTransitions = 0;

        const colThird = Math.floor(width / 3);
        const startY = Math.floor(height * 0.2);
        const endY = Math.floor(height * 0.8);
        const startX = Math.floor(width * 0.2);
        const endX = Math.floor(width * 0.8);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = imgData[idx] ?? 0;
            const g = imgData[idx + 1] ?? 0;
            const b = imgData[idx + 2] ?? 0;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            if (x < colThird) {
              leftLum += lum;
              leftCount++;
            } else if (x < colThird * 2) {
              centerLum += lum;
              centerCount++;
            } else {
              rightLum += lum;
              rightCount++;
            }

            if (y >= startY && y <= endY && x >= startX && x <= endX) {
              rSum += r;
              gSum += g;
              bSum += b;
              colorSamples++;

              if (x > startX) {
                const prevIdx = (y * width + (x - 1)) * 4;
                const prevLum =
                  0.299 * (imgData[prevIdx] ?? 0) +
                  0.587 * (imgData[prevIdx + 1] ?? 0) +
                  0.114 * (imgData[prevIdx + 2] ?? 0);
                if (Math.abs(lum - prevLum) > 45) {
                  edgeTransitions++;
                }
              }
            }
          }
        }

        const totalLum = (leftLum + centerLum + rightLum) / (width * height);
        lightLevel = Math.min(100, Math.max(0, Math.round((totalLum / 255) * 100)));

        const avgL = leftCount > 0 ? leftLum / leftCount : 0;
        const avgC = centerCount > 0 ? centerLum / centerCount : 0;
        const avgR = rightCount > 0 ? rightLum / rightCount : 0;

        if (avgL > avgC + 20 && avgL > avgR) {
          lightDirection = 'brighter on your left (10 o’clock)';
        } else if (avgR > avgC + 20 && avgR > avgL) {
          lightDirection = 'brighter on your right (2 o’clock)';
        } else if (avgC > avgL + 15 && avgC > avgR + 15) {
          lightDirection = 'brighter straight ahead (12 o’clock)';
        } else {
          lightDirection = 'evenly distributed';
        }

        if (colorSamples > 0) {
          dominantColor = detectColorName(
            rSum / colorSamples,
            gSum / colorSamples,
            bSum / colorSamples
          );
        }

        hasTextPattern = edgeTransitions > (endX - startX) * 2.2;
      }
    } catch {
      hasValidVideo = false;
    }
  }

  // Truthful saved-memory reference (never claimed as live confirmation)
  let closestMemoryGuidance: string | null = null;
  if (goal && memories.length > 0) {
    const match = memories.find((m) => m.label.toLowerCase().includes(goal.toLowerCase()));
    if (match) {
      closestMemoryGuidance = `I have a previously saved note for ${match.label} (${match.note}), but I cannot confirm it is still there without cloud object recognition.`;
    }
  }

  if (!hasValidVideo) {
    return {
      text: closestMemoryGuidance || 'No current camera observation is available.',
      lightLevel: 0,
      lightDirection: 'unavailable',
      dominantColor: 'unknown',
      hasTextPattern: false,
      closestMemoryGuidance,
    };
  }

  let text = '';
  const headingText =
    currentHeading != null
      ? `Heading ${Math.round(currentHeading)} degrees ${getCompassDirection(currentHeading)}.`
      : '';

  if (mode === 'find') {
    text = `The camera is active (light ${lightLevel}%, center tone ${dominantColor}), but object recognition is currently unavailable. ${closestMemoryGuidance || ''}`.trim();
  } else if (mode === 'read') {
    text = hasTextPattern
      ? `The camera is active and detects high-contrast edges consistent with printed text (light ${lightLevel}%), but cloud text reading is currently unavailable.`
      : `The camera is active (light ${lightLevel}%), and cloud text reading is currently unavailable.`;
  } else {
    text = `The camera is active, but cloud scene recognition is unavailable. ${headingText} Light level is ${lightLevel}% (${lightDirection}) with a mostly ${dominantColor} center view.`.trim();
  }

  return {
    text,
    lightLevel,
    lightDirection,
    dominantColor,
    hasTextPattern,
    closestMemoryGuidance,
  };
}

function detectColorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (max < 40) return 'very dark';
  if (min > 200 && delta < 25) return 'bright white';
  if (delta < 20) return 'neutral gray';

  if (r > g + 30 && r > b + 30) {
    if (g > 120 && b < 80) return 'orange or brown';
    return 'red';
  }
  if (g > r + 25 && g > b + 25) return 'green';
  if (b > r + 25 && b > g + 20) return 'blue';
  if (r > 160 && g > 160 && b < 100) return 'yellow';
  if (r > 130 && g < 100 && b > 130) return 'purple';

  return 'mixed';
}
