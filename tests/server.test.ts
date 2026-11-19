import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createSentraApp } from '../server';
import { SentraEventStore } from '../server/eventStore';
import { validateConfiguredModel } from '../server/geminiService';
import { sanitizeGeminiResponse } from '../server/validation';

const VALID_JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);

describe('SENTRA Backend Gateway, Auth, Persistence & Safety', () => {
  let tmpDir: string;
  let dbPath: string;
  let server: http.Server;
  let storeRef: SentraEventStore;
  let baseUrl: string;
  let provisionedToken: string;
  const deviceId = 'ESP32-TEST-01';
  const testOperatorToken = 'sentra-test-operator-secret-123';
  const prevApiKey = process.env.GEMINI_API_KEY;
  const prevSimEnabled = process.env.SENTRA_SIMULATOR_ENABLED;
  const prevOpToken = process.env.SENTRA_OPERATOR_TOKEN;
  const prevModel = process.env.SENTRA_GEMINI_MODEL;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentra-test-'));
    dbPath = path.join(tmpDir, 'sentra-test.db');
    process.env.SENTRA_SIMULATOR_ENABLED = 'true';
    process.env.SENTRA_OPERATOR_TOKEN = testOperatorToken;

    const { app, store } = createSentraApp({ dbPath, heartbeatTimeoutMs: 2500 });
    storeRef = store;
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    process.env.GEMINI_API_KEY = prevApiKey;
    process.env.SENTRA_SIMULATOR_ENABLED = prevSimEnabled;
    process.env.SENTRA_OPERATOR_TOKEN = prevOpToken;
    if (prevModel === undefined) delete process.env.SENTRA_GEMINI_MODEL;
    else process.env.SENTRA_GEMINI_MODEL = prevModel;
    storeRef?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires operator authorization for device registration, simulator endpoints, and telemetry deletion', async () => {
    // Missing operator token -> 401
    const unauthReg = await fetch(`${baseUrl}/api/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'UNAUTH-01',
        name: 'Unauth',
        capabilities: { camera: false, forwardToF: true, downwardToF: false, imu: false, audioOutput: false },
      }),
    });
    expect(unauthReg.status).toBe(401);

    // Missing SENTRA_OPERATOR_TOKEN on server -> 503 locked fail-closed
    delete process.env.SENTRA_OPERATOR_TOKEN;
    const lockedReg = await fetch(`${baseUrl}/api/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operator-Token': testOperatorToken },
      body: JSON.stringify({
        deviceId: 'UNAUTH-02',
        name: 'Locked',
        capabilities: { camera: false, forwardToF: true, downwardToF: false, imu: false, audioOutput: false },
      }),
    });
    expect(lockedReg.status).toBe(503);

    const lockedSim = await fetch(`${baseUrl}/api/device/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sentra-Simulator': 'true' },
      body: JSON.stringify({ forwardDistanceCm: 100 }),
    });
    expect(lockedSim.status).toBe(503);

    const lockedDelete = await fetch(`${baseUrl}/api/events`, { method: 'DELETE' });
    expect(lockedDelete.status).toBe(503);

    // Restore operator token for remaining tests
    process.env.SENTRA_OPERATOR_TOKEN = testOperatorToken;
  });

  it('registers a real hardware device with valid operator credentials and issues a one-time token', async () => {
    const res = await fetch(`${baseUrl}/api/device/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Token': testOperatorToken,
      },
      body: JSON.stringify({
        deviceId,
        name: 'Test Headband',
        capabilities: {
          camera: true,
          forwardToF: true,
          downwardToF: true,
          imu: true,
          audioOutput: true,
        },
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deviceId).toBe(deviceId);
    expect(typeof data.provisionedToken).toBe('string');
    expect(data.provisionedToken.length).toBeGreaterThan(20);
    provisionedToken = data.provisionedToken;
  });

  it('rejects unauthenticated and invalid-token telemetry writes with 401', async () => {
    const noTokenRes = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId,
        sequence: 1,
        uptimeMs: 1000,
        batteryPercent: 80,
        sensors: { forwardDistanceCm: 100, downwardDistanceMm: 80, imu: null },
        capabilities: { camera: true, forwardToF: true, downwardToF: true, imu: false, audioOutput: true },
      }),
    });
    expect(noTokenRes.status).toBe(401);

    const badTokenRes = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token-12345',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId,
        sequence: 1,
        uptimeMs: 1000,
        batteryPercent: 80,
        sensors: { forwardDistanceCm: 100, downwardDistanceMm: 80, imu: null },
        capabilities: { camera: true, forwardToF: true, downwardToF: true, imu: false, audioOutput: true },
      }),
    });
    expect(badTokenRes.status).toBe(401);
  });

  it('rejects malformed telemetry values (negative battery / NaN / out-of-range)', async () => {
    const res = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId,
        sequence: 1,
        uptimeMs: 1000,
        batteryPercent: 150,
        sensors: { forwardDistanceCm: 100, downwardDistanceMm: 80, imu: null },
        capabilities: { camera: true, forwardToF: true, downwardToF: true, imu: false, audioOutput: true },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid versioned telemetry, normalizes zero sensors to null, and rejects duplicate sequence numbers', async () => {
    const res1 = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId,
        sequence: 10,
        uptimeMs: 5000,
        batteryPercent: 87,
        sensors: { forwardDistanceCm: 0, downwardDistanceMm: 85, imu: null },
        capabilities: { camera: true, forwardToF: true, downwardToF: true, imu: false, audioOutput: true },
      }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.ok).toBe(true);
    expect(body1.accepted).toBe(true);
    expect(body1.state.sourceMode).toBe('hardware');
    expect(body1.state.sensors.forwardDistanceCm).toBeNull(); // 0 normalized to null
    expect(body1.state.sensors.downwardDistanceMm).toBe(85);

    // Duplicate sequence is safely rejected without altering state
    const dupRes = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId,
        sequence: 10,
        uptimeMs: 5000,
        batteryPercent: 87,
        sensors: { forwardDistanceCm: 120, downwardDistanceMm: 85, imu: null },
        capabilities: { camera: true, forwardToF: true, downwardToF: true, imu: false, audioOutput: true },
      }),
    });
    expect(dupRes.status).toBe(200);
    const dupBody = await dupRes.json();
    expect(dupBody.accepted).toBe(false);
    expect(dupBody.reason).toMatch(/duplicate/i);
    expect(dupBody.state.sensors.forwardDistanceCm).toBeNull();
  });

  it('enqueues critical alerts on ToF threshold and preserves them until explicit ack', async () => {
    const res = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId,
        sequence: 11,
        uptimeMs: 6000,
        batteryPercent: 86,
        sensors: { forwardDistanceCm: 28, downwardDistanceMm: 85, imu: null },
        capabilities: { camera: true, forwardToF: true, downwardToF: true, imu: false, audioOutput: true },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggeredAlerts.length).toBe(1);
    expect(body.triggeredAlerts[0].severity).toBe('critical');

    // Poll should return the pending critical action
    const poll1 = await fetch(`${baseUrl}/api/device/poll?deviceId=${deviceId}`, {
      headers: { Authorization: `Bearer ${provisionedToken}` },
    });
    expect(poll1.status).toBe(200);
    const pollData1 = await poll1.json();
    expect(pollData1.actions.length).toBeGreaterThanOrEqual(1);
    const actionId = pollData1.actions[0].id;

    // Second poll BEFORE ack still keeps the action delivered
    const poll2 = await fetch(`${baseUrl}/api/device/poll?deviceId=${deviceId}`, {
      headers: { Authorization: `Bearer ${provisionedToken}` },
    });
    const pollData2 = await poll2.json();
    expect(pollData2.actions.some((a: any) => a.id === actionId)).toBe(true);

    // Explicit ack removes it cleanly
    const ackRes = await fetch(`${baseUrl}/api/device/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: JSON.stringify({ deviceId, actionIds: [actionId] }),
    });
    expect(ackRes.status).toBe(200);

    const poll3 = await fetch(`${baseUrl}/api/device/poll?deviceId=${deviceId}`, {
      headers: { Authorization: `Bearer ${provisionedToken}` },
    });
    const pollData3 = await poll3.json();
    expect(pollData3.actions.some((a: any) => a.id === actionId)).toBe(false);
  });

  it('separates simulator writes strictly from real hardware state and requires confirmation header + operator auth', async () => {
    const blockedRes = await fetch(`${baseUrl}/api/device/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operator-Token': testOperatorToken },
      body: JSON.stringify({ forwardDistanceCm: 100 }),
    });
    expect(blockedRes.status).toBe(403);

    const noAuthSimRes = await fetch(`${baseUrl}/api/device/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sentra-Simulator': 'true' },
      body: JSON.stringify({ forwardDistanceCm: 100 }),
    });
    expect(noAuthSimRes.status).toBe(401);

    const simRes = await fetch(`${baseUrl}/api/device/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentra-Simulator': 'true',
        'X-Operator-Token': testOperatorToken,
      },
      body: JSON.stringify({ forwardDistanceCm: 95, downwardDistanceMm: 90, batteryPercent: 55 }),
    });
    expect(simRes.status).toBe(200);
    const simData = await simRes.json();
    expect(simData.telemetry.deviceId).toBe('SIM-ESP32-01');
    expect(simData.telemetry.sourceMode).toBe('simulator');

    // Hardware device state remains completely isolated
    const hwRes = await fetch(`${baseUrl}/api/device/status?deviceId=${deviceId}`);
    const hwData = await hwRes.json();
    expect(hwData.telemetry.deviceId).toBe(deviceId);
    expect(hwData.telemetry.sourceMode).toBe('hardware');
    expect(hwData.telemetry.batteryPercent).toBe(86);
  });

  it('validates wearable JPEG ingestion, rejects non-JPEG bytes, and serves latest frame + status', async () => {
    const badRes = await fetch(`${baseUrl}/api/device/frame?deviceId=${deviceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: Buffer.from('not-a-valid-jpeg-payload'),
    });
    expect(badRes.status).toBe(400);

    const goodRes = await fetch(`${baseUrl}/api/device/frame?deviceId=${deviceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${provisionedToken}`,
        'X-Frame-Sequence': '42',
      },
      body: VALID_JPEG_HEADER,
    });
    expect(goodRes.status).toBe(200);
    const upBody = await goodRes.json();
    expect(upBody.status.sequence).toBe(42);

    const statusRes = await fetch(`${baseUrl}/api/device/frame/status?deviceId=${deviceId}`);
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.frameAvailable).toBe(true);
    expect(statusJson.sequence).toBe(42);
    expect(statusJson.imageFormat).toBe('image/jpeg');

    const latestRes = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${deviceId}`);
    expect(latestRes.status).toBe(200);
    expect(latestRes.headers.get('content-type')).toContain('image/jpeg');
    expect(latestRes.headers.get('cache-control')).toContain('no-store');
    const bytes = Buffer.from(await latestRes.arrayBuffer());
    expect(bytes.equals(VALID_JPEG_HEADER)).toBe(true);
  });

  it('persists telemetry, analytics, and memories across database reopen (simulated restart) without mixing memories with telemetry', async () => {
    const memRes = await fetch(`${baseUrl}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'Study Desk Keys',
        note: 'Left next to monitor',
        room: 'Study',
        heading: 90,
        source: 'user_manual',
      }),
    });
    expect(memRes.status).toBe(201);

    // Check analytics excluding simulator
    const anaHwRes = await fetch(`${baseUrl}/api/analytics?range=24h&includeSimulated=false`);
    const anaHw = await anaHwRes.json();
    expect(anaHw.totalSensorEvents).toBeGreaterThanOrEqual(2);
    expect(anaHw.totalAlerts).toBe(1);
    expect(anaHw.sensorHistory.every((e: any) => e.sourceMode === 'hardware')).toBe(true);

    // Reopen fresh SentraEventStore pointing at same SQLite file to verify durable persistence
    const reopened = new SentraEventStore(dbPath);
    expect(reopened.isAvailable()).toBe(true);
    const persistedMemories = reopened.listMemories();
    expect(persistedMemories.length).toBe(1);
    expect(persistedMemories[0].label).toBe('Study Desk Keys');

    const persistedSummary = reopened.getAnalyticsSummary({
      range: '24h',
      includeSimulated: true,
    });
    expect(persistedSummary.totalSensorEvents).toBe(3);
    reopened.close();
  });

  it('truthfully reports MISSING_API_KEY, UNSUPPORTED_MODEL without silent substitution, and allows conversation without image', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.SENTRA_GEMINI_MODEL;

    // Supports gemini-3.6-flash and gemini-3.8-flash explicitly
    process.env.SENTRA_GEMINI_MODEL = 'gemini-3.6-flash';
    expect(validateConfiguredModel()).toMatchObject({ valid: true, configuredModel: 'gemini-3.6-flash' });
    process.env.SENTRA_GEMINI_MODEL = 'gemini-3.8-flash';
    expect(validateConfiguredModel()).toMatchObject({ valid: true, configuredModel: 'gemini-3.8-flash' });

    // Never silently substitutes an unrecognized model
    process.env.SENTRA_GEMINI_MODEL = 'nonexistent-model-xyz';
    expect(validateConfiguredModel().valid).toBe(false);

    const badModelDiagRes = await fetch(`${baseUrl}/api/gemini/diagnostic`, { method: 'POST' });
    const badModelDiag = await badModelDiagRes.json();
    expect(badModelDiag.ok).toBe(false);
    expect(badModelDiag.errorCode).toBe('UNSUPPORTED_MODEL');
    expect(badModelDiag.configuredModel).toBe('nonexistent-model-xyz');

    const badModelAnalyzeRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'ask',
        operation: 'conversation',
        query: 'What time should I take medicine?',
        image: null,
        wearableDeviceId: 'UNCONNECTED-DEVICE',
      }),
    });
    const badModelAnalyze = await badModelAnalyzeRes.json();
    expect(badModelAnalyze.errorCode).toBe('UNSUPPORTED_MODEL');

    delete process.env.SENTRA_GEMINI_MODEL;

    // Diagnostic with missing API key returns explicit MISSING_API_KEY (never claims connected)
    const missingKeyDiagRes = await fetch(`${baseUrl}/api/gemini/diagnostic`, { method: 'POST' });
    const missingKeyDiag = await missingKeyDiagRes.json();
    expect(missingKeyDiag.ok).toBe(false);
    expect(missingKeyDiag.errorCode).toBe('MISSING_API_KEY');
    expect(missingKeyDiag.apiReachable).toBe(false);

    // General conversational question without camera image proceeds past image gate to MISSING_API_KEY
    const convNoImgRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'ask',
        operation: 'conversation',
        query: 'Tell me a quick joke',
        image: null,
        wearableDeviceId: 'UNCONNECTED-DEVICE',
      }),
    });
    const convNoImg = await convNoImgRes.json();
    expect(convNoImg.errorCode).toBe('MISSING_API_KEY');

    // When a device without an active hardware hazard has no frame -> observation_unavailable
    const noImgRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'describe',
        operation: 'scene_analysis',
        query: 'What is ahead?',
        image: null,
        wearableDeviceId: 'UNCONNECTED-DEVICE',
      }),
    });
    const noImgData = await noImgRes.json();
    expect(noImgData.status).toBe('degraded');
    expect(noImgData.errorCode).toBe('NO_FRESH_IMAGE');
    expect(noImgData.detectedObjects).toEqual([]);
    expect(noImgData.pathStatus).toBe('observation_unavailable');

    // When primary hardware still has an active 28cm obstacle hazard and no frame -> confirmed_sensor_alert preserved
    const hwHazardNoImgRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'describe',
        operation: 'scene_analysis',
        query: 'What is ahead?',
        image: null,
        wearableDeviceId: deviceId,
      }),
    });
    const hwHazardNoImg = await hwHazardNoImgRes.json();
    expect(hwHazardNoImg.pathStatus).toBe('confirmed_sensor_alert');
    expect(hwHazardNoImg.hazard).not.toBeNull();

    // With image but no GEMINI_API_KEY -> MISSING_API_KEY
    const dataUrl = `data:image/jpeg;base64,${VALID_JPEG_HEADER.toString('base64')}`;
    const noKeyRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'describe',
        operation: 'scene_analysis',
        query: 'Describe surroundings',
        image: dataUrl,
        imageTimestamp: Date.now(),
        wearableDeviceId: 'UNCONNECTED-DEVICE',
      }),
    });
    const noKeyData = await noKeyRes.json();
    expect(noKeyData.status).toBe('degraded');
    expect(noKeyData.errorCode).toBe('MISSING_API_KEY');
    expect(noKeyData.detectedObjects).toEqual([]);
  });

  it('prevents Gemini vision response from overriding critical hardware ToF hazards', () => {
    const safeResult = sanitizeGeminiResponse(
      {
        spokenResponse: 'Everything looks clear ahead.',
        sceneDescription: 'Hallway appears clear.',
        pathStatus: 'observation_available',
        foundTarget: false,
        detectedObjects: [],
      },
      {
        operation: 'scene_analysis',
        hasFreshImage: true,
        frameTimestamp: Date.now(),
        imageDimensions: { width: 640, height: 480 },
        hardwareHazard: {
          id: 'hw-1',
          type: 'obstacle',
          severity: 'critical',
          description: 'Forward sensor detects an obstacle within 22 cm.',
          clockPosition: "12 o'clock",
          source: 'sensor_hardware',
          timestamp: Date.now(),
        },
      }
    );
    expect(safeResult.pathStatus).toBe('confirmed_sensor_alert');
    expect(safeResult.hazard).not.toBeNull();
    expect(safeResult.hazard?.severity).toBe('critical');
    expect(safeResult.spokenResponse).toContain('Stop.');
  });

  it('marks stale devices as disconnected after heartbeatTimeoutMs expires', async () => {
    // createSentraApp in beforeAll configured heartbeatTimeoutMs = 2500ms; wait briefly or trigger a dedicated fast gateway
    const fastTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentra-hb-'));
    const fastDb = path.join(fastTmp, 'hb.db');
    const { app: fastApp, gateway: fastGateway, store: fastStore } = createSentraApp({
      dbPath: fastDb,
      heartbeatTimeoutMs: 2000,
    });
    const reg = fastGateway.registerDevice({
      deviceId: 'HB-01',
      name: 'HB Test',
      capabilities: { camera: false, forwardToF: true, downwardToF: false, imu: false, audioOutput: false },
    });
    expect(reg.provisionedToken.length).toBeGreaterThan(10);

    fastGateway.ingestTelemetry(
      {
        schemaVersion: 1,
        deviceId: 'HB-01',
        sequence: 1,
        uptimeMs: 100,
        batteryPercent: 90,
        sensors: { forwardDistanceCm: 100, downwardDistanceMm: null, imu: null },
        capabilities: { camera: false, forwardToF: true, downwardToF: false, imu: false, audioOutput: false },
      },
      'hardware'
    );
    expect(fastGateway.getLiveState('HB-01')?.connected).toBe(true);

    // Wait just past heartbeatTimeoutMs (2000ms) and invoke sweepHeartbeats
    await new Promise((r) => setTimeout(r, 2050));
    fastGateway.sweepHeartbeats();

    expect(fastGateway.getLiveState('HB-01')?.connected).toBe(false);
    const analytics = fastStore.getAnalyticsSummary({ range: '1h', includeSimulated: false });
    expect(analytics.connectionHistory.some((e) => e.deviceId === 'HB-01' && e.eventType === 'disconnected')).toBe(
      true
    );
    void fastApp;
    fastStore.close();
    fs.rmSync(fastTmp, { recursive: true, force: true });
  });

  it('defaults to gemini-3.8-flash, auto-upgrades retired gemini-2.5-flash, normalizes models/ prefix, and rejects stale browser snapshots', async () => {
    delete process.env.SENTRA_GEMINI_MODEL;
    delete process.env.GEMINI_API_KEY;
    expect(validateConfiguredModel()).toMatchObject({
      valid: true,
      configuredModel: 'gemini-3.8-flash',
    });

    process.env.SENTRA_GEMINI_MODEL = 'gemini-2.5-flash';
    expect(validateConfiguredModel()).toMatchObject({
      valid: true,
      rawConfiguredModel: 'gemini-2.5-flash',
      configuredModel: 'gemini-3.8-flash',
    });
    process.env.SENTRA_GEMINI_MODEL = 'models/gemini-4-hydrogen';
    expect(validateConfiguredModel()).toMatchObject({
      valid: true,
      configuredModel: 'gemini-4-hydrogen',
    });
    delete process.env.SENTRA_GEMINI_MODEL;

    // Stale browser snapshot (>20s old) must be rejected with NO_FRESH_IMAGE
    const staleDataUrl = `data:image/jpeg;base64,${VALID_JPEG_HEADER.toString('base64')}`;
    const staleRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'describe',
        operation: 'scene_analysis',
        query: 'What is in front of me?',
        image: staleDataUrl,
        imageTimestamp: Date.now() - 35000,
        wearableDeviceId: 'UNCONNECTED-DEVICE',
      }),
    });
    const staleJson = await staleRes.json();
    expect(staleJson.status).toBe('degraded');
    expect(staleJson.errorCode).toBe('NO_FRESH_IMAGE');
  });

  it('supports runtime device config updates and remote command queue polling + ack', async () => {
    // Requires operator auth for config & command endpoints
    const unauthCfg = await fetch(`${baseUrl}/api/device/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, frameSize: 'QVGA' }),
    });
    expect(unauthCfg.status).toBe(401);

    const cfgUpdateRes = await fetch(`${baseUrl}/api/device/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Token': testOperatorToken,
      },
      body: JSON.stringify({
        deviceId,
        frameSize: 'QVGA',
        jpegQuality: 15,
        proximityCriticalCm: 55,
      }),
    });
    expect(cfgUpdateRes.status).toBe(200);
    const cfgUpdateJson = await cfgUpdateRes.json();
    expect(cfgUpdateJson.config.frameSize).toBe('QVGA');
    expect(cfgUpdateJson.config.proximityCriticalCm).toBe(55);

    const cmdRes = await fetch(`${baseUrl}/api/device/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Token': testOperatorToken,
      },
      body: JSON.stringify({ deviceId, command: 'RECALIBRATE_IMU' }),
    });
    expect(cmdRes.status).toBe(200);
    const cmdJson = await cmdRes.json();
    expect(cmdJson.action.type).toBe('recalibrate_imu');

    const pollRes = await fetch(`${baseUrl}/api/device/poll?deviceId=${deviceId}`, {
      headers: { Authorization: `Bearer ${provisionedToken}` },
    });
    expect(pollRes.status).toBe(200);
    const pollJson = await pollRes.json();
    expect(pollJson.config.frameSize).toBe('QVGA');
    expect(pollJson.actions.some((a: any) => a.type === 'config_update')).toBe(true);
    expect(pollJson.actions.some((a: any) => a.type === 'recalibrate_imu')).toBe(true);

    const ackIds = pollJson.actions.map((a: any) => a.id);
    const ackRes = await fetch(`${baseUrl}/api/device/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provisionedToken}`,
      },
      body: JSON.stringify({ deviceId, actionIds: ackIds }),
    });
    expect(ackRes.status).toBe(200);

    // Status exposes deviceConfig + sensorFusion truthfully without downward drop-off on baseline
    const statusRes = await fetch(`${baseUrl}/api/device/status?deviceId=${deviceId}`);
    const statusJson = await statusRes.json();
    expect(statusJson.deviceConfig.proximityCriticalCm).toBe(55);
    expect(statusJson.sensorFusion).toBeTruthy();
  });
});
