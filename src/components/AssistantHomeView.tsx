import React from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Send,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import type { CameraSourceType } from '../types/deviceProtocol';
import type { GoalTask, HazardAlert } from '../types/sentra';
import type { UnifiedPhaseDisplay } from '../utils/sessionControls';

export interface AssistantHomeViewProps {
  sessionActive: boolean;
  isStartingSession: boolean;
  isSwitchingSource: boolean;
  phaseDisplay: UnifiedPhaseDisplay;
  cameraSource: CameraSourceType;
  isCameraReady: boolean;
  wearableConnected: boolean;
  wakeWordEnabled: boolean;
  wakeWordSupported: boolean;
  wakeLimitationNote: string;
  liveTranscript: string;
  spokenTranscript: string;
  assistantResponse: string;
  hasConversationActivity: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  voiceMuted: boolean;
  onToggleMute: () => void;
  voiceError: string | null;
  lastError: string | null;
  isOnline: boolean;
  activeGoal: GoalTask | null;
  activeHazard: HazardAlert | null;
  typedQuery: string;
  onTypedQueryChange: (val: string) => void;
  onSubmitTypedQuery: (query: string) => void;
  onStartSession: () => void;
  onStopSession: () => void;
  onTapToTalk: () => void;
  onRepeat: () => void;
  onStopSpeaking: () => void;
  onCancelTask: () => void;
  onDismissHazard: () => void;
  onRetryMic: () => void;
  onSwitchToMobileCamera: () => void;
  onOpenDeviceSetup: () => void;
  showCameraPreview: boolean;
  onToggleCameraPreview: () => void;
}

const EXAMPLE_REQUESTS = [
  'Find my remote',
  'Is the door open?',
  'Read this label',
] as const;

export const AssistantHomeView: React.FC<AssistantHomeViewProps> = ({
  sessionActive,
  isStartingSession,
  isSwitchingSource,
  phaseDisplay,
  cameraSource,
  isCameraReady,
  wearableConnected,
  wakeWordEnabled,
  wakeLimitationNote,
  liveTranscript,
  spokenTranscript,
  assistantResponse,
  hasConversationActivity,
  isProcessing,
  isSpeaking,
  voiceMuted,
  onToggleMute,
  voiceError,
  lastError,
  isOnline,
  activeGoal,
  activeHazard,
  typedQuery,
  onTypedQueryChange,
  onSubmitTypedQuery,
  onStartSession,
  onStopSession,
  onTapToTalk,
  onRepeat,
  onStopSpeaking,
  onCancelTask,
  onDismissHazard,
  onRetryMic,
  onSwitchToMobileCamera,
  onOpenDeviceSetup,
  showCameraPreview,
  onToggleCameraPreview,
}) => {
  const hasActiveTask = Boolean(
    activeGoal && (activeGoal.state === 'active' || activeGoal.state === 'need_observation')
  );

  const cameraRightLabel =
    cameraSource === 'esp32_camera'
      ? wearableConnected
        ? isCameraReady
          ? 'Wearable camera · Live'
          : 'Wearable camera'
        : 'Wearable not connected'
      : isCameraReady
      ? 'Phone camera · Live'
      : 'Phone camera';

  const sessionLeftLabel = !sessionActive
    ? isStartingSession
      ? 'Starting session'
      : 'Session off'
    : phaseDisplay.label;

  const primaryBusy = isStartingSession || isSwitchingSource;
  const isListeningPulse =
    sessionActive &&
    (phaseDisplay.phase === 'hearing' ||
      phaseDisplay.phase === 'listening' ||
      phaseDisplay.phase === 'guiding');

  const circleLabel = !sessionActive
    ? isStartingSession
      ? 'Starting…'
      : 'Start Sentra'
    : phaseDisplay.phase === 'hearing'
    ? 'Listening…'
    : phaseDisplay.phase === 'thinking'
    ? 'Thinking…'
    : phaseDisplay.phase === 'speaking'
    ? 'Speaking'
    : phaseDisplay.phase === 'guiding'
    ? 'Guiding'
    : 'Tap to Talk';

  const showReadyExamplesInCard = !sessionActive && !hasConversationActivity;

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-5">
      {/* Compact Session & Camera Status Row (matches reference) */}
      <section
        aria-label="Session and camera status"
        className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          {!sessionActive && !isStartingSession ? (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-[#B5B9BF]"
              aria-hidden="true"
            />
          ) : phaseDisplay.phase === 'error' ? (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"
              aria-hidden="true"
            />
          ) : (
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-primary ${
                isListeningPulse ? 'animate-pulse' : ''
              }`}
              aria-hidden="true"
            />
          )}
          <span className="font-semibold text-foreground">{sessionLeftLabel}</span>
          {!isOnline && (
            <span className="text-xs font-semibold text-destructive">· Offline</span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-xs sm:text-sm text-muted-foreground">{cameraRightLabel}</span>
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={voiceMuted ? 'Unmute spoken responses' : 'Mute spoken responses'}
            aria-pressed={voiceMuted}
            title={voiceMuted ? 'Unmute voice output' : 'Mute voice output'}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${
              voiceMuted
                ? 'border-destructive bg-destructive/15 text-destructive'
                : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-foreground'
            }`}
          >
            {voiceMuted ? (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </section>

      {/* Centered Hero Copy & Iconic Circular Start Sentra Microphone Control */}
      <section
        aria-label="Voice assistant control"
        className="flex flex-col items-center text-center pt-1 pb-1"
      >
        <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          YOUR HOME. YOUR QUESTIONS.
        </p>
        <h2 className="mt-2.5 text-[28px] sm:text-[34px] font-bold tracking-tight leading-[1.16] text-foreground">
          A little help,
          <br />
          whenever you need.
        </h2>
        <p className="mt-3 max-w-xs sm:max-w-sm text-sm leading-relaxed text-muted-foreground">
          {!sessionActive ? (
            <>
              Start once. Then say “Hey Sentra”
              <br />
              and ask in your own words.
            </>
          ) : wakeWordEnabled ? (
            'Say “Hey Sentra” and ask in your own words, or tap the mic.'
          ) : (
            wakeLimitationNote
          )}
        </p>

        {/* Circular Focal Button with Concentric Halo Ring */}
        <div className="mt-7 mb-2 flex items-center justify-center">
          <div
            className={`rounded-full border p-3.5 transition-all ${
              phaseDisplay.phase === 'hearing'
                ? 'border-primary/80 bg-[#15130B] sentra-listening'
                : sessionActive
                ? 'border-primary/45 bg-[#12161B]'
                : 'border-primary/30 bg-[#0E1115]'
            }`}
          >
            <button
              type="button"
              onClick={sessionActive ? onTapToTalk : onStartSession}
              disabled={primaryBusy}
              aria-label={
                !sessionActive
                  ? 'Start Sentra session with camera and microphone'
                  : phaseDisplay.phase === 'hearing'
                  ? 'Listening to your voice right now'
                  : 'Tap to speak to Sentra now'
              }
              className="flex h-[156px] w-[156px] sm:h-[168px] sm:w-[168px] flex-col items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground shadow-[0_0_36px_rgba(255,220,56,0.16)] transition-transform active:scale-[0.97] hover:brightness-105 disabled:opacity-60"
            >
              {isStartingSession || isSwitchingSource || phaseDisplay.phase === 'thinking' ? (
                <Loader2 className="h-10 w-10 animate-spin stroke-[2.2]" aria-hidden="true" />
              ) : phaseDisplay.phase === 'speaking' ? (
                <Volume2 className="h-10 w-10 stroke-[2]" aria-hidden="true" />
              ) : (
                <Mic className="h-10 w-10 stroke-[2]" aria-hidden="true" />
              )}
              <span className="text-lg font-bold tracking-tight">{circleLabel}</span>
            </button>
          </div>
        </div>

        {/* Live transcript pill-free bar while actively hearing speech */}
        {liveTranscript && (
          <p className="mt-3 w-full rounded-xl border border-primary/50 bg-card px-4 py-2 text-sm text-primary">
            Hearing: “{liveTranscript}”
          </p>
        )}

        {/* Active Guiding Task Indicator with Direct Cancel */}
        {hasActiveTask && (
          <div className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-primary/40 bg-card px-4 py-2.5 text-left">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wider text-primary uppercase">
                Active Guidance
              </p>
              <p className="truncate text-sm font-medium text-foreground">
                {activeGoal?.targetObject || activeGoal?.intent}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancelTask}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3.5 text-xs font-semibold text-foreground hover:border-primary"
            >
              <XCircle className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Cancel Task</span>
            </button>
          </div>
        )}
      </section>

      {/* Real Hazard Alert (Only when sensor or vision hazard exists) */}
      {activeHazard && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive bg-destructive/15 px-4 py-3 text-sm font-semibold text-foreground"
        >
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <span>Hazard notice: {activeHazard.description}</span>
          </div>
          <button
            type="button"
            onClick={onDismissHazard}
            className="min-h-[44px] rounded-xl border border-destructive/60 bg-background px-3.5 text-xs font-semibold text-foreground hover:bg-secondary shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Actionable Errors (Permissions, Disconnected Wearable, Network, AI) */}
      {(voiceError || lastError) && (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/70 bg-card px-4 py-3.5 space-y-2.5"
        >
          <div className="flex items-start gap-2.5 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              {voiceError && <p className="font-semibold">{voiceError}</p>}
              {lastError && <p className="text-muted-foreground">{lastError}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {voiceError && (
              <button
                type="button"
                onClick={onRetryMic}
                className="min-h-[44px] rounded-xl border border-border bg-secondary px-3.5 text-xs font-semibold text-foreground hover:border-primary"
              >
                Retry Microphone
              </button>
            )}
            {cameraSource === 'esp32_camera' && !wearableConnected && (
              <>
                <button
                  type="button"
                  onClick={onSwitchToMobileCamera}
                  className="min-h-[44px] rounded-xl bg-primary px-3.5 text-xs font-bold text-primary-foreground"
                >
                  Return to Mobile Camera
                </button>
                <button
                  type="button"
                  onClick={onOpenDeviceSetup}
                  className="min-h-[44px] rounded-xl border border-border bg-secondary px-3.5 text-xs font-semibold text-foreground hover:border-primary"
                >
                  Device Setup
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Prominent Response Card (Matches "READY WHEN YOU ARE" card in reference) */}
      <section
        aria-label="Current Sentra response"
        aria-live={voiceMuted ? 'polite' : 'off'}
        aria-atomic="true"
        className="rounded-2xl border border-border bg-card px-5 py-4 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {showReadyExamplesInCard ? 'READY WHEN YOU ARE' : 'CURRENT RESPONSE'}
          </h3>
          {isSpeaking && (
            <button
              type="button"
              onClick={onStopSpeaking}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-destructive/70 bg-destructive/15 px-3 text-xs font-semibold text-foreground hover:bg-destructive hover:text-destructive-foreground"
            >
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Stop Speaking</span>
            </button>
          )}
        </div>

        {showReadyExamplesInCard ? (
          <div className="space-y-1.5 text-lg sm:text-[21px] font-normal leading-snug text-foreground">
            <p>“Find my remote.”</p>
            <p>“Is the door open?”</p>
            <p>“Read this label.”</p>
          </div>
        ) : (
          <div className="space-y-2">
            {spokenTranscript && (
              <p className="text-xs sm:text-sm text-muted-foreground">
                You asked: <span className="font-medium text-foreground">“{spokenTranscript}”</span>
              </p>
            )}
            <p className="text-lg sm:text-[20px] font-normal leading-relaxed text-foreground">
              {assistantResponse}
            </p>
          </div>
        )}
      </section>

      {/* Three Suggested Example Requests (Suggestions Only — Never a Fixed Menu) */}
      <section aria-label="Example questions" className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2">
        {EXAMPLE_REQUESTS.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onSubmitTypedQuery(example)}
            disabled={isProcessing || isSwitchingSource}
            className="min-h-[46px] rounded-xl border border-border bg-[#0C0F13] px-3 py-2 text-center text-xs sm:text-[13px] font-medium text-foreground transition-colors hover:border-primary hover:bg-secondary disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </section>

      {/* Consistently Accessible Bottom Action Bar: Repeat + Stop Sentra (matches reference) */}
      <div className="sticky bottom-2 z-20 grid grid-cols-[1fr_1.45fr] gap-3 pt-0.5">
        <button
          type="button"
          onClick={onRepeat}
          disabled={!assistantResponse}
          className="min-h-[54px] rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold text-foreground transition-colors hover:border-primary hover:bg-secondary disabled:opacity-45 shadow-lg shadow-black/40"
        >
          Repeat
        </button>
        <button
          type="button"
          onClick={onStopSession}
          disabled={!sessionActive && !isStartingSession && !isSpeaking && !hasActiveTask}
          className={`min-h-[54px] rounded-2xl border px-4 py-3 text-base font-semibold transition-colors shadow-lg shadow-black/40 ${
            sessionActive || isStartingSession || isSpeaking || hasActiveTask
              ? 'border-[#F09A8A] bg-[#221314] text-[#FFB8AB] hover:bg-[#311A1B]'
              : 'border-[#E89B8C]/60 bg-[#141011] text-[#F0A99B]/80 disabled:opacity-60 disabled:cursor-not-allowed'
          }`}
        >
          Stop Sentra
        </button>
      </div>

      {/* Optional Text Input Alternative + Secondary Camera Preview Toggle */}
      <div className="space-y-2 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = typedQuery.trim();
            if (trimmed) {
              onSubmitTypedQuery(trimmed);
              onTypedQueryChange('');
            }
          }}
          className="flex items-stretch gap-2"
        >
          <label htmlFor="sentra-text-input" className="sr-only">
            Type a question or request for Sentra
          </label>
          <input
            id="sentra-text-input"
            type="text"
            value={typedQuery}
            onChange={(e) => onTypedQueryChange(e.target.value)}
            placeholder="Or type any question…"
            className="min-h-[46px] flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary"
          />
          <button
            type="submit"
            disabled={isProcessing || !typedQuery.trim()}
            aria-label="Send message to Sentra"
            className="inline-flex min-h-[46px] min-w-[46px] items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-45"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Ask</span>
          </button>
        </form>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onToggleCameraPreview}
            aria-expanded={showCameraPreview}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {showCameraPreview ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{showCameraPreview ? 'Hide camera preview' : 'Show camera preview'}</span>
          </button>

          {sessionActive && (
            <span className="text-xs text-muted-foreground">
              Say “Stop Sentra” to end
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
