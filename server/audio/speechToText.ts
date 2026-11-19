import { GoogleGenAI } from '@google/genai';
import { isAudioSilent, validateWavBuffer } from '../validation';

export interface SttResult {
  ok: boolean;
  isEmpty: boolean;
  wakeDetected: boolean;
  transcript: string;
  command: string;
  model: string;
  durationMs?: number;
  error?: string;
  errorCode?: 'SILENT_AUDIO' | 'INVALID_WAV' | 'MISSING_API_KEY' | 'STT_FAILED' | 'QUOTA_EXCEEDED';
}

export function parseWakePhraseAndCommand(rawTranscript: string): {
  wakeDetected: boolean;
  command: string;
  isEmergencyStop: boolean;
} {
  const cleaned = rawTranscript.trim();
  if (!cleaned) {
    return { wakeDetected: false, command: '', isEmergencyStop: false };
  }

  // Emergency halt keywords
  if (/^(?:stop|cancel|halt|quiet|pause)$/i.test(cleaned)) {
    return { wakeDetected: true, command: 'stop', isEmergencyStop: true };
  }

  // Common wake word regex patterns
  const wakePatterns = [
    /^(?:hey|hay|hi|hello|ok|okay)\s+sentra[,\s.:;!-]*(.*)$/i,
    /^sentra[,\s.:;!-]*(.*)$/i,
    /^(?:.*?[,\s])(?:hey|hay|hi|hello|ok|okay)\s+sentra[,\s.:;!-]*(.*)$/i,
  ];

  for (const pattern of wakePatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const command = (match[1] || '').trim();
      return { wakeDetected: true, command, isEmergencyStop: false };
    }
  }

  return { wakeDetected: false, command: cleaned, isEmergencyStop: false };
}

export async function transcribeWavAudio(
  buffer: Buffer,
  options?: {
    apiKey?: string;
    model?: string;
    requireWakeWord?: boolean;
  }
): Promise<SttResult> {
  const wavCheck = validateWavBuffer(buffer, {
    expectedChannels: 1,
    expectedSampleRate: 16000,
    maxDurationMs: 8000,
  });

  if (!wavCheck.valid) {
    return {
      ok: false,
      isEmpty: false,
      wakeDetected: false,
      transcript: '',
      command: '',
      model: options?.model || 'none',
      durationMs: wavCheck.durationMs,
      error: wavCheck.error || 'Invalid WAV audio format.',
      errorCode: 'INVALID_WAV',
    };
  }

  if (isAudioSilent(buffer)) {
    return {
      ok: true,
      isEmpty: true,
      wakeDetected: false,
      transcript: '',
      command: '',
      model: options?.model || 'silent-detector',
      durationMs: wavCheck.durationMs,
      errorCode: 'SILENT_AUDIO',
    };
  }

  const apiKey = (options?.apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      isEmpty: false,
      wakeDetected: false,
      transcript: '',
      command: '',
      model: 'unconfigured',
      durationMs: wavCheck.durationMs,
      error: 'GEMINI_API_KEY is not configured on the server.',
      errorCode: 'MISSING_API_KEY',
    };
  }

  const modelName =
    options?.model ||
    process.env.GEMINI_STT_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-2.5-flash';

  try {
    const ai = new GoogleGenAI({ apiKey });
    const base64Audio = buffer.toString('base64');

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: base64Audio,
              },
            },
            {
              text: `You are an accurate, verbatim speech-to-text transcriber for a visually impaired user's wearable assistant named SENTRA.
Transcribe the speech in this audio recording exactly as spoken.
Do not add conversational pleasantries, explanations, or quotes.
If the audio contains only ambient noise or is unintelligible, respond with an empty string.
Output only the transcript.`,
            },
          ],
        },
      ],
      config: {
        temperature: 0.0,
      },
    });

    const rawTranscript = (response.text || '').trim();

    if (!rawTranscript) {
      return {
        ok: true,
        isEmpty: true,
        wakeDetected: false,
        transcript: '',
        command: '',
        model: modelName,
        durationMs: wavCheck.durationMs,
      };
    }

    const { wakeDetected, command, isEmergencyStop } = parseWakePhraseAndCommand(rawTranscript);

    return {
      ok: true,
      isEmpty: false,
      wakeDetected,
      transcript: rawTranscript,
      command: isEmergencyStop ? 'stop' : (command || rawTranscript),
      model: modelName,
      durationMs: wavCheck.durationMs,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isQuota = /quota|rate limit|429/i.test(errorMsg);
    return {
      ok: false,
      isEmpty: false,
      wakeDetected: false,
      transcript: '',
      command: '',
      model: modelName,
      durationMs: wavCheck.durationMs,
      error: `Speech-to-text transcription error: ${errorMsg}`,
      errorCode: isQuota ? 'QUOTA_EXCEEDED' : 'STT_FAILED',
    };
  }
}
