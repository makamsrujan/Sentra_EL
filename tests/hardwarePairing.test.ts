import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSentraApp } from "../server";
import { buildWearableLiveSystemInstruction, extractPcmFromWav16k } from "../server/audio/liveWearableTurn";
import { resolveLiveModelName } from "../server/liveVoiceGateway";
import { createWavHeader } from "../server/validation";

const OP_TOKEN = "pairing-test-operator-token";

// Minimal valid JPEG frames with distinct payloads for verification
const JPEG_FRAME_A = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x04,
  0x41, 0x41, 0xff, 0xd9,
]);

const JPEG_FRAME_B = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x04,
  0x42, 0x42, 0xff, 0xd9,
]);

const JPEG_FRAME_OTHER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x04,
  0x4f, 0x54, 0xff, 0xd9,
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerDevice(baseUrl: string, deviceId: string, name: string, capabilities: Record<string, boolean>) {
  const res = await fetch(`${baseUrl}/api/device/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Operator-Token": OP_TOKEN,
    },
    body: JSON.stringify({ deviceId, name, capabilities }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  expect(data.ok).toBe(true);
  expect(typeof data.provisionedToken).toBe("string");
  return data.provisionedToken as string;
}

describe("Two-Board Backend Pairing (ESP32-S3 + Separate ESP32-CAM)", () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let closeStore: () => void;
  let gatewayRef: ReturnType<typeof createSentraApp>["gateway"];

  const s3Id = "ESP32-S3-SENTRA-001";
  const camId = "ESP32-CAM-SENTRA-001";
  const otherCamId = "ESP32-CAM-OTHER-002";
  const unpairedId = "ESP32-S3-LEGACY-SINGLE";
  const mispairedS3Id = "ESP32-S3-MISPAIRED-SIM";

  let s3Token = "";
  let camToken = "";
  let otherCamToken = "";
  let unpairedToken = "";
  let mispairedS3Token = "";

  const prevOpToken = process.env.SENTRA_OPERATOR_TOKEN;
  const prevSimEnabled = process.env.SENTRA_SIMULATOR_ENABLED;
  const prevGeminiKey = process.env.GEMINI_API_KEY;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentra-pairing-test-"));
    process.env.SENTRA_OPERATOR_TOKEN = OP_TOKEN;
    process.env.SENTRA_SIMULATOR_ENABLED = "true";
    delete process.env.GEMINI_API_KEY;

    const created = createSentraApp({
      dbPath: path.join(tmpDir, "pairing.db"),
      heartbeatTimeoutMs: 2000,
      cameraPairings: {
        [s3Id]: camId,
        [mispairedS3Id]: "SIM-ESP32-01",
      },
    });
    gatewayRef = created.gateway;
    closeStore = () => created.store.close();

    await new Promise<void>((resolve) => {
      server = created.app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    s3Token = await registerDevice(baseUrl, s3Id, "S3 Sensor Controller", {
      camera: false,
      forwardToF: true,
      downwardToF: false,
      imu: true,
      audioOutput: false,
    });
    camToken = await registerDevice(baseUrl, camId, "ESP32-CAM Primary", {
      camera: true,
      forwardToF: false,
      downwardToF: false,
      imu: false,
      audioOutput: false,
    });
    otherCamToken = await registerDevice(baseUrl, otherCamId, "ESP32-CAM Unpaired Other", {
      camera: true,
      forwardToF: false,
      downwardToF: false,
      imu: false,
      audioOutput: false,
    });
    unpairedToken = await registerDevice(baseUrl, unpairedId, "Legacy Single Board", {
      camera: true,
      forwardToF: true,
      downwardToF: false,
      imu: true,
      audioOutput: false,
    });
    mispairedS3Token = await registerDevice(baseUrl, mispairedS3Id, "S3 Mispaired To Sim", {
      camera: false,
      forwardToF: true,
      downwardToF: false,
      imu: true,
      audioOutput: false,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeStore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevOpToken === undefined) delete process.env.SENTRA_OPERATOR_TOKEN;
    else process.env.SENTRA_OPERATOR_TOKEN = prevOpToken;
    if (prevSimEnabled === undefined) delete process.env.SENTRA_SIMULATOR_ENABLED;
    else process.env.SENTRA_SIMULATOR_ENABLED = prevSimEnabled;
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
  });

  async function sendS3Telemetry(id: string, token: string, sequence: number, forwardDistanceCm = 75) {
    const res = await fetch(`${baseUrl}/api/device/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Token": token,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        deviceId: id,
        sequence,
        uptimeMs: sequence * 1000,
        sensors: {
          forwardDistanceCm,
          downwardDistanceMm: null,
          imu: { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, pitch: 2, roll: 0, heading: null, calibrated: true },
        },
        capabilities: {
          camera: false,
          forwardToF: true,
          downwardToF: false,
          imu: true,
          audioOutput: false,
        },
        sensorHealth: {
          camera: "unavailable",
          forwardToF: "valid",
          imu: "valid",
        },
      }),
    });
    return res;
  }

  async function uploadFrame(
    id: string,
    token: string,
    jpeg: Buffer,
    opts?: { sequence?: number; bootSession?: string }
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "image/jpeg",
      "X-Device-Token": token,
    };
    if (opts?.sequence !== undefined) headers["X-Frame-Sequence"] = String(opts.sequence);
    if (opts?.bootSession) headers["X-Boot-Session"] = opts.bootSession;
    return fetch(`${baseUrl}/api/device/frame?deviceId=${encodeURIComponent(id)}`, {
      method: "POST",
      headers,
      body: new Uint8Array(jpeg),
    });
  }

  it("enforces independent per-device tokens between S3 and ESP32-CAM", async () => {
    const camUsingS3Token = await uploadFrame(camId, s3Token, JPEG_FRAME_A, {
      sequence: 1,
      bootSession: "cam-auth-check",
    });
    expect(camUsingS3Token.status).toBe(401);

    const s3UsingCamToken = await sendS3Telemetry(s3Id, camToken, 1);
    expect(s3UsingCamToken.status).toBe(401);
  });

  it("pairs S3 telemetry with ESP32-CAM frames while preserving requested deviceId across status, latest JPEG, analyze, and Live Voice", async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const health = await healthRes.json();
    expect(health.cameraPairings[s3Id]).toBe(camId);

    const telRes = await sendS3Telemetry(s3Id, s3Token, 1, 68);
    expect(telRes.status).toBe(200);

    const frameRes = await uploadFrame(camId, camToken, JPEG_FRAME_A, {
      sequence: 1,
      bootSession: "cam-boot-0001",
    });
    expect(frameRes.status).toBe(200);

    // 1. Device status preserves S3 deviceId + sensor readings and surfaces paired camera freshness
    const statusRes = await fetch(`${baseUrl}/api/device/status?deviceId=${s3Id}`);
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json();
    expect(status.telemetry.deviceId).toBe(s3Id);
    expect(status.telemetry.connected).toBe(true);
    expect(status.telemetry.sensors.forwardDistanceCm).toBe(68);
    expect(status.telemetry.frameAvailable).toBe(true);
    expect(status.telemetry.frameStale).toBe(false);
    expect(status.telemetry.sensorHealth.camera).toBe("valid");

    // 2. Frame status preserves S3 deviceId for unchanged UI
    const fStatusRes = await fetch(`${baseUrl}/api/device/frame/status?deviceId=${s3Id}`);
    const fStatus = await fStatusRes.json();
    expect(fStatus.deviceId).toBe(s3Id);
    expect(fStatus.frameAvailable).toBe(true);
    expect(fStatus.stale).toBe(false);
    expect(fStatus.connectionStatus).toBe("hardware");

    // 3. Latest JPEG preserves X-Device-Id (S3) and exposes X-Camera-Device-Id (ESP32-CAM)
    const latestRes = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${s3Id}&rejectStale=true`);
    expect(latestRes.status).toBe(200);
    expect(latestRes.headers.get("x-device-id")).toBe(s3Id);
    expect(latestRes.headers.get("x-camera-device-id")).toBe(camId);
    const bytes = Buffer.from(await latestRes.arrayBuffer());
    expect(bytes.equals(JPEG_FRAME_A)).toBe(true);

    // 4. Independent board health check via API (no UI change needed)
    const camStatusRes = await fetch(`${baseUrl}/api/device/status?deviceId=${camId}`);
    const camStatus = await camStatusRes.json();
    expect(camStatus.telemetry.deviceId).toBe(camId);
    expect(camStatus.telemetry.connected).toBe(true);
    expect(camStatus.telemetry.frameAvailable).toBe(true);

    // 5. Primary live state prefers S3 controller over paired camera node, and Live Voice frame fetch resolves paired camera
    const primaryLive = gatewayRef.getLiveState();
    expect(primaryLive?.deviceId).toBe(s3Id);
    const liveVoiceFrame = gatewayRef.getLatestFrame(s3Id, { excludeSimulator: true });
    expect(liveVoiceFrame.available).toBe(true);
    expect(liveVoiceFrame.cameraConnected).toBe(true);
    expect(liveVoiceFrame.sourceDeviceId).toBe(camId);
    expect(liveVoiceFrame.frame?.buffer.equals(JPEG_FRAME_A)).toBe(true);

    // 6. Wearable visual analysis resolves the fresh paired camera frame (fails at NO_API_KEY, NOT NO_FRESH_IMAGE)
    const analyzeRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "describe",
        operation: "scene_analysis",
        query: "What is in front of me?",
        useWearableFrame: true,
        wearableDeviceId: s3Id,
      }),
    });
    const analyzeData = await analyzeRes.json();
    expect(analyzeData.errorCode).toBe("MISSING_API_KEY");
  });

  it("handles camera-only reboots safely when X-Boot-Session changes and client sequence resets to 1", async () => {
    const r2 = await uploadFrame(camId, camToken, JPEG_FRAME_A, {
      sequence: 2,
      bootSession: "cam-boot-0001",
    });
    expect(r2.status).toBe(200);
    const seqBeforeReboot = (await r2.json()).status.sequence;

    // Duplicate sequence within same boot session should not regress or advance sequence
    const dup = await uploadFrame(camId, camToken, JPEG_FRAME_B, {
      sequence: 2,
      bootSession: "cam-boot-0001",
    });
    expect(dup.status).toBe(200);
    expect((await dup.json()).status.sequence).toBe(seqBeforeReboot);

    // Camera reboots: new boot session ID, client sequence restarts at 1
    const afterReboot = await uploadFrame(camId, camToken, JPEG_FRAME_B, {
      sequence: 1,
      bootSession: "cam-boot-0002",
    });
    expect(afterReboot.status).toBe(200);
    const seqAfterReboot = (await afterReboot.json()).status.sequence;
    expect(seqAfterReboot).toBeGreaterThan(seqBeforeReboot);

    // Paired S3 immediately receives the new post-reboot JPEG bytes
    const latestRes = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${s3Id}`);
    expect(latestRes.status).toBe(200);
    expect(Number(latestRes.headers.get("x-frame-sequence"))).toBe(seqAfterReboot);
    const bytes = Buffer.from(await latestRes.arrayBuffer());
    expect(bytes.equals(JPEG_FRAME_B)).toBe(true);
  });

  it("retains backward-compatible single-device behavior when no pairing exists", async () => {
    const telRes = await sendS3Telemetry(unpairedId, unpairedToken, 1, 95);
    expect(telRes.status).toBe(200);
    const frameRes = await uploadFrame(unpairedId, unpairedToken, JPEG_FRAME_A, {
      sequence: 1,
      bootSession: "single-boot-1",
    });
    expect(frameRes.status).toBe(200);

    const latestRes = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${unpairedId}`);
    expect(latestRes.status).toBe(200);
    expect(latestRes.headers.get("x-device-id")).toBe(unpairedId);
    expect(latestRes.headers.get("x-camera-device-id")).toBe(unpairedId);
  });

  it("keeps sensor telemetry and camera health independent on disconnect and never falls back to another camera or simulator", async () => {
    // Keep another unrelated camera AND the simulator actively streaming fresh frames
    const otherRes = await uploadFrame(otherCamId, otherCamToken, JPEG_FRAME_OTHER, {
      sequence: 1,
      bootSession: "other-boot-1",
    });
    expect(otherRes.status).toBe(200);

    const simFrameRes = await fetch(`${baseUrl}/api/device/simulate/frame`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Operator-Token": OP_TOKEN,
        "X-Sentra-Simulator": "true",
      },
      body: JSON.stringify({
        deviceId: "SIM-ESP32-01",
        frame: `data:image/jpeg;base64,${JPEG_FRAME_OTHER.toString("base64")}`,
      }),
    });
    expect(simFrameRes.status).toBe(200);

    // Let paired CAM heartbeat expire (> 700 ms) while keeping S3 telemetry alive
    await sleep(1100);
    expect((await sendS3Telemetry(s3Id, s3Token, 2, 52)).status).toBe(200);
    expect((await uploadFrame(otherCamId, otherCamToken, JPEG_FRAME_OTHER, { sequence: 2, bootSession: "other-boot-1" })).status).toBe(200);
    await sleep(1100);
    expect((await sendS3Telemetry(s3Id, s3Token, 3, 52)).status).toBe(200);

    // S3 sensor controller stays connected with valid ToF, while paired camera reports offline/no live frame
    const s3Status = await (await fetch(`${baseUrl}/api/device/status?deviceId=${s3Id}`)).json();
    expect(s3Status.telemetry.connected).toBe(true);
    expect(s3Status.telemetry.sensors.forwardDistanceCm).toBe(52);
    expect(s3Status.telemetry.frameAvailable).toBe(false);
    expect(s3Status.telemetry.sensorHealth.camera).toBe("unavailable");

    const fStatus = await (await fetch(`${baseUrl}/api/device/frame/status?deviceId=${s3Id}`)).json();
    expect(fStatus.deviceId).toBe(s3Id);
    expect(fStatus.frameAvailable).toBe(false);
    expect(fStatus.connectionStatus).toBe("disconnected");

    // Must return 404 (never fall back to otherCamId or SIM-ESP32-01)
    const latestRes = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${s3Id}`);
    expect(latestRes.status).toBe(404);

    // Visual analysis must fail honestly with NO_FRESH_IMAGE
    const analyzeOffline = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "describe",
        operation: "scene_analysis",
        query: "Describe ahead",
        useWearableFrame: true,
        wearableDeviceId: s3Id,
      }),
    });
    expect((await analyzeOffline.json()).errorCode).toBe("NO_FRESH_IMAGE");

    // Reverse: bring CAM back online and let S3 expire -> CAM remains independently online while S3 is disconnected
    await sleep(2150);
    expect((await uploadFrame(camId, camToken, JPEG_FRAME_A, { sequence: 2, bootSession: "cam-boot-0002" })).status).toBe(200);

    const s3OfflineStatus = await (await fetch(`${baseUrl}/api/device/status?deviceId=${s3Id}`)).json();
    expect(s3OfflineStatus.telemetry.connected).toBe(false);

    const camOnlineStatus = await (await fetch(`${baseUrl}/api/device/status?deviceId=${camId}`)).json();
    expect(camOnlineStatus.telemetry.connected).toBe(true);
    expect(camOnlineStatus.telemetry.frameAvailable).toBe(true);
  });

  it("rejects stale frames with 410 and NO_FRESH_IMAGE even while camera heartbeat is active", async () => {
    // Configure short sensorStaleMs on paired camera for fast deterministic stale check
    const cfgRes = await fetch(`${baseUrl}/api/device/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Operator-Token": OP_TOKEN,
      },
      body: JSON.stringify({
        deviceId: camId,
        sensorStaleMs: 1000,
      }),
    });
    expect(cfgRes.status).toBe(200);

    expect((await sendS3Telemetry(s3Id, s3Token, 4, 80)).status).toBe(200);
    expect((await uploadFrame(camId, camToken, JPEG_FRAME_A, { sequence: 3, bootSession: "cam-boot-0002" })).status).toBe(200);

    // Wait > 120 ms (frame stale) but < 700 ms (camera still connected)
    await sleep(1100);

    const fStatus = await (await fetch(`${baseUrl}/api/device/frame/status?deviceId=${s3Id}`)).json();
    expect(fStatus.frameAvailable).toBe(true);
    expect(fStatus.stale).toBe(true);

    const staleLatest = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${s3Id}&rejectStale=true`);
    expect(staleLatest.status).toBe(410);

    const analyzeStale = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "describe",
        operation: "scene_analysis",
        query: "What is ahead?",
        useWearableFrame: true,
        wearableDeviceId: s3Id,
      }),
    });
    expect((await analyzeStale.json()).errorCode).toBe("NO_FRESH_IMAGE");
  });

  it("strictly excludes simulator frames from live visual analysis and hardware pairings", async () => {
    // Push fresh simulator frame + telemetry
    const simTelRes = await fetch(`${baseUrl}/api/device/simulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Operator-Token": OP_TOKEN,
        "X-Sentra-Simulator": "true",
      },
      body: JSON.stringify({
        deviceId: "SIM-ESP32-01",
        forwardDistanceCm: 40,
      }),
    });
    expect(simTelRes.status).toBe(200);

    const simFrameRes = await fetch(`${baseUrl}/api/device/simulate/frame`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Operator-Token": OP_TOKEN,
        "X-Sentra-Simulator": "true",
      },
      body: JSON.stringify({
        deviceId: "SIM-ESP32-01",
        frame: `data:image/jpeg;base64,${JPEG_FRAME_A.toString("base64")}`,
      }),
    });
    expect(simFrameRes.status).toBe(200);

    // 1. Hardware controller mispaired to SIM-ESP32-01 must NOT serve simulator frames
    expect((await sendS3Telemetry(mispairedS3Id, mispairedS3Token, 1, 70)).status).toBe(200);
    const mispairedFrameStatus = await (await fetch(`${baseUrl}/api/device/frame/status?deviceId=${mispairedS3Id}`)).json();
    expect(mispairedFrameStatus.frameAvailable).toBe(false);
    const mispairedLatest = await fetch(`${baseUrl}/api/device/frame/latest?deviceId=${mispairedS3Id}`);
    expect(mispairedLatest.status).toBe(404);

    // 2. Live visual analysis targeting SIM-ESP32-01 must exclude simulator JPEG frame
    const simAnalyzeRes = await fetch(`${baseUrl}/api/sentra/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "describe",
        operation: "scene_analysis",
        query: "What do you see?",
        useWearableFrame: true,
        wearableDeviceId: "SIM-ESP32-01",
      }),
    });
    expect((await simAnalyzeRes.json()).errorCode).toBe("NO_FRESH_IMAGE");

    // 3. Live Voice frame helper explicitly rejects simulator frames
    const lvSimFrame = gatewayRef.getLatestFrame("SIM-ESP32-01", { excludeSimulator: true });
    expect(lvSimFrame.available).toBe(false);
    expect(lvSimFrame.frame).toBeNull();
  });

  it("supports physical PTT trigger without wake phrase and handles ESP32-S3 audio reboots via X-Boot-Session", async () => {
    // 1. Without X-Audio-Trigger: ptt, an utterance lacking "Hey SENTRA" is ignored_no_wake (backward compatible)
    const wakeOnlyRes = await fetch(`${baseUrl}/api/device/audio/utterance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": s3Id,
        "X-Device-Token": s3Token,
        "X-Operator-Token": OP_TOKEN,
        "X-Sequence": "1",
        "X-Boot-Session": "s3-boot-0001",
      },
      body: JSON.stringify({ transcript: "what is in front of me" }),
    });
    expect(wakeOnlyRes.status).toBe(200);
    expect((await wakeOnlyRes.json()).status).toBe("ignored_no_wake");

    // 2. Duplicate sequence within the same S3 boot session is rejected with 409
    const dupRes = await fetch(`${baseUrl}/api/device/audio/utterance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": s3Id,
        "X-Device-Token": s3Token,
        "X-Operator-Token": OP_TOKEN,
        "X-Sequence": "1",
        "X-Boot-Session": "s3-boot-0001",
      },
      body: JSON.stringify({ transcript: "duplicate" }),
    });
    expect(dupRes.status).toBe(409);

    // 3. With X-Audio-Trigger: ptt and a new X-Boot-Session (simulating S3 reboot resetting sequence to 1),
    //    natural speech without "Hey SENTRA" is accepted and processed immediately
    const pttRebootRes = await fetch(`${baseUrl}/api/device/audio/utterance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": s3Id,
        "X-Device-Token": s3Token,
        "X-Operator-Token": OP_TOKEN,
        "X-Sequence": "1",
        "X-Boot-Session": "s3-boot-0002",
        "X-Audio-Trigger": "ptt",
      },
      body: JSON.stringify({ transcript: "check device status" }),
    });
    expect(pttRebootRes.status).toBe(200);
    const pttData = await pttRebootRes.json();
    expect(pttData.ok).toBe(true);
    expect(pttData.status).toBe("completed");
    expect(pttData.wakeDetected).toBe(true);
  });

  it("prepares INMP441 16 kHz PCM audio and grounded system instructions for gemini-3.8-live wearable voice turns", () => {
    expect(resolveLiveModelName()).toBe("gemini-3.8-live");

    const pcmPayload = Buffer.alloc(640, 0x2a);
    const wav = Buffer.concat([createWavHeader(pcmPayload.length, 16000, 1, 16), pcmPayload]);
    const extracted = extractPcmFromWav16k(wav);
    expect(extracted).not.toBeNull();
    expect(extracted!.length).toBe(640);
    expect(extracted!.equals(pcmPayload)).toBe(true);
    expect(extractPcmFromWav16k(Buffer.from("not-a-wav"))).toBeNull();

    const withFrame = buildWearableLiveSystemInstruction({
      sensorsSummary: "Forward obstacle: 68 cm",
      memoriesSummary: "Keys: on desk",
      hasFreshImage: true,
    });
    expect(withFrame).toContain("paired ESP32-CAM");
    expect(withFrame).toContain("Forward obstacle: 68 cm");
    expect(withFrame).toContain("no downward drop-off sensor");

    const withoutFrame = buildWearableLiveSystemInstruction({
      sensorsSummary: "unavailable",
      memoriesSummary: "",
      hasFreshImage: false,
    });
    expect(withoutFrame).toContain("NO fresh camera image is attached");
  });
});
