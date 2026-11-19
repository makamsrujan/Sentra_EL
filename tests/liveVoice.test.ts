import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSentraApp } from '../server';
import { attachLiveVoiceWebSocket, resolveLiveModelName } from '../server/liveVoiceGateway';

describe('SENTRA Gemini 3.8 Live Voice WebSocket Gateway', () => {
  let tmpDir: string;
  let httpServer: http.Server;
  let port: number;
  let closeStore: () => void;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedLiveModel = process.env.SENTRA_LIVE_MODEL;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentra-live-test-'));
    const dbPath = path.join(tmpDir, 'live.db');
    const { app, gateway, store } = createSentraApp({ dbPath, heartbeatTimeoutMs: 2500 });
    closeStore = () => store.close();
    httpServer = http.createServer(app);
    attachLiveVoiceWebSocket({ server: httpServer, gateway, store });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
    if (savedLiveModel === undefined) delete process.env.SENTRA_LIVE_MODEL;
    else process.env.SENTRA_LIVE_MODEL = savedLiveModel;

    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults live model to gemini-3.8-live and strips models/ prefix', () => {
    delete process.env.SENTRA_LIVE_MODEL;
    expect(resolveLiveModelName()).toBe('gemini-3.8-live');

    process.env.SENTRA_LIVE_MODEL = 'models/gemini-3.8-live';
    expect(resolveLiveModelName()).toBe('gemini-3.8-live');
  });

  it('exposes liveModel on GET /api/health', async () => {
    delete process.env.SENTRA_LIVE_MODEL;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.liveModel).toBe('gemini-3.8-live');
  });

  it('returns MISSING_API_KEY JSON error over /api/live/voice when GEMINI_API_KEY is unset without crashing server', async () => {
    delete process.env.GEMINI_API_KEY;
    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/voice?deviceId=ESP32-S3-SENTRA-001&voice=Zephyr`);
      ws.on('message', (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(err);
        }
      });
      ws.on('error', reject);
    });
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('MISSING_API_KEY');
  });
});
