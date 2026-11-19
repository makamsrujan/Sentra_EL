#!/usr/bin/env node
// Strictly simulator-labeled gateway & protocol smoke test; never claims physical hardware success.
const base = process.env.SENTRA_BASE_URL || 'http://127.0.0.1:3000';
const token = process.env.SENTRA_OPERATOR_TOKEN;
if (!token) {
  console.error('SIM-FAIL: configure SENTRA_OPERATOR_TOKEN');
  process.exit(2);
}

async function request(path, method = 'GET', data, extraHeaders = {}) {
  const headers = {
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    'X-Sentra-Simulator': 'true',
    'X-Operator-Token': token,
    ...extraHeaders,
  };
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: data === undefined ? undefined : typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  }
  return path.includes('/frame/latest') ? response : response.json();
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const jpegBase64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDvKKKK2Mj/2Q==';

try {
  // 1. Baseline simulator telemetry (1x forward VL53L0X + GY-521 MPU6050, no downward sensor)
  const telemetry = await request('/api/device/simulate', 'POST', {
    forwardDistanceCm: 85,
    downwardDistanceMm: null,
    headPitchDeg: -3,
    batteryPercent: null,
    imu: { ax: 0.02, ay: 0.01, az: 9.81, gx: 0.1, gy: -0.1, gz: 0.0, heading: null },
  });
  check(
    telemetry.simulated && telemetry.telemetry?.sourceMode === 'simulator',
    'Telemetry not classified as simulated'
  );
  console.log('SIM-OK: baseline single-VL53L0X + MPU6050 telemetry accepted and labeled simulator');

  // 2. Simulator JPEG upload & freshness check
  const uploaded = await request('/api/device/simulate/frame', 'POST', {
    frame: 'data:image/jpeg;base64,' + jpegBase64,
  });
  check(uploaded.simulated, 'JPEG upload not labeled simulator');
  const frame = await request('/api/device/frame/status?deviceId=SIM-ESP32-01');
  check(
    frame.frameAvailable && !frame.stale && frame.connectionStatus === 'simulator',
    'Frame status not fresh or not classified as simulator'
  );
  const latestRes = await request('/api/device/frame/latest?deviceId=SIM-ESP32-01');
  check(
    (latestRes.headers.get('content-type') || '').includes('image/jpeg'),
    'Latest wearable frame did not return image/jpeg'
  );

  // 3. Dashboard status & sensor fusion safety invariants
  const snapshot = await request('/api/device/status?deviceId=SIM-ESP32-01');
  check(
    snapshot.telemetry?.sourceMode === 'simulator' &&
      snapshot.telemetry?.sensors.forwardDistanceCm === 85 &&
      snapshot.telemetry?.sensors.imu?.heading === null,
    'Dashboard did not reflect simulator VL53L0X + 6-axis MPU6050 state'
  );
  check(
    snapshot.sensorFusion?.downwardDropOffCapable === false &&
      snapshot.sensorFusion?.vl53l5cxStatus === 'unavailable',
    'Sensor fusion must not claim downward drop-off or VL53L5CX support on baseline configuration'
  );
  console.log('SIM-OK: valid JPEG, freshness, and sensor fusion invariants verified');

  // 4. Virtual device protocol roundtrip (registration, telemetry, reboot recovery, JPEG, config, command/poll/ack)
  const virtId = 'VIRT-PROTO-CHECK-01';
  const reg = await request('/api/device/register', 'POST', {
    deviceId: virtId,
    name: 'Virtual ESP32-S3 Protocol Smoke',
    capabilities: {
      camera: true,
      forwardToF: true,
      downwardToF: false,
      imu: true,
      audioOutput: false,
      vl53l5cx: false,
    },
  });
  const devToken = reg.provisionedToken;
  check(typeof devToken === 'string' && devToken.length > 20, 'Virtual device token provisioning failed');

  const devAuthHeaders = { Authorization: `Bearer ${devToken}` };

  const cfgRes = await request('/api/device/config', 'POST', {
    deviceId: virtId,
    frameSize: 'QVGA',
    jpegQuality: 14,
    proximityCriticalCm: 50,
  });
  check(cfgRes.config?.frameSize === 'QVGA' && cfgRes.config?.proximityCriticalCm === 50, 'Config update failed');

  const cmdRes = await request('/api/device/command', 'POST', {
    deviceId: virtId,
    command: 'CAPTURE_FRAME',
  });
  check(Boolean(cmdRes.action?.id), 'Command enqueue failed');

  const hwTel1 = await request(
    '/api/device/telemetry',
    'POST',
    {
      schemaVersion: 1,
      deviceId: virtId,
      sequence: 5,
      uptimeMs: 12000,
      firmwareVersion: '1.1.0-prehw',
      batteryPercent: null,
      sensors: {
        forwardDistanceCm: 38,
        downwardDistanceMm: null,
        headPitchDeg: -2,
        imu: { ax: 0.01, ay: 0.0, az: 9.81, gx: 0.1, gy: 0.0, gz: 0.0, heading: null, calibrated: true, motionMagnitude: 0.02 },
      },
      capabilities: { camera: true, forwardToF: true, downwardToF: false, imu: true, audioOutput: false, vl53l5cx: false },
      sensorHealth: {
        forwardToF: 'valid',
        downwardToF: 'unavailable',
        imu: 'valid',
        imuCalibrated: true,
        camera: 'valid',
        vl53l5cx: 'unavailable',
        wm8960: 'unavailable',
      },
    },
    devAuthHeaders
  );
  check(hwTel1.accepted === true && hwTel1.triggeredAlerts.length === 1, 'Configurable 50cm alert threshold did not trigger on 38cm');

  // Simulated device reboot (sequence resets to 1, lower uptimeMs) must be accepted
  const hwReboot = await request(
    '/api/device/telemetry',
    'POST',
    {
      schemaVersion: 1,
      deviceId: virtId,
      sequence: 1,
      uptimeMs: 900,
      firmwareVersion: '1.1.0-prehw',
      batteryPercent: null,
      sensors: {
        forwardDistanceCm: 140,
        downwardDistanceMm: null,
        headPitchDeg: 0,
        imu: { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, heading: null, calibrated: true, motionMagnitude: 0 },
      },
      capabilities: { camera: true, forwardToF: true, downwardToF: false, imu: true, audioOutput: false, vl53l5cx: false },
    },
    devAuthHeaders
  );
  check(hwReboot.accepted === true, 'Reboot sequence recovery was rejected');

  const pollRes = await request(`/api/device/poll?deviceId=${encodeURIComponent(virtId)}`, 'GET', undefined, devAuthHeaders);
  check(
    Array.isArray(pollRes.actions) && pollRes.actions.some((a) => a.type === 'capture_frame'),
    'Poll did not deliver queued capture_frame command'
  );
  check(pollRes.config?.proximityCriticalCm === 50, 'Poll did not return active runtime config');

  const ackIds = pollRes.actions.map((a) => a.id);
  const ackRes = await request(
    '/api/device/ack',
    'POST',
    { deviceId: virtId, actionIds: ackIds },
    devAuthHeaders
  );
  check(ackRes.ok === true && ackRes.acknowledged === ackIds.length, 'Command ack count mismatch');

  const pollAfterAck = await request(`/api/device/poll?deviceId=${encodeURIComponent(virtId)}`, 'GET', undefined, devAuthHeaders);
  check(Array.isArray(pollAfterAck.actions) && pollAfterAck.actions.length === 0, 'Command queue not empty after ack');

  console.log('SIM-OK: full bidirectional config/command/poll/ack & reboot sequence verified');
  console.log('SIM-NOTE: physical sensors, I2C wiring, OV2640 ribbon, and WM8960 hardware are NOT tested');
} catch (error) {
  console.error('SIM-FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
