import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { SentraEventStore } from './server/eventStore';
import { DeviceGateway } from './server/deviceGateway';
import { getConfiguredModel, isGeminiApiKeyConfigured, runSentraAnalysis } from './server/geminiService';
import {
  AckActionsSchema,
  AnalyzeRequestSchema,
  decodeBase64Image,
  DeviceRegistrationSchema,
  MAX_FRAME_BYTES,
  MemoryCreateSchema,
  parseAndAdaptTelemetry,
  validateJpegBuffer,
} from './server/validation';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

function extractBearerOrHeaderToken(req: express.Request): string | undefined {
  const headerToken = req.header('x-device-token');
  if (headerToken && headerToken.trim()) return headerToken.trim();
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return undefined;
}

function isSimulatorAllowed(req: express.Request, gateway: DeviceGateway): { allowed: boolean; reason?: string } {
  if (!gateway.isSimulatorEnabled()) {
    return { allowed: false, reason: 'Simulator endpoints are disabled (SENTRA_SIMULATOR_ENABLED=false).' };
  }
  const simHeader = req.header('x-sentra-simulator');
  if (simHeader !== 'true') {
    return { allowed: false, reason: 'Missing X-Sentra-Simulator: true confirmation header.' };
  }
  const opToken = process.env.SENTRA_OPERATOR_TOKEN?.trim();
  if (opToken) {
    const provided = extractBearerOrHeaderToken(req);
    if (provided !== opToken) {
      return { allowed: false, reason: 'Operator authentication required for simulator endpoints.' };
    }
  }
  return { allowed: true };
}

export function createSentraApp(options?: { dbPath?: string; heartbeatTimeoutMs?: number }) {
  const app = express();
  const store = new SentraEventStore(options?.dbPath);
  const gateway = new DeviceGateway(store, options?.heartbeatTimeoutMs);

  // Raw binary JPEG parser specifically for ESP32-S3 binary uploads
  app.use(
    '/api/device/frame',
    express.raw({
      type: ['image/jpeg', 'application/octet-stream'],
      limit: MAX_FRAME_BYTES + 1024,
    })
  );

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // -------------------------------------------------------------
  // SYSTEM HEALTH
  // -------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    const primary = gateway.getLiveState();
    const now = Date.now();
    const dbOk = store.isAvailable();
    res.json({
      status: dbOk ? 'ok' : 'degraded',
      name: 'SENTRA Assistive Vision Companion',
      databaseAvailable: dbOk,
      databaseError: store.getError(),
      hasApiKey: isGeminiApiKeyConfigured(),
      configuredModel: getConfiguredModel(),
      simulatorEnabled: gateway.isSimulatorEnabled(),
      deviceAuthRequired: true,
      heartbeatTimeoutMs: gateway.getHeartbeatTimeoutMs(),
      wearableConnected: Boolean(primary?.connected),
      wearableSourceMode: primary?.sourceMode ?? 'disconnected',
      lastTelemetryAgeMs:
        primary?.lastTelemetryAt != null ? Math.max(0, now - primary.lastTelemetryAt) : null,
      lastFrameAgeMs: primary?.frameAgeMs ?? null,
    });
  });

  // -------------------------------------------------------------
  // HARDWARE GATEWAY (READ-ONLY FOR DASHBOARD, SSE, AUTHED WRITES)
  // -------------------------------------------------------------
  app.get('/api/device/status', (req, res) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    const telemetry = gateway.getLiveState(deviceId);
    const devices = gateway.listLiveStates();
    res.json({
      ok: true,
      telemetry,
      devices,
      pendingActionsCount: telemetry?.pendingActionsCount ?? 0,
    });
  });

  app.get('/api/device/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    gateway.addSseClient(res);

    // Send initial snapshot immediately
    res.write(
      `event: snapshot\ndata: ${JSON.stringify({
        devices: gateway.listLiveStates(),
        telemetry: gateway.getLiveState(),
      })}\n\n`
    );

    const keepalive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepalive);
        gateway.removeSseClient(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      gateway.removeSseClient(res);
    });
  });

  app.post('/api/device/register', (req, res) => {
    const opToken = process.env.SENTRA_OPERATOR_TOKEN?.trim();
    if (opToken && extractBearerOrHeaderToken(req) !== opToken) {
      return res.status(401).json({ ok: false, error: 'Operator token required to register devices.' });
    }

    const parsed = DeviceRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    if (parsed.data.deviceId.startsWith('SIM-')) {
      return res.status(400).json({
        ok: false,
        error: 'Device IDs starting with "SIM-" are reserved for the simulator.',
      });
    }

    const reg = gateway.registerDevice({
      deviceId: parsed.data.deviceId,
      name: parsed.data.name,
      capabilities: parsed.data.capabilities,
      isSimulator: false,
    });

    return res.status(201).json({
      ok: true,
      deviceId: reg.deviceId,
      provisionedToken: reg.provisionedToken,
      note: 'Store this provisioned device token securely; it is never returned again.',
    });
  });

  app.post('/api/device/telemetry', (req, res) => {
    const token = extractBearerOrHeaderToken(req);
    const bodyDeviceId =
      req.body && typeof req.body.deviceId === 'string' ? req.body.deviceId : 'ESP32-S3-SENTRA-001';

    if (!gateway.authenticateHardwareToken(token, bodyDeviceId)) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized. Provide valid X-Device-Token or Authorization: Bearer <token>.',
      });
    }

    const existing = gateway.getLiveState(bodyDeviceId);
    const fallbackSeq = existing?.lastSequence != null ? existing.lastSequence + 1 : 0;
    const adapted = parseAndAdaptTelemetry(req.body, fallbackSeq, bodyDeviceId);
    if (!adapted.ok) {
      return res.status(400).json({ ok: false, error: adapted.error });
    }

    const result = gateway.ingestTelemetry(adapted.payload, 'hardware');
    if (!result.accepted) {
      return res.status(200).json({
        ok: true,
        accepted: false,
        reason: result.reason,
        state: result.state,
      });
    }

    return res.json({
      ok: true,
      accepted: true,
      isLegacyAdapted: adapted.isLegacyAdapted,
      state: result.state,
      triggeredAlerts: result.triggeredAlerts,
      serverTimestamp: Date.now(),
    });
  });

  app.post('/api/device/frame', (req, res) => {
    const token = extractBearerOrHeaderToken(req);
    const queryDeviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    const headerDeviceId = req.header('x-device-id');
    const bodyDeviceId =
      !Buffer.isBuffer(req.body) && req.body && typeof req.body.deviceId === 'string'
        ? req.body.deviceId
        : undefined;
    const deviceId = (queryDeviceId || headerDeviceId || bodyDeviceId || 'ESP32-S3-SENTRA-001').trim();

    if (!gateway.authenticateHardwareToken(token, deviceId)) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized. Provide valid X-Device-Token or Authorization: Bearer <token>.',
      });
    }

    const seqRaw =
      typeof req.query.sequence === 'string'
        ? Number(req.query.sequence)
        : req.header('x-frame-sequence')
        ? Number(req.header('x-frame-sequence'))
        : !Buffer.isBuffer(req.body) && req.body?.sequence !== undefined
        ? Number(req.body.sequence)
        : undefined;
    const sequence = seqRaw !== undefined && Number.isInteger(seqRaw) && seqRaw >= 0 ? seqRaw : undefined;

    let jpegBuffer: Buffer | null = null;
    if (Buffer.isBuffer(req.body)) {
      const check = validateJpegBuffer(req.body);
      if (!check.ok) {
        return res.status(400).json({ ok: false, error: check.error });
      }
      jpegBuffer = check.buffer;
    } else if (req.body && typeof req.body.frame === 'string') {
      const decoded = decodeBase64Image(req.body.frame, ['image/jpeg']);
      if (!decoded.ok) {
        return res.status(400).json({ ok: false, error: decoded.error });
      }
      jpegBuffer = decoded.buffer;
    } else {
      return res.status(400).json({
        ok: false,
        error: 'Send binary image/jpeg body or JSON { frame: "data:image/jpeg;base64,..." }.',
      });
    }

    const result = gateway.ingestFrame({
      deviceId,
      buffer: jpegBuffer,
      sequence,
      sourceMode: 'hardware',
    });

    if (!result.ok) {
      return res.status(409).json({ ok: false, error: result.error });
    }

    return res.json({
      ok: true,
      status: result.status,
    });
  });

  app.get('/api/device/frame/status', (req, res) => {
    const deviceId =
      (typeof req.query.deviceId === 'string' ? req.query.deviceId : gateway.getLiveState()?.deviceId) ||
      'ESP32-S3-SENTRA-001';
    return res.json(gateway.getFrameStatus(deviceId));
  });

  app.get('/api/device/frame/latest', (req, res) => {
    const deviceId =
      (typeof req.query.deviceId === 'string' ? req.query.deviceId : gateway.getLiveState()?.deviceId) ||
      'ESP32-S3-SENTRA-001';
    const latest = gateway.getLatestFrame(deviceId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (!latest.available || !latest.frame) {
      return res.status(404).json({ ok: false, error: 'No frame available for device.', deviceId });
    }

    if (latest.stale && req.query.rejectStale === 'true') {
      return res.status(410).json({
        ok: false,
        error: 'Latest frame is stale.',
        deviceId,
        frameAgeMs: latest.ageMs,
      });
    }

    res.setHeader('Content-Type', latest.frame.mimeType);
    res.setHeader('X-Device-Id', deviceId);
    res.setHeader('X-Frame-Sequence', String(latest.frame.sequence));
    res.setHeader('X-Frame-Timestamp', String(latest.frame.receivedAt));
    res.setHeader('X-Frame-Age-Ms', String(latest.ageMs ?? 0));
    res.setHeader('X-Frame-Stale', String(latest.stale));
    return res.send(latest.frame.buffer);
  });

  app.get('/api/device/poll', (req, res) => {
    const deviceId =
      (typeof req.query.deviceId === 'string' ? req.query.deviceId : 'ESP32-S3-SENTRA-001').trim();
    const token = extractBearerOrHeaderToken(req);
    if (!gateway.authenticateHardwareToken(token, deviceId)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized device poll.' });
    }
    const actions = gateway.pollPendingActions(deviceId);
    return res.json({ ok: true, deviceId, actions });
  });

  app.post('/api/device/ack', (req, res) => {
    const parsed = AckActionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Invalid ack payload.' });
    }
    const token = extractBearerOrHeaderToken(req);
    if (!gateway.authenticateHardwareToken(token, parsed.data.deviceId)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized device ack.' });
    }
    const acknowledged = gateway.acknowledgeActions(parsed.data.deviceId, parsed.data.actionIds);
    return res.json({ ok: true, acknowledged });
  });

  // -------------------------------------------------------------
  // PROTECTED DEVELOPER / TESTBENCH SIMULATOR ENDPOINTS
  // -------------------------------------------------------------
  app.post('/api/device/simulate', (req, res) => {
    const guard = isSimulatorAllowed(req, gateway);
    if (!guard.allowed) {
      return res.status(403).json({ ok: false, error: guard.reason });
    }

    const simId = 'SIM-ESP32-01';
    const current = gateway.getLiveState(simId);
    const nextSeq = current?.lastSequence != null ? current.lastSequence + 1 : 1;

    const rawBody = {
      schemaVersion: 1,
      deviceId: simId,
      sequence: nextSeq,
      uptimeMs: (current?.uptimeMs ?? 0) + 1000,
      batteryPercent:
        req.body?.batteryPercent !== undefined
          ? req.body.batteryPercent
          : req.body?.batteryLevel !== undefined
          ? req.body.batteryLevel
          : current?.batteryPercent ?? 82,
      batteryCharging: req.body?.batteryCharging ?? false,
      earphoneConnected: req.body?.earphoneConnected ?? false,
      audioVolume: req.body?.audioVolume ?? 80,
      sensors: {
        forwardDistanceCm:
          req.body?.forwardDistanceCm !== undefined
            ? req.body.forwardDistanceCm
            : req.body?.forwardToFDistanceCm !== undefined
            ? req.body.forwardToFDistanceCm
            : current?.sensors.forwardDistanceCm ?? 150,
        downwardDistanceMm:
          req.body?.downwardDistanceMm !== undefined
            ? req.body.downwardDistanceMm
            : req.body?.downwardCliffSensorMm !== undefined
            ? req.body.downwardCliffSensorMm
            : current?.sensors.downwardDistanceMm ?? 85,
        headPitchDeg: req.body?.headPitchDeg ?? 0,
        imu: req.body?.imu ?? current?.sensors.imu ?? null,
      },
      capabilities: {
        camera: true,
        forwardToF: true,
        downwardToF: true,
        imu: Boolean(req.body?.imu ?? current?.sensors.imu),
        audioOutput: false,
      },
    };

    const adapted = parseAndAdaptTelemetry(rawBody, nextSeq, simId);
    if (!adapted.ok) {
      return res.status(400).json({ ok: false, error: adapted.error });
    }

    const result = gateway.ingestTelemetry(adapted.payload, 'simulator');
    return res.json({
      ok: true,
      simulated: true,
      telemetry: result.state,
      triggeredAlerts: result.triggeredAlerts,
    });
  });

  app.post('/api/device/simulate/frame', (req, res) => {
    const guard = isSimulatorAllowed(req, gateway);
    if (!guard.allowed) {
      return res.status(403).json({ ok: false, error: guard.reason });
    }

    const simId = 'SIM-ESP32-01';
    if (!req.body || typeof req.body.frame !== 'string') {
      return res.status(400).json({ ok: false, error: 'Provide JSON { frame: "data:image/jpeg;base64,..." }.' });
    }
    const decoded = decodeBase64Image(req.body.frame, ['image/jpeg']);
    if (!decoded.ok) {
      return res.status(400).json({ ok: false, error: decoded.error });
    }
    const result = gateway.ingestFrame({
      deviceId: simId,
      buffer: decoded.buffer,
      sourceMode: 'simulator',
    });
    return res.json({ ok: result.ok, simulated: true, status: result.status });
  });

  // -------------------------------------------------------------
  // ANALYTICS, EVENTS, AND PERSISTENT CONTEXTUAL MEMORY
  // -------------------------------------------------------------
  app.get('/api/analytics', (req, res) => {
    const deviceId = typeof req.query.deviceId === 'string' && req.query.deviceId.trim() ? req.query.deviceId.trim() : null;
    const rawRange = String(req.query.range || '24h');
    const range = (['1h', '24h', '7d', 'all'].includes(rawRange) ? rawRange : '24h') as
      | '1h'
      | '24h'
      | '7d'
      | 'all';
    const includeSimulated = req.query.includeSimulated === 'true';

    const summary = store.getAnalyticsSummary({ deviceId, range, includeSimulated });
    return res.json(summary);
  });

  app.get('/api/events', (req, res) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    const includeSimulated = req.query.includeSimulated === 'true';
    const limit = Number(req.query.limit || 50);
    const offset = Number(req.query.offset || 0);
    const data = store.querySensorEvents({ deviceId, includeSimulated, limit, offset });
    return res.json({ ok: true, ...data });
  });

  app.get('/api/events/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="sentra-events-export.json"');
    res.json(store.exportAllData());
  });

  app.delete('/api/events', (_req, res) => {
    store.clearTelemetryEvents();
    return res.json({ ok: true });
  });

  app.get('/api/memories', (_req, res) => {
    return res.json({ ok: true, memories: store.listMemories() });
  });

  app.post('/api/memories', (req, res) => {
    const parsed = MemoryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.message });
    }
    const now = Date.now();
    const item = {
      id: `mem-${now}`,
      label: parsed.data.label,
      note: parsed.data.note,
      room: parsed.data.room,
      heading: parsed.data.heading ?? null,
      source: parsed.data.source,
      timestamp: now,
      at: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    store.addMemory(item);
    return res.status(201).json({ ok: true, memory: item });
  });

  app.delete('/api/memories/:id', (req, res) => {
    const deleted = store.deleteMemory(req.params.id);
    return res.json({ ok: true, deleted });
  });

  app.delete('/api/memories', (_req, res) => {
    store.clearMemories();
    return res.json({ ok: true });
  });

  // -------------------------------------------------------------
  // GEMINI MULTIMODAL ANALYSIS PIPELINE
  // -------------------------------------------------------------
  app.post('/api/sentra/analyze', async (req, res) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        status: 'error',
        errorCode: 'INVALID_RESPONSE',
        errorMessage: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }

    const d = parsed.data;
    const wearableDevice = gateway.getLiveState(d.wearableDeviceId);
    const frameEntry = wearableDevice ? gateway.getLatestFrame(wearableDevice.deviceId) : null;

    const result = await runSentraAnalysis({
      mode: d.mode,
      explicitOperation: d.operation,
      query: d.query,
      imageDataUrl: d.image ?? null,
      imageTimestamp: d.imageTimestamp ?? null,
      imageDimensions: d.imageDimensions ?? null,
      sensors: d.sensors,
      goal: d.goal ?? null,
      memory: d.memory,
      history: d.history,
      heading: d.heading ?? null,
      wearableDevice,
      wearableFrameBuffer:
        frameEntry && frameEntry.available && frameEntry.frame
          ? {
              buffer: frameEntry.frame.buffer,
              receivedAt: frameEntry.frame.receivedAt,
              stale: frameEntry.stale,
            }
          : null,
      useWearableFrame: d.useWearableFrame,
      store,
    });

    if (wearableDevice?.connected && result.ok && result.spokenResponse) {
      gateway.enqueueAction(wearableDevice.deviceId, {
        type: 'speech',
        text: result.spokenResponse,
        priority: 'normal',
      });
    }

    return res.json(result);
  });

  return { app, store, gateway };
}

async function startServer() {
  const { app, gateway } = createSentraApp();
  gateway.startHeartbeatMonitor();

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      plugins: [
        {
          name: 'sentra-disable-hmr-websocket',
          transform(code, id) {
            if (id.includes('vite/dist/client/client.mjs')) {
              return code.replace(
                'transport.connect(createHMRHandler(handleMessage));',
                '/* HMR disabled in server middleware mode; skip WebSocket connection */'
              );
            }
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SENTRA server listening on http://0.0.0.0:${PORT}`);
  });
}

// Start server only when executed directly as entry point
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  startServer().catch((err) => {
    console.error('Failed to start SENTRA server:', err);
    process.exit(1);
  });
}
