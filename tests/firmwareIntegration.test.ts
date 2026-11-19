import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSentraApp } from '../server';

const rootDir = path.resolve(__dirname, '..');

describe('ESP32-S3 C Firmware Pre-Hardware Suite & Express Backend Contract', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let closeStore: () => void;
  let validJsonFromC: string;
  let missingJsonFromC: string;
  const testOperatorToken = 'fw-test-op-token';
  const deviceId = 'ESP32-S3-SENTRA-001';
  let provisionedToken = '';

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentra-fw-integ-'));
    process.env.SENTRA_OPERATOR_TOKEN = testOperatorToken;

    const { app, store } = createSentraApp({
      dbPath: path.join(tmpDir, 'fw.db'),
      heartbeatTimeoutMs: 5000,
    });
    closeStore = () => store.close();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const regRes = await fetch(`${baseUrl}/api/device/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator-Token': testOperatorToken,
      },
      body: JSON.stringify({
        deviceId,
        name: 'SENTRA Headband Unit',
        capabilities: {
          camera: true,
          forwardToF: true,
          downwardToF: false,
          imu: true,
          audioOutput: false,
          vl53l5cx: false,
        },
      }),
    });
    const regJson = await regRes.json();
    provisionedToken = regJson.provisionedToken;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('compiles and passes all 12 native C firmware tests under gcc -Wall -Wextra -Werror', () => {
    const binPath = path.join(tmpDir, 'sentra_fw_test');
    execFileSync(
      'gcc',
      [
        '-Wall',
        '-Wextra',
        '-Werror',
        '-DSENTRA_FIRMWARE_HOST_TEST',
        '-Ifirmware/esp32s3/include',
        '-Ifirmware/esp32s3/tests',
        'firmware/esp32s3/tests/test_firmware.c',
        'firmware/esp32s3/src/vl53l0x.c',
        'firmware/esp32s3/src/mpu6050.c',
        'firmware/esp32s3/src/obstacle_awareness.c',
        'firmware/esp32s3/src/local_alerts.c',
        'firmware/esp32s3/src/device_telemetry.c',
        '-lm',
        '-o',
        binPath,
      ],
      { cwd: rootDir, stdio: 'pipe' }
    );

    const normalOut = execFileSync(binPath, [], { cwd: rootDir, encoding: 'utf8' });
    expect(normalOut).toContain('all 12 ESP32-S3 firmware pre-hardware unit tests passed');

    const dumpOut = execFileSync(binPath, ['--dump-json'], { cwd: rootDir, encoding: 'utf8' });
    const validMatch = dumpOut.match(/^JSON_VALID=(.+)$/m);
    const missingMatch = dumpOut.match(/^JSON_MISSING=(.+)$/m);
    expect(validMatch).toBeTruthy();
    expect(missingMatch).toBeTruthy();
    validJsonFromC = validMatch![1];
    missingJsonFromC = missingMatch![1];
  });

  it('ingests serialized C firmware valid and missing-sensor payloads cleanly through POST /api/device/telemetry', async () => {
    expect(validJsonFromC).toBeTruthy();
    expect(missingJsonFromC).toBeTruthy();

    // 1. Valid VL53L0X + IMU + OV2640 payload produced by C firmware serializer
    const postValid = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': provisionedToken,
      },
      body: validJsonFromC,
    });
    expect(postValid.status).toBe(200);

    const statusValidRes = await fetch(`${baseUrl}/api/device/status?deviceId=${deviceId}`);
    const statusValid = await statusValidRes.json();
    expect(statusValid.telemetry.deviceId).toBe(deviceId);
    expect(statusValid.telemetry.lastSequence).toBe(42);
    expect(statusValid.telemetry.sensors.forwardDistanceCm).toBeCloseTo(42.5, 1);
    expect(statusValid.telemetry.sensors.downwardDistanceMm).toBeNull();
    expect(statusValid.telemetry.sensors.imu.calibrated).toBe(true);
    expect(statusValid.telemetry.sensors.imu.heading).toBeNull();
    expect(statusValid.telemetry.capabilities.camera).toBe(true);
    expect(statusValid.telemetry.capabilities.forwardToF).toBe(true);
    expect(statusValid.telemetry.capabilities.audioOutput).toBe(false);
    expect(statusValid.telemetry.sensorHealth.forwardToF).toBe('valid');
    expect(statusValid.sensorFusion.forwardObstruction).toBe('critical');

    // 2. Disconnected / missing sensor payload produced by C firmware serializer
    const postMissing = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': provisionedToken,
      },
      body: missingJsonFromC,
    });
    expect(postMissing.status).toBe(200);

    const statusMissingRes = await fetch(`${baseUrl}/api/device/status?deviceId=${deviceId}`);
    const statusMissing = await statusMissingRes.json();
    expect(statusMissing.telemetry.lastSequence).toBe(43);
    expect(statusMissing.telemetry.sensors.forwardDistanceCm).toBeNull();
    expect(statusMissing.telemetry.sensors.imu).toBeNull();
    expect(statusMissing.telemetry.sensors.headPitchDeg).toBeNull();
    expect(statusMissing.telemetry.capabilities.camera).toBe(false);
    expect(statusMissing.telemetry.capabilities.forwardToF).toBe(false);
    expect(statusMissing.telemetry.sensorHealth.forwardToF).toBe('invalid');
    expect(statusMissing.sensorFusion.forwardStatus).toBe('unavailable');
  });
});
