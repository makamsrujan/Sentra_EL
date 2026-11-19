import crypto from 'node:crypto';
import type { AudioUtteranceResponse } from '../../src/types/deviceProtocol';
import type { GoalTask } from '../../src/types/sentra';
import { parseVoiceIntent } from '../../src/utils/parser';
import type { DeviceGateway } from '../deviceGateway';
import type { SentraEventStore } from '../eventStore';
import { runSentraAnalysis } from '../geminiService';
import type { AudioReplyStore } from './audioReplyStore';
import { parseWakePhraseAndCommand, transcribeWavAudio } from './speechToText';
import { synthesizeSpeechWav } from './textToSpeech';

export interface VoiceTurnInput {
  deviceId: string;
  sequence: number;
  wavBuffer?: Buffer;
  rawTranscript?: string;
  gateway: DeviceGateway;
  store: SentraEventStore;
  audioReplyStore: AudioReplyStore;
  apiKey?: string;
}

function formatSensorsSummary(dev: ReturnType<DeviceGateway['getLiveState']>): string {
  if (!dev) return 'No sensors connected.';
  const parts: string[] = [];
  if (dev.sensors.forwardDistanceCm != null) {
    parts.push(`Forward obstacle: ${dev.sensors.forwardDistanceCm} cm`);
  }
  if (dev.sensors.downwardDistanceMm != null) {
    parts.push(`Ground drop-off distance: ${dev.sensors.downwardDistanceMm} mm`);
  }
  if (dev.sensors.headPitchDeg != null) {
    parts.push(`Head pitch: ${dev.sensors.headPitchDeg.toFixed(1)}°`);
  }
  if (dev.sensors.imu?.heading != null) {
    parts.push(`Heading: ${dev.sensors.imu.heading.toFixed(0)}°`);
  }
  if (dev.batteryPercent != null) {
    parts.push(`Battery: ${dev.batteryPercent}%`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Sensors idle.';
}

export async function processWearableVoiceTurn(
  input: VoiceTurnInput
): Promise<AudioUtteranceResponse> {
  const startTime = Date.now();
  const turnId = `trn-${startTime}-${crypto.randomBytes(3).toString('hex')}`;
  const { deviceId, sequence, gateway, store, audioReplyStore, apiKey } = input;

  let transcript = (input.rawTranscript || '').trim();
  let durationMs: number | undefined;

  // 1. Transcription step if WAV buffer is supplied
  if (input.wavBuffer) {
    const stt = await transcribeWavAudio(input.wavBuffer, { apiKey });
    durationMs = stt.durationMs;

    if (!stt.ok) {
      gateway.broadcast('voice_turn', {
        turnId,
        deviceId,
        sequence,
        status: 'failed',
        error: stt.error,
        durationMs,
        timestamp: Date.now(),
      });

      return {
        ok: false,
        turnId,
        deviceId,
        sequence,
        durationMs,
        status: 'failed',
        error: stt.error,
      };
    }

    if (stt.isEmpty) {
      gateway.broadcast('voice_turn', {
        turnId,
        deviceId,
        sequence,
        status: 'silent',
        durationMs,
        timestamp: Date.now(),
      });

      return {
        ok: true,
        turnId,
        deviceId,
        sequence,
        durationMs,
        status: 'silent',
        wakeDetected: false,
        transcript: '',
      };
    }

    transcript = stt.transcript;
  }

  // 2. Identify wake phrase and extract command
  const { wakeDetected, command, isEmergencyStop } = parseWakePhraseAndCommand(transcript);

  // Require intentional activation for hardware audio (wake phrase or explicit command)
  if (!wakeDetected && !isEmergencyStop) {
    gateway.broadcast('voice_turn', {
      turnId,
      deviceId,
      sequence,
      status: 'ignored_no_wake',
      transcript,
      durationMs,
      timestamp: Date.now(),
    });

    return {
      ok: true,
      turnId,
      deviceId,
      sequence,
      durationMs,
      status: 'ignored_no_wake',
      wakeDetected: false,
      transcript,
    };
  }

  // 3. Handle immediate emergency stop
  if (isEmergencyStop) {
    const spoken = 'SENTRA stopped.';
    let audioReplyId: string | null = null;

    // Reset active persistent goal
    gateway.setActiveGoal(deviceId, null);

    const tts = await synthesizeSpeechWav(spoken, { apiKey });
    if (tts.ok && tts.buffer) {
      const stored = audioReplyStore.storeReply({
        deviceId,
        buffer: tts.buffer,
        sampleRate: tts.sampleRate,
        durationMs: tts.durationMs,
      });
      audioReplyId = stored.replyId;
    }

    gateway.enqueueAction(deviceId, {
      type: 'speech',
      text: spoken,
      priority: 'critical',
      audioReplyId,
      audioUrl: audioReplyId ? `/api/device/audio/reply/${audioReplyId}` : null,
      audioFormat: 'wav',
      audioDurationMs: tts.durationMs ?? null,
      deliveryMode: 'direct_response',
    });

    gateway.broadcast('voice_turn', {
      turnId,
      deviceId,
      sequence,
      status: 'completed',
      wakeDetected: true,
      transcript,
      reasoning: 'Emergency halt acknowledged.',
      spokenResponse: spoken,
      audioReplyId,
      timestamp: Date.now(),
    });

    return {
      ok: true,
      turnId,
      deviceId,
      sequence,
      durationMs,
      status: 'completed',
      wakeDetected: true,
      transcript,
      reasoning: 'Emergency halt acknowledged.',
      audioReplyId,
    };
  }

  // 4. Parse user intent using SENTRA's existing parser
  const intent = parseVoiceIntent(command || transcript);
  const liveState = gateway.getLiveState(deviceId);
  const latestFrame = gateway.getLatestFrame(deviceId);
  const memories = store.listMemories().slice(0, 5).map((m) => ({
    label: m.label,
    note: m.note,
    room: m.room || undefined,
    heading: m.heading,
  }));

  // 5. Run the existing SENTRA multimodal reasoning engine
  const analysis = await runSentraAnalysis({
    mode: intent.mode || 'describe',
    explicitOperation: intent.operation,
    query: intent.query || command || transcript,
    imageDataUrl: null,
    imageTimestamp: null,
    imageDimensions: null,
    sensors: formatSensorsSummary(liveState),
    goal: intent.goal || null,
    memory: memories,
    history: [],
    heading: liveState?.sensors.imu?.heading ?? null,
    wearableDevice: liveState,
    wearableFrameBuffer:
      latestFrame.available && latestFrame.frame
        ? {
            buffer: latestFrame.frame.buffer,
            receivedAt: latestFrame.frame.receivedAt,
            stale: latestFrame.stale,
          }
        : null,
    useWearableFrame: true,
    store,
  });

  // 6. Persist any newly learned memories
  if (analysis.rememberedData) {
    const memNow = Date.now();
    store.addMemory({
      id: `mem-${memNow}-${crypto.randomBytes(3).toString('hex')}`,
      label: analysis.rememberedData.label,
      note: analysis.rememberedData.note,
      room: analysis.rememberedData.room,
      heading: liveState?.sensors.imu?.heading ?? null,
      source: 'live_verified',
      timestamp: memNow,
      at: new Date(memNow).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }

  // 7. Update persistent goal state across wearable and frontend
  let activeGoal = gateway.getActiveGoal(deviceId);
  if (intent.mode === 'find' || intent.goal) {
    const now = Date.now();
    // Preserve the task's identity and verification history across subsequent turns.
    const state: GoalTask['state'] = analysis.foundTarget ? 'completed' : 'active';
    activeGoal = {
      id: activeGoal?.id || `goal-${now}-${crypto.randomBytes(3).toString('hex')}`,
      intent: intent.query || command || transcript,
      targetObject: intent.goal || activeGoal?.targetObject,
      state,
      requiredObservation: analysis.activePerceptionRequest || 'Scan environment to spot the target.',
      nextSafeAction: analysis.suggestedAction || analysis.reachGuidance?.handInstruction || null,
      confidence: activeGoal?.confidence ?? null,
      createdAt: activeGoal?.createdAt ?? now,
      updatedAt: now,
      history: [...(activeGoal?.history ?? []), { timestamp: now, note: 'Wearable voice turn processed', state }],
      verificationSteps: activeGoal?.verificationSteps ?? [],
    };
    gateway.setActiveGoal(deviceId, activeGoal);
  } else if (analysis.goalUpdate && activeGoal) {
    const now = Date.now();
    const state = (analysis.goalUpdate.state as GoalTask['state']) || activeGoal.state;
    activeGoal = {
      ...activeGoal,
      targetObject: analysis.goalUpdate.targetObject || activeGoal.targetObject,
      state,
      nextSafeAction: analysis.goalUpdate.nextAction || activeGoal.nextSafeAction,
      updatedAt: now,
      history: [...activeGoal.history, { timestamp: now, note: 'Wearable goal updated', state }],
    };
    gateway.setActiveGoal(deviceId, activeGoal);
  }

  // 8. Synthesize spoken response audio for the wearable headset
  const spokenText = analysis.spokenResponse || 'Understood.';
  let audioReplyId: string | null = null;
  let audioDurationMs: number | null = null;

  const tts = await synthesizeSpeechWav(spokenText, { apiKey });
  if (tts.ok && tts.buffer) {
    const stored = audioReplyStore.storeReply({
      deviceId,
      buffer: tts.buffer,
      sampleRate: tts.sampleRate,
      durationMs: tts.durationMs,
    });
    audioReplyId = stored.replyId;
    audioDurationMs = tts.durationMs ?? null;
  }

  // 9. Enqueue action for device history (marked as direct_response so poll won't duplicate speech)
  gateway.enqueueAction(deviceId, {
    type: 'speech',
    text: spokenText,
    priority: analysis.hazard ? 'critical' : 'normal',
    audioReplyId,
    audioUrl: audioReplyId ? `/api/device/audio/reply/${audioReplyId}` : null,
    audioFormat: 'wav',
    audioDurationMs,
    deliveryMode: 'direct_response',
  });

  // 10. Broadcast SSE event for real-time frontend observation
  gateway.broadcast('voice_turn', {
    turnId,
    deviceId,
    sequence,
    status: 'completed',
    wakeDetected: true,
    transcript,
    command: command || transcript,
    spokenResponse: spokenText,
    analysis,
    goal: activeGoal,
    audioReplyId,
    latencyMs: Date.now() - startTime,
    timestamp: Date.now(),
  });

  return {
    ok: true,
    turnId,
    deviceId,
    sequence,
    durationMs,
    status: 'completed',
    wakeDetected: true,
    transcript,
    reasoning: analysis.sceneDescription,
    audioReplyId,
  };
}
