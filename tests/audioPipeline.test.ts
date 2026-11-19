import { describe, expect, it } from 'vitest';
import express from 'express';
import { createPcmWav, createWavHeader, isAudioSilent, validateWavBuffer } from '../server/validation';
import { parseWakePhraseAndCommand } from '../server/audio/speechToText';
import { AudioReplyStore } from '../server/audio/audioReplyStore';
import { synthesizeTestToneWav } from '../server/audio/textToSpeech';
import { createSentraApp } from '../server';

describe('SENTRA Hardware Audio Pipeline & Codec Protocol', () => {
  describe('WAV Header & Audio Validation', () => {
    it('validates a compliant 16 kHz Mono 16-bit PCM WAV buffer', () => {
      // 1 second of 16kHz mono 16-bit PCM = 32000 bytes data + 44 bytes header = 32044 bytes
      const pcmData = Buffer.alloc(32000);
      // Put a recognizable non-zero sine wave in PCM data so it is not silent
      for (let i = 0; i < 16000; i++) {
        const sample = Math.round(10000 * Math.sin((2 * Math.PI * 440 * i) / 16000));
        pcmData.writeInt16LE(sample, i * 2);
      }
      const wav = Buffer.concat([createWavHeader(pcmData.length, 16000, 1, 16), pcmData]);

      const result = validateWavBuffer(wav);
      expect(result.valid).toBe(true);
      expect(result.sampleRate).toBe(16000);
      expect(result.channels).toBe(1);
      expect(result.bitsPerSample).toBe(16);
      expect(result.durationMs).toBe(1000);
      expect(result.dataBytes).toBe(32000);
      expect(isAudioSilent(wav)).toBe(false);
    });

    it('rejects buffers smaller than 44 bytes', () => {
      const tiny = Buffer.from('RIFF1234WAVE');
      const result = validateWavBuffer(tiny);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');
    });

    it('rejects corrupted WAV containers missing RIFF/WAVE header', () => {
      const bad = Buffer.alloc(64);
      bad.write('NOT_A_WAV_CONTAINER', 0);
      const result = validateWavBuffer(bad);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid WAV container');
    });

    it('rejects WAV files exceeding 8 seconds duration', () => {
      // 9 seconds at 16kHz mono 16-bit = 9 * 16000 * 2 = 288,000 bytes
      const pcmData = Buffer.alloc(288000);
      const wav = Buffer.concat([createWavHeader(pcmData.length, 16000, 1, 16), pcmData]);
      const result = validateWavBuffer(wav, { maxDurationMs: 8000 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds the 8000 ms maximum limit');
      expect(result.durationMs).toBe(9000);
    });

    it('rejects oversized uploads exceeding MAX_AUDIO_UPLOAD_BYTES', () => {
      const huge = Buffer.alloc(600 * 1024);
      const result = validateWavBuffer(huge);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum size limit');
    });

    it('detects silent zeroed audio buffers', () => {
      const silentPcm = Buffer.alloc(16000 * 2); // 1 sec of pure silence (0x00)
      const silentWav = Buffer.concat([createWavHeader(silentPcm.length, 16000, 1, 16), silentPcm]);
      expect(isAudioSilent(silentWav)).toBe(true);
    });
  });

  describe('Wake Phrase Parsing & Command Extraction', () => {
    it('correctly parses "Hey SENTRA" wake phrase alone', () => {
      const parsed = parseWakePhraseAndCommand('Hey SENTRA');
      expect(parsed.wakeDetected).toBe(true);
      expect(parsed.command).toBe('');
      expect(parsed.isEmergencyStop).toBe(false);
    });

    it('extracts command following "Hey SENTRA, what is around me?"', () => {
      const parsed = parseWakePhraseAndCommand('Hey SENTRA, what is around me?');
      expect(parsed.wakeDetected).toBe(true);
      expect(parsed.command).toBe('what is around me?');
      expect(parsed.isEmergencyStop).toBe(false);
    });

    it('extracts target object from "Hey SENTRA, find my bottle"', () => {
      const parsed = parseWakePhraseAndCommand('Hey SENTRA, find my bottle');
      expect(parsed.wakeDetected).toBe(true);
      expect(parsed.command).toBe('find my bottle');
      expect(parsed.isEmergencyStop).toBe(false);
    });

    it('recognizes emergency "Stop" / "Cancel" commands immediately', () => {
      const stop = parseWakePhraseAndCommand('Stop');
      expect(stop.wakeDetected).toBe(true);
      expect(stop.command).toBe('stop');
      expect(stop.isEmergencyStop).toBe(true);

      const cancel = parseWakePhraseAndCommand('Cancel');
      expect(cancel.wakeDetected).toBe(true);
      expect(cancel.command).toBe('stop');
      expect(cancel.isEmergencyStop).toBe(true);
    });

    it('ignores speech that does not contain wake words', () => {
      const random = parseWakePhraseAndCommand('The weather is nice outside today.');
      expect(random.wakeDetected).toBe(false);
      expect(random.command).toBe('The weather is nice outside today.');
      expect(random.isEmergencyStop).toBe(false);
    });
  });

  describe('Audio Reply Store', () => {
    it('stores, retrieves, and isolates replies per device ID', () => {
      const store = new AudioReplyStore({ maxReplies: 10, defaultTtlMs: 2000 });
      const testBuffer = synthesizeTestToneWav(200);

      const reply1 = store.storeReply({
        deviceId: 'ESP32-S3-001',
        buffer: testBuffer,
        sampleRate: 24000,
        durationMs: 200,
      });

      expect(reply1.replyId).toMatch(/^rep-/);
      expect(reply1.deviceId).toBe('ESP32-S3-001');

      // Retrieval with correct deviceId succeeds
      const fetched = store.getReply(reply1.replyId, 'ESP32-S3-001');
      expect(fetched).not.toBeNull();
      expect(fetched?.buffer.length).toBe(testBuffer.length);

      // Retrieval with mismatched deviceId fails
      const wrongDev = store.getReply(reply1.replyId, 'ESP32-S3-999');
      expect(wrongDev).toBeNull();

      store.destroy();
    });

    it('expires replies when TTL passes', async () => {
      const store = new AudioReplyStore({ maxReplies: 10, defaultTtlMs: 50 });
      const testBuffer = synthesizeTestToneWav(100);

      const reply = store.storeReply({
        deviceId: 'ESP32-S3-001',
        buffer: testBuffer,
        ttlMs: 50,
      });

      expect(store.getReply(reply.replyId)).not.toBeNull();

      // Wait 70ms for TTL to lapse
      await new Promise((r) => setTimeout(r, 70));

      expect(store.getReply(reply.replyId)).toBeNull();
      store.destroy();
    });
  });

  describe('Authenticated Audio HTTP Routes', () => {
    it('rejects unauthenticated utterance uploads with 401', async () => {
      const { app } = createSentraApp({ dbPath: ':memory:' });
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/device/audio/utterance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Device-Id': 'ESP32-S3-SENTRA-001',
        },
        body: new Uint8Array(synthesizeTestToneWav(200)),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Unauthorized');

      server.close();
    });

    it('rejects malformed audio uploads with 400', async () => {
      const { app, gateway } = createSentraApp({ dbPath: ':memory:' });
      const server = app.listen(0);
      const port = (server.address() as any).port;
      const { provisionedToken: devToken } = gateway.registerDevice({
        deviceId: 'ESP32-S3-SENTRA-001',
        name: 'Audio test device',
        capabilities: { camera: false, forwardToF: false, downwardToF: false, imu: false, audioOutput: true },
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/device/audio/utterance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Device-Id': 'ESP32-S3-SENTRA-001',
          'X-Device-Token': devToken,
        },
        body: Buffer.from('NOT_A_VALID_WAV_HEADER_DATA_12345'),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('too small');

      server.close();
    });

    it('processes a valid direct transcript utterance and returns voice turn status', async () => {
      const opToken = 'test-op-token-audio';
      process.env.SENTRA_OPERATOR_TOKEN = opToken;
      const { app, gateway } = createSentraApp({ dbPath: ':memory:' });
      const server = app.listen(0);
      const port = (server.address() as any).port;
      const { provisionedToken: devToken } = gateway.registerDevice({
        deviceId: 'ESP32-S3-SENTRA-001',
        name: 'Audio test device',
        capabilities: { camera: false, forwardToF: false, downwardToF: false, imu: false, audioOutput: true },
      });

      // Send emergency stop via JSON transcript with operator token
      const res = await fetch(`http://127.0.0.1:${port}/api/device/audio/utterance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': devToken,
          'X-Operator-Token': opToken,
        },
        body: JSON.stringify({
          deviceId: 'ESP32-S3-SENTRA-001',
          sequence: 1,
          transcript: 'Hey SENTRA, stop',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.wakeDetected).toBe(true);
      expect(json.status).toBe('completed');
      expect(json.turnId).toMatch(/^trn-/);

      // Verify duplicate sequence is rejected with 409
      const dupRes = await fetch(`http://127.0.0.1:${port}/api/device/audio/utterance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': devToken,
          'X-Operator-Token': opToken,
        },
        body: JSON.stringify({
          deviceId: 'ESP32-S3-SENTRA-001',
          sequence: 1,
          transcript: 'Hey SENTRA, stop',
        }),
      });

      expect(dupRes.status).toBe(409);
      const dupJson = await dupRes.json();
      expect(dupJson.ok).toBe(false);
      expect(dupJson.error).toContain('Duplicate');

      server.close();
    });

    it('enforces authentication on audio reply download and rejects mismatched device identity', async () => {
      const opToken = 'test-op-token-audio';
      process.env.SENTRA_OPERATOR_TOKEN = opToken;
      const { app, gateway, audioReplyStore } = createSentraApp({ dbPath: ':memory:' });
      const server = app.listen(0);
      const port = (server.address() as any).port;
      const { provisionedToken: devToken } = gateway.registerDevice({
        deviceId: 'ESP32-S3-SENTRA-001',
        name: 'Audio test device',
        capabilities: { camera: false, forwardToF: false, downwardToF: false, imu: false, audioOutput: true },
      });

      // 1. Store a test reply directly in audioReplyStore
      const testBuffer = synthesizeTestToneWav(200);
      const stored = audioReplyStore.storeReply({
        deviceId: 'ESP32-S3-SENTRA-001',
        buffer: testBuffer,
        sampleRate: 24000,
        durationMs: 200,
      });
      const replyId = stored.replyId;

      // 2. Unauthenticated request to reply endpoint is rejected with 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/device/audio/reply/${replyId}`);
      expect(unauthRes.status).toBe(401);

      // 3. Mismatched device ID is rejected with 403
      const mismatchRes = await fetch(
        `http://127.0.0.1:${port}/api/device/audio/reply/${replyId}?deviceId=OTHER-DEV-999`,
        {
          headers: { 'X-Device-Token': devToken, 'X-Operator-Token': opToken },
        }
      );
      expect(mismatchRes.status).toBe(403);

      // 4. Authorized download succeeds and streams WAV bytes
      const authRes = await fetch(
        `http://127.0.0.1:${port}/api/device/audio/reply/${replyId}?deviceId=ESP32-S3-SENTRA-001`,
        {
          headers: { 'X-Device-Token': devToken },
        }
      );
      expect(authRes.status).toBe(200);
      expect(authRes.headers.get('Content-Type')).toBe('audio/wav');
      const bytes = await authRes.arrayBuffer();
      expect(bytes.byteLength).toBe(testBuffer.length);

      server.close();
    });

    it('protects audio ownership changes with operator credentials', async () => {
      const opToken = 'test-op-token-audio';
      process.env.SENTRA_OPERATOR_TOKEN = opToken;
      const { app } = createSentraApp({ dbPath: ':memory:' });
      const server = app.listen(0);
      const port = (server.address() as any).port;

      // Unauthenticated ownership change is rejected with 401
      const unauth = await fetch(`http://127.0.0.1:${port}/api/device/audio/ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'browser' }),
      });
      expect(unauth.status).toBe(401);

      // Operator authenticated change succeeds
      const auth = await fetch(`http://127.0.0.1:${port}/api/device/audio/ownership`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Token': opToken,
        },
        body: JSON.stringify({ mode: 'browser' }),
      });
      expect(auth.status).toBe(200);
      const json = await auth.json();
      expect(json.ok).toBe(true);
      expect(json.mode).toBe('browser');

      server.close();
    });

    it('returns truthful audio status without leaking secrets', async () => {
      const { app } = createSentraApp({ dbPath: ':memory:' });
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/device/audio/status`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.codec.name).toContain('Waveshare WM8960');
      expect(json.codec.sampleRate).toBe(16000);
      expect(json.ownershipMode).toBe('wearable');
      expect(json.sttModel).toBe('gemini-3.5-transcribe');
      expect(json.ttsModel).toBe('gemini-3.8-flash-lite-tts');
      // Verify no tokens leaked in JSON
      const jsonStr = JSON.stringify(json);
      expect(jsonStr).not.toContain('sentra-dev-key');
      expect(jsonStr).not.toContain('testOperator');

      server.close();
    });

    it('validates 24 kHz TTS WAV output without failing default 16 kHz sample rate check', () => {
      const ttsWav = synthesizeTestToneWav(200, 24000);
      const valid24k = validateWavBuffer(ttsWav, { expectedSampleRate: 24000 });
      expect(valid24k.valid).toBe(true);
      expect(valid24k.sampleRate).toBe(24000);
    });
  });
});
