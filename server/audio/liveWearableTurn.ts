import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { resolveLiveModelName } from "../liveVoiceGateway";
import { createWavHeader } from "../validation";

export interface WearableLiveTurnParams {
  wavBuffer: Buffer;
  jpegFrameBuffer: Buffer | null;
  sensorsSummary: string;
  memoriesSummary: string;
  apiKey?: string;
  voiceName?: string;
  timeoutMs?: number;
}

export interface WearableLiveTurnResult {
  ok: boolean;
  model: string;
  inputTranscript: string;
  outputTranscript: string;
  wavBuffer?: Buffer;
  sampleRate?: number;
  durationMs?: number;
  error?: string;
}

const PCM16_INPUT_CHUNK_BYTES = 8192; // 256 ms @ 16 kHz mono 16-bit PCM

/**
 * Strip the 44-byte RIFF/WAVE header from a validated 16 kHz mono 16-bit PCM WAV buffer.
 */
export function extractPcmFromWav16k(wavBuffer: Buffer): Buffer | null {
  if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length <= 44) return null;
  if (
    wavBuffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    wavBuffer.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return null;
  }
  // Locate the "data" chunk cleanly (standard 44-byte header starts at offset 36)
  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === "data") {
      const end = Math.min(wavBuffer.length, dataStart + chunkSize);
      return end > dataStart ? wavBuffer.subarray(dataStart, end) : null;
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return null;
}

export function buildWearableLiveSystemInstruction(params: {
  sensorsSummary: string;
  memoriesSummary: string;
  hasFreshImage: boolean;
}): string {
  const visionLine = params.hasFreshImage
    ? "A fresh JPEG image from the paired ESP32-CAM is attached to this turn. Ground visual answers strictly in that image."
    : "NO fresh camera image is attached right now. Do NOT guess or fabricate what is visually ahead; say plainly that no live camera frame is available.";

  return [
    "You are SENTRA, a concise, calm voice-first assistive companion running on a two-board ESP32-S3 + ESP32-CAM wearable.",
    "Reply in 1 to 2 clear spoken sentences using clock positions (e.g. 12 o'clock) and human-scale distances.",
    visionLine,
    "Hardware truth: only ONE forward-facing VL53L0X ToF sensor and a 6-axis GY-521 MPU6050 IMU exist (no magnetometer heading, no downward drop-off sensor). Never claim a path is safe to walk or free of drop-offs.",
    `Live wearable sensors: ${params.sensorsSummary || "unavailable"}.`,
    params.memoriesSummary ? `Saved contextual memories: ${params.memoriesSummary}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Runs a single ESP32-S3 wearable PTT voice turn directly through gemini-3.8-live:
 *   INMP441 16 kHz mono PCM WAV + optional fresh paired ESP32-CAM JPEG
 *   -> ai.live.connect(gemini-3.8-live, responseModalities: [Modality.AUDIO])
 *   -> 24 kHz mono PCM16 WAV for MAX98357A + speaker playback.
 */
export async function runGeminiLiveWearableTurn(
  params: WearableLiveTurnParams
): Promise<WearableLiveTurnResult> {
  const model = resolveLiveModelName();
  const apiKey = (params.apiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      model,
      inputTranscript: "",
      outputTranscript: "",
      error: "GEMINI_API_KEY is not configured on the server for gemini-3.8-live.",
    };
  }

  const pcmInput = extractPcmFromWav16k(params.wavBuffer);
  if (!pcmInput || pcmInput.length === 0) {
    return {
      ok: false,
      model,
      inputTranscript: "",
      outputTranscript: "",
      error: "Invalid or empty 16 kHz mono PCM WAV audio from wearable microphone.",
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const voiceName = params.voiceName || process.env.SENTRA_LIVE_VOICE || "Zephyr";
  const timeoutMs = params.timeoutMs ?? 18000;
  const audioChunks: Buffer[] = [];
  const inputTranscriptParts: string[] = [];
  const outputTranscriptParts: string[] = [];

  const sessionRef: { current: Awaited<ReturnType<typeof ai.live.connect>> | null } = { current: null };

  try {
    const turnResult = await new Promise<WearableLiveTurnResult>((resolve) => {
      let settled = false;
      const finish = (res: WearableLiveTurnResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          model,
          inputTranscript: inputTranscriptParts.join(" ").trim(),
          outputTranscript: outputTranscriptParts.join(" ").trim(),
          error: `Timed out waiting for ${model} audio response.`,
        });
      }, timeoutMs);

      ai.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: buildWearableLiveSystemInstruction({
              sensorsSummary: params.sensorsSummary,
              memoriesSummary: params.memoriesSummary,
              hasFreshImage: Boolean(params.jpegFrameBuffer),
            }),
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              const content = message.serverContent;
              if (content?.inputTranscription?.text) {
                inputTranscriptParts.push(content.inputTranscription.text);
              }
              if (content?.outputTranscription?.text) {
                outputTranscriptParts.push(content.outputTranscription.text);
              }
              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  audioChunks.push(Buffer.from(part.inlineData.data, "base64"));
                }
              }
              if (content?.turnComplete) {
                const pcmOut = Buffer.concat(audioChunks);
                if (pcmOut.length === 0) {
                  finish({
                    ok: false,
                    model,
                    inputTranscript: inputTranscriptParts.join(" ").trim(),
                    outputTranscript: outputTranscriptParts.join(" ").trim(),
                    error: `${model} completed turn without returning audio chunks.`,
                  });
                  return;
                }
                const sampleRate = 24000;
                const wavBuffer = Buffer.concat([
                  createWavHeader(pcmOut.length, sampleRate, 1, 16),
                  pcmOut,
                ]);
                const durationMs = Math.round((pcmOut.length / (sampleRate * 2)) * 1000);
                finish({
                  ok: true,
                  model,
                  inputTranscript: inputTranscriptParts.join(" ").trim(),
                  outputTranscript: outputTranscriptParts.join(" ").trim(),
                  wavBuffer,
                  sampleRate,
                  durationMs,
                });
              }
            },
            onerror: (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err || "Live API error");
              finish({
                ok: false,
                model,
                inputTranscript: inputTranscriptParts.join(" ").trim(),
                outputTranscript: outputTranscriptParts.join(" ").trim(),
                error: msg,
              });
            },
            onclose: () => {
              if (!settled) {
                const pcmOut = Buffer.concat(audioChunks);
                if (pcmOut.length > 0) {
                  const sampleRate = 24000;
                  const wavBuffer = Buffer.concat([
                    createWavHeader(pcmOut.length, sampleRate, 1, 16),
                    pcmOut,
                  ]);
                  finish({
                    ok: true,
                    model,
                    inputTranscript: inputTranscriptParts.join(" ").trim(),
                    outputTranscript: outputTranscriptParts.join(" ").trim(),
                    wavBuffer,
                    sampleRate,
                    durationMs: Math.round((pcmOut.length / (sampleRate * 2)) * 1000),
                  });
                } else {
                  finish({
                    ok: false,
                    model,
                    inputTranscript: inputTranscriptParts.join(" ").trim(),
                    outputTranscript: outputTranscriptParts.join(" ").trim(),
                    error: `${model} session closed before delivering a reply.`,
                  });
                }
              }
            },
          },
        })
        .then((connected) => {
          sessionRef.current = connected;
          // 1. Attach fresh paired ESP32-CAM JPEG frame if available
          if (params.jpegFrameBuffer && params.jpegFrameBuffer.length > 0) {
            connected.sendRealtimeInput({
              video: {
                data: params.jpegFrameBuffer.toString("base64"),
                mimeType: "image/jpeg",
              },
            });
          }
          // 2. Stream INMP441 16 kHz mono PCM chunks
          for (let offset = 0; offset < pcmInput.length; offset += PCM16_INPUT_CHUNK_BYTES) {
            const slice = pcmInput.subarray(offset, Math.min(pcmInput.length, offset + PCM16_INPUT_CHUNK_BYTES));
            connected.sendRealtimeInput({
              audio: {
                data: slice.toString("base64"),
                mimeType: "audio/pcm;rate=16000",
              },
            });
          }
          // 3. Signal end of user utterance so gemini-3.8-live responds immediately
          connected.sendRealtimeInput({ audioStreamEnd: true });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err || "Failed to connect to Live API");
          finish({
            ok: false,
            model,
            inputTranscript: "",
            outputTranscript: "",
            error: msg,
          });
        });
    });

    return turnResult;
  } finally {
    try {
      sessionRef.current?.close();
    } catch {
      // Ignore close cleanup errors
    }
  }
}
