import React, { useState } from 'react';
import { Bookmark, Trash2, Volume2, Search, X, Navigation, Compass } from 'lucide-react';
import { SentraMemoryItem } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';

interface MemoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  memories: SentraMemoryItem[];
  onClearAll: () => void;
  onDeleteItem: (id: string) => void;
  onSpeakMemory: (item: SentraMemoryItem) => void;
  onFindItem: (label: string) => void;
}

export const MemoryDrawer: React.FC<MemoryDrawerProps> = ({
  isOpen,
  onClose,
  memories,
  onClearAll,
  onDeleteItem,
  onSpeakMemory,
  onFindItem,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const filtered = memories.filter(
    (m) =>
      m.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.note.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Remembered Places and Objects"
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center p-3 animate-fade-in"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-card border-2 border-border p-5 shadow-2xl text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Bookmark className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold tracking-tight">
              Memory ({memories.length})
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-secondary transition-colors"
            aria-label="Close memory modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Search */}
        {memories.length > 2 && (
          <div className="relative mb-3">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search memories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl bg-secondary pl-10 pr-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground border border-border/50 focus:border-primary focus:outline-none"
            />
          </div>
        )}

        {/* List of items */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {memories.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Bookmark className="mx-auto h-12 w-12 opacity-30 mb-3" />
              <p className="text-xl font-semibold text-foreground">Nothing saved yet</p>
              <p className="mt-1 text-base">
                Hold the talk button and say <span className="font-bold text-primary">"Remember this"</span> or tap the Remember button.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No memories match "{searchTerm}"
            </p>
          ) : (
            filtered
              .slice()
              .reverse()
              .map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl bg-secondary p-4 border border-border/40 space-y-2 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xl font-bold text-foreground leading-snug">
                      {item.label}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onSpeakMemory(item)}
                        className="rounded-lg p-2 text-primary hover:bg-background/80 transition-colors"
                        aria-label={`Read out note for ${item.label}`}
                        title="Read aloud"
                      >
                        <Volume2 className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => {
                          onFindItem(item.label);
                          onClose();
                        }}
                        className="rounded-lg p-2 text-accent hover:bg-background/80 transition-colors"
                        aria-label={`Find ${item.label}`}
                        title="Start finding this"
                      >
                        <Navigation className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        className="rounded-lg p-2 text-destructive hover:bg-background/80 transition-colors"
                        aria-label={`Delete ${item.label}`}
                        title="Delete"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-base text-foreground/90 leading-relaxed">
                    {item.note}
                  </p>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/20">
                    <span>{item.at}</span>
                    {item.heading != null && (
                      <span className="flex items-center gap-1 font-mono">
                        <Compass className="h-3.5 w-3.5 text-primary" />
                        {Math.round(item.heading)}° {getCompassDirection(item.heading)}
                      </span>
                    )}
                  </div>
                </div>
              ))
          )}
        </div>

        {/* Footer actions */}
        {memories.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-3">
            <button
              onClick={() => {
                if (window.confirm('Clear all saved memories? This cannot be undone.')) {
                  onClearAll();
                }
              }}
              className="rounded-xl px-4 py-2 text-base font-bold text-destructive hover:bg-destructive/10 transition-colors"
            >
              Clear all
            </button>
            <button
              onClick={onClose}
              className="rounded-xl bg-primary px-6 py-2.5 text-base font-bold text-primary-foreground shadow-md hover:brightness-110"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
