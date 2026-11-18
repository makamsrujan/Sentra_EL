import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-bold transition-colors hover:brightness-110 ${
          compact ? 'px-2.5 py-2 text-xs' : 'px-3.5 py-2.5 text-xs'
        }`}
        aria-label="Install SENTRA as an app"
      >
        <Download className="h-3.5 w-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-2.5 py-2 text-xs font-bold text-foreground hover:border-primary"
          aria-label="How to install SENTRA on iOS"
        >
          <Smartphone className="h-3.5 w-3.5 text-primary" />
          <span>Install iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-xl bg-card border border-border p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-primary">Install SENTRA on iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label="Close instructions"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-sm text-foreground/90">
                <li>
                  Tap the <strong>Share</strong> icon in Safari’s toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>Tap <strong>Add</strong> to install SENTRA in standalone mode.</li>
              </ol>
              <p className="text-xs text-muted-foreground border-t border-border pt-2">
                Note: Standalone PWA installation provides full-screen access, but continuous background microphone listening still requires a future native iOS app.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl bg-amber-500/15 border border-amber-500/50 px-3 py-2 text-xs font-semibold text-amber-200 flex items-center gap-2"
    >
      <WifiOff className="h-4 w-4 text-amber-400 shrink-0" />
      <span>
        Offline Mode — Static app shell active. Gemini AI Visual Analysis is unavailable; Local Analysis only provides basic optical heuristics.
      </span>
    </div>
  );
};
