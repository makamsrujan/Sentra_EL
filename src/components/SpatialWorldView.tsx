import React from 'react';
import { Compass, Navigation, Map, Layers, Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { SpatialLandmark, SpatialRelationship, DetectedObject } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';

interface SpatialWorldViewProps {
  heading: number | null;
  landmarks: SpatialLandmark[];
  relationships: SpatialRelationship[];
  detectedObjects: DetectedObject[];
  currentRoom: string;
}

export const SpatialWorldView: React.FC<SpatialWorldViewProps> = ({
  heading,
  landmarks,
  relationships,
  detectedObjects,
  currentRoom,
}) => {
  const currentHeading = heading != null ? Math.round(heading) : 0;
  const compassDir = getCompassDirection(currentHeading);

  return (
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* 2D Compass Radar Visualizer */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Compass className="h-5 w-5" />
            <span>Spatial Orientation Radar</span>
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

          {/* Center User Dot */}
          <div className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold shadow-lg">
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

        <p className="text-center text-xs text-muted-foreground">
          Yellow vector indicates forward camera orientation relative to true compass north.
        </p>
      </div>

      {/* Spatial Relationships Observed */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Layers className="h-5 w-5 text-accent" />
            <span>Observed Spatial Relationships</span>
          </div>
          <span className="text-xs text-muted-foreground">{relationships.length} logged</span>
        </div>

        {relationships.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            As objects are observed together, their spatial arrangements (e.g. "spectacles ON desk") will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {relationships.slice(-5).map((rel) => (
              <div
                key={rel.id}
                className="p-3 rounded-xl bg-secondary border border-border/40 flex items-center justify-between text-sm"
              >
                <div>
                  <span className="font-bold text-primary capitalize">{rel.subject}</span>{' '}
                  <span className="text-xs uppercase font-mono px-1.5 py-0.5 rounded bg-background text-accent">
                    {rel.relation.replace('_', ' ')}
                  </span>{' '}
                  <span className="font-bold text-foreground capitalize">{rel.object}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {rel.verifiedLive ? 'Live verified' : 'Historical'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Verification & Sensor Grounding Notice */}
      <div className="rounded-2xl bg-secondary/70 border border-border p-4 text-xs text-muted-foreground space-y-1.5">
        <div className="flex items-center gap-1.5 font-bold text-foreground text-sm">
          <Info className="h-4 w-4 text-primary" />
          <span>Spatial Evidence Grounding</span>
        </div>
        <p>
          SENTRA operates strictly on confirmed camera frames and real compass hardware. Areas out of frame are marked as unobserved, never assumed clear.
        </p>
      </div>
    </div>
  );
};
