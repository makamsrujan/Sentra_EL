import { Router, Response } from 'express';
import { db } from './db.js';
import {
  registerUser,
  loginUser,
  authenticateToken,
  optionalAuthenticate,
  AuthenticatedRequest,
} from './auth.js';

const router = Router();

// ==========================================
// Authentication Routes
// ==========================================

// Register
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required.' });
    }
    const result = await registerUser(email, password, name);
    res.json({
      ok: true,
      user: result.user,
      token: result.token,
      deviceApiKey: result.deviceApiKey,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || 'Registration failed.' });
  }
});

// Login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const result = await loginUser(email, password);
    res.json({
      ok: true,
      user: result.user,
      token: result.token,
    });
  } catch (err: any) {
    res.status(401).json({ ok: false, error: err.message || 'Invalid credentials.' });
  }
});

// Get Current User Profile (/api/auth/me)
router.get('/auth/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  
  // Also fetch user's registered devices and settings summary
  const devices = db.prepare('SELECT id, device_name, hardware_model, status, last_seen, battery_level FROM devices WHERE user_id = ?').all(user.id);
  const settingsRow = db.prepare('SELECT settings_json FROM user_settings WHERE user_id = ?').get(user.id) as { settings_json: string } | undefined;
  
  res.json({
    ok: true,
    user,
    devices,
    settings: settingsRow ? JSON.parse(settingsRow.settings_json) : null,
  });
});

// Update User Profile
router.put('/auth/profile', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }
    db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), Date.now(), user.id);
    res.json({ ok: true, user: { ...user, name: name.trim() } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// User Settings Sync Routes (Persistent Settings)
// ==========================================

// Get user settings
router.get('/user/settings', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const row = db.prepare('SELECT settings_json FROM user_settings WHERE user_id = ?').get(user.id) as { settings_json: string } | undefined;
    if (!row) {
      return res.json({ ok: true, settings: null });
    }
    res.json({ ok: true, settings: JSON.parse(row.settings_json) });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Save / update user settings
router.post('/user/settings', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const settings = req.body;
    const settingsJson = JSON.stringify(settings);
    const now = Date.now();

    db.prepare(`
      INSERT INTO user_settings (user_id, settings_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = excluded.updated_at
    `).run(user.id, settingsJson, now);

    res.json({ ok: true, saved: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// Contextual Memory Database Routes
// ==========================================

// List user memories (optionally filtered by type)
router.get('/memories', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { type } = req.query;

    let rows;
    if (type) {
      rows = db.prepare('SELECT * FROM contextual_memories WHERE user_id = ? AND type = ? ORDER BY updated_at DESC').all(user.id, String(type));
    } else {
      rows = db.prepare('SELECT * FROM contextual_memories WHERE user_id = ? ORDER BY updated_at DESC').all(user.id);
    }

    const memories = rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      details: r.details,
      tags: r.tags_json ? JSON.parse(r.tags_json) : [],
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ ok: true, memories });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Save or bulk sync memories
router.post('/memories/sync', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { items } = req.body; // array of memory objects
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    const upsertStmt = db.prepare(`
      INSERT INTO contextual_memories (id, user_id, type, title, details, tags_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        details = excluded.details,
        tags_json = excluded.tags_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);

    const runSync = db.transaction((memories: any[]) => {
      for (const item of memories) {
        upsertStmt.run(
          item.id || `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          user.id,
          item.type || 'object',
          item.title || 'Untitled Memory',
          item.details || '',
          JSON.stringify(item.tags || []),
          JSON.stringify(item.metadata || {}),
          item.createdAt || Date.now(),
          item.updatedAt || Date.now()
        );
      }
    });

    runSync(items);

    res.json({ ok: true, count: items.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete memory
router.delete('/memories/:id', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    db.prepare('DELETE FROM contextual_memories WHERE id = ? AND user_id = ?').run(id, user.id);
    res.json({ ok: true, deleted: id });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// Device Management & Telemetry Log
// ==========================================

// Get user's connected devices
router.get('/devices', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const devices = db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
    res.json({ ok: true, devices });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Pair a new device
router.post('/devices/pair', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { deviceId, deviceName, hardwareModel } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const apiKey = `key_${Math.random().toString(36).substring(2)}${Date.now()}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO devices (id, user_id, device_name, hardware_model, api_key, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'online', ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        device_name = excluded.device_name,
        hardware_model = excluded.hardware_model
    `).run(deviceId, user.id, deviceName || 'SENTRA Wearable', hardwareModel || 'ESP32-S3', apiKey, now);

    res.json({ ok: true, deviceId, apiKey });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get historical telemetry logs for wearable diagnostics
router.get('/telemetry/history', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = 50 } = req.query;
    const logs = db.prepare('SELECT * FROM telemetry_logs ORDER BY timestamp DESC LIMIT ?').all(Number(limit));
    res.json({ ok: true, logs });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
