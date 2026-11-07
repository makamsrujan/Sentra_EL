import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store database in workspace root or server directory
const DB_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'sentra.db');
export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency and performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- User Settings table (syncs user preferences like speechRate, audioFeedback, etc.)
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Contextual Memories table (conversations, objects, spatial, preferences)
    CREATE TABLE IF NOT EXISTS contextual_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'conversational' | 'object' | 'spatial' | 'preference'
      title TEXT NOT NULL,
      details TEXT,
      tags_json TEXT, -- array of tags
      metadata_json TEXT, -- custom fields
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- User Registered Devices (ESP32-S3 Wearables, etc.)
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, -- device_id, e.g. ESP32-S3-SENTRA-001
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      hardware_model TEXT,
      api_key TEXT UNIQUE,
      last_seen INTEGER,
      battery_level INTEGER DEFAULT 100,
      status TEXT DEFAULT 'offline',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Device Telemetry Log
    CREATE TABLE IF NOT EXISTS telemetry_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      device_id TEXT NOT NULL,
      battery_level INTEGER,
      battery_charging INTEGER,
      forward_tof_cm REAL,
      downward_cliff_mm REAL,
      imu_json TEXT,
      head_pitch REAL,
      earphone_connected INTEGER,
      audio_volume INTEGER,
      timestamp INTEGER NOT NULL
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_memories_user ON contextual_memories(user_id, type);
    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_telemetry_dev_time ON telemetry_logs(device_id, timestamp DESC);
  `);

  console.log(`[Database] SQLite initialized at ${DB_PATH}`);
}
