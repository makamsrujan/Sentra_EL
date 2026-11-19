import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  Compass,
  Layers,
  MapPin,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Volume2,
  CheckCircle2,
  Navigation,
} from 'lucide-react';
import { SpatialLandmark, SpatialRelationship, DetectedObject } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';
import { speakText } from '../utils/audio';

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
  const hasHeading = heading != null && Number.isFinite(heading);
  const currentHeading = hasHeading ? Math.round(heading!) : 0;
  const compassDir = hasHeading ? getCompassDirection(currentHeading) : 'Unavailable';

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [selectedLandmark, setSelectedLandmark] = useState<SpatialLandmark | null>(null);

  // Convert distance text (e.g. "Arm reach", "3 steps ahead") into radial pixels
  const parseDistanceToRadius = (distStr: string): number => {
    const lower = distStr.toLowerCase();
    if (lower.includes('arm')) return 65;
    if (lower.includes('1 step') || lower.includes('step ahead')) return 110;
    if (lower.includes('2 step')) return 140;
    if (lower.includes('3 step')) return 175;
    if (lower.includes('4 step') || lower.includes('5 step')) return 210;
    return 130; // default radius
  };

  // Calculate relative clock position of landmark relative to user's heading
  const getRelativeClockPosition = (landmarkHeading: number, userHeading: number): string => {
    const diff = (landmarkHeading - userHeading + 360) % 360;
    const hour = Math.round(diff / 30) % 12;
    return `${hour === 0 ? 12 : hour} o'clock`;
  };

  // Render D3 Interactive Map
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 460;
    const height = 380;
    const centerX = width / 2;
    const centerY = height / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('class', 'main-map-group');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    const defs = svg.append('defs');

    const fovGradient = defs
      .append('radialGradient')
      .attr('id', 'fov-gradient')
      .attr('cx', '50%')
      .attr('cy', '100%')
      .attr('r', '100%');
    fovGradient.append('stop').attr('offset', '0%').attr('stop-color', '#ffd15c').attr('stop-opacity', 0.35);
    fovGradient.append('stop').attr('offset', '100%').attr('stop-color', '#ffd15c').attr('stop-opacity', 0.0);

    // 1. Concentric Distance Rings
    const rings = [
      { radius: 65, label: "Arm's Reach (~0.8m)" },
      { radius: 110, label: 'Near (~1.5m)' },
      { radius: 155, label: 'Mid (~2.5m)' },
      { radius: 195, label: 'Far (~4.0m)' },
    ];

    rings.forEach((r) => {
      g.append('circle')
        .attr('cx', centerX)
        .attr('cy', centerY)
        .attr('r', r.radius)
        .attr('fill', 'none')
        .attr('stroke', 'currentColor')
        .attr('class', 'text-border/40')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4');

      g.append('text')
        .attr('x', centerX + 6)
        .attr('y', centerY - r.radius + 12)
        .attr('class', 'fill-muted-foreground text-[9px] font-mono select-none pointer-events-none')
        .text(r.label);
    });

    // 2. Compass Axes
    const axisGroup = g.append('g').attr('class', 'axis-lines');
    axisGroup
      .append('line')
      .attr('x1', centerX)
      .attr('y1', centerY - 200)
      .attr('x2', centerX)
      .attr('y2', centerY + 200)
      .attr('stroke', 'currentColor')
      .attr('class', 'text-border/30')
      .attr('stroke-width', 1);

    axisGroup
      .append('line')
      .attr('x1', centerX - 200)
      .attr('y1', centerY)
      .attr('x2', centerX + 200)
      .attr('y2', centerY)
      .attr('stroke', 'currentColor')
      .attr('class', 'text-border/30')
      .attr('stroke-width', 1);

    const cardinals = [
      { label: 'N', x: centerX, y: centerY - 210, color: 'text-primary font-extrabold' },
      { label: 'S', x: centerX, y: centerY + 215, color: 'text-muted-foreground' },
      { label: 'E', x: centerX + 215, y: centerY + 4, color: 'text-muted-foreground' },
      { label: 'W', x: centerX - 215, y: centerY + 4, color: 'text-muted-foreground' },
    ];

    cardinals.forEach((c) => {
      g.append('text')
        .attr('x', c.x)
        .attr('y', c.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('class', `text-xs font-mono select-none pointer-events-none ${c.color}`)
        .text(c.label);
    });

    // 3. Vision Cone (only rendered when compass heading is actually available)
    if (hasHeading) {
      const fovAngle = 65;
      const startAngle = ((currentHeading - fovAngle / 2 - 90) * Math.PI) / 180;
      const endAngle = ((currentHeading + fovAngle / 2 - 90) * Math.PI) / 180;
      const coneRadius = 185;

      const arcGenerator = d3
        .arc<any>()
        .innerRadius(0)
        .outerRadius(coneRadius)
        .startAngle(startAngle + Math.PI / 2)
        .endAngle(endAngle + Math.PI / 2);

      g.append('path')
        .attr('d', arcGenerator(null))
        .attr('transform', `translate(${centerX}, ${centerY})`)
        .attr('fill', 'url(#fov-gradient)')
        .attr('class', 'pointer-events-none');
    }

    // 4. Spatial Relationships Lines between Landmarks
    const relGroup = g.append('g').attr('class', 'spatial-relationships-layer');
    relationships.forEach((rel) => {
      const subjectLm = landmarks.find((l) => l.name.toLowerCase().includes(rel.subject.toLowerCase()));
      const objectLm = landmarks.find((l) => l.name.toLowerCase().includes(rel.object.toLowerCase()));

      if (subjectLm && objectLm) {
        const sRad = ((subjectLm.heading - 90) * Math.PI) / 180;
        const sR = parseDistanceToRadius(subjectLm.distanceEst);
        const sx = centerX + Math.cos(sRad) * sR;
        const sy = centerY + Math.sin(sRad) * sR;

        const oRad = ((objectLm.heading - 90) * Math.PI) / 180;
        const oR = parseDistanceToRadius(objectLm.distanceEst);
        const ox = centerX + Math.cos(oRad) * oR;
        const oy = centerY + Math.sin(oRad) * oR;

        relGroup
          .append('line')
          .attr('x1', sx)
          .attr('y1', sy)
          .attr('x2', ox)
          .attr('y2', oy)
          .attr('stroke', '#38bdf8')
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '3 3')
          .attr('opacity', 0.65);

        relGroup
          .append('text')
          .attr('x', (sx + ox) / 2)
          .attr('y', (sy + oy) / 2 - 6)
          .attr('text-anchor', 'middle')
          .attr('class', 'fill-sky-400 text-[10px] font-mono font-bold select-none')
          .text(rel.relation);
      }
    });

    // 5. Connect User to each Landmark with directional radial line
    landmarks.forEach((lm) => {
      const rad = ((lm.heading - 90) * Math.PI) / 180;
      const r = parseDistanceToRadius(lm.distanceEst);
      const x = centerX + Math.cos(rad) * r;
      const y = centerY + Math.sin(rad) * r;

      g.append('line')
        .attr('x1', centerX)
        .attr('y1', centerY)
        .attr('x2', x)
        .attr('y2', y)
        .attr('stroke', 'currentColor')
        .attr('class', 'text-border/40')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2 4');
    });

    // 6. Interactive Landmark Nodes
    const landmarksGroup = g.append('g').attr('class', 'landmarks-layer');

    landmarks.forEach((lm) => {
      const rad = ((lm.heading - 90) * Math.PI) / 180;
      const r = parseDistanceToRadius(lm.distanceEst);
      const x = centerX + Math.cos(rad) * r;
      const y = centerY + Math.sin(rad) * r;
      const relClock = getRelativeClockPosition(lm.heading, currentHeading);

      const lmNode = landmarksGroup
        .append('g')
        .attr('class', 'landmark-node cursor-pointer')
        .attr('transform', `translate(${x}, ${y})`)
        .on('click', () => {
          setSelectedLandmark(lm);
          speakText(`${lm.name} is recorded at ${relClock}, ${lm.distanceEst}.`);
        });

      lmNode
        .append('circle')
        .attr('r', 11)
        .attr('fill', lm.verified ? '#047857' : '#0369a1')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2);

      lmNode.append('circle').attr('r', 3.5).attr('fill', '#ffffff');

      const labelText = lm.name;
      const approxWidth = labelText.length * 6.8 + 16;
      lmNode
        .append('rect')
        .attr('x', -approxWidth / 2)
        .attr('y', 15)
        .attr('width', approxWidth)
        .attr('height', 18)
        .attr('rx', 4)
        .attr('fill', 'rgba(15, 23, 42, 0.92)')
        .attr('stroke', lm.verified ? '#10b981' : '#38bdf8')
        .attr('stroke-width', 1);

      lmNode
        .append('text')
        .attr('x', 0)
        .attr('y', 27)
        .attr('text-anchor', 'middle')
        .attr('class', 'fill-foreground text-[10px] font-bold select-none')
        .text(labelText);

      if (hasHeading) {
        lmNode
          .append('text')
          .attr('x', 0)
          .attr('y', -15)
          .attr('text-anchor', 'middle')
          .attr('class', 'fill-primary text-[9px] font-mono font-bold select-none')
          .text(relClock);
      }
    });

    // 7. Center User Marker (YOU)
    const userGroup = g
      .append('g')
      .attr('class', 'user-center-marker')
      .attr('transform', `translate(${centerX}, ${centerY})`);

    if (hasHeading) {
      const headingRad = ((currentHeading - 90) * Math.PI) / 180;
      const arrowLength = 30;
      const arrowX = Math.cos(headingRad) * arrowLength;
      const arrowY = Math.sin(headingRad) * arrowLength;

      userGroup
        .append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', arrowX)
        .attr('y2', arrowY)
        .attr('stroke', '#ffd15c')
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round');

      userGroup.append('circle').attr('cx', arrowX).attr('cy', arrowY).attr('r', 4.5).attr('fill', '#ffd15c');
    }

    userGroup
      .append('circle')
      .attr('r', 17)
      .attr('fill', '#ffd15c')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2);

    userGroup
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('class', 'fill-slate-950 text-[10px] font-extrabold select-none')
      .text('YOU');
  }, [currentHeading, hasHeading, landmarks, relationships]);

  const handleZoom = (scaleFactor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(250).call(zoomBehaviorRef.current.scaleBy, scaleFactor);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(350).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  return (
    <div className="space-y-4 text-foreground">
      {/* Header card with current heading and scope */}
      <div className="rounded-xl bg-card border border-border p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary border border-primary/40">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground">Spatial Awareness</h3>
            <p className="text-xs text-muted-foreground">
              Context: <span className="text-primary font-semibold">{currentRoom}</span> · Polar Bearing & Observation Plot (Not full SLAM)
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="font-mono text-base font-extrabold text-primary tabular-nums">
            {hasHeading ? `${currentHeading}° ${compassDir}` : 'Heading N/A'}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {hasHeading ? 'Browser Magnetometer' : 'MPU6050 6-axis: No Compass'}
          </div>
        </div>
      </div>

      {/* Main Interactive D3 Map Container */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-primary" />
            <span className="font-bold text-sm text-foreground">
              Observed Landmarks ({landmarks.length})
            </span>
          </div>

          {/* D3 Zoom Controls */}
          <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 border border-border/60">
            <button
              type="button"
              onClick={() => handleZoom(1.3)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              title="Zoom in"
              aria-label="Zoom in on spatial plot"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(0.7)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              title="Zoom out"
              aria-label="Zoom out on spatial plot"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              title="Reset view"
              aria-label="Reset zoom and center view"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* D3 SVG Canvas */}
        <div
          ref={containerRef}
          className="relative w-full h-[380px] rounded-lg bg-slate-950/85 border border-border/60 overflow-hidden cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          <svg ref={svgRef} className="w-full h-full select-none" />

          {landmarks.length === 0 && (
            <div className="pointer-events-none absolute top-3 left-3 right-3 text-center">
              <span className="inline-block rounded-md bg-slate-900/90 border border-border px-3 py-1.5 text-xs text-muted-foreground">
                No observed landmarks logged yet in this session. Analyze frames or find objects to plot bearings.
              </span>
            </div>
          )}

          {/* Legend Overlay */}
          <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2 p-1.5 rounded-md bg-slate-900/90 border border-border/50 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1 font-mono font-bold text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span>{hasHeading ? 'You & Vision Cone' : 'User Origin'}</span>
            </div>
            <span aria-hidden="true">·</span>
            <div className="flex items-center gap-1 font-mono text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Verified Sighting</span>
            </div>
            <span aria-hidden="true">·</span>
            <div className="flex items-center gap-1 font-mono text-sky-400">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              <span>Detected Entity</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Drag to pan the map · Scroll or use +/- to zoom · Tap any landmark to inspect and speak its clock orientation.
        </p>

        {/* Selected Landmark Details Card */}
        {selectedLandmark && (
          <div className="rounded-xl bg-secondary/80 border border-primary/50 p-3.5 flex items-start justify-between gap-3 animate-fade-in">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/40 mt-0.5">
                <MapPin className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">{selectedLandmark.name}</span>
                  {selectedLandmark.verified && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Verified Sight</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Room: <span className="text-foreground">{selectedLandmark.room}</span> · Distance: <span className="text-foreground font-semibold">{selectedLandmark.distanceEst}</span>
                </p>
                <p className="text-xs font-mono text-primary font-bold">
                  Relative Position: {getRelativeClockPosition(selectedLandmark.heading, currentHeading)} ({Math.round(selectedLandmark.heading)}° true compass)
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                const relClock = getRelativeClockPosition(selectedLandmark.heading, currentHeading);
                speakText(`${selectedLandmark.name} is at your ${relClock}, ${selectedLandmark.distanceEst}.`);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 active:scale-95 transition-all shadow-sm shrink-0"
            >
              <Volume2 className="h-3.5 w-3.5" />
              <span>Speak</span>
            </button>
          </div>
        )}
      </div>

      {/* Spatial Relationships Observed */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-base text-foreground">
            <Layers className="h-5 w-5 text-accent" />
            <span>Observed Spatial Relationships ({relationships.length})</span>
          </div>
          <span className="text-xs text-muted-foreground font-mono">Observed Inferences</span>
        </div>

        {relationships.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            As objects and landmarks are observed together, their spatial arrangements (e.g. "spectacles ON study desk") will appear here.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {relationships.slice(-6).map((rel) => (
              <div
                key={rel.id}
                className="p-2.5 rounded-xl bg-secondary/70 border border-border/50 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-bold text-primary capitalize">{rel.subject}</span>{' '}
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-background text-accent border border-border/40 font-bold">
                    {rel.relation.replace('_', ' ')}
                  </span>{' '}
                  <span className="font-bold text-foreground capitalize">{rel.object}</span>
                </div>
                {rel.verifiedLive && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
