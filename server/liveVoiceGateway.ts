import type http from 'node:http';
import {
  FunctionDeclaration,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Type,
} from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import { evaluateSensorFusion } from '../src/utils/sensorFusion';
import type { DeviceGateway } from './deviceGateway';
import type { SentraEventStore } from './eventStore';
import { isGeminiApiKeyConfigured } from './geminiService';

export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
export const ALLOWED_LIVE_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'] as const;
export type LiveVoicePersona = (typeof ALLOWED_LIVE_VOICES)[number];

const SENTRA_LIVE_SYSTEM_INSTRUCTION = `You are SENTRA, a real-time voice-first assistive companion for blind and visually impaired users, connected to a two-board ESP32-S3 sensor controller + paired ESP32-CAM wearable (with discrete INMP441 mic and MAX98357A speaker audio).

GROUNDING & HARDWARE RULES:
1. Ground visual claims strictly in the live camera frames attached to this session. Never invent objects, doors, stairs, or safe walking paths not seen right now.
2. Baseline wearable hardware has ONE forward-facing VL53L0X ToF sensor and a 6-axis GY-521 MPU6050 IMU (no compass heading, no downward drop-off sensor). Never claim downward cliff/drop-off safety unless the optional sensor is explicitly reported active.
3. Call get_wearable_telemetry whenever the user asks about distance, obstacles, battery, pitch, or wearable health.
4. Call capture_wearable_snapshot when the user asks to inspect surroundings using the paired ESP32-CAM camera and no fresh frame arrived in the last 2 seconds.
5. Call save_contextual_memory when the user asks you to remember where an item or place is located.
6. Speak concisely in 1 to 2 calm sentences using clock positions ("at 12 o'clock") and human-scale distances ("within arm's reach", "about 1 meter ahead").`;

const sentraLiveTools: FunctionDeclaration[] = [
  {
    name: 'get_wearable_telemetry',
    description:
      'Returns the live fused hardware telemetry from the ESP32-S3 headband (VL53L0X forward distance, MPU6050 pitch & calibration, battery, OV2640 frame freshness, and hazard status).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: {
          type: Type.STRING,
          description: 'Optional ESP32-S3 device identifier.',
        },
      },
    },
  },
  {
    name: 'capture_wearable_snapshot',
    description:
      'Queues a capture_frame command to the connected ESP32-S3 OV2640 camera to grab a fresh JPEG frame immediately.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: {
          type: Type.STRING,
          description: 'ESP32-S3 device identifier.',
        },
      },
    },
  },
  {
    name: 'recalibrate_imu',
    description:
      'Queues an IMU calibration command for the GY-521 MPU6050 on the headband.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: {
          type: Type.STRING,
          description: 'ESP32-S3 device identifier.',
        },
      },
    },
  },
  {
    name: 'save_contextual_memory',
    description:
      'Saves an object or place location requested by the user into contextual memory.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING, description: 'Short name of object or landmark.' },
        note: { type: Type.STRING, description: 'Where the object is positioned.' },
        room: { type: Type.STRING, description: 'Optional room name.' },
      },
      required: ['label', 'note'],
    },
  },
];

export function resolveLiveModelName(): string {
  const raw = process.env.SENTRA_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  return raw.replace(/^models\//i, '') || DEFAULT_LIVE_MODEL;
}

export function attachLiveVoiceWebSocket(params: {
  server: http.Server;
  gateway: DeviceGateway;
  store: SentraEventStore;
}): WebSocketServer {
  const wss = new WebSocketServer({ server: params.server, path: '/api/live/voice' });

  wss.on('connection', async (clientWs, req) => {
    const reqUrl = new URL(req.url || '/api/live/voice', 'http://localhost');
    let activeDeviceId = reqUrl.searchParams.get('deviceId')?.trim() || 'ESP32-S3-SENTRA-001';
    let cameraSource = reqUrl.searchParams.get('source')?.trim() || 'browser_camera';
    const requestedVoice = reqUrl.searchParams.get('voice')?.trim() || process.env.SENTRA_LIVE_VOICE || 'Zephyr';
    const voiceName: LiveVoicePersona = (ALLOWED_LIVE_VOICES as readonly string[]).includes(requestedVoice)
      ? (requestedVoice as LiveVoicePersona)
      : 'Zephyr';

    if (!isGeminiApiKeyConfigured()) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: 'MISSING_API_KEY',
          message: 'GEMINI_API_KEY is not configured on the server for Live API conversations.',
        })
      );
      clientWs.close(1011, 'GEMINI_API_KEY missing');
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const liveModel = resolveLiveModelName();
    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let closed = false;
    let lastVideoSentAt = 0;
    let lastPushedWearableFrameAt = 0;
    let lastAlertSequence = -1;

    const sendJson = (payload: Record<string, unknown>) => {
      if (!closed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      session = await ai.live.connect({
        model: liveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: sentraLiveTools }],
          systemInstruction: SENTRA_LIVE_SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              sendJson({ type: 'input_transcript', text: content.inputTranscription.text });
            }
            if (content?.outputTranscription?.text) {
              sendJson({ type: 'output_transcript', text: content.outputTranscription.text });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendJson({ type: 'audio', data: part.inlineData.data });
              }
            }
            if (content?.interrupted) {
              sendJson({ type: 'interrupted' });
            }
            if (content?.turnComplete) {
              sendJson({ type: 'turn_complete' });
            }

            if (message.toolCall?.functionCalls?.length && session) {
              const functionResponses = message.toolCall.functionCalls.map((call) => {
                const args = (call.args || {}) as Record<string, unknown>;
                const targetId =
                  typeof args.deviceId === 'string' && args.deviceId.trim()
                    ? args.deviceId.trim()
                    : activeDeviceId;

                if (call.name === 'get_wearable_telemetry') {
                  const dev = params.gateway.getLiveState(targetId);
                  const fusion = evaluateSensorFusion(dev);
                  const frameStatus = params.gateway.getFrameStatus(targetId);
                  return {
                    id: call.id,
                    name: call.name,
                    response: {
                      connected: Boolean(dev?.connected),
                      deviceId: targetId,
                      sourceMode: dev?.sourceMode ?? 'disconnected',
                      batteryPercent: dev?.batteryPercent ?? null,
                      sensorFusion: fusion,
                      cameraFrameFresh: Boolean(frameStatus.frameAvailable && !frameStatus.stale),
                      cameraFrameAgeMs: frameStatus.frameAgeMs,
                    },
                  };
                }

                if (call.name === 'capture_wearable_snapshot') {
                  const action = params.gateway.enqueueCommand({
                    deviceId: targetId,
                    command: 'CAPTURE_FRAME',
                  });
                  sendJson({
                    type: 'hardware_event',
                    event: 'CAPTURE_FRAME',
                    deviceId: targetId,
                    queued: Boolean(action),
                  });
                  return {
                    id: call.id,
                    name: call.name,
                    response: action
                      ? { queued: true, actionId: action.id, deviceId: targetId }
                      : { queued: false, reason: 'Wearable device is not registered or connected.' },
                  };
                }

                if (call.name === 'recalibrate_imu') {
                  const action = params.gateway.enqueueCommand({
                    deviceId: targetId,
                    command: 'RECALIBRATE_IMU',
                  });
                  sendJson({
                    type: 'hardware_event',
                    event: 'RECALIBRATE_IMU',
                    deviceId: targetId,
                    queued: Boolean(action),
                  });
                  return {
                    id: call.id,
                    name: call.name,
                    response: action
                      ? { queued: true, actionId: action.id, deviceId: targetId }
                      : { queued: false, reason: 'Wearable device is not registered or connected.' },
                  };
                }

                if (call.name === 'save_contextual_memory') {
                  const label = String(args.label || 'Saved Location').slice(0, 120);
                  const note = String(args.note || 'Observed during live conversation.').slice(0, 1000);
                  const room = typeof args.room === 'string' && args.room.trim()
                    ? args.room.trim().slice(0, 80)
                    : 'Current Area';
                  const now = Date.now();
                  const memoryItem = {
                    id: `mem-${now}`,
                    label,
                    note,
                    room,
                    heading: null,
                    source: 'live_verified' as const,
                    timestamp: now,
                    at: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  };
                  params.store.addMemory(memoryItem);
                  sendJson({ type: 'memory_saved', memory: memoryItem });
                  return {
                    id: call.id,
                    name: call.name,
                    response: { saved: true, memory: memoryItem },
                  };
                }

                return {
                  id: call.id,
                  name: call.name,
                  response: { error: `Unknown tool: ${call.name}` },
                };
              });

              session.sendToolResponse({ functionResponses });
            }
          },
          onerror: (err: any) => {
            sendJson({
              type: 'error',
              code: 'LIVE_SESSION_ERROR',
              message: err?.message || 'Gemini Live stream error.',
            });
          },
          onclose: () => {
            if (!closed) {
              sendJson({ type: 'closed' });
              clientWs.close();
            }
          },
        },
      });

      const initialState = params.gateway.getLiveState(activeDeviceId);
      const initialFusion = evaluateSensorFusion(initialState);
      sendJson({
        type: 'connected',
        model: liveModel,
        voiceName,
        deviceId: activeDeviceId,
        hardwareConnected: Boolean(initialState?.connected),
        sensorFusion: initialFusion,
      });

      // Push initial hardware context into the live session without fabricating unseen objects
      if (initialState?.connected) {
        session.sendRealtimeInput({
          text: `[SYSTEM HARDWARE STATUS] Wearable ${activeDeviceId} (${initialState.sourceMode}) connected. ${initialFusion.summaryText}`,
        });
      }
    } catch (err: any) {
      sendJson({
        type: 'error',
        code: 'LIVE_CONNECT_FAILED',
        message: err?.message || 'Failed to establish Gemini Live API session.',
      });
      clientWs.close(1011, 'Live connect failed');
      return;
    }

    // Periodic hardware sync: forward fresh OV2640 frames (<= 1 FPS) and critical ToF hazards
    const hwTimer = setInterval(() => {
      if (closed || !session) return;
      const dev = params.gateway.getLiveState(activeDeviceId);
      const fusion = evaluateSensorFusion(dev);

      if (
        dev?.connected &&
        fusion.forwardStatus === 'valid' &&
        fusion.forwardObstruction === 'critical' &&
        dev.lastSequence != null &&
        dev.lastSequence !== lastAlertSequence
      ) {
        lastAlertSequence = dev.lastSequence;
        const msg = `[CRITICAL HARDWARE ALERT] Forward VL53L0X sensor measures obstruction at ${Math.round(
          fusion.forwardDistanceCm ?? 0
        )} cm ahead. Immediately caution the user.`;
        session.sendRealtimeInput({ text: msg });
        sendJson({
          type: 'hardware_event',
          event: 'PROXIMITY_CRITICAL',
          distanceCm: fusion.forwardDistanceCm,
          deviceId: activeDeviceId,
        });
      }

      if (cameraSource === 'esp32_camera') {
        const latest = params.gateway.getLatestFrame(activeDeviceId, { excludeSimulator: true });
        const now = Date.now();
        if (
          latest.available &&
          latest.cameraConnected &&
          latest.frame &&
          !latest.stale &&
          latest.frame.receivedAt > lastPushedWearableFrameAt &&
          now - lastVideoSentAt >= 1000
        ) {
          lastPushedWearableFrameAt = latest.frame.receivedAt;
          lastVideoSentAt = now;
          session.sendRealtimeInput({
            video: {
              data: latest.frame.buffer.toString('base64'),
              mimeType: 'image/jpeg',
            },
          });
        }
      }
    }, 1000);

    clientWs.on('message', (rawData) => {
      if (closed || !session) return;
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          data?: string;
          text?: string;
          deviceId?: string;
          source?: string;
        };

        if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
          return;
        }

        if (msg.type === 'video' && typeof msg.data === 'string' && msg.data.length > 0) {
          const now = Date.now();
          // Enforce <= 1 FPS video input rate rule per Live API guidelines
          if (now - lastVideoSentAt >= 950) {
            lastVideoSentAt = now;
            session.sendRealtimeInput({
              video: { data: msg.data, mimeType: 'image/jpeg' },
            });
          }
          return;
        }

        if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          session.sendRealtimeInput({ text: msg.text.trim() });
          return;
        }

        if (msg.type === 'set_source') {
          if (typeof msg.deviceId === 'string' && msg.deviceId.trim()) {
            activeDeviceId = msg.deviceId.trim();
          }
          if (typeof msg.source === 'string') {
            cameraSource = msg.source;
          }
          const dev = params.gateway.getLiveState(activeDeviceId);
          sendJson({
            type: 'hardware_state',
            deviceId: activeDeviceId,
            connected: Boolean(dev?.connected),
            sensorFusion: evaluateSensorFusion(dev),
          });
        }
      } catch {
        // Ignore malformed client WebSocket JSON packets
      }
    });

    clientWs.on('close', () => {
      closed = true;
      clearInterval(hwTimer);
      try {
        session?.close();
      } catch {}
      session = null;
    });
  });

  return wss;
}
