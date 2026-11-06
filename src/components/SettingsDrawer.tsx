import React from 'react';
import { Sliders, Volume2, Vibrate, Camera, X, PlayCircle } from 'lucide-react';
import { SentraSettings } from '../types/sentra';
import { speakText } from '../utils/audio';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SentraSettings;
  onUpdateSettings: (settings: SentraSettings) => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

  const handleSpeechRateChange = (newRate: number) => {
    onUpdateSettings({ ...settings, speechRate: newRate });
  };

  const testVoice = () => {
    speakText('This is SENTRA speaking at this voice speed.', settings.speechRate);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center p-3 animate-fade-in"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-card border-2 border-border p-5 shadow-2xl text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Sliders className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-secondary transition-colors"
            aria-label="Close settings"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {/* Speech Rate */}
          <div className="rounded-2xl bg-secondary p-4 border border-border/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-lg">
                <Volume2 className="h-5 w-5 text-primary" />
                <span>Speech Speed</span>
              </div>
              <span className="font-mono text-lg font-bold text-primary">
                {settings.speechRate.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min="0.75"
              max="1.6"
              step="0.05"
              value={settings.speechRate}
              onChange={(e) => handleSpeechRateChange(parseFloat(e.target.value))}
              className="w-full accent-primary h-3 rounded-lg cursor-pointer"
              aria-label="Speech speed slider"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Slower (0.75x)</span>
              <button
                onClick={testVoice}
                className="flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <PlayCircle className="h-4 w-4" />
                <span>Test speech</span>
              </button>
              <span>Faster (1.6x)</span>
            </div>
          </div>

          {/* Sound & Haptics Toggles */}
          <div className="rounded-2xl bg-secondary p-4 border border-border/40 space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <Volume2 className="h-5 w-5 text-accent" />
                <div>
                  <p className="font-semibold text-lg">Auditory Cues</p>
                  <p className="text-xs text-muted-foreground">
                    Play audio beeps on listening, capture, and found items
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.audioFeedback}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, audioFeedback: e.target.checked })
                }
                className="h-6 w-6 accent-primary rounded cursor-pointer"
              />
            </label>

            <div className="border-t border-border/30" />

            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <Vibrate className="h-5 w-5 text-accent" />
                <div>
                  <p className="font-semibold text-lg">Haptic Vibration</p>
                  <p className="text-xs text-muted-foreground">
                    Vibrate phone on hazard cautions and object discoveries
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.hapticFeedback}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, hapticFeedback: e.target.checked })
                }
                className="h-6 w-6 accent-primary rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Camera Lens */}
          <div className="rounded-2xl bg-secondary p-4 border border-border/40 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Camera className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-lg">Camera Lens</p>
                  <p className="text-xs text-muted-foreground">
                    Rear outward camera is recommended for vision assistance
                  </p>
                </div>
              </div>
              <select
                value={settings.cameraFacing}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    cameraFacing: e.target.value as 'environment' | 'user',
                  })
                }
                className="rounded-xl bg-background px-3 py-2 text-base font-semibold text-foreground border border-border focus:border-primary focus:outline-none"
              >
                <option value="environment">Back (Outward)</option>
                <option value="user">Front (Selfie)</option>
              </select>
            </div>
          </div>

          {/* Always-On & Quota Resilience Card */}
          <div className="rounded-2xl bg-secondary/80 border border-primary/40 p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold text-lg text-primary">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
              </span>
              <span>Always-On Accessibility Guarantee</span>
            </div>
            <p className="text-sm text-foreground/90 leading-relaxed">
              SENTRA is engineered so a blind user is <strong>never left without guidance</strong>. If cloud vision quota runs out or offline:
            </p>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>
                <strong className="text-foreground">On-Device Vision:</strong> Measures ambient lighting, direction of brightest light, and dominant colors without internet or credits.
              </li>
              <li>
                <strong className="text-foreground">Compass Landmark Guidance:</strong> Points directly toward saved memories using the phone’s hardware compass.
              </li>
              <li>
                <strong className="text-foreground">Motion Throttling:</strong> Pauses repetitive requests while stationary to conserve quota.
              </li>
              <li>
                <strong className="text-foreground">Continuous Cloud Quota:</strong> To increase daily cloud limits, attach a billing-enabled key in AI Studio <strong>Settings &gt; Secrets</strong>.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-primary px-6 py-2.5 text-base font-bold text-primary-foreground shadow-md hover:brightness-110"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
