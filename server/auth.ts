import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'sentra-default-jwt-secret-key-change-in-production-2026';
const JWT_EXPIRES_IN = '7d';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    return payload;
  } catch {
    return null;
  }
}

// Authentication Middleware
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(403).json({ error: 'Invalid or expired authentication token.' });
  }

  // Ensure user still exists in database
  const userRecord = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(user.id) as AuthUser | undefined;
  if (!userRecord) {
    return res.status(401).json({ error: 'User no longer exists.' });
  }

  req.user = userRecord;
  next();
}

// Optional Auth Middleware (for endpoints accessible to both guests and logged-in users)
export function optionalAuthenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (token) {
    const user = verifyToken(token);
    if (user) {
      const userRecord = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(user.id) as AuthUser | undefined;
      if (userRecord) {
        req.user = userRecord;
      }
    }
  }
  next();
}

// Auth Controller Functions
export async function registerUser(email: string, password: string, name: string) {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !password || !name) {
    throw new Error('Email, password, and name are required.');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = `usr_${crypto.randomUUID()}`;
  const now = Date.now();

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(userId, cleanEmail, passwordHash, name.trim(), now, now);

  // Link default demo wearable to this initial user if available
  const insertDevice = db.prepare(`
    INSERT OR IGNORE INTO devices (id, user_id, device_name, hardware_model, api_key, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const apiKey = `key_${crypto.randomBytes(16).toString('hex')}`;
  insertDevice.run('ESP32-S3-SENTRA-001', userId, 'Primary SENTRA Glasses', 'ESP32-S3-Sense-v2', apiKey, 'online', now);

  const authUser: AuthUser = { id: userId, email: cleanEmail, name: name.trim() };
  const token = generateToken(authUser);

  return { user: authUser, token, deviceApiKey: apiKey };
}

export async function loginUser(email: string, password: string) {
  const cleanEmail = email.toLowerCase().trim();
  const user = db.prepare('SELECT id, email, password_hash, name FROM users WHERE email = ?').get(cleanEmail) as {
    id: string;
    email: string;
    password_hash: string;
    name: string;
  } | undefined;

  if (!user) {
    throw new Error('Invalid email or password.');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error('Invalid email or password.');
  }

  const authUser: AuthUser = { id: user.id, email: user.email, name: user.name };
  const token = generateToken(authUser);

  return { user: authUser, token };
}
