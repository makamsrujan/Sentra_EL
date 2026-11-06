import React from 'react';
import { Eye, Clock, MapPin, ShieldCheck, AlertTriangle, Layers, Info } from 'lucide-react';
import { DetectedObject, HazardAlert } from '../types/sentra';

interface LiveVisionViewProps {
  detectedObjects: DetectedObject[];
  sceneDescription: string;
  pathIsClear: boolean;
  hazard: HazardAlert | null;
  onSelectObject?: (obj: DetectedObject) => void;
}

export const LiveVisionView: React.FC<LiveVisionViewProps> = ({
  detectedObjects,
  sceneDescription,
  pathIsClear,
  hazard,
  onSelectObject,
}) => {
  return (
    <div className="space-y-4 text-foreground animate-fade-in">
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
                ? 'bg-success/20 text-success'
                : 'bg-destructive/20 text-destructive'
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
          {sceneDescription || 'Aim the camera toward your surroundings to inspect observed objects and obstacles.'}
        </p>

        {hazard && (
          <div className="mt-2 rounded-xl bg-destructive/15 border border-destructive/40 p-3 flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-destructive">Caution: {hazard.type.replace('_', ' ').toUpperCase()}</p>
              <p className="text-xs text-foreground/90">{hazard.description} at {hazard.clockPosition}</p>
            </div>
          </div>
        )}
      </div>

      {/* Observed Objects Breakdown */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Layers className="h-5 w-5 text-accent" />
            <span>Identified Objects ({detectedObjects.length})</span>
          </div>
          <span className="text-xs text-muted-foreground">Confidence & Position</span>
        </div>

        {detectedObjects.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground space-y-2">
            <Info className="mx-auto h-8 w-8 opacity-40" />
            <p className="text-base font-semibold">No distinct objects confirmed in current view</p>
            <p className="text-xs">Pan slowly or bring camera closer to confirm objects with high confidence.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {detectedObjects.map((obj) => (
              <div
                key={obj.id}
                onClick={() => onSelectObject?.(obj)}
                className="flex items-center justify-between p-3 rounded-xl bg-secondary border border-border/40 hover:border-primary/60 transition-all cursor-pointer"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base text-foreground capitalize">
                      {obj.label}
                    </span>
                    {obj.isTargetGoal && (
                      <span className="rounded-full bg-primary/20 text-primary border border-primary/50 px-2 py-0.5 text-xs font-bold">
                        Target Goal
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-primary" />
                      {obj.clockPosition}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-accent" />
                      {obj.relativeDistance.replace('_', ' ')}
                    </span>
                    {obj.attributes && obj.attributes.length > 0 && (
                      <span className="text-foreground/70">{obj.attributes.join(', ')}</span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-sm font-extrabold text-primary font-mono">
                    {Math.round(obj.confidence * 100)}%
                  </span>
                  <div className="w-16 h-1.5 rounded-full bg-background mt-1 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.round(obj.confidence * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
