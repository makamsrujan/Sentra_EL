/**
 * SENTRA Temporal Object Tracking Service
 * Feature 3: Advanced Temporal Object Detection and Tracking
 *
 * Implements multi-frame temporal association, persistent track IDs,
 * velocity estimation, relative movement (approaching/receding),
 * and target disappearance/re-emergence detection.
 */

import { DetectedObject, TrackedObject, RelativeMovement, TrackingStatus } from '../types/sentra';

export interface TemporalTrackingCallbacks {
  onTargetLost?: (targetLabel: string, lastClockPosition: string) => void;
  onTargetReacquired?: (target: TrackedObject) => void;
  onApproachingHazard?: (hazardObject: TrackedObject) => void;
}

export class TemporalTrackerService {
  private activeTracks: Map<string, TrackedObject> = new Map();
  private nextTrackIdNumber: number = 1;
  private callbacks: TemporalTrackingCallbacks = {};
  private targetGoalName: string | null = null;
  private maxMissFramesBeforeLost: number = 3;

  public setCallbacks(callbacks: TemporalTrackingCallbacks) {
    this.callbacks = callbacks;
  }

  public setTargetGoal(goal: string | null) {
    this.targetGoalName = goal ? goal.toLowerCase().trim() : null;
  }

  /**
   * Update tracker with newly detected objects from the current video frame.
   * Uses IoU + Centroid proximity to associate detections with existing tracks.
   */
  public update(newDetections: DetectedObject[], timestamp = Date.now()): TrackedObject[] {
    const matchedTrackIds = new Set<string>();

    for (const detection of newDetections) {
      const bestMatch = this.findBestMatch(detection);

      if (bestMatch && !matchedTrackIds.has(bestMatch.trackId)) {
        matchedTrackIds.add(bestMatch.trackId);
        this.updateExistingTrack(bestMatch, detection, timestamp);
      } else {
        // Create new track
        const newTrack = this.createNewTrack(detection, timestamp);
        matchedTrackIds.add(newTrack.trackId);
        this.activeTracks.set(newTrack.trackId, newTrack);
      }
    }

    // Handle missing tracks (occlusion & loss)
    for (const [trackId, track] of this.activeTracks.entries()) {
      if (!matchedTrackIds.has(trackId)) {
        track.missCount++;
        if (track.missCount === 1) {
          track.status = 'occluded';
        } else if (track.missCount >= this.maxMissFramesBeforeLost) {
          if (track.status !== 'lost') {
            track.status = 'lost';
            if (track.isTargetGoal) {
              this.callbacks.onTargetLost?.(track.label, track.clockPosition);
            }
          }
        }
      }
    }

    // Prune tracks lost for more than 10 frames
    for (const [trackId, track] of this.activeTracks.entries()) {
      if (track.missCount > 10) {
        this.activeTracks.delete(trackId);
      }
    }

    return Array.from(this.activeTracks.values());
  }

  private findBestMatch(detection: DetectedObject): TrackedObject | null {
    if (!detection.box2d) return null;

    let bestTrack: TrackedObject | null = null;
    let highestScore = 0.25; // Minimum association threshold

    for (const track of this.activeTracks.values()) {
      // Must match label or belong to the same semantic class
      const labelMatch = track.label.toLowerCase() === detection.label.toLowerCase();
      if (!labelMatch) continue;

      const iou = this.calculateIoU(track.box2d, detection.box2d);
      const centroidDist = this.calculateCentroidDistance(track.box2d, detection.box2d);
      // Normalized distance score (0 to 1)
      const distScore = Math.max(0, 1 - centroidDist / 400);

      const combinedScore = iou * 0.6 + distScore * 0.4;
      if (combinedScore > highestScore) {
        highestScore = combinedScore;
        bestTrack = track;
      }
    }

    return bestTrack;
  }

  private updateExistingTrack(track: TrackedObject, detection: DetectedObject, timestamp: number) {
    const prevBox = track.box2d;
    const newBox = detection.box2d || prevBox;

    // Calculate movement & velocity
    const prevCenter = this.getBoxCenter(prevBox);
    const newCenter = this.getBoxCenter(newBox);
    const dt = Math.max(100, timestamp - track.lastSeenAt) / 1000;

    const vx = (newCenter[0] - prevCenter[0]) / dt;
    const vy = (newCenter[1] - prevCenter[1]) / dt;

    const prevArea = (prevBox[2] - prevBox[0]) * (prevBox[3] - prevBox[1]);
    const newArea = (newBox[2] - newBox[0]) * (newBox[3] - newBox[1]);
    const areaGrowth = (newArea - prevArea) / Math.max(1, prevArea);

    let movement: RelativeMovement = 'stationary';
    if (areaGrowth > 0.18) movement = 'approaching';
    else if (areaGrowth < -0.18) movement = 'receding';
    else if (vx > 35) movement = 'moving_right';
    else if (vx < -35) movement = 'moving_left';

    const wasLost = track.status === 'lost' || track.status === 'occluded';

    // Update state
    track.box2d = newBox;
    track.confidence = detection.confidence;
    track.clockPosition = detection.clockPosition;
    track.relativeDistance = detection.relativeDistance;
    track.lastSeenAt = timestamp;
    track.seenCount++;
    track.missCount = 0;
    track.status = 'tracking';
    track.movement = movement;
    track.velocity = { vx, vy };

    // Fire re-acquired alert if target reappeared
    if (wasLost && track.isTargetGoal) {
      this.callbacks.onTargetReacquired?.(track);
    }

    // Fire approaching alert if obstacle is expanding rapidly towards the user
    if (movement === 'approaching' && track.relativeDistance === 'near') {
      this.callbacks.onApproachingHazard?.(track);
    }
  }

  private createNewTrack(detection: DetectedObject, timestamp: number): TrackedObject {
    const trackId = `track-${this.nextTrackIdNumber++}`;
    const isTarget = Boolean(
      this.targetGoalName && detection.label.toLowerCase().includes(this.targetGoalName)
    );

    return {
      trackId,
      label: detection.label,
      confidence: detection.confidence,
      box2d: detection.box2d || [0, 0, 0, 0],
      clockPosition: detection.clockPosition,
      relativeDistance: detection.relativeDistance,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      seenCount: 1,
      missCount: 0,
      status: 'new',
      movement: 'stationary',
      velocity: { vx: 0, vy: 0 },
      isTargetGoal: isTarget,
    };
  }

  private calculateIoU(b1: [number, number, number, number], b2: [number, number, number, number]): number {
    const [y1a, x1a, y2a, x2a] = b1;
    const [y1b, x1b, y2b, x2b] = b2;

    const yA = Math.max(y1a, y1b);
    const xA = Math.max(x1a, x1b);
    const yB = Math.min(y2a, y2b);
    const xB = Math.min(x2a, x2b);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = (x2a - x1a) * (y2a - y1a);
    const boxBArea = (x2b - x1b) * (y2b - y1b);

    const unionArea = boxAArea + boxBArea - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
  }

  private calculateCentroidDistance(b1: [number, number, number, number], b2: [number, number, number, number]): number {
    const c1 = this.getBoxCenter(b1);
    const c2 = this.getBoxCenter(b2);
    return Math.hypot(c1[0] - c2[0], c1[1] - c2[1]);
  }

  private getBoxCenter(b: [number, number, number, number]): [number, number] {
    return [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];
  }

  public getActiveTracks(): TrackedObject[] {
    return Array.from(this.activeTracks.values());
  }

  public clear() {
    this.activeTracks.clear();
  }
}

export const temporalTracker = new TemporalTrackerService();
