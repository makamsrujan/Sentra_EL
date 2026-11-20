import { describe, expect, it } from 'vitest';
import { computeObjectCoverBox } from '../src/services/cameraService';
import { classifyTrialCategory, parseVoiceIntent } from '../src/utils/parser';
import { analyzeLocalScene } from '../src/utils/localVision';
import { clampBox2d } from '../server/validation';

describe('SENTRA Frontend Perception Utilities & Bounding Box Geometry', () => {
  it('accurately projects normalized [0..1000] boxes under object-fit: cover cropping', () => {
    // Container 400x400 (aspect 1.0), source 1600x800 (aspect 2.0, wider -> horizontal crop)
    // Scale = 400 / 800 = 0.5; rendered width = 800, crop X = 200 each side
    // Box [250, 400, 750, 600] -> source x in [640..960] -> scaled [320..480] -> minus 200 -> [120..280]
    // Rendered inside 400x400 viewport -> x=120, y=100, width=160, height=200
    const box = computeObjectCoverBox([250, 400, 750, 600], 400, 400, 1600, 800);
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(120, 1);
    expect(box!.y).toBeCloseTo(100, 1);
    expect(box!.width).toBeCloseTo(160, 1);
    expect(box!.height).toBeCloseTo(200, 1);
  });

  it('clamps out-of-range bounding box coordinates cleanly', () => {
    const clamped = clampBox2d([-50, 200, 1200, 1050]);
    expect(clamped).toEqual([0, 200, 1000, 1000]);
  });

  it('classifies voice queries into distinct operations accurately', () => {
    expect(parseVoiceIntent('What is my wearable battery level?').operation).toBe('device_status');
    expect(parseVoiceIntent('Find the water bottle')).toMatchObject({
      mode: 'find',
      operation: 'object_query',
      goal: 'water bottle',
    });
    expect(classifyTrialCategory('Find the water bottle')).toBe('object_finder');

    expect(parseVoiceIntent('Help me to walk near door')).toMatchObject({
      mode: 'navigate',
      operation: 'object_query',
      goal: 'door',
    });
    expect(classifyTrialCategory('Help me to walk near door')).toBe('walk_assistant');

    expect(parseVoiceIntent('Help me finding obstacles')).toMatchObject({
      mode: 'describe',
      operation: 'scene_analysis',
    });
    expect(classifyTrialCategory('Help me finding obstacles')).toBe('obstacles');

    expect(parseVoiceIntent('Describe what is in front of me').operation).toBe('scene_analysis');
    expect(parseVoiceIntent('Tell me a quick reminder about posture').operation).toBe('conversation');
  });

  it('local fallback refuses to fabricate live objects or clear paths when video is unavailable', () => {
    const res = analyzeLocalScene(
      null,
      null,
      [
        {
          id: '1',
          label: 'Keys',
          note: 'On wooden desk',
          at: '10:00',
          timestamp: Date.now(),
          source: 'user_manual',
        },
      ],
      'find',
      'Where are my keys?',
      'keys'
    );
    expect(res.text).toContain('saved note');
    expect(res.text).toContain('cannot confirm');
  });
});
