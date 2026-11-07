import React from 'react';
import {
  Eye,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Info,
  Activity,
  Compass,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Wifi,
  WifiOff,
  Cpu,
} from 'lucide-react';
import {
  DetectedObject,
  HazardAlert,
  TrackedObject,
  SlamState,
  PerceptionMode,
  LocalVisionAnalysis,
} from '../types/sentra';

interface LiveVisionViewProps {
  detectedObjects: DetectedObject[];
  trackedObjects?: TrackedObject[];
  sceneDescription: string;
  pathIsClear: boolean;
  hazard: HazardAlert | null;
  slamState?: SlamState;
  perceptionMode?: PerceptionMode;
  localAnalysis?: LocalVisionAnalysis | null;
  onSelectObject?: (obj: DetectedObject) => void;
}

export const LiveVisionView: React.FC<LiveVisionViewProps> = ({
  detectedObjects,
  trackedObjects = [],
  sceneDescription,
  pathIsClear,
  hazard,
  slamState,
  perceptionMode = 'online_gemini',
  localAnalysis,
  onSelectObject,
}) => {
  const getMovementIcon = (mov: string) => {
    switch (mov) {
      case 'approaching':
        return <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />;
      case 'receding':
        return <ArrowUpRight className="h-3.5 w-3.5 text-sky-400" />;
      case 'moving_left':
      case 'moving_right':
        return <ArrowRight className="h-3.5 w-3.5 text-amber-400" />;
      default:
        return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* Perception Mode & Health Status Banner */}
      <div className="rounded-2xl bg-card border border-border p-3 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          {perceptionMode === 'offline_local' ? (
            <WifiOff className="h-5 w-5 text-amber-400" />
          ) : (
            <Wifi className="h-5 w-5 text-primary" />
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Processing Mode
            </p>
            <p className="text-sm font-bold text-foreground">
              {perceptionMode === 'offline_local'
                ? 'Offline (On-Device Computer Vision)'
                : 'Online (Gemini Cloud 3.8 Multimodal)'}
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
            perceptionMode === 'offline_local'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'bg-primary/15 text-primary border border-primary/30'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>{perceptionMode === 'offline_local' ? 'Local Canvas Model' : 'Cloud Reasoning'}</span>
        </span>
      </div>

      {/* Scene Overview Banner */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Eye className="h-5 w-5" />
            <span>Perception Scene Breakdown</span>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
              pathIsClear
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            }`}
          >
            {pathIsClear ? (
              <>
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Walkway Clear</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Path Obstructed</span>
              </>
            )}
          </span>
        </div>

        <p className="text-base text-foreground/90 leading-relaxed">
          {sceneDescription ||
            'Aim the camera toward your surroundings to inspect observed objects and obstacles.'}
        </p>

        {hazard && (
          <div className="mt-2 rounded-xl bg-destructive/15 border border-destructive/40 p-3 flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-destructive">
                Caution: {hazard.type.replace('_', ' ').toUpperCase()}
              </p>
              <p className="text-xs text-foreground/90">
                {hazard.description} at {hazard.clockPosition}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Feature 3: Temporal Object Tracking Live Feed */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Layers className="h-5 w-5 text-accent" />
            <span>Temporal Tracked Objects ({trackedObjects.length || detectedObjects.length})</span>
          </div>
          <span className="text-xs text-muted-foreground">ID & Movement Dynamics</span>
        </div>

        {trackedObjects.length === 0 && detectedObjects.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground space-y-2">
            <Info className="mx-auto h-8 w-8 opacity-40" />
            <p className="text-base font-semibold">No distinct objects in tracking buffer</p>
            <p className="text-xs">Objects are automatically assigned persistent track IDs when observed.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(trackedObjects.length > 0 ? trackedObjects : detectedObjects).map((item: any) => {
              const isTrack = 'trackId' in item;
              const trackId = isTrack ? item.trackId : item.id;
              const movement = isTrack ? item.movement : 'stationary';
              const status = isTrack ? item.status : 'tracking';

              return (
                <div
                  key={trackId}
                  onClick={() => onSelectObject?.(item)}
                  className="flex items-center justify-between p-3 rounded-xl bg-secondary border border-border/40 hover:border-primary/60 transition-all cursor-pointer"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary bg-background px-1.5 py-0.5 rounded border border-border/60">
                        #{isTrack ? item.trackId : 'obj'}
                      </span>
                      <span className="font-bold text-base text-foreground capitalize">
                        {item.label}
                      </span>
                      {item.isTargetGoal && (
                        <span className="rounded-full bg-primary/20 text-primary border border-primary/50 px-2 py-0.5 text-xs font-bold">
                          Goal Target
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-accent" />
                        <span>{item.clockPosition}</span>
                      </span>
                      <span>•</span>
                      <span>{item.relativeDistance.replace('_', ' ')}</span>
                      <span>•</span>
                      <span className="text-emerald-400 font-bold">
                        {Math.round(item.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold border ${
                        movement === 'approaching'
                          ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                          : movement === 'receding'
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                          : 'bg-secondary text-muted-foreground border-border/50'
                      }`}
                    >
                      {getMovementIcon(movement)}
                      <span className="capitalize">{movement.replace('_', ' ')}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Feature 5: Visual-Inertial SLAM Pose & Odometry Metrics */}
      {slamState && (
        <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-base text-foreground">
              <Compass className="h-5 w-5 text-primary" />
              <span>Visual Odometry & SLAM Pose</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold border ${
                slamState.status === 'tracking'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : slamState.status === 'degraded'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-rose-500/20 text-rose-400 border-rose-500/40'
              }`}
            >
              <span className="capitalize">Status: {slamState.status}</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
            <div className="rounded-xl bg-secondary p-2.5 border border-border/40">
              <span className="text-muted-foreground block text-[10px] uppercase">X (Lateral)</span>
              <span className="text-base font-bold text-foreground">
                {slamState.pose.x >= 0 ? '+' : ''}
                {slamState.pose.x.toFixed(2)}m
              </span>
            </div>
            <div className="rounded-xl bg-secondary p-2.5 border border-border/40">
              <span className="text-muted-foreground block text-[10px] uppercase">Z (Depth)</span>
              <span className="text-base font-bold text-foreground">
                {slamState.pose.z >= 0 ? '+' : ''}
                {slamState.pose.z.toFixed(2)}m
              </span>
            </div>
            <div className="rounded-xl bg-secondary p-2.5 border border-border/40">
              <span className="text-muted-foreground block text-[10px] uppercase">Tracked Features</span>
              <span className="text-base font-bold text-primary">
                {slamState.featureCount} pts
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
