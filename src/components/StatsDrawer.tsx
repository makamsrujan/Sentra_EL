import React from 'react';
import { Activity, ShieldAlert, Clock, CheckCircle2, RotateCcw, X, Zap } from 'lucide-react';
import { SentraStats } from '../types/sentra';

interface StatsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  stats: SentraStats;
  onResetStats: () => void;
}

export const StatsDrawer: React.FC<StatsDrawerProps> = ({
  isOpen,
  onClose,
  stats,
  onResetStats,
}) => {
  if (!isOpen) return null;

  const avgResponseTime = stats.calls > 0 ? (stats.totalMs / stats.calls / 1000).toFixed(1) : '–';
  const avgFindTime = stats.findsDone > 0 ? (stats.findMs / stats.findsDone / 1000).toFixed(0) : '–';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Performance and Safety Statistics"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center p-3 animate-fade-in"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-card border-2 border-border p-5 shadow-2xl text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold tracking-tight">Performance & Stats</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-secondary transition-colors"
            aria-label="Close stats modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-secondary p-4 border border-border/40">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-1">
                <Zap className="h-4 w-4 text-primary" />
                <span>Requests</span>
              </div>
              <p className="text-3xl font-extrabold text-foreground">{stats.calls}</p>
              <p className="text-xs text-muted-foreground mt-1">Vision & query analyses</p>
            </div>

            <div className="rounded-2xl bg-secondary p-4 border border-border/40">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-1">
                <Clock className="h-4 w-4 text-primary" />
                <span>Avg Latency</span>
              </div>
              <p className="text-3xl font-extrabold text-foreground">{avgResponseTime} s</p>
              <p className="text-xs text-muted-foreground mt-1">Per vision request</p>
            </div>
          </div>

          <div className="rounded-2xl bg-secondary p-4 border border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <span>Object Searches</span>
              </div>
              <span className="text-lg font-bold">
                {stats.findsDone} of {stats.findsStarted} found
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-background overflow-hidden">
              <div
                className="h-full bg-success transition-all duration-500"
                style={{
                  width: `${
                    stats.findsStarted > 0
                      ? Math.min(100, Math.round((stats.findsDone / stats.findsStarted) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Average search duration: <span className="font-bold text-foreground">{avgFindTime} s</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-secondary p-4 border border-border/40">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-1">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <span>Hazards Flagged</span>
              </div>
              <p className="text-3xl font-extrabold text-destructive">{stats.hazards}</p>
              <p className="text-xs text-muted-foreground mt-1">Stairs, drops, obstacles</p>
            </div>

            <div className="rounded-2xl bg-secondary p-4 border border-border/40">
              <div className="flex items-center gap-2 text-muted-foreground text-sm font-semibold mb-1">
                <RotateCcw className="h-4 w-4 text-accent" />
                <span>Blur Retakes</span>
              </div>
              <p className="text-3xl font-extrabold text-accent">{stats.retakes}</p>
              <p className="text-xs text-muted-foreground mt-1">Auto-retaken steady frames</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
          <button
            onClick={() => {
              if (window.confirm('Reset all performance counters?')) {
                onResetStats();
              }
            }}
            className="rounded-xl px-4 py-2 text-base font-bold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            Reset stats
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-primary px-6 py-2.5 text-base font-bold text-primary-foreground shadow-md hover:brightness-110"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
