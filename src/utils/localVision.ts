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
 * On-device local computer vision and sensor engine.
 * Runs 100% in-browser on HTML5 canvas and Web APIs.
 * Requires ZERO cloud API calls, ZERO credits, and works completely offline!
 */
export function analyzeLocalScene(
  video: HTMLVideoElement | null,
  currentHeading: number | null,
  memories: SentraMemoryItem[],
  mode: SentraMode,
  query = '',
  goal: string | null = null
): LocalVisionResult {
  let lightLevel = 50;
  let lightDirection = 'straight ahead';
  let dominantColor = 'neutral';
  let hasTextPattern = false;

  if (video && video.videoWidth && video.videoHeight) {
    try {
      const width = 120;
      const height = Math.round((120 * video.videoHeight) / video.videoWidth);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height).data;

        // 1. Measure Light Distribution (Left, Center, Right quadrants)
        let leftLum = 0, centerLum = 0, rightLum = 0;
        let leftCount = 0, centerCount = 0, rightCount = 0;

        // 2. Measure Colors in Center 60%
        let rSum = 0, gSum = 0, bSum = 0;
        let colorSamples = 0;

        // 3. Measure High-frequency edge transitions (Text / Pattern indicator)
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

            // Sample center zone for color & edge transitions
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

        // Light direction
        const avgL = leftCount > 0 ? leftLum / leftCount : 0;
        const avgC = centerCount > 0 ? centerLum / centerCount : 0;
        const avgR = rightCount > 0 ? rightLum / rightCount : 0;

        if (avgL > avgC + 20 && avgL > avgR) {
          lightDirection = 'at your 10 o’clock to your left';
        } else if (avgR > avgC + 20 && avgR > avgL) {
          lightDirection = 'at your 2 o’clock to your right';
        } else if (avgC > avgL + 15 && avgC > avgR + 15) {
          lightDirection = 'straight ahead at 12 o’clock';
        } else {
          lightDirection = 'evenly diffused';
        }

        // Color analysis
        if (colorSamples > 0) {
          const avgR = rSum / colorSamples;
          const avgG = gSum / colorSamples;
          const avgB = bSum / colorSamples;
          dominantColor = detectColorName(avgR, avgG, avgB);
        }

        // Text / Pattern heuristic
        hasTextPattern = edgeTransitions > (endX - startX) * 2.2;
      }
    } catch (e) {
      console.warn('Local frame analysis error:', e);
    }
  }

  // 4. Spatial Compass Navigation to closest saved memory
  let closestMemoryGuidance: string | null = null;
  if (currentHeading != null && memories.length > 0) {
    const memoryWithHeading = memories.filter((m) => m.heading != null);
    if (memoryWithHeading.length > 0) {
      // Pick most recent or closest angular match
      const target = memoryWithHeading[memoryWithHeading.length - 1];
      if (target && target.heading != null) {
        let diff = (target.heading - currentHeading + 360) % 360;
        if (diff > 180) diff -= 360; // -180 to +180

        const absDiff = Math.abs(Math.round(diff));
        if (absDiff < 20) {
          closestMemoryGuidance = `You are facing directly toward saved ${target.label} (heading ${Math.round(target.heading)}° ${getCompassDirection(target.heading)}).`;
        } else if (diff > 0) {
          closestMemoryGuidance = `Turn about ${absDiff} degrees right to face saved ${target.label}.`;
        } else {
          closestMemoryGuidance = `Turn about ${absDiff} degrees left to face saved ${target.label}.`;
        }
      }
    }
  }

  // Synthesize spoken guidance based on mode
  let text = '';
  const headingText =
    currentHeading != null
      ? `Facing ${Math.round(currentHeading)}° ${getCompassDirection(currentHeading)}.`
      : '';

  if (mode === 'describe') {
    let lightSummary = '';
    if (lightLevel < 12) {
      lightSummary = 'Very dark environment (under 12% light). Lights appear off or camera is obstructed.';
    } else if (lightLevel > 80) {
      lightSummary = `Bright environment (${lightLevel}% light). Main light source is ${lightDirection}.`;
    } else {
      lightSummary = `Moderate lighting at ${lightLevel}%. Light is ${lightDirection}.`;
    }

    const centerObject = dominantColor !== 'neutral' ? `Center view shows predominantly ${dominantColor} surface.` : '';
    const textNotice = hasTextPattern ? 'High-contrast text or signage detected in view.' : '';

    text = `Local Vision: ${headingText} ${lightSummary} ${centerObject} ${textNotice} ${
      closestMemoryGuidance || ''
    }`.trim();
  } else if (mode === 'read') {
    if (hasTextPattern) {
      text = `Local Vision: High contrast printed text pattern detected in center view. Light is at ${lightLevel}%. (Cloud OCR resting — move closer or tap steady).`;
    } else {
      text = `Local Vision: No clear text edges in view. Light is at ${lightLevel}%. Try centering label and holding still.`;
    }
  } else if (mode === 'find') {
    const target = goal || query.replace(/find\s+/i, '').trim() || 'target';
    if (closestMemoryGuidance) {
      text = `Local Assist for ${target}: ${closestMemoryGuidance} Center color is ${dominantColor}. Scan slowly.`;
    } else {
      text = `Local Assist for ${target}: ${headingText} Light is ${lightLevel}%. Pan camera slowly across the room.`;
    }
  } else if (mode === 'remember') {
    text = `MEMORY: Saved Location | Saved at heading ${
      currentHeading != null ? Math.round(currentHeading) + '°' : 'current position'
    }. Light was ${lightLevel}%, center color was ${dominantColor}.`;
  } else {
    text = `Local Assist: ${headingText} Light level is ${lightLevel}%. Center area is ${dominantColor}. ${
      closestMemoryGuidance || ''
    }`.trim();
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

  // Grayscale / Brightness checks
  if (max < 40) return 'black / very dark';
  if (min > 200 && delta < 25) return 'white / bright';
  if (delta < 20) return 'neutral gray';

  // Hue-based checks
  if (r > g + 30 && r > b + 30) {
    if (g > 120 && b < 80) return 'orange or brown';
    return 'red';
  }
  if (g > r + 25 && g > b + 25) return 'green';
  if (b > r + 25 && b > g + 20) return 'blue';
  if (r > 160 && g > 160 && b < 100) return 'yellow';
  if (r > 130 && b > 130 && g < 100) return 'purple';

  return 'mixed color';
}
