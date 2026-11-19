import { GoogleGenAI } from '@google/genai';
import { createPcmWav, createWavHeader, validateWavBuffer } from '../validation';

export interface TtsResult {
  ok: boolean;
  buffer?: Buffer;
  mimeType?: 'audio/wav';
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  durationMs?: number;
  model: string;
  error?: string;
  errorCode?: 'EMPTY_TEXT' | 'MISSING_API_KEY' | 'TTS_FAILED' | 'TTS_NO_AUDIO' | 'UNSUPPORTED_OUTPUT';
}

export function synthesizeTestToneWav(
  durationMs = 500,
  frequencyHz = 880,
  sampleRate = 24000
): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
  const pcmBuffer = Buffer.alloc(sampleCount * 2);
  const amplitude = 12000; // Safe modest volume

  for (let i = 0; i < sampleCount; i++) {
    // Sine wave with slight decay envelope to prevent clicks
    const t = i / sampleRate;
    const envelope = Math.min(1, Math.min(i / (sampleRate * 0.02), (sampleCount - i) / (sampleRate * 0.02)));
    const sample = Math.round(amplitude * envelope * Math.sin(2 * Math.PI * frequencyHz * t));
    pcmBuffer.writeInt16LE(sample, i * 2);
  }

  return Buffer.concat([createWavHeader(pcmBuffer.length, sampleRate, 1, 16), pcmBuffer]);
}

export async function synthesizeSpeechWav(
  text: string,
  options?: {
    apiKey?: string;
    model?: string;
    voiceName?: string;
  }
): Promise<TtsResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    return {
      ok: false,
      model: 'none',
      error: 'Cannot synthesize speech for empty text.',
      errorCode: 'EMPTY_TEXT',
    };
  }

  const apiKey = (options?.apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      model: 'unconfigured',
      error: 'GEMINI_API_KEY is not configured on the server.',
      errorCode: 'MISSING_API_KEY',
    };
  }

  const modelName =
    options?.model ||
    process.env.GEMINI_TTS_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-3.8-flash-lite-tts';
  const voiceName = options?.voiceName || process.env.SENTRA_TTS_VOICE || 'Puck';

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // Request audio modality from multimodal Gemini
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Speak the following assistive response aloud for a visually impaired user clearly, concisely, and naturally:\n\n"${cleanText}"`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((p) => p.inlineData && p.inlineData.data);

    if (!audioPart || !audioPart.inlineData?.data) {
      return {
        ok: false,
        model: modelName,
        error: `Model ${modelName} did not return audio output in response.`,
        errorCode: 'TTS_NO_AUDIO',
      };
    }

    const rawMime = (audioPart.inlineData.mimeType || '').toLowerCase();
    const rawDataBuffer = Buffer.from(audioPart.inlineData.data, 'base64');

    if (rawDataBuffer.length === 0) {
      return {
        ok: false,
        model: modelName,
        error: 'TTS returned empty audio data buffer.',
        errorCode: 'TTS_NO_AUDIO',
      };
    }

    let finalWavBuffer: Buffer;
    let sampleRate = 24000;

    if (rawMime.includes('pcm')) {
      // Parse rate from mime type if present (e.g., 'audio/pcm;rate=24000')
      const rateMatch = rawMime.match(/rate=(\d+)/);
      if (rateMatch) {
        sampleRate = parseInt(rateMatch[1], 10);
      }
      finalWavBuffer = createPcmWav(rawDataBuffer, sampleRate, 1, 16);
    } else if (rawMime.includes('wav')) {
      finalWavBuffer = rawDataBuffer;
      const parsed = validateWavBuffer(finalWavBuffer);
      if (parsed.valid && parsed.sampleRate) {
        sampleRate = parsed.sampleRate;
      }
    } else {
      // Unrecognized audio format
      return {
        ok: false,
        model: modelName,
        error: `Unsupported upstream audio format MIME type: ${rawMime}. Expected PCM or WAV.`,
        errorCode: 'UNSUPPORTED_OUTPUT',
      };
    }

    const validation = validateWavBuffer(finalWavBuffer, { expectedSampleRate: sampleRate });
    if (!validation.valid) {
      return {
        ok: false,
        model: modelName,
        error: `Normalized WAV audio validation failed: ${validation.error}`,
        errorCode: 'UNSUPPORTED_OUTPUT',
      };
    }

    return {
      ok: true,
      buffer: finalWavBuffer,
      mimeType: 'audio/wav',
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
      durationMs: validation.durationMs,
      model: modelName,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      model: modelName,
      error: `Text-to-speech synthesis error: ${errorMsg}`,
      errorCode: 'TTS_FAILED',
    };
  }
}
