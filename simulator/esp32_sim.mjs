#!/usr/bin/env node
// Strictly simulator-labeled gateway smoke test; never claims physical hardware success.
const base = process.env.SENTRA_BASE_URL || 'http://127.0.0.1:3000';
const token = process.env.SENTRA_OPERATOR_TOKEN;
if (!token) { console.error('SIM-FAIL: configure SENTRA_OPERATOR_TOKEN'); process.exit(2); }

async function request(path, method = 'GET', data) {
  const headers = method === 'POST'
    ? { 'Content-Type': 'application/json', 'X-Sentra-Simulator': 'true', 'X-Operator-Token': token }
    : {};
  const response = await fetch(new URL(path, base), {
    method, headers, body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) throw new Error(path + ': HTTP ' + response.status + ' ' + await response.text());
  return path.includes('/frame/latest') ? response : response.json();
}
function check(condition, message) { if (!condition) throw new Error(message); }
const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDvKKKK2Mj/2Q==';

try {
  const telemetry = await request('/api/device/simulate', 'POST', {
    forwardDistanceCm: 85, downwardDistanceMm: 105, batteryPercent: null,
    imu: { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, heading: null },
  });
  check(telemetry.simulated && telemetry.telemetry?.sourceMode === 'simulator',
    'Telemetry not classified as simulated');
  console.log('SIM-OK: telemetry accepted and labeled simulator');
  const uploaded = await request('/api/device/simulate/frame', 'POST', {
    frame: 'data:image/jpeg;base64,' + jpegBase64,
  });
  check(uploaded.simulated, 'JPEG upload not labeled simulator');
  const frame = await request('/api/device/frame/status?deviceId=SIM-ESP32-01');
  check(frame.frameAvailable && frame.connectionStatus === 'simulator',
    'Frame status not classified as simulator');
  const snapshot = await request('/api/device/status?deviceId=SIM-ESP32-01');
  check(snapshot.telemetry?.sourceMode === 'simulator' &&
        snapshot.telemetry?.sensors.forwardDistanceCm === 85,
        'Dashboard did not receive simulated telemetry');
  console.log('SIM-OK: valid JPEG and dashboard source verification');
  console.log('SIM-NOTE: physical sensors, VAD and headset audio are NOT tested');
} catch (error) {
  console.error('SIM-FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
