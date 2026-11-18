import React from 'react';
import {
  Eye,
  Clock,
  MapPin,
  AlertTriangle,
  Layers,
  Info,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import { DetectedObject, HazardAlert } from '../types/sentra';
import { PathSafetyStatus } from '../types/deviceProtocol';

interface LiveVisionViewProps {
  detectedObjects: DetectedObject[];
  sceneDescription: string;
  pathStatus: PathSafetyStatus;
  detectionTimestamp: number | null;
  detectionStale: boolean;
  hazard: HazardAlert | null;
  onSelectObject?: (obj: DetectedObject) => void;
}

const PATH_STATUS_META: Record<
  PathSafetyStatus,
  { label: string; classes: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  unknown: {
    label: 'Status Unknown',
    classes: 'bg-secondary text-muted-foreground border-border',
    Icon: HelpCircle,
  },
  observation_unavailable: {
    label: 'Observation Unavailable',
    classes: 'bg-secondary text-muted-foreground border-border',
    Icon: Info,
  },
  observation_available: {
    label: 'Observation Available (Unverified Safety)',
    classes: 'bg-accent/15 text-accent border-accent/40',
    Icon: Eye,
  },
  possible_obstruction: {
    label: 'Possible Obstruction',
    classes: 'bg-primary/15 text-primary border-primary/50',
    Icon: AlertTriangle,
  },
  confirmed_sensor_alert: {
    label: 'Confirmed Sensor Alert',
    classes: 'bg-destructive/20 text-destructive border-destructive/50',
    Icon: ShieldAlert,
  },
};

export const LiveVisionView: React.FC<LiveVisionViewProps> = ({
  detectedObjects,
  sceneDescription,
  pathStatus,
  detectionTimestamp,
  detectionStale,
  hazard,
  onSelectObject,
}) => {
  const statusMeta = PATH_STATUS_META[pathStatus] || PATH_STATUS_META.unknown;
  const StatusIcon = statusMeta.Icon;

  return (
    <div className="space-y-4 text-foreground">
      {/* Scene Overview Card */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Eye className="h-5 w-5" />
            <span>Live Vision Breakdown</span>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${statusMeta.classes}`}
          >
            <StatusIcon className="h-3.5 w-3.5" />
            <span>{statusMeta.label}</span>
          </span>
        </div>

        <p className="text-sm text-foreground/90 leading-relaxed">
          {sceneDescription ||
            'Capture an observation from an active camera feed to analyze surroundings.'}
        </p>

        <p className="text-[11px] text-muted-foreground border-t border-border/50 pt-2">
          Prototype Notice: Visual descriptions reflect only the analyzed snapshot and do not guarantee obstacle-free navigation.
        </p>

        {hazard && (
          <div className="rounded-xl bg-destructive/15 border border-destructive/40 p-3 flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-destructive">
                Caution: {hazard.type.replace('_', ' ').toUpperCase()}
              </p>
              <p className="text-xs text-foreground/90">
                {hazard.description} ({hazard.clockPosition})
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Identified Objects List */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-base">
            <Layers className="h-5 w-5 text-accent" />
            <span>
              Detected Entities ({detectedObjects.length})
              {detectionStale && detectedObjects.length > 0 ? ' — Stale' : ''}
            </span>
          </div>
          {detectionTimestamp ? (
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              Frame: {new Date(detectionTimestamp).toLocaleTimeString()}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No frame analyzed yet</span>
          )}
        </div>

        {detectedObjects.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground space-y-1.5">
            <Info className="mx-auto h-7 w-7 opacity-40" />
            <p className="text-sm font-semibold text-foreground">No current object detections</p>
            <p className="text-xs">
              Trigger a scene description or search from an active camera stream to populate grounded detections.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {detectedObjects.map((obj) => (
              <button
                key={obj.id}
                type="button"
                onClick={() => onSelectObject?.(obj)}
                className={`w-full text-left flex items-center justify-between p-3 rounded-xl bg-secondary border border-border/50 hover:border-primary/60 transition-colors ${
                  detectionStale ? 'opacity-65' : ''
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground capitalize">
                      {obj.label}
                    </span>
                    {obj.isTargetGoal && (
                      <span className="text-xs font-bold text-primary">· Target Goal</span>
                    )}
                    {detectionStale && (
                      <span className="text-xs font-mono text-muted-foreground">· Stale</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3 text-primary" />
                      {obj.clockPosition}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-accent" />
                      {obj.relativeDistance.replace('_', ' ')}
                    </span>
                    {obj.attributes && obj.attributes.length > 0 && (
                      <span className="text-foreground/70">{obj.attributes.join(', ')}</span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0 pl-3">
                  <span className="text-sm font-bold text-primary font-mono tabular-nums">
                    {Math.round(obj.confidence * 100)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
