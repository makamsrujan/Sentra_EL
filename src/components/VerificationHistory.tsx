import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  Eye,
  RefreshCw,
  CornerDownRight,
  Compass,
  Clock,
  ShieldCheck,
  Volume2,
  Sparkles,
  Radio,
  ChevronDown,
  ChevronUp,
  Layers,
  History,
  AlertTriangle,
} from 'lucide-react';
import { GoalTask, VerificationStep, VerificationActionCategory } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';
import { speakText } from '../utils/audio';

interface VerificationHistoryProps {
  currentGoal: GoalTask | null;
  activePerceptionPrompt?: string | null;
  isSearching?: boolean;
  onReadAloud?: (text: string) => void;
  className?: string;
}

type FilterTab = 'all' | 'completed' | 'active' | 'attempted';

/**
 * Resolves the verification step's primary action category:
 * 'completed' | 'active' | 'attempted'
 */
export function getStepActionCategory(
  step: VerificationStep,
  isGoalActive: boolean,
  isLatest: boolean
): VerificationActionCategory {
  if (step.actionCategory) {
    return step.actionCategory;
  }
  if (step.outcome === 'success' || step.state === 'completed') {
    return 'completed';
  }
  if (
    isGoalActive &&
    (step.state === 'verifying' ||
      step.state === 'need_observation' ||
      step.outcome === 'pending' ||
      (isLatest && step.outcome === 're_aim_needed'))
  ) {
    return 'active';
  }
  return 'attempted';
}

export const VerificationHistory: React.FC<VerificationHistoryProps> = ({
  currentGoal,
  activePerceptionPrompt,
  isSearching = false,
  onReadAloud,
  className = '',
}) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  const verificationSteps = useMemo(() => {
    return currentGoal?.verificationSteps || [];
  }, [currentGoal]);

  const isGoalActive = Boolean(
    currentGoal && currentGoal.state !== 'completed' && currentGoal.state !== 'cancelled'
  );

  // Categorize steps with computed category metadata
  const categorizedSteps = useMemo(() => {
    return verificationSteps.map((step, index) => {
      const isLatest = index === verificationSteps.length - 1;
      const category = getStepActionCategory(step, isGoalActive, isLatest);
      const elapsedSec = currentGoal
        ? Math.max(0, Math.round((step.timestamp - currentGoal.createdAt) / 1000))
        : 0;
      return {
        ...step,
        computedCategory: category,
        stepIndex: index + 1,
        elapsedSec,
      };
    });
  }, [verificationSteps, isGoalActive, currentGoal]);

  // Counts for each category
  const counts = useMemo(() => {
    let completed = 0;
    let active = 0;
    let attempted = 0;
    categorizedSteps.forEach((s) => {
      if (s.computedCategory === 'completed') completed++;
      else if (s.computedCategory === 'active') active++;
      else attempted++;
    });
    return { completed, active, attempted, total: categorizedSteps.length };
  }, [categorizedSteps]);

  // Filtered list
  const filteredSteps = useMemo(() => {
    if (activeTab === 'all') return categorizedSteps;
    return categorizedSteps.filter((s) => s.computedCategory === activeTab);
  }, [categorizedSteps, activeTab]);

  // Narrate history aloud for accessibility
  const handleNarrateHistory = () => {
    if (!currentGoal) {
      const msg = 'No active search goal is currently in progress.';
      if (onReadAloud) onReadAloud(msg);
      else speakText(msg);
      return;
    }

    if (verificationSteps.length === 0) {
      const msg = `Currently locating ${currentGoal.targetObject || currentGoal.intent}. No verification steps have been recorded yet.`;
      if (onReadAloud) onReadAloud(msg);
      else speakText(msg);
      return;
    }

    const target = currentGoal.targetObject || currentGoal.intent;
    const latestStep = categorizedSteps[categorizedSteps.length - 1];
    let summary = `Verification history for ${target}. ${counts.total} total steps recorded: ${counts.completed} completed, ${counts.active} active, and ${counts.attempted} attempted. `;
    if (currentGoal.state === 'completed') {
      summary += `The target has been verified and confirmed. `;
    }
    if (latestStep) {
      summary += `Latest step: ${latestStep.stepName}. ${latestStep.note}`;
    }

    if (onReadAloud) onReadAloud(summary);
    else speakText(summary);
  };

  const toggleExpand = (id: string) => {
    setExpandedStepId((prev) => (prev === id ? null : id));
  };

  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* Header and Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-border/40">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary shrink-0" />
          <div>
            <h4 className="font-bold text-base text-foreground flex items-center gap-2">
              <span>Verification History</span>
              {currentGoal && (
                <span className="text-xs font-semibold text-muted-foreground">
                  · {currentGoal.targetObject || 'Target'}
                </span>
              )}
            </h4>
            <p className="text-xs text-muted-foreground">
              Audit log of real visual checks, camera adjustments, and confirmed sightings
            </p>
          </div>
        </div>

        {/* Listen Aloud Button */}
        <button
          onClick={handleNarrateHistory}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl bg-secondary px-3 py-1.5 text-xs font-bold text-foreground hover:bg-secondary/80 border border-border/60 active:scale-95 transition-all shadow-sm"
          aria-label="Listen to verification history summary aloud"
          title="Narrate verification status and recent attempts"
        >
          <Volume2 className="h-3.5 w-3.5 text-primary" />
          <span>Read History</span>
        </button>
      </div>

      {/* Goal Summary Status Banner */}
      {currentGoal && (
        <div
          className={`rounded-xl p-3 border text-xs flex items-center justify-between gap-3 ${
            currentGoal.state === 'completed'
              ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-200'
              : currentGoal.state === 'need_observation'
              ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
              : 'bg-primary/10 border-primary/30 text-foreground'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {currentGoal.state === 'completed' ? (
              <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
            ) : currentGoal.state === 'need_observation' ? (
              <CornerDownRight className="h-5 w-5 text-amber-400 shrink-0 animate-bounce" />
            ) : (
              <RefreshCw className="h-5 w-5 text-primary shrink-0 animate-spin" />
            )}
            <div>
              <div className="font-bold text-sm">
                {currentGoal.state === 'completed'
                  ? 'Verification Goal Achieved'
                  : currentGoal.state === 'need_observation'
                  ? 'Active Re-aiming Required'
                  : 'Live Verification in Progress'}
              </div>
              <div className="text-[11px] opacity-85">
                {currentGoal.state === 'completed'
                  ? `Target "${currentGoal.targetObject}" confirmed in view with ${Math.round(
                      currentGoal.confidence * 100
                    )}% confidence`
                  : activePerceptionPrompt ||
                    'Continuously analyzing incoming camera frames without hallucinating sightings'}
              </div>
            </div>
          </div>

          <div className="text-right shrink-0 font-mono text-[11px] opacity-75">
            {counts.total} {counts.total === 1 ? 'action' : 'actions'}
          </div>
        </div>
      )}

      {/* Verification Action Category Filter Bar (Segmented Controls) */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-secondary/60 rounded-xl border border-border/50">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'all'
              ? 'bg-card text-foreground shadow-sm border border-border/60'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>All Actions</span>
          <span className="text-[11px] font-mono opacity-70">({counts.total})</span>
        </button>

        {/* Completed Filter */}
        <button
          onClick={() => setActiveTab('completed')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'completed'
              ? 'bg-emerald-950/40 text-emerald-300 shadow-sm border border-emerald-500/50'
              : 'text-muted-foreground hover:text-emerald-400 hover:bg-emerald-950/20'
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Completed</span>
          <span className="text-[11px] font-mono opacity-80">({counts.completed})</span>
        </button>

        {/* Active Filter */}
        <button
          onClick={() => setActiveTab('active')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'active'
              ? 'bg-primary/20 text-primary shadow-sm border border-primary/50'
              : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span>Active</span>
          <span className="text-[11px] font-mono opacity-80">({counts.active})</span>
        </button>

        {/* Attempted Filter */}
        <button
          onClick={() => setActiveTab('attempted')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'attempted'
              ? 'bg-card text-sky-300 shadow-sm border border-sky-500/40'
              : 'text-muted-foreground hover:text-sky-400 hover:bg-secondary/40'
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          <span>Attempted</span>
          <span className="text-[11px] font-mono opacity-80">({counts.attempted})</span>
        </button>
      </div>

      {/* Verification Steps Render List */}
      {filteredSteps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 p-6 text-center space-y-2.5 bg-card/40">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
            {activeTab === 'completed' ? (
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
            ) : activeTab === 'active' ? (
              <Radio className="h-5 w-5 text-muted-foreground" />
            ) : activeTab === 'attempted' ? (
              <Eye className="h-5 w-5 text-muted-foreground" />
            ) : (
              <History className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          <div className="text-sm font-bold text-foreground">
            {activeTab === 'all'
              ? 'No Verification Steps Yet'
              : `No ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Actions`}
          </div>

          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            {activeTab === 'all'
              ? 'When SENTRA searches for an object, it evaluates camera frames through a 6-stage closed loop: UNDERSTAND → OBSERVE → REASON → ACT → VERIFY → UPDATE. Real verification logs will appear here without hallucinations.'
              : `There are currently no actions categorized as "${activeTab}". Switch to "All Actions" to view the full verification timeline.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
          {filteredSteps
            .slice()
            .reverse()
            .map((step) => {
              const isExpanded = expandedStepId === step.id;
              const isCompleted = step.computedCategory === 'completed';
              const isActive = step.computedCategory === 'active';
              const isAttempted = step.computedCategory === 'attempted';

              return (
                <div
                  key={step.id}
                  className={`rounded-xl border p-3 text-xs transition-all ${
                    isCompleted
                      ? 'border-l-4 border-l-emerald-500 border-border/60 bg-emerald-950/20 shadow-sm'
                      : isActive
                      ? 'border-l-4 border-l-primary border-border/60 bg-primary/10 shadow-sm'
                      : 'border-l-4 border-l-sky-500/60 border-border/60 bg-secondary/50'
                  }`}
                >
                  {/* Step Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background font-mono text-[10px] font-bold text-foreground border border-border">
                        #{step.stepIndex}
                      </span>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">
                            {step.stepName}
                          </span>

                          {/* Distinct Category Label */}
                          {isCompleted && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>COMPLETED</span>
                            </span>
                          )}

                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                              <span className="h-2 w-2 rounded-full bg-primary animate-ping inline-block" />
                              <span>ACTIVE ACTION</span>
                            </span>
                          )}

                          {isAttempted && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400">
                              <Eye className="h-3.5 w-3.5" />
                              <span>ATTEMPTED SCAN</span>
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 pt-0.5">
                          <span>
                            {new Date(step.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">+{step.elapsedSec}s elapsed</span>
                        </div>
                      </div>
                    </div>

                    {/* Step Expand Toggle */}
                    <button
                      onClick={() => toggleExpand(step.id)}
                      className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      aria-label={isExpanded ? 'Collapse step details' : 'Expand step details'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Step Body Note */}
                  <div className="mt-2 pl-7">
                    <p className="text-xs text-foreground/90 leading-relaxed font-medium">
                      {step.note}
                    </p>

                    {/* Active Re-aim Prompt Callout */}
                    {isActive && step.outcome === 're_aim_needed' && (
                      <div className="mt-2 rounded-lg bg-primary/15 border border-primary/40 p-2 flex items-start gap-2">
                        <CornerDownRight className="h-4 w-4 text-primary shrink-0 mt-0.5 animate-bounce" />
                        <div className="text-xs">
                          <span className="font-bold text-primary uppercase text-[10px] block">
                            Direct Perception Adjustment
                          </span>
                          <span className="text-foreground font-semibold">{step.note}</span>
                        </div>
                      </div>
                    )}

                    {/* Expanded Technical Details */}
                    {isExpanded && (
                      <div className="mt-2.5 pt-2 border-t border-border/40 space-y-1.5 text-[11px] font-mono text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Outcome Code:</span>
                          <span className="text-foreground font-bold">{step.outcome}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>State Machine:</span>
                          <span className="text-foreground">{step.state}</span>
                        </div>
                        {step.sensorSummary && (
                          <div className="flex justify-between">
                            <span>Sensors:</span>
                            <span className="text-foreground">{step.sensorSummary}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Step ID:</span>
                          <span className="text-foreground truncate max-w-[200px]">{step.id}</span>
                        </div>
                      </div>
                    )}

                    {/* Metadata Row: Heading, Clock Position, Confidence */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 text-[10px] text-muted-foreground">
                      {step.heading != null && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 border border-border/50 font-mono text-foreground font-semibold">
                          <Compass className="h-3 w-3 text-primary" />
                          <span>
                            {Math.round(step.heading)}° {getCompassDirection(step.heading)}
                          </span>
                        </span>
                      )}

                      {step.clockPosition && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 border border-border/50 font-mono text-foreground font-semibold">
                          <Clock className="h-3 w-3 text-accent" />
                          <span>{step.clockPosition}</span>
                        </span>
                      )}

                      {step.confidence != null && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 border font-mono font-bold ${
                            isCompleted
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40'
                              : 'bg-background text-foreground border-border/50'
                          }`}
                        >
                          <Sparkles className="h-3 w-3 text-emerald-400" />
                          <span>Confidence: {Math.round(step.confidence * 100)}%</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};
