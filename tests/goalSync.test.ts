import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { DeviceGateway } from '../server/deviceGateway';
import { SentraEventStore } from '../server/eventStore';
import type { GoalTask } from '../src/types/sentra';

describe('Wearable goal state gateway contract', () => {
  it('emits the complete GoalTask over goal_update SSE and preserves its identity', () => {
    const store = new SentraEventStore(':memory:');
    const gateway = new DeviceGateway(store);
    const deviceId = 'TEST-GOAL-DEVICE-001';
    gateway.registerDevice({
      deviceId, name: 'Goal integration test',
      capabilities: { camera: false, forwardToF: false, downwardToF: false, imu: false, audioOutput: false },
    });
    const events: string[] = [];
    const fakeResponse = {
      write(chunk: string) { events.push(chunk); return true; },
    } as unknown as Response;
    gateway.addSseClient(fakeResponse);
    const now = Date.now();
    const goal: GoalTask = {
      id: 'goal-test-01',
      intent: 'find my bottle',
      targetObject: 'bottle',
      state: 'active',
      requiredObservation: 'Observe a current camera frame',
      nextSafeAction: null,
      confidence: null,
      createdAt: now,
      updatedAt: now,
      history: [{timestamp: now, note: 'Created in test', state: 'active'}],
      verificationSteps: [],
    };
    gateway.setActiveGoal(deviceId, goal);
    expect(gateway.getActiveGoal(deviceId)).toEqual(goal);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('event: goal_update');
    const raw = events[0].split('data: ')[1]?.trim();
    expect(JSON.parse(raw).deviceId).toBe(deviceId);
    expect(JSON.parse(raw).goal).toEqual(goal);
    gateway.removeSseClient(fakeResponse);
    store.close();
  });
});
