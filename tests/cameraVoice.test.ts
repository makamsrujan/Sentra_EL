import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyCameraError } from '../src/services/cameraService';
import {
  classifySpeechError,
  combineResultSegments,
  deriveVoiceAssistantState,
  extractWakePhraseCommand,
} from '../src/hooks/useVoiceAssistant';
import { validateWearableFramePayload } from '../src/hooks/useWearableFrames';
import { parseVoiceIntent } from '../src/utils/parser';

describe('SENTRA Camera Diagnostics & Error Classification', () => {
  it('distinguishes verified iframe Permissions Policy blocks from OS blocks and site permission denials', () => {
    const resPolicyBlocked = classifyCameraError(
      { name: 'NotAllowedError', message: 'Permission denied' },
      {
        isSecureContext: true,
        apiSupported: true,
        isEmbeddedIframe: true,
        permissionsPolicyBlocked: true,
        permissionState: 'prompt',
      }
    );
    expect(resPolicyBlocked.type).toBe('blocked_by_embed');

    // Inside iframe WITHOUT permissionsPolicyBlocked & WITHOUT explicit policy msg -> should NOT blame embed blindly
    const resIframeGrantedOsDenied = classifyCameraError(
      { name: 'NotAllowedError', message: 'Permission denied by system' },
      {
        isSecureContext: true,
        apiSupported: true,
        isEmbeddedIframe: true,
        permissionsPolicyBlocked: false,
        permissionState: 'granted',
      }
    );
    expect(resIframeGrantedOsDenied.type).toBe('os_permission_denied');

    const resExplicitPolicyMsg = classifyCameraError(
      { name: 'NotAllowedError', message: 'Disallowed by feature policy' },
      {
        isSecureContext: true,
        apiSupported: true,
        isEmbeddedIframe: true,
        permissionsPolicyBlocked: false,
        permissionState: 'granted',
      }
    );
    expect(resExplicitPolicyMsg.type).toBe('blocked_by_embed');

    const resUserDenied = classifyCameraError(
      { name: 'NotAllowedError', message: 'Permission dismissed or denied' },
      {
        isSecureContext: true,
        apiSupported: true,
        isEmbeddedIframe: false,
        permissionsPolicyBlocked: false,
        permissionState: 'denied',
      }
    );
    expect(resUserDenied.type).toBe('permission_denied');
  });

  it('flags insecure HTTP origins cleanly as https_required', () => {
    const res = classifyCameraError(
      { name: 'SecurityError', message: 'Only secure origins allowed' },
      {
        isSecureContext: false,
        apiSupported: false,
        isEmbeddedIframe: false,
        permissionsPolicyBlocked: false,
        permissionState: 'unknown',
      }
    );
    expect(res.type).toBe('https_required');
  });

  it('classifies camera-in-use, invalid device IDs, and missing camera hardware accurately', () => {
    const baseEnv = {
      isSecureContext: true,
      apiSupported: true,
      isEmbeddedIframe: false,
      permissionsPolicyBlocked: false,
      permissionState: 'granted' as PermissionState,
    };

    expect(classifyCameraError({ name: 'NotReadableError' }, baseEnv).type).toBe('in_use');
    expect(classifyCameraError({ name: 'NotFoundError' }, baseEnv).type).toBe('unavailable');
    expect(
      classifyCameraError({ name: 'NotFoundError' }, baseEnv, { hadExplicitDeviceId: true }).type
    ).toBe('invalid_device_id');
    expect(classifyCameraError({ name: 'OverconstrainedError' }, baseEnv).type).toBe('invalid_device_id');
  });
});

describe('SENTRA "Hey SENTRA" Wake Word, State Machine & Multi-Segment Handling', () => {
  it('merges multi-segment transcripts and extracts full inline questions cleanly', () => {
    const combined = combineResultSegments(
      [
        { isFinal: false, 0: { transcript: 'Hey' } },
        { isFinal: false, 0: { transcript: 'SENTRA what is around me?' } },
      ],
      0
    );
    expect(combined.fullText).toBe('Hey SENTRA what is around me?');

    const parsed = extractWakePhraseCommand(combined.fullText);
    expect(parsed.detected).toBe(true);
    expect(parsed.command).toBe('what is around me?');
    expect(parsed.isInterrupt).toBe(false);

    const parsedBottle = extractWakePhraseCommand('Hey SENTRA, find my bottle');
    expect(parsedBottle.detected).toBe(true);
    expect(parsedBottle.command).toBe('find my bottle');
    expect(parseVoiceIntent(parsedBottle.command)).toMatchObject({ mode: 'find', goal: 'bottle' });
  });

  it('enforces event-driven voice states and never reports wake_listening before onstart fires', () => {
    // Even if wakeWordEnabled is true, idle or starting phase must NOT report wake_listening
    expect(
      deriveVoiceAssistantState({
        speechRecognitionSupported: true,
        voiceErrorType: null,
        isProcessing: false,
        isSpeaking: false,
        listenMode: 'idle',
        recognitionPhase: 'idle',
        wakeWordEnabled: true,
      })
    ).toBe('disabled');

    expect(
      deriveVoiceAssistantState({
        speechRecognitionSupported: true,
        voiceErrorType: null,
        isProcessing: false,
        isSpeaking: false,
        listenMode: 'wake',
        recognitionPhase: 'starting',
        wakeWordEnabled: true,
      })
    ).toBe('starting');

    // Only transitions to wake_listening when onstart sets recognitionPhase = 'active'
    expect(
      deriveVoiceAssistantState({
        speechRecognitionSupported: true,
        voiceErrorType: null,
        isProcessing: false,
        isSpeaking: false,
        listenMode: 'wake',
        recognitionPhase: 'active',
        wakeWordEnabled: true,
      })
    ).toBe('wake_listening');

    expect(
      deriveVoiceAssistantState({
        speechRecognitionSupported: true,
        voiceErrorType: 'permission_denied',
        isProcessing: false,
        isSpeaking: false,
        listenMode: 'idle',
        recognitionPhase: 'idle',
        wakeWordEnabled: false,
      })
    ).toBe('permission_blocked');

    expect(
      deriveVoiceAssistantState({
        speechRecognitionSupported: false,
        voiceErrorType: null,
        isProcessing: false,
        isSpeaking: false,
        listenMode: 'idle',
        recognitionPhase: 'idle',
        wakeWordEnabled: false,
      })
    ).toBe('unsupported');
  });

  it('recognizes interruption commands ("Stop", "Cancel", "Be quiet")', () => {
    expect(extractWakePhraseCommand('Stop').isInterrupt).toBe(true);
    expect(extractWakePhraseCommand('Be quiet').isInterrupt).toBe(true);
    expect(extractWakePhraseCommand('Hey SENTRA cancel').isInterrupt).toBe(true);
  });

  it('ignores ambient speech that does not invoke Hey SENTRA', () => {
    const res = extractWakePhraseCommand('The table has two chairs next to it');
    expect(res.detected).toBe(false);
    expect(res.isInterrupt).toBe(false);
  });

  it('treats permission/hardware errors as fatal to avoid infinite restart loops while keeping no-speech non-fatal', () => {
    expect(classifySpeechError('no-speech').fatalForLoop).toBe(false);
    expect(classifySpeechError('aborted').fatalForLoop).toBe(false);
    expect(
      classifySpeechError('not-allowed', {
        isSecureContext: true,
        isEmbedded: true,
        permissionsPolicyBlocked: false,
      })
    ).toMatchObject({ type: 'permission_denied', fatalForLoop: true });
    expect(
      classifySpeechError('not-allowed', {
        isSecureContext: true,
        isEmbedded: true,
        permissionsPolicyBlocked: true,
      })
    ).toMatchObject({ type: 'blocked_by_embed', fatalForLoop: true });
    expect(classifySpeechError('audio-capture')).toMatchObject({
      type: 'mic_disconnected',
      fatalForLoop: true,
    });
  });
});

describe('SENTRA Wearable Frame Payload Consistency', () => {
  it('rejects mismatched device IDs and invalid image blobs while accepting valid frames', () => {
    expect(
      validateWearableFramePayload({
        expectedDeviceId: 'ESP32-S3-SENTRA-001',
        responseDeviceIdHeader: 'OTHER-DEVICE',
        mimeType: 'image/jpeg',
        byteSize: 4096,
        frameAgeMs: 250,
        staleFlag: false,
      }).ok
    ).toBe(false);

    expect(
      validateWearableFramePayload({
        expectedDeviceId: 'ESP32-S3-SENTRA-001',
        responseDeviceIdHeader: 'ESP32-S3-SENTRA-001',
        mimeType: 'application/json',
        byteSize: 64,
        frameAgeMs: 250,
        staleFlag: false,
      }).ok
    ).toBe(false);

    expect(
      validateWearableFramePayload({
        expectedDeviceId: 'ESP32-S3-SENTRA-001',
        responseDeviceIdHeader: 'ESP32-S3-SENTRA-001',
        mimeType: 'image/jpeg',
        byteSize: 4096,
        frameAgeMs: 250,
        staleFlag: false,
      }).ok
    ).toBe(true);
  });
});

describe('SENTRA UI Terminology & PWA Assets Verification', () => {
  it('removes all legacy "Cloud Vision" or "SCENE 2026" references in src and server', () => {
    const walk = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          files.push(full);
        }
      }
      return files;
    };

    const allFiles = [
      ...walk(path.resolve(process.cwd(), 'src')),
      ...walk(path.resolve(process.cwd(), 'server')),
    ];
    const hits = allFiles.filter((file) => {
      const content = fs.readFileSync(file, 'utf8');
      return /cloud vision|scene 2026/i.test(content);
    });
    expect(hits).toEqual([]);
  });

  it('contains all required PWA PNG and SVG icon assets in public/', () => {
    const publicDir = path.resolve(process.cwd(), 'public');
    for (const file of [
      'icon.svg',
      'pwa-192x192.png',
      'pwa-512x512.png',
      'pwa-maskable-512x512.png',
      'apple-touch-icon.png',
    ]) {
      const fullPath = path.join(publicDir, file);
      expect(fs.existsSync(fullPath), `${file} missing`).toBe(true);
      expect(fs.statSync(fullPath).size).toBeGreaterThan(200);
    }
  });
});

