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
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* Header & Search */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Bookmark className="h-5 w-5" />
            <span>Contextual Object & Place Memory ({memories.length})</span>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            <span>{showAddForm ? 'Cancel' : 'Remember New'}</span>
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          SENTRA maintains consent-based spatial memories. Items are clearly tagged as either verified live observations or historical memory so you are never misled.
        </p>

        {/* Add Memory Modal/Form */}
        {showAddForm && (
          <form onSubmit={handleAddSubmit} className="space-y-2.5 pt-2 border-t border-border/40">
            <input
              type="text"
              placeholder="Object or landmark name (e.g. Reading Glasses)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full rounded-xl bg-secondary px-3.5 py-2 text-sm border border-border/60 focus:border-primary focus:outline-none"
              required
            />
            <input
              type="text"
              placeholder="Spatial location description (e.g. On top of nightstand at 3 o'clock)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="w-full rounded-xl bg-secondary px-3.5 py-2 text-sm border border-border/60 focus:border-primary focus:outline-none"
            />
            <div className="flex gap-2">
              <select
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                className="rounded-xl bg-secondary px-3 py-2 text-xs border border-border/60 font-semibold"
              >
                <option value="Living Room">Living Room</option>
                <option value="Kitchen">Kitchen</option>
                <option value="Bedroom">Bedroom</option>
                <option value="Office / Study">Office / Study</option>
                <option value="Hallway">Hallway</option>
              </select>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground"
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
            className="w-full rounded-xl bg-secondary pl-9 pr-4 py-2 text-sm border border-border/50 focus:border-primary focus:outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Memory List */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-card border border-border p-8 text-center text-muted-foreground space-y-2">
            <Bookmark className="mx-auto h-8 w-8 opacity-40" />
            <p className="text-base font-bold text-foreground">No memories found</p>
            <p className="text-xs">
              Say <span className="text-primary font-bold">"Remember where I placed this"</span> or click Remember New above.
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
                  className="rounded-2xl bg-card border border-border/60 p-4 space-y-2 hover:border-primary/50 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-lg text-foreground">{item.label}</h4>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isLive
                              ? 'bg-success/20 text-success border border-success/40'
                              : 'bg-accent/20 text-accent border border-accent/40'
                          }`}
                        >
                          {isLive ? <CheckCircle2 className="h-3 w-3" /> : <History className="h-3 w-3" />}
                          <span>{isLive ? 'Live Verified' : 'Historical Memory'}</span>
                        </span>
                      </div>

                      {item.room && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Tag className="h-3 w-3 text-primary" />
                          <span>{item.room}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onSpeakMemory(item)}
                        className="rounded-lg p-2 text-primary hover:bg-secondary transition-colors"
                        aria-label={`Read out note for ${item.label}`}
                        title="Read aloud"
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onFindMemoryTarget(item.label)}
                        className="rounded-lg p-2 text-accent hover:bg-secondary transition-colors"
                        aria-label={`Start finding ${item.label}`}
                        title="Guide me towards this"
                      >
                        <Navigation className="h-4 w-4" />
                      </button>
                      <button
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

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/20">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.at}
                    </span>
                    {item.heading != null && (
                      <span className="flex items-center gap-1 font-mono text-primary">
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
        <div className="pt-2 flex justify-end">
          <button
            onClick={() => {
              if (window.confirm('Delete all contextual memories?')) {
                onClearAll();
              }
            }}
            className="text-xs font-bold text-destructive hover:underline"
          >
            Clear all saved memories
          </button>
        </div>
      )}
    </div>
  );
};
