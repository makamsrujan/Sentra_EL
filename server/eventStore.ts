import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AlertEventRecord,
  AnalyticsSummary,
  ConnectionEventRecord,
  DeviceCapabilities,
  RegisteredDeviceSummary,
  SensorEventRecord,
} from '../src/types/deviceProtocol';
import type { SentraMemoryItem } from '../src/types/sentra';

export interface StoredDeviceRecord extends RegisteredDeviceSummary {
  tokenHash: string | null;
}

const RETENTION_MAX_SENSOR_EVENTS = 10000;
const RETENTION_MAX_ALERTS = 2000;
const RETENTION_MAX_CONNECTIONS = 2000;
const RETENTION_MAX_ANALYSES = 2000;

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export class SentraEventStore {
  private db: DatabaseSync | null = null;
  private initError: string | null = null;
  private writeCount = 0;

  constructor(dbPath = process.env.SENTRA_DB_PATH || './data/sentra.db') {
    try {
      if (dbPath !== ':memory:') {
        const resolved = path.resolve(dbPath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        this.db = new DatabaseSync(resolved);
      } else {
        this.db = new DatabaseSync(':memory:');
      }

      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
      this.runMigrations();
    } catch (err: any) {
      this.initError = err?.message || 'SQLite initialization failed';
      this.db = null;
      console.error('SQLite initialization error:', this.initError);
    }
  }

  public isAvailable(): boolean {
    return this.db !== null;
  }

  public getError(): string | null {
    return this.initError;
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }

  private runMigrations(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const row = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS currentVersion FROM schema_migrations')
      .get() as { currentVersion: number };

    const currentVersion = Number(row?.currentVersion || 0);

    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          device_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT,
          capabilities_json TEXT NOT NULL,
          registered_at INTEGER NOT NULL,
          last_seen_at INTEGER,
          is_simulator INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sensor_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          source_mode TEXT NOT NULL CHECK(source_mode IN ('hardware', 'simulator')),
          sequence INTEGER NOT NULL,
          uptime_ms INTEGER,
          battery_percent REAL,
          forward_distance_cm REAL,
          downward_distance_mm REAL,
          head_pitch_deg REAL,
          imu_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sensor_events_device_time
          ON sensor_events(device_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS alert_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          source_mode TEXT NOT NULL CHECK(source_mode IN ('hardware', 'simulator')),
          alert_type TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('caution', 'critical')),
          description TEXT NOT NULL,
          sensor_value TEXT,
          acknowledged INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_alert_events_device_time
          ON alert_events(device_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS connection_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          source_mode TEXT NOT NULL CHECK(source_mode IN ('hardware', 'simulator')),
          event_type TEXT NOT NULL,
          details TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_connection_events_device_time
          ON connection_events(device_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS memory_entries (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          note TEXT NOT NULL,
          room TEXT,
          heading REAL,
          source TEXT NOT NULL,
          verified_at INTEGER,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS analysis_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          operation TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          model TEXT,
          latency_ms INTEGER,
          error_code TEXT,
          summary TEXT,
          frame_timestamp INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_analysis_events_time
          ON analysis_events(created_at DESC);

        INSERT INTO schema_migrations (version, applied_at) VALUES (1, ${Date.now()});
      `);
    }
  }

  private enforceRetentionIfNeeded(): void {
    if (!this.db) return;
    this.writeCount++;
    if (this.writeCount % 50 !== 0) return;

    this.db.exec(`
      DELETE FROM sensor_events WHERE id NOT IN (
        SELECT id FROM sensor_events ORDER BY id DESC LIMIT ${RETENTION_MAX_SENSOR_EVENTS}
      );
      DELETE FROM alert_events WHERE id NOT IN (
        SELECT id FROM alert_events ORDER BY id DESC LIMIT ${RETENTION_MAX_ALERTS}
      );
      DELETE FROM connection_events WHERE id NOT IN (
        SELECT id FROM connection_events ORDER BY id DESC LIMIT ${RETENTION_MAX_CONNECTIONS}
      );
      DELETE FROM analysis_events WHERE id NOT IN (
        SELECT id FROM analysis_events ORDER BY id DESC LIMIT ${RETENTION_MAX_ANALYSES}
      );
    `);
  }

  public upsertDevice(params: {
    deviceId: string;
    name: string;
    tokenHash?: string | null;
    capabilities: DeviceCapabilities;
    isSimulator: boolean;
    lastSeenAt?: number | null;
  }): void {
    if (!this.db) return;
    const now = Date.now();
    const existing = this.getDevice(params.deviceId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE devices
           SET name = ?, capabilities_json = ?, last_seen_at = COALESCE(?, last_seen_at),
               token_hash = COALESCE(?, token_hash), is_simulator = ?
           WHERE device_id = ?`
        )
        .run(
          params.name,
          JSON.stringify(params.capabilities),
          params.lastSeenAt ?? null,
          params.tokenHash ?? null,
          params.isSimulator ? 1 : 0,
          params.deviceId
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO devices (device_id, name, token_hash, capabilities_json, registered_at, last_seen_at, is_simulator)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.deviceId,
          params.name,
          params.tokenHash ?? null,
          JSON.stringify(params.capabilities),
          now,
          params.lastSeenAt ?? null,
          params.isSimulator ? 1 : 0
        );
    }
  }

  public getDevice(deviceId: string): StoredDeviceRecord | null {
    if (!this.db) return null;
    const row = this.db
      .prepare('SELECT * FROM devices WHERE device_id = ?')
      .get(deviceId) as any;
    if (!row) return null;
    return {
      deviceId: row.device_id,
      name: row.name,
      tokenHash: row.token_hash || null,
      capabilities: JSON.parse(row.capabilities_json),
      registeredAt: Number(row.registered_at),
      lastSeenAt: row.last_seen_at != null ? Number(row.last_seen_at) : null,
      isSimulator: Boolean(row.is_simulator),
    };
  }

  public listDevices(): RegisteredDeviceSummary[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM devices ORDER BY registered_at ASC').all() as any[];
    return rows.map((row) => ({
      deviceId: row.device_id,
      name: row.name,
      capabilities: JSON.parse(row.capabilities_json),
      registeredAt: Number(row.registered_at),
      lastSeenAt: row.last_seen_at != null ? Number(row.last_seen_at) : null,
      isSimulator: Boolean(row.is_simulator),
    }));
  }

  public insertSensorEvent(params: {
    deviceId: string;
    sourceMode: 'hardware' | 'simulator';
    sequence: number;
    uptimeMs: number | null;
    batteryPercent: number | null;
    forwardDistanceCm: number | null;
    downwardDistanceMm: number | null;
    headPitchDeg: number | null;
    imuJson: string | null;
    createdAt?: number;
  }): number | null {
    if (!this.db) return null;
    const result = this.db
      .prepare(
        `INSERT INTO sensor_events (
          device_id, source_mode, sequence, uptime_ms, battery_percent,
          forward_distance_cm, downward_distance_mm, head_pitch_deg, imu_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.deviceId,
        params.sourceMode,
        params.sequence,
        params.uptimeMs,
        params.batteryPercent,
        params.forwardDistanceCm,
        params.downwardDistanceMm,
        params.headPitchDeg,
        params.imuJson,
        params.createdAt ?? Date.now()
      );
    this.enforceRetentionIfNeeded();
    return Number(result.lastInsertRowid);
  }

  public insertAlertEvent(params: {
    deviceId: string;
    sourceMode: 'hardware' | 'simulator';
    alertType: string;
    severity: 'caution' | 'critical';
    description: string;
    sensorValue?: string | null;
    createdAt?: number;
  }): number | null {
    if (!this.db) return null;
    const result = this.db
      .prepare(
        `INSERT INTO alert_events (device_id, source_mode, alert_type, severity, description, sensor_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.deviceId,
        params.sourceMode,
        params.alertType,
        params.severity,
        params.description,
        params.sensorValue ?? null,
        params.createdAt ?? Date.now()
      );
    this.enforceRetentionIfNeeded();
    return Number(result.lastInsertRowid);
  }

  public insertConnectionEvent(params: {
    deviceId: string;
    sourceMode: 'hardware' | 'simulator';
    eventType: 'connected' | 'disconnected' | 'registered' | 'frame_stale';
    details?: string | null;
    createdAt?: number;
  }): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO connection_events (device_id, source_mode, event_type, details, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        params.deviceId,
        params.sourceMode,
        params.eventType,
        params.details ?? null,
        params.createdAt ?? Date.now()
      );
    this.enforceRetentionIfNeeded();
  }

  public insertAnalysisEvent(params: {
    operation: string;
    mode: string;
    status: 'ok' | 'degraded' | 'error';
    model?: string | null;
    latencyMs?: number | null;
    errorCode?: string | null;
    summary?: string | null;
    frameTimestamp?: number | null;
  }): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO analysis_events (operation, mode, status, model, latency_ms, error_code, summary, frame_timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.operation,
        params.mode,
        params.status,
        params.model ?? null,
        params.latencyMs ?? null,
        params.errorCode ?? null,
        params.summary ?? null,
        params.frameTimestamp ?? null,
        Date.now()
      );
    this.enforceRetentionIfNeeded();
  }

  public querySensorEvents(filters: {
    deviceId?: string;
    fromTs?: number;
    toTs?: number;
    includeSimulated?: boolean;
    limit?: number;
    offset?: number;
  }): { total: number; events: SensorEventRecord[] } {
    if (!this.db) return { total: 0, events: [] };

    const clauses: string[] = [];
    const args: any[] = [];
    if (filters.deviceId) {
      clauses.push('device_id = ?');
      args.push(filters.deviceId);
    }
    if (filters.fromTs) {
      clauses.push('created_at >= ?');
      args.push(filters.fromTs);
    }
    if (filters.toTs) {
      clauses.push('created_at <= ?');
      args.push(filters.toTs);
    }
    if (!filters.includeSimulated) {
      clauses.push("source_mode = 'hardware'");
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(500, Math.max(1, filters.limit ?? 100));
    const offset = Math.max(0, filters.offset ?? 0);

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM sensor_events ${whereSql}`)
      .get(...args) as { cnt: number };

    const rows = this.db
      .prepare(`SELECT * FROM sensor_events ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset) as any[];

    return {
      total: Number(countRow?.cnt || 0),
      events: rows.map((r) => ({
        id: Number(r.id),
        deviceId: r.device_id,
        sourceMode: r.source_mode,
        sequence: Number(r.sequence),
        uptimeMs: r.uptime_ms != null ? Number(r.uptime_ms) : null,
        batteryPercent: r.battery_percent != null ? Number(r.battery_percent) : null,
        forwardDistanceCm: r.forward_distance_cm != null ? Number(r.forward_distance_cm) : null,
        downwardDistanceMm: r.downward_distance_mm != null ? Number(r.downward_distance_mm) : null,
        headPitchDeg: r.head_pitch_deg != null ? Number(r.head_pitch_deg) : null,
        imuJson: r.imu_json ?? null,
        createdAt: Number(r.created_at),
      })),
    };
  }

  public getAnalyticsSummary(params: {
    deviceId?: string | null;
    range: '1h' | '24h' | '7d' | 'all';
    includeSimulated: boolean;
  }): AnalyticsSummary {
    const now = Date.now();
    const rangeMsMap = {
      '1h': 3600 * 1000,
      '24h': 24 * 3600 * 1000,
      '7d': 7 * 24 * 3600 * 1000,
      all: 0,
    };
    const fromTs = rangeMsMap[params.range] > 0 ? now - rangeMsMap[params.range] : undefined;

    if (!this.db) {
      return {
        ok: false,
        deviceId: params.deviceId ?? null,
        range: params.range,
        includeSimulated: params.includeSimulated,
        totalSensorEvents: 0,
        totalAlerts: 0,
        proximityAlertCount: 0,
        uptimeEstimateMs: 0,
        sessionDurationMs: 0,
        alertsByHour: [],
        sensorHistory: [],
        batteryHistory: [],
        recentAlerts: [],
        connectionHistory: [],
      };
    }

    const buildWhere = (tablePrefix = '') => {
      const clauses: string[] = [];
      const args: any[] = [];
      if (params.deviceId) {
        clauses.push(`${tablePrefix}device_id = ?`);
        args.push(params.deviceId);
      }
      if (fromTs) {
        clauses.push(`${tablePrefix}created_at >= ?`);
        args.push(fromTs);
      }
      if (!params.includeSimulated) {
        clauses.push(`${tablePrefix}source_mode = 'hardware'`);
      }
      return {
        sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
        args,
      };
    };

    const sensorWhere = buildWhere();
    const sensorCountRow = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM sensor_events ${sensorWhere.sql}`)
      .get(...sensorWhere.args) as { cnt: number };

    const sensorRows = this.db
      .prepare(
        `SELECT created_at, forward_distance_cm, downward_distance_mm, battery_percent, source_mode, uptime_ms
         FROM sensor_events ${sensorWhere.sql}
         ORDER BY created_at DESC LIMIT 80`
      )
      .all(...sensorWhere.args) as any[];

    const alertWhere = buildWhere();
    const alertCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN alert_type IN ('obstacle', 'proximity', 'dropoff') THEN 1 ELSE 0 END) AS prox
         FROM alert_events ${alertWhere.sql}`
      )
      .get(...alertWhere.args) as { total: number; prox: number | null };

    const recentAlertRows = this.db
      .prepare(`SELECT * FROM alert_events ${alertWhere.sql} ORDER BY created_at DESC LIMIT 25`)
      .all(...alertWhere.args) as any[];

    const allAlertsInRange = this.db
      .prepare(`SELECT created_at FROM alert_events ${alertWhere.sql} ORDER BY created_at ASC`)
      .all(...alertWhere.args) as Array<{ created_at: number }>;

    const connWhere = buildWhere();
    const connRows = this.db
      .prepare(`SELECT * FROM connection_events ${connWhere.sql} ORDER BY created_at DESC LIMIT 30`)
      .all(...connWhere.args) as any[];

    // Compute real connected session duration & uptime estimate from connection events
    const connAsc = this.db
      .prepare(`SELECT event_type, created_at FROM connection_events ${connWhere.sql} ORDER BY created_at ASC`)
      .all(...connWhere.args) as Array<{ event_type: string; created_at: number }>;

    let uptimeEstimateMs = 0;
    let currentSessionStart: number | null = null;
    for (const ev of connAsc) {
      if (ev.event_type === 'connected') {
        if (currentSessionStart === null) currentSessionStart = Number(ev.created_at);
      } else if (ev.event_type === 'disconnected') {
        if (currentSessionStart !== null) {
          uptimeEstimateMs += Math.max(0, Number(ev.created_at) - currentSessionStart);
          currentSessionStart = null;
        }
      }
    }
    const sessionDurationMs = currentSessionStart !== null ? Math.max(0, now - currentSessionStart) : 0;
    uptimeEstimateMs += sessionDurationMs;

    // Bucket alerts by hour (using real stored alert timestamps)
    const bucketsMap = new Map<number, number>();
    for (const a of allAlertsInRange) {
      const hourTs = Math.floor(Number(a.created_at) / 3600000) * 3600000;
      bucketsMap.set(hourTs, (bucketsMap.get(hourTs) || 0) + 1);
    }
    const alertsByHour = Array.from(bucketsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-24)
      .map(([ts, count]) => ({
        timestamp: ts,
        bucketLabel: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        count,
      }));

    const sensorHistory = sensorRows
      .slice()
      .reverse()
      .map((r) => ({
        timestamp: Number(r.created_at),
        forwardDistanceCm: r.forward_distance_cm != null ? Number(r.forward_distance_cm) : null,
        downwardDistanceMm: r.downward_distance_mm != null ? Number(r.downward_distance_mm) : null,
        batteryPercent: r.battery_percent != null ? Number(r.battery_percent) : null,
        sourceMode: r.source_mode as 'hardware' | 'simulator',
      }));

    const batteryHistory = sensorHistory
      .filter((s): s is typeof s & { batteryPercent: number } => s.batteryPercent !== null)
      .map((s) => ({
        timestamp: s.timestamp,
        batteryPercent: s.batteryPercent,
        sourceMode: s.sourceMode,
      }));

    const recentAlerts: AlertEventRecord[] = recentAlertRows.map((r) => ({
      id: Number(r.id),
      deviceId: r.device_id,
      sourceMode: r.source_mode,
      alertType: r.alert_type,
      severity: r.severity,
      description: r.description,
      sensorValue: r.sensor_value ?? null,
      acknowledged: Boolean(r.acknowledged),
      createdAt: Number(r.created_at),
    }));

    const connectionHistory: ConnectionEventRecord[] = connRows.map((r) => ({
      id: Number(r.id),
      deviceId: r.device_id,
      sourceMode: r.source_mode,
      eventType: r.event_type,
      details: r.details ?? null,
      createdAt: Number(r.created_at),
    }));

    return {
      ok: true,
      deviceId: params.deviceId ?? null,
      range: params.range,
      includeSimulated: params.includeSimulated,
      totalSensorEvents: Number(sensorCountRow?.cnt || 0),
      totalAlerts: Number(alertCounts?.total || 0),
      proximityAlertCount: Number(alertCounts?.prox || 0),
      uptimeEstimateMs,
      sessionDurationMs,
      alertsByHour,
      sensorHistory,
      batteryHistory,
      recentAlerts,
      connectionHistory,
    };
  }

  // Contextual Memory Operations (Strictly separated from telemetry)
  public listMemories(): SentraMemoryItem[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM memory_entries ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      note: r.note,
      room: r.room || undefined,
      heading: r.heading != null ? Number(r.heading) : null,
      source: r.source,
      timestamp: Number(r.created_at),
      at: new Date(Number(r.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
  }

  public addMemory(item: SentraMemoryItem): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory_entries (id, label, note, room, heading, source, verified_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.label,
        item.note,
        item.room ?? null,
        item.heading ?? null,
        item.source,
        item.source === 'live_verified' ? item.timestamp : null,
        item.timestamp
      );
  }

  public deleteMemory(id: string): boolean {
    if (!this.db) return false;
    const res = this.db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  public clearMemories(): void {
    if (!this.db) return;
    this.db.exec('DELETE FROM memory_entries;');
  }

  public exportAllData(): Record<string, unknown> {
    if (!this.db) return { available: false };
    return {
      exportedAt: new Date().toISOString(),
      devices: this.listDevices(),
      memories: this.listMemories(),
      sensorEvents: this.db.prepare('SELECT * FROM sensor_events ORDER BY created_at DESC LIMIT 1000').all(),
      alertEvents: this.db.prepare('SELECT * FROM alert_events ORDER BY created_at DESC LIMIT 1000').all(),
      connectionEvents: this.db.prepare('SELECT * FROM connection_events ORDER BY created_at DESC LIMIT 1000').all(),
      analysisEvents: this.db.prepare('SELECT * FROM analysis_events ORDER BY created_at DESC LIMIT 500').all(),
    };
  }

  public clearTelemetryEvents(): void {
    if (!this.db) return;
    this.db.exec(`
      DELETE FROM sensor_events;
      DELETE FROM alert_events;
      DELETE FROM connection_events;
      DELETE FROM analysis_events;
    `);
  }
}
