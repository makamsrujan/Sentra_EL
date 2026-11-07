import React from 'react';
import {
  Compass,
  Navigation,
  Layers,
  Info,
  CheckCircle2,
  AlertCircle,
  Footprints,
  ShieldAlert,
  X,
  CornerDownRight,
} from 'lucide-react';
import {
  SpatialLandmark,
  SpatialRelationship,
  DetectedObject,
  SlamState,
  NavigationRoute,
} from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';

interface SpatialWorldViewProps {
  heading: number | null;
  landmarks: SpatialLandmark[];
  relationships: SpatialRelationship[];
  detectedObjects: DetectedObject[];
  currentRoom: string;
  slamState?: SlamState;
  activeRoute?: NavigationRoute | null;
  onSelectDestination?: (dest: string) => void;
  onCancelRoute?: () => void;
}

const COMMON_DESTINATIONS = [
  'Kitchen Doorway',
  'Study Desk',
  'Front Entrance Door',
  'Living Room Center',
  'Dining Table',
];

export const SpatialWorldView: React.FC<SpatialWorldViewProps> = ({
  heading,
  landmarks,
  relationships,
  detectedObjects,
  currentRoom,
  slamState,
  activeRoute,
  onSelectDestination,
  onCancelRoute,
}) => {
  const currentHeading = heading != null ? Math.round(heading) : 0;
  const compassDir = getCompassDirection(currentHeading);

  return (
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* 2D Compass Radar & Visual-Inertial SLAM Position */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Compass className="h-5 w-5" />
            <span>Spatial Orientation & SLAM Radar</span>
          </div>
          <span className="font-mono text-sm font-bold text-foreground">
            {currentHeading}° {compassDir}
          </span>
        </div>

        {/* Circular Radar Plot */}
        <div className="relative mx-auto h-52 w-52 rounded-full border-2 border-border/70 bg-secondary/50 flex items-center justify-center shadow-inner overflow-hidden">
          {/* Compass Axis Marks */}
          <span className="absolute top-1 text-[11px] font-bold text-primary">N</span>
          <span className="absolute bottom-1 text-[11px] font-bold text-muted-foreground">S</span>
          <span className="absolute right-2 text-[11px] font-bold text-muted-foreground">E</span>
          <span className="absolute left-2 text-[11px] font-bold text-muted-foreground">W</span>

          {/* Concentric distance rings */}
          <div className="absolute h-36 w-36 rounded-full border border-border/40" />
          <div className="absolute h-20 w-20 rounded-full border border-border/40" />

          {/* User Forward Heading Vector */}
          <div
            className="absolute h-24 w-1 bg-primary rounded-full origin-bottom transition-transform duration-300"
            style={{
              bottom: '50%',
              transform: `rotate(${currentHeading}deg)`,
            }}
          >
            <div className="h-2 w-2 rounded-full bg-primary -top-1 -left-0.5 shadow-md" />
          </div>

          {/* Center User Dot with SLAM Position Offset */}
          <div
            className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold shadow-lg transition-transform duration-300"
            style={{
              transform: slamState
                ? `translate(${Math.max(-25, Math.min(25, slamState.pose.x * 10))}px, ${Math.max(
                    -25,
                    Math.min(25, -slamState.pose.z * 10)
                  )}px)`
                : undefined,
            }}
          >
            YOU
          </div>

          {/* Plot Landmarks onto Radar */}
          {landmarks.map((lm) => {
            const rad = ((lm.heading - 90) * Math.PI) / 180;
            const dist = 75; // radius in px
            const x = 104 + Math.cos(rad) * dist;
            const y = 104 + Math.sin(rad) * dist;

            return (
              <div
                key={lm.id}
                className="absolute z-20 flex flex-col items-center group cursor-pointer"
                style={{ left: `${x - 10}px`, top: `${y - 10}px` }}
                title={`${lm.name} at ${Math.round(lm.heading)}°`}
              >
                <div className="h-4 w-4 rounded-full bg-accent border-2 border-background shadow-md animate-pulse" />
                <span className="text-[9px] font-bold bg-background/90 px-1 rounded text-accent truncate max-w-[60px]">
                  {lm.name}
                </span>
              </div>
            );
          })}
        </div>

        {slamState && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40 font-mono">
            <span>Visual Odometry: ({slamState.pose.x.toFixed(2)}m, {slamState.pose.z.toFixed(2)}m)</span>
            <span className="text-primary font-bold">Confidence: {Math.round(slamState.trackingConfidence * 100)}%</span>
          </div>
        )}
      </div>

      {/* Feature 6: Indoor Navigation & A* Path Planning Card */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Navigation className="h-5 w-5" />
            <span>Indoor Landmark Navigation</span>
          </div>
          <span className="text-xs text-muted-foreground">A* Map Planner</span>
        </div>

        {/* Safety Disclaimer */}
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 flex items-start gap-2 text-xs text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
          <span>
            <strong>Visual Landmark Assistance:</strong> Supplementary aid only. Do not rely on
            unseen paths. Does not replace a cane or guide dog.
          </span>
        </div>

        {/* Quick Destination Buttons */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Plan Route to Landmark:
          </p>
          <div className="flex flex-wrap gap-2">
            {COMMON_DESTINATIONS.map((dest) => (
              <button
                key={dest}
                onClick={() => onSelectDestination?.(dest)}
                className={`rounded-full px-3 py-1 text-xs font-bold border transition-all active:scale-95 ${
                  activeRoute?.destination === dest
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-secondary text-foreground border-border/60 hover:border-primary'
                }`}
              >
                {dest}
              </button>
            ))}
          </div>
        </div>

        {/* Active Route Steps Visualizer */}
        {activeRoute ? (
          <div className="mt-3 rounded-xl bg-secondary/70 border border-border/60 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase">Active Route</p>
                <h4 className="text-base font-bold text-primary">To: {activeRoute.destination}</h4>
              </div>
              <button
                onClick={onCancelRoute}
                className="flex items-center gap-1 rounded-lg bg-destructive/15 text-destructive px-2.5 py-1 text-xs font-bold hover:bg-destructive/25 transition-all"
              >
                <X className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
            </div>

            <div className="space-y-2 pt-1 border-t border-border/40">
              {activeRoute.steps.map((step, idx) => (
                <div
                  key={step.stepNumber}
                  className={`flex items-start gap-2.5 p-2 rounded-lg text-xs transition-all ${
                    idx === activeRoute.currentStepIndex
                      ? 'bg-primary/15 border border-primary/40 text-foreground font-semibold'
                      : 'text-muted-foreground'
                  }`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background font-mono text-[10px] font-bold text-primary border border-border">
                    {step.stepNumber}
                  </span>
                  <div className="flex-1 space-y-0.5">
                    <p className="leading-relaxed">{step.instruction}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                      <span>{step.clockPosition}</span>
                      <span>•</span>
                      <span>~{step.stepsEstimate} steps</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground pt-1">
            Tap a destination above or say <span className="text-primary font-bold">"Guide me to the kitchen"</span> to compute an obstacle-free landmark route.
          </p>
        )}
      </div>

      {/* Spatial Relationships Observed */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Layers className="h-5 w-5 text-accent" />
            <span>Observed Spatial Relationships ({relationships.length})</span>
          </div>
          <span className="text-xs text-muted-foreground">Evidence Grounded</span>
        </div>

        {relationships.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground space-y-2">
            <Info className="mx-auto h-7 w-7 opacity-40" />
            <p className="text-sm font-semibold">No spatial relationships confirmed yet</p>
            <p className="text-xs">
              Aim camera at a room surface (e.g. bottle on desk) to confirm spatial associations.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {relationships.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center justify-between p-3 rounded-xl bg-secondary border border-border/40 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold capitalize text-foreground">{rel.subject}</span>
                  <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary font-mono font-bold">
                    {rel.relation.replace('_', ' ')}
                  </span>
                  <span className="font-bold capitalize text-foreground">{rel.object}</span>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-bold">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Confirmed</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
