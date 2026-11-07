import React, { useState } from 'react';
import {
  Bookmark,
  Search,
  Trash2,
  Volume2,
  Navigation,
  Compass,
  Plus,
  Clock,
  CheckCircle2,
  History,
  Download,
  Upload,
  Database,
} from 'lucide-react';
import { SentraMemoryItem } from '../types/sentra';
import { getCompassDirection } from '../utils/sensors';

interface ContextualMemoryViewProps {
  memories: SentraMemoryItem[];
  onAddMemory: (label: string, note: string, room?: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearAll: () => void;
  onSpeakMemory: (item: SentraMemoryItem) => void;
  onFindMemoryTarget: (label: string) => void;
  onExportData?: () => void;
  onImportData?: (file: File) => void;
}

export const ContextualMemoryView: React.FC<ContextualMemoryViewProps> = ({
  memories,
  onAddMemory,
  onDeleteMemory,
  onClearAll,
  onSpeakMemory,
  onFindMemoryTarget,
  onExportData,
  onImportData,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newRoom, setNewRoom] = useState('Living Room');
  const [activeTab, setActiveTab] = useState<'all' | 'verified' | 'historical'>('all');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newLabel.trim()) {
      onAddMemory(newLabel.trim(), newNote.trim() || newLabel.trim(), newRoom);
      setNewLabel('');
      setNewNote('');
      setShowAddForm(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImportData) {
      onImportData(file);
    }
  };

  const filtered = memories.filter((m) => {
    const matchSearch =
      m.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.note.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.room && m.room.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchSearch) return false;
    if (activeTab === 'verified') return m.source === 'live_verified';
    if (activeTab === 'historical') return m.source !== 'live_verified';
    return true;
  });

  return (
    <div className="space-y-4 text-foreground animate-fade-in">
      {/* Header & Controls */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-primary">
            <Bookmark className="h-5 w-5" />
            <span>Contextual Memory ({memories.length})</span>
          </div>

          <div className="flex items-center gap-1.5">
            {onExportData && (
              <button
                onClick={onExportData}
                title="Export JSON Backup"
                className="p-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 text-xs font-bold transition-all"
              >
                <Download className="h-4 w-4" />
              </button>
            )}

            {onImportData && (
              <label
                title="Import JSON Backup"
                className="p-1.5 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 text-xs font-bold cursor-pointer transition-all"
              >
                <Upload className="h-4 w-4" />
                <input type="file" accept=".json" className="hidden" onChange={handleFileChange} />
              </label>
            )}

            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 active:scale-95 transition-all flex items-center gap-1"
            >
              <Plus className="h-4 w-4" />
              <span>{showAddForm ? 'Cancel' : 'Remember New'}</span>
            </button>
          </div>
        </div>

        {/* Persistence Status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5 text-primary" />
          <span>IndexedDB Structured Storage: Active & Persistent across sessions.</span>
        </div>

        {/* Add Memory Form */}
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
                Save to IndexedDB
              </button>
            </div>
          </form>
        )}

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search saved memories (e.g. bottle, desk, glasses)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl bg-secondary pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground border border-border/60 focus:border-primary focus:outline-none"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({memories.length})
          </button>
          <button
            onClick={() => setActiveTab('verified')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'verified'
                ? 'bg-emerald-500 text-white'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            Live Verified ({memories.filter((m) => m.source === 'live_verified').length})
          </button>
          <button
            onClick={() => setActiveTab('historical')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'historical'
                ? 'bg-amber-500 text-white'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            Historical ({memories.filter((m) => m.source !== 'live_verified').length})
          </button>
        </div>
      </div>

      {/* Memory Items List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-card border border-border p-8 text-center text-muted-foreground text-xs">
            No memories match your query.
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="p-3.5 rounded-2xl bg-card border border-border space-y-2 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">{item.label}</span>
                  {item.source === 'live_verified' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Live Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                      <History className="h-3 w-3" />
                      Historical Recall
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onSpeakMemory(item)}
                    className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground"
                    title="Speak aloud"
                  >
                    <Volume2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onFindMemoryTarget(item.label)}
                    className="p-1 rounded-lg hover:bg-secondary text-primary"
                    title="Search for this object"
                  >
                    <Navigation className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDeleteMemory(item.id)}
                    className="p-1 rounded-lg hover:bg-destructive/15 text-destructive"
                    title="Delete memory"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <p className="text-xs text-foreground/90 leading-relaxed">{item.note}</p>

              <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono pt-1 border-t border-border/30">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{item.at}</span>
                </span>
                {item.heading != null && (
                  <span className="flex items-center gap-1">
                    <Compass className="h-3 w-3 text-primary" />
                    <span>
                      {Math.round(item.heading)}° {getCompassDirection(item.heading)}
                    </span>
                  </span>
                )}
                {item.room && <span>Room: {item.room}</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {memories.length > 0 && (
        <div className="text-center pt-1">
          <button
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-destructive underline font-semibold transition-colors"
          >
            Clear all saved memories
          </button>
        </div>
      )}
    </div>
  );
};
