import React, { useState } from 'react';
import { Bookmark, Search, Trash2, Volume2, Navigation, Compass, Plus, Tag, Clock, CheckCircle2, History, AlertCircle } from 'lucide-react';
import { SentraMemoryItem } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';

interface ContextualMemoryViewProps {
  memories: SentraMemoryItem[];
  onAddMemory: (label: string, note: string, room?: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearAll: () => void;
  onSpeakMemory: (item: SentraMemoryItem) => void;
  onFindMemoryTarget: (label: string) => void;
}

export const ContextualMemoryView: React.FC<ContextualMemoryViewProps> = ({
  memories,
  onAddMemory,
  onDeleteMemory,
  onClearAll,
  onSpeakMemory,
  onFindMemoryTarget,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newRoom, setNewRoom] = useState('Living Room');
  const [confirmClear, setConfirmClear] = useState(false);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newLabel.trim()) {
      onAddMemory(newLabel.trim(), newNote.trim() || newLabel.trim(), newRoom);
      setNewLabel('');
      setNewNote('');
      setShowAddForm(false);
    }
  };

  const filtered = memories.filter(
    (m) =>
      m.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.note.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.room && m.room.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-4 text-foreground">
      {/* Header & Search */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Bookmark className="h-5 w-5" />
            <span>Contextual Object & Place Memory ({memories.length})</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 transition-all inline-flex items-center gap-1 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{showAddForm ? 'Cancel' : 'Remember New'}</span>
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Saved memories are persisted in SQLite and tagged by evidence source (live observation vs historical/manual note).
        </p>

        {/* Add Memory Form */}
        {showAddForm && (
          <form onSubmit={handleAddSubmit} className="space-y-2.5 pt-2 border-t border-border/40">
            <input
              type="text"
              placeholder="Object or landmark name (e.g. Reading Glasses)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full rounded-lg bg-secondary px-3.5 py-2 text-sm border border-border/60 focus:border-primary focus:outline-none"
              required
            />
            <input
              type="text"
              placeholder="Spatial location description (e.g. On top of nightstand at 3 o'clock)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="w-full rounded-lg bg-secondary px-3.5 py-2 text-sm border border-border/60 focus:border-primary focus:outline-none"
            />
            <div className="flex gap-2">
              <select
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                className="rounded-lg bg-secondary px-3 py-2 text-xs border border-border/60 font-semibold"
              >
                <option value="Living Room">Living Room</option>
                <option value="Kitchen">Kitchen</option>
                <option value="Bedroom">Bedroom</option>
                <option value="Office / Study">Office / Study</option>
                <option value="Hallway">Hallway</option>
              </select>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground"
              >
                Save Memory
              </button>
            </div>
          </form>
        )}

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search saved objects, rooms, or notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg bg-secondary pl-9 pr-4 py-2 text-sm border border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Memory List */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground space-y-2">
            <Bookmark className="mx-auto h-7 w-7 opacity-40" />
            <p className="text-sm font-bold text-foreground">No saved memories yet</p>
            <p className="text-xs">
              Say <span className="text-primary font-bold">"Remember this spot"</span> with an active camera or click Remember New above.
            </p>
          </div>
        ) : (
          filtered
            .slice()
            .reverse()
            .map((item) => {
              const isLive = item.source === 'live_verified';

              return (
                <div
                  key={item.id}
                  className="rounded-xl bg-card border border-border p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h4 className="font-bold text-base text-foreground">{item.label}</h4>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            isLive ? 'text-success' : 'text-accent'
                          }`}
                        >
                          {isLive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
                          <span>{isLive ? 'Live Verified Sighting' : 'Historical / Manual Note'}</span>
                        </span>
                        {item.room && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.room}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onSpeakMemory(item)}
                        className="rounded-lg p-2 text-primary hover:bg-secondary transition-colors"
                        aria-label={`Read out note for ${item.label}`}
                        title="Read aloud"
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onFindMemoryTarget(item.label)}
                        className="rounded-lg p-2 text-accent hover:bg-secondary transition-colors"
                        aria-label={`Start finding ${item.label}`}
                        title="Search for this item"
                      >
                        <Navigation className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteMemory(item.id)}
                        className="rounded-lg p-2 text-destructive hover:bg-secondary transition-colors"
                        aria-label={`Delete ${item.label}`}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-foreground/90 leading-relaxed">{item.note}</p>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30 font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.at}
                    </span>
                    {item.heading != null && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Compass className="h-3 w-3" />
                        {Math.round(item.heading)}° {getCompassDirection(item.heading)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
        )}
      </div>

      {memories.length > 0 && (
        <div className="pt-2 flex justify-end gap-2">
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="text-xs font-bold text-destructive hover:underline"
            >
              Clear all saved memories
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg bg-secondary px-3 py-1 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-destructive px-3 py-1 text-xs font-bold text-destructive-foreground"
              >
                Confirm Clear All
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
