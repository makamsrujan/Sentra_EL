import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyCameraError } from '../src/services/cameraService';
import {
  classifySpeechError,
  extractWakePhraseCommand,
} from '../src/hooks/useVoiceAssistant';
import { parseVoiceIntent } from '../src/utils/parser';

describe('SENTRA Camera Diagnostics & Error Classification', () => {
  it('distinguishes iframe Permissions Policy / embed blocks from user permission denial', () => {
    const res = classifyCameraError(
      { name: 'NotAllowedError', message: 'Permission denied' },
      {
        isSecureContext: true,
        apiSupported: true,
        isEmbeddedIframe: true,
        permissionsPolicyBlocked: true,
        permissionState: 'prompt',
      }
    );
    expect(res.type).toBe('blocked_by_embed');

    const resTopLevelIframeGranted = classifyCameraError(
      { name: 'NotAllowedError', message: 'Disallowed by feature policy' },
      {
        isSecureContext: true,
        apiSupported: true,
        isEmbeddedIframe: true,
        permissionsPolicyBlocked: false,
        permissionState: 'granted',
      }
    );
    expect(resTopLevelIframeGranted.type).toBe('blocked_by_embed');

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

  it('classifies camera-in-use and missing camera hardware accurately', () => {
    const baseEnv = {
      isSecureContext: true,
      apiSupported: true,
      isEmbeddedIframe: false,
      permissionsPolicyBlocked: false,
      permissionState: 'granted' as PermissionState,
    };

    expect(classifyCameraError({ name: 'NotReadableError' }, baseEnv).type).toBe('in_use');
    expect(classifyCameraError({ name: 'NotFoundError' }, baseEnv).type).toBe('unavailable');
  });
});

describe('SENTRA "Hey SENTRA" Wake Word & Speech Error Handling', () => {
  it('detects standalone "Hey SENTRA" wake phrase without a command yet', () => {
    const res = extractWakePhraseCommand('Hey SENTRA');
    expect(res.detected).toBe(true);
    expect(res.command).toBe('');
    expect(res.isInterrupt).toBe(false);
  });

  it('extracts inline commands following "Hey SENTRA"', () => {
    const res = extractWakePhraseCommand('Hey, SENTRA what is right in front of me?');
    expect(res.detected).toBe(true);
    expect(res.command).toBe('what is right in front of me?');
    expect(res.isInterrupt).toBe(false);

    const parsed = parseVoiceIntent('Hey SENTRA find my keys');
    expect(parsed.mode).toBe('find');
    expect(parsed.goal).toBe('keys');
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
        isEmbedded: false,
        permissionsPolicyBlocked: false,
      })
    ).toMatchObject({ type: 'permission_denied', fatalForLoop: true });
    expect(classifySpeechError('audio-capture')).toMatchObject({
      type: 'mic_disconnected',
      fatalForLoop: true,
    });
  });
});

describe('SENTRA UI Terminology & PWA Assets Verification', () => {
  it('removes all user-facing "Cloud Vision" references in src', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
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

    const hits = walk(srcDir).filter((file) =>
      fs.readFileSync(file, 'utf8').includes('Cloud Vision')
    );
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
