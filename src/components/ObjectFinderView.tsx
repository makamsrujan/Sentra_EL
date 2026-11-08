import React, { useState } from 'react';
import {
  Search,
  Crosshair,
  CornerDownRight,
  CheckCircle2,
  XCircle,
  Compass,
  Sparkles,
  RefreshCw,
  History,
  Clock,
  Eye,
  AlertCircle,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { GoalTask, DetectedObject, VerificationStep, VerificationStepOutcome } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';
import { VerificationHistory } from './VerificationHistory';

interface ObjectFinderViewProps {
  currentGoal: GoalTask | null;
  onStartSearch: (target: string) => void;
  onCancelSearch: () => void;
  activePerceptionPrompt?: string | null;
  detectedObjects: DetectedObject[];
  isSearching: boolean;
}

const COMMON_TARGETS = [
  'Water Bottle',
  'Spectacles',
  'Keys',
  'Doorway',
  'Phone',
  'Coffee Mug',
  'Backpack',
  'Chair',
];

export const ObjectFinderView: React.FC<ObjectFinderViewProps> = ({
  currentGoal,
  onStartSearch,
  onCancelSearch,
  activePerceptionPrompt,
  detectedObjects,
  isSearching,
}) => {
  const [targetInput, setTargetInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetInput.trim()) {
      onStartSearch(targetInput.trim());
      setTargetInput('');
    }
  };

  const steps = [
    { name: 'Understand', active: Boolean(currentGoal), done: Boolean(currentGoal) },
    { name: 'Observe', active: isSearching, done: detectedObjects.length > 0 },
    {
      name: 'Reason',
      active: isSearching,
      done: Boolean(currentGoal?.state === 'verifying' || currentGoal?.state === 'completed'),
    },
    {
      name: 'Verify',
      active: currentGoal?.state === 'verifying',
      done: currentGoal?.state === 'completed',
    },
  ];

  const verificationSteps: VerificationStep[] = currentGoal?.verificationSteps || [];

  const getOutcomeBadge = (outcome: VerificationStepOutcome) => {
    switch (outcome) {
      case 'success':
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
          label: 'Verified Confirmed',
          classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
        };
      case 're_aim_needed':
        return {
          icon: <CornerDownRight className="h-4 w-4 text-amber-400 animate-bounce" />,
          label: 'Re-aim Directive',
          classes: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
        };
      case 'attempted':
        return {
          icon: <Eye className="h-4 w-4 text-sky-400" />,
          label: 'Observation Scanned',
          classes: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
        };
      case 'inconclusive':
        return {
          icon: <AlertCircle className="h-4 w-4 text-purple-400" />,
          label: 'Inconclusive Angle',
          classes: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
        };
      case 'pending':
      default:
        return {
          icon: <RefreshCw className="h-4 w-4 text-slate-400" />,
          label: 'Initiated',
          classes: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
        };
    }
  };

  return (
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* Target Search Input Card */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 font-bold text-lg text-primary">
          <Crosshair className="h-5 w-5" />
          <span>Active Object Finder</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          SENTRA executes a real observation and verification loop. Every attempted angle,
          camera adjustment, and verification result is tracked live.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="What should SENTRA find? (e.g. spectacles)"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            className="flex-1 rounded-xl bg-secondary px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground border border-border/60 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!targetInput.trim()}
            className="rounded-xl bg-primary px-5 py-2.5 font-bold text-primary-foreground disabled:opacity-50 hover:brightness-110 active:scale-95 transition-all shadow-sm flex items-center gap-1.5"
          >
            <Search className="h-4 w-4" />
            <span>Search</span>
          </button>
        </form>

        {/* Quick Target Chips */}
        <div className="flex flex-wrap gap-2 pt-1">
          {COMMON_TARGETS.map((target) => (
            <button
              key={target}
              onClick={() => onStartSearch(target)}
              className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-foreground border border-border/50 hover:border-primary hover:text-primary transition-all active:scale-95"
            >
              + {target}
            </button>
          ))}
        </div>
      </div>

      {/* Active Goal Task & Pipeline State Card */}
      {currentGoal ? (
        <div className="rounded-2xl bg-card border-2 border-primary/60 p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Active Goal State
              </span>
              <h3 className="text-xl font-bold text-primary">
                Locating: {currentGoal.targetObject || currentGoal.intent}
              </h3>
            </div>
            <button
              onClick={onCancelSearch}
              className="rounded-xl bg-destructive/15 text-destructive px-3 py-1.5 text-xs font-bold hover:bg-destructive/25 transition-all flex items-center gap-1"
            >
              <XCircle className="h-4 w-4" />
              <span>Cancel Task</span>
            </button>
          </div>

          {/* Pipeline Steps Indicator (UNDERSTAND → OBSERVE → REASON → VERIFY) */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {steps.map((s) => (
              <div
                key={s.name}
                className={`text-center py-1.5 px-1 rounded-lg text-xs font-bold border transition-all ${
                  s.done
                    ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-400'
                    : s.active
                    ? 'bg-primary/20 border-primary text-primary animate-pulse'
                    : 'bg-secondary border-border/30 text-muted-foreground'
                }`}
              >
                {s.name}
              </div>
            ))}
          </div>

          {/* Active Perception Directive */}
          {activePerceptionPrompt ? (
            <div className="rounded-xl bg-primary/10 border border-primary/50 p-3 flex items-start gap-3">
              <CornerDownRight className="h-5 w-5 text-primary shrink-0 mt-0.5 animate-bounce" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-primary">
                  Active Perception Directive
                </p>
                <p className="text-base font-bold text-foreground">
                  {activePerceptionPrompt}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-secondary p-3 flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 text-accent animate-spin" />
              <span>Scanning camera observations every 5 seconds. Pan smoothly.</span>
            </div>
          )}

          {/* Verification Status Banner */}
          <div className="text-xs text-muted-foreground pt-1 border-t border-border/30 flex items-center justify-between">
            <span>
              Started:{' '}
              {new Date(currentGoal.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="font-mono">Task ID: {currentGoal.id.slice(0, 10)}</span>
          </div>

          {/* VISUAL HISTORY LOG OF VERIFICATION ATTEMPTS */}
          <div className="pt-2 border-t border-border/40">
            <VerificationHistory
              currentGoal={currentGoal}
              activePerceptionPrompt={activePerceptionPrompt}
              isSearching={isSearching}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-card border border-border p-6 text-center text-muted-foreground space-y-2">
            <Sparkles className="mx-auto h-8 w-8 text-primary opacity-50" />
            <p className="text-lg font-bold text-foreground">No Search Task In Progress</p>
            <p className="text-sm max-w-md mx-auto">
              Say <span className="text-primary font-bold">"Where is my spectacles?"</span> or pick an
              item above to initiate active search guidance with live verification logs.
            </p>
          </div>

          {/* Educational / Standby Verification Architecture Card */}
          <div className="rounded-2xl bg-card border border-border/70 p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-foreground">
              <History className="h-4 w-4 text-primary" />
              <span>Closed-Loop Verification Architecture</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              SENTRA does not hallucinate item locations. Each target passes through continuous verification states:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Completed</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Target verified in camera frame with high confidence & spatial clock position.
                </p>
              </div>

              <div className="rounded-xl border border-primary/40 bg-primary/10 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-primary">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <span>Active</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Live sensor sweep, re-aiming prompt, or waiting for camera angle adjustment.
                </p>
              </div>

              <div className="rounded-xl border border-sky-500/40 bg-secondary/50 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-sky-400">
                  <Eye className="h-4 w-4 shrink-0" />
                  <span>Attempted</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Scanned orientation angle where target was not detected or was obscured.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
