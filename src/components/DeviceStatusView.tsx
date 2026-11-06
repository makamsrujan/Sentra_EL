import React, { useState } from 'react';
import { Cpu, Wifi, WifiOff, Battery, BatteryCharging, Headphones, Compass, AlertTriangle, ShieldCheck, Sliders, Play, Camera, Radio } from 'lucide-react';
import { WearableTelemetry } from '../types/sentra';

interface DeviceStatusViewProps {
  telemetry: WearableTelemetry;
  useWearableFeed: boolean;
  onToggleFeedSource: (useWearable: boolean) => void;
  onUpdateSimulatedTelemetry: (updated: Partial<WearableTelemetry>) => void;
  cameraReady: boolean;
}

export const DeviceStatusView: React.FC<DeviceStatusViewProps> = ({
  telemetry,
  useWearableFeed,
  onToggleFeedSource,
  onUpdateSimulatedTelemetry,
  cameraReady,
}) => {
  const [showSimulator, setShowSimulator] = useState(false);

  // Quick hazard triggers for testing
  const triggerCliffHazard = () => {
    onUpdateSimulatedTelemetry({ downwardCliffSensorMm: 350 });
  };

  const triggerProximityHazard = () => {
    onUpdateSimulatedTelemetry({ forwardToFDistanceCm: 28 });
  };

  const resetSensorsNormal = () => {
    onUpdateSimulatedTelemetry({ forwardToFDistanceCm: 150, downwardCliffSensorMm: 80 });
  };

  return (
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* Wearable Connection Header */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Cpu className="h-6 w-6 text-primary" />
            <div>
              <h3 className="font-bold text-lg leading-tight">ESP32-S3 Wearable Gateway</h3>
              <p className="text-xs text-muted-foreground">Headband + Electronics Box Specification</p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
              telemetry.connected
                ? 'bg-success/20 text-success border border-success/40'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {telemetry.connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span>{telemetry.connected ? 'Hardware Connected' : 'Disconnected'}</span>
          </span>
        </div>

        {/* Video Feed Source Selector */}
        <div className="rounded-xl bg-secondary p-3 border border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-bold">Active Camera Input</p>
              <p className="text-xs text-muted-foreground">
                {useWearableFeed ? 'ESP32-S3 Headband Camera' : 'Local Device Camera'}
              </p>
            </div>
          </div>
          <button
            onClick={() => onToggleFeedSource(!useWearableFeed)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 active:scale-95 transition-all shadow-sm"
          >
            Switch to {useWearableFeed ? 'Browser' : 'Wearable'}
          </button>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {/* Battery */}
          <div className="rounded-xl bg-secondary p-3 border border-border/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Battery</span>
              {telemetry.batteryCharging ? (
                <BatteryCharging className="h-4 w-4 text-success" />
              ) : (
                <Battery className="h-4 w-4 text-primary" />
              )}
            </div>
            <p className="text-2xl font-extrabold text-foreground mt-1 font-mono">
              {telemetry.batteryLevel}%
            </p>
            <p className="text-[11px] text-muted-foreground">3.7V LiPo Wearable Pack</p>
          </div>

          {/* Earphone Audio */}
          <div className="rounded-xl bg-secondary p-3 border border-border/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Audio Interface</span>
              <Headphones className="h-4 w-4 text-accent" />
            </div>
            <p className="text-base font-bold text-foreground mt-1">
              {telemetry.earphoneConnected ? 'Single Earphone' : 'No Output'}
            </p>
            <p className="text-[11px] text-muted-foreground">Vol: {telemetry.audioVolume}% • MAX98357A</p>
          </div>

          {/* Forward Distance Sensor */}
          <div className="rounded-xl bg-secondary p-3 border border-border/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Forward Proximity</span>
              {telemetry.forwardToFDistanceCm < 45 ? (
                <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-success" />
              )}
            </div>
            <p
              className={`text-2xl font-extrabold mt-1 font-mono ${
                telemetry.forwardToFDistanceCm < 45 ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {telemetry.forwardToFDistanceCm} cm
            </p>
            <p className="text-[11px] text-muted-foreground">VL53L0X Laser ToF</p>
          </div>

          {/* Downward Drop-off Cliff Sensor */}
          <div className="rounded-xl bg-secondary p-3 border border-border/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Downward Step/Cliff</span>
              {telemetry.downwardCliffSensorMm > 200 ? (
                <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-success" />
              )}
            </div>
            <p
              className={`text-2xl font-extrabold mt-1 font-mono ${
                telemetry.downwardCliffSensorMm > 200 ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {telemetry.downwardCliffSensorMm} mm
            </p>
            <p className="text-[11px] text-muted-foreground">Cliff warning &gt; 200mm</p>
          </div>
        </div>
      </div>

      {/* Round 2 Interactive Hardware Simulator */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-accent">
            <Sliders className="h-5 w-5" />
            <span>Wearable Simulator [ROUND 2 TESTBENCH]</span>
          </div>
          <button
            onClick={() => setShowSimulator(!showSimulator)}
            className="text-xs font-bold text-primary hover:underline"
          >
            {showSimulator ? 'Collapse' : 'Expand Controls'}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Simulate real-time ESP32-S3 sensor packets to test hazard detection, ToF collision alerts, and cliff drop-offs.
        </p>

        {showSimulator && (
          <div className="space-y-3 pt-2 border-t border-border/30">
            {/* Quick Trigger Buttons */}
            <div className="flex gap-2">
              <button
                onClick={triggerProximityHazard}
                className="flex-1 rounded-xl bg-destructive/15 text-destructive border border-destructive/40 py-2 text-xs font-bold hover:bg-destructive/25 transition-all"
              >
                Simulate Obstacle (28cm)
              </button>
              <button
                onClick={triggerCliffHazard}
                className="flex-1 rounded-xl bg-destructive/15 text-destructive border border-destructive/40 py-2 text-xs font-bold hover:bg-destructive/25 transition-all"
              >
                Simulate Stairs (350mm)
              </button>
              <button
                onClick={resetSensorsNormal}
                className="rounded-xl bg-secondary px-3 py-2 text-xs font-bold text-foreground border border-border/60 hover:bg-secondary/80 transition-all"
              >
                Reset Normal
              </button>
            </div>

            {/* Forward Distance Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Forward ToF Distance:</span>
                <span className="font-mono font-bold text-primary">{telemetry.forwardToFDistanceCm} cm</span>
              </div>
              <input
                type="range"
                min="10"
                max="300"
                value={telemetry.forwardToFDistanceCm}
                onChange={(e) =>
                  onUpdateSimulatedTelemetry({ forwardToFDistanceCm: Number(e.target.value) })
                }
                className="w-full accent-primary h-2 rounded cursor-pointer"
              />
            </div>

            {/* Cliff Drop-off Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Downward Step/Cliff Sensor:</span>
                <span className="font-mono font-bold text-accent">{telemetry.downwardCliffSensorMm} mm</span>
              </div>
              <input
                type="range"
                min="40"
                max="500"
                value={telemetry.downwardCliffSensorMm}
                onChange={(e) =>
                  onUpdateSimulatedTelemetry({ downwardCliffSensorMm: Number(e.target.value) })
                }
                className="w-full accent-accent h-2 rounded cursor-pointer"
              />
            </div>

            {/* Battery Level Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Battery Level:</span>
                <span className="font-mono font-bold text-foreground">{telemetry.batteryLevel}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                value={telemetry.batteryLevel}
                onChange={(e) =>
                  onUpdateSimulatedTelemetry({ batteryLevel: Number(e.target.value) })
                }
                className="w-full accent-success h-2 rounded cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
