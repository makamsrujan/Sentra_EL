import React from 'react';
import { RotateCcw, Crosshair, Navigation, ShieldAlert, CheckCircle2 } from 'lucide-react';
import type { TrialCategory } from '../utils/parser';

export interface TrialEntry {
  id: string;
  questionNumber: number;
  category: TrialCategory;
  query: string;
  response: string;
  inputSource: 'browser_camera' | 'esp32_camera';
  latencyMs: number;
  timestamp: number;
}

export const MAX_TRIAL_QUESTIONS = 10;

interface TrialTrackerCardProps {
  entries: TrialEntry[];
  onResetTrial: () => void;
}

const CATEGORY_LABEL: Record<TrialCategory, string> = {
  object_finder: 'Object Finder',
  walk_assistant: 'Walk Assistance',
  obstacles: 'General Obstacles',
  general: 'General Query',
};

export const TrialTrackerCard: React.FC<TrialTrackerCardProps> = ({
  entries,
  onResetTrial,
}) => {
  const used = entries.length;
  const remaining = Math.max(0, MAX_TRIAL_QUESTIONS - used);
  const progressPct = Math.min(100, Math.round((used / MAX_TRIAL_QUESTIONS) * 100));

  const objectCount = entries.filter((e) => e.category === 'object_finder').length;
  const walkCount = entries.filter((e) => e.category === 'walk_assistant').length;
  const obstacleCount = entries.filter((e) => e.category === 'obstacles').length;

  return (
    <div className="space-y-4">
      {/* 10-Question Trial Panel */}
      <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-foreground">
              10-Question Trial — Object Finder &amp; Walk Assistance
            </h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {used} of {MAX_TRIAL_QUESTIONS} questions used · {remaining} remaining · Object Finder:{' '}
              {objectCount} · Walk Assist: {walkCount} · Obstacles: {obstacleCount}
            </p>
          </div>

          <button
            type="button"
            onClick={onResetTrial}
            disabled={used === 0}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-secondary border border-border px-3.5 py-2 text-xs font-bold text-foreground hover:border-primary transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Trial</span>
          </button>
        </div>

        {/* Clean Progress Bar */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={MAX_TRIAL_QUESTIONS}
          aria-label="10-question trial progress"
        >
          <div
            className={`h-full transition-all duration-200 ${
              remaining === 0 ? 'bg-success' : 'bg-primary'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {remaining === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-success/15 border border-success/40 px-3.5 py-3 text-sm text-foreground">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <span>10-question trial complete. Reset trial to run another 10 questions.</span>
            </div>
            <button
              type="button"
              onClick={onResetTrial}
              className="min-h-[40px] rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-105 whitespace-nowrap shrink-0"
            >
              Start New 10-Question Trial
            </button>
          </div>
        )}

        {/* Recent Trial Log */}
        {entries.length > 0 && (
          <div className="divide-y divide-border/60 border-t border-border/60 pt-2 max-h-56 overflow-y-auto">
            {entries.slice(0, 10).map((entry) => (
              <div key={entry.id} className="py-2.5 space-y-1 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground font-mono tabular-nums">
                  <span>
                    Q{entry.questionNumber} · {CATEGORY_LABEL[entry.category]} ·{' '}
                    {entry.inputSource === 'esp32_camera' ? 'Wearable' : 'Mobile Phone'}
                  </span>
                  <span>{Math.round(entry.latencyMs)} ms</span>
                </div>
                <p className="font-semibold text-foreground">"{entry.query}"</p>
                <p className="text-muted-foreground leading-relaxed">{entry.response}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Supported Voice Prompts Guide */}
      <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <div>
          <h2 className="text-base font-bold text-foreground">What You Can Ask SENTRA</h2>
          <p className="text-xs text-muted-foreground">
            Press <strong className="text-foreground">TAP TO SPEAK</strong> or say{' '}
            <strong className="text-foreground">"Hey Sentra"</strong> followed by any of these requests:
          </p>
        </div>

        <div className="divide-y divide-border/60">
          <div className="py-2.5 flex items-start gap-3">
            <Crosshair className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">Object Finder</p>
              <p className="text-xs text-muted-foreground">
                “Find the water bottle” · “Where are my keys?” · “Locate my phone”
              </p>
            </div>
          </div>

          <div className="py-2.5 flex items-start gap-3">
            <Navigation className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">
                Walk Assistant (Scene Recognition)
              </p>
              <p className="text-xs text-muted-foreground">
                “Help me to walk near door” · “Guide me to the chair” · “Describe what is in front of me”
              </p>
            </div>
          </div>

          <div className="py-2.5 flex items-start gap-3">
            <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">General Obstacles</p>
              <p className="text-xs text-muted-foreground">
                “Help me finding obstacles” · “Is my path clear?” · “Anything blocking my way?”
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
