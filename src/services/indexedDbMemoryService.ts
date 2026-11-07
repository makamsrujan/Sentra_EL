/**
 * SENTRA Contextual Memory Service (IndexedDB)
 * Feature 4: Robust Long-term Contextual Memory
 * 
 * Provides structured persistent storage with clear separation between:
 * - Conversational Memory
 * - Object Memory (explicitly tracking source: live_verified vs remembered_historical)
 * - Spatial Memory (landmarks, relationships, room graphs)
 * - User Preferences
 */

import {
  ConversationalRecord,
  ObjectMemoryRecord,
  SpatialMemoryRecord,
  SentraMemoryItem,
  SpatialLandmark,
  SpatialRelationship,
} from '../types/sentra';

const DB_NAME = 'sentra_contextual_memory_v1';
const DB_VERSION = 1;

class IndexedDbMemoryService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isAvailable: boolean = true;
  private memoryCache: SentraMemoryItem[] = [];

  constructor() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      this.isAvailable = false;
      console.warn('IndexedDB not supported in current environment; using in-memory fallback.');
    }
  }

  private async getDB(): Promise<IDBDatabase> {
    if (!this.isAvailable) {
      throw new Error('IndexedDB unavailable');
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Conversational Memory Store
        if (!db.objectStoreNames.contains('conversational_memory')) {
          const convStore = db.createObjectStore('conversational_memory', { keyPath: 'id' });
          convStore.createIndex('sessionId', 'sessionId', { unique: false });
          convStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 2. Object Memory Store
        if (!db.objectStoreNames.contains('object_memory')) {
          const objStore = db.createObjectStore('object_memory', { keyPath: 'id' });
          objStore.createIndex('normalizedName', 'normalizedName', { unique: false });
          objStore.createIndex('room', 'room', { unique: false });
          objStore.createIndex('lastSeenTimestamp', 'lastSeenTimestamp', { unique: false });
          objStore.createIndex('source', 'source', { unique: false });
        }

        // 3. Spatial Memory Store
        if (!db.objectStoreNames.contains('spatial_memory')) {
          const spatialStore = db.createObjectStore('spatial_memory', { keyPath: 'id' });
          spatialStore.createIndex('roomName', 'roomName', { unique: false });
          spatialStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        // 4. User Preferences Store
        if (!db.objectStoreNames.contains('user_preferences')) {
          db.createObjectStore('user_preferences', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.isAvailable = false;
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  // --- Initial Migration from Legacy LocalStorage ---
  public async migrateFromLocalStorage(legacyItems: SentraMemoryItem[]): Promise<void> {
    try {
      const existing = await this.getAllObjectMemories();
      if (existing.length === 0 && legacyItems.length > 0) {
        for (const item of legacyItems) {
          await this.saveObjectMemory(item);
        }
      }
    } catch (e) {
      console.warn('Could not migrate legacy memories to IndexedDB:', e);
    }
  }

  // --- Object Memory Methods ---
  public async saveObjectMemory(item: SentraMemoryItem): Promise<void> {
    const record: ObjectMemoryRecord = {
      id: item.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: item.label,
      normalizedName: item.label.toLowerCase().trim(),
      description: item.note,
      room: item.room || 'General Space',
      relativePosition: item.heading != null ? `${Math.round(item.heading)}°` : undefined,
      lastSeenTimestamp: item.timestamp || Date.now(),
      source: item.source || 'remembered_historical',
      confidence: item.confidence || 0.8,
      attributes: item.attributes || [],
    };

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('object_memory', 'readwrite');
        const store = tx.objectStore('object_memory');
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fallback in-memory
      const idx = this.memoryCache.findIndex((m) => m.id === item.id);
      if (idx >= 0) this.memoryCache[idx] = item;
      else this.memoryCache.push(item);
    }
  }

  public async getAllObjectMemories(): Promise<SentraMemoryItem[]> {
    try {
      const db = await this.getDB();
      return new Promise<SentraMemoryItem[]>((resolve, reject) => {
        const tx = db.transaction('object_memory', 'readonly');
        const store = tx.objectStore('object_memory');
        const req = store.getAll();

        req.onsuccess = () => {
          const records: ObjectMemoryRecord[] = req.result || [];
          const items: SentraMemoryItem[] = records.map((r) => ({
            id: r.id,
            label: r.label,
            note: r.description,
            at: new Date(r.lastSeenTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: r.lastSeenTimestamp,
            heading: r.relativePosition ? parseInt(r.relativePosition, 10) || null : null,
            room: r.room,
            source: r.source,
            confidence: r.confidence,
            attributes: r.attributes,
          }));
          this.memoryCache = items;
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [...this.memoryCache];
    }
  }

  public async searchObjectMemories(query: string): Promise<SentraMemoryItem[]> {
    const all = await this.getAllObjectMemories();
    const clean = query.toLowerCase().trim();
    if (!clean) return all;

    return all.filter(
      (m) =>
        m.label.toLowerCase().includes(clean) ||
        m.note.toLowerCase().includes(clean) ||
        (m.room && m.room.toLowerCase().includes(clean))
    );
  }

  public async deleteObjectMemory(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('object_memory', 'readwrite');
        const store = tx.objectStore('object_memory');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      this.memoryCache = this.memoryCache.filter((m) => m.id !== id);
    }
  }

  public async clearAllObjectMemories(): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('object_memory', 'readwrite');
        const store = tx.objectStore('object_memory');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      this.memoryCache = [];
    }
  }

  // --- Conversational Turn Recording ---
  public async recordConversationTurn(turn: ConversationalRecord): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('conversational_memory', 'readwrite');
        const store = tx.objectStore('conversational_memory');
        const req = store.put(turn);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('Could not record conversation turn to IndexedDB:', e);
    }
  }

  public async getRecentConversations(limit = 12): Promise<ConversationalRecord[]> {
    try {
      const db = await this.getDB();
      return new Promise<ConversationalRecord[]>((resolve, reject) => {
        const tx = db.transaction('conversational_memory', 'readonly');
        const store = tx.objectStore('conversational_memory');
        const req = store.getAll();

        req.onsuccess = () => {
          const turns: ConversationalRecord[] = req.result || [];
          turns.sort((a, b) => a.timestamp - b.timestamp);
          resolve(turns.slice(-limit));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  // --- Spatial Memory (Landmarks & Room Topology) ---
  public async saveSpatialModel(room: string, landmarks: SpatialLandmark[], relationships: SpatialRelationship[]): Promise<void> {
    const record: SpatialMemoryRecord = {
      id: `spatial-${room.toLowerCase().replace(/\s+/g, '-')}`,
      roomName: room,
      landmarks,
      relationships,
      lastUpdated: Date.now(),
    };

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('spatial_memory', 'readwrite');
        const store = tx.objectStore('spatial_memory');
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('Could not save spatial memory to IndexedDB:', e);
    }
  }

  // --- Data Export & Import ---
  public async exportAllData(): Promise<string> {
    const objects = await this.getAllObjectMemories();
    const conversations = await this.getRecentConversations(50);
    return JSON.stringify({
      schema: 'sentra_backup_v1',
      exportedAt: new Date().toISOString(),
      objects,
      conversations,
    }, null, 2);
  }

  public async importData(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data.objects)) {
        for (const obj of data.objects) {
          await this.saveObjectMemory(obj);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to parse backup JSON:', e);
      return false;
    }
  }
}

export const memoryService = new IndexedDbMemoryService();
