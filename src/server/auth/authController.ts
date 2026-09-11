import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { queryOne, runQuery } from '../database/db';

const JWT_SECRET = process.env.JWT_SECRET || 's3coin_super_secret_jwt_key_development_only';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  miner_token: string;
  balance_s3: number;
  total_mined: number;
  created_at: number;
  last_login: number | null;
  status: string;
  is_admin: number;
}

export function generateMinerToken(): string {
  // 64-character secure random hex token
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to authenticate requests using JWT Bearer token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing or invalid Bearer token.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string };
    const user = queryOne<AuthUser>(
      'SELECT id, username, email, miner_token, balance_s3, total_mined, created_at, last_login, status, is_admin FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!user) {
      res.status(401).json({ error: 'User no longer exists.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'User account is suspended.' });
      return;
    }

    (req as any).user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Middleware for Admin only
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as AuthUser | undefined;
  if (!user || !user.is_admin) {
    res.status(403).json({ error: 'Forbidden: Admin access required.' });
    return;
  }
  next();
}

/**
 * Register a new user
 * STRICT: Initial balance is strictly 0.0 S3!
 */
export async function registerHandler(req: Request, res: Response): Promise<void> {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }
    const { username, email, password } = body || {};

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required.' });
      return;
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanUsername.length < 3 || cleanUsername.length > 32) {
      res.status(400).json({ error: 'Username must be between 3 and 32 characters.' });
      return;
    }

    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
      res.status(400).json({ error: 'Username contains invalid characters. Use letters, numbers, hyphens, and underscores.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    // Check unique username and email
    const existingUser = queryOne<AuthUser>(
      'SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE',
      [cleanUsername, cleanEmail]
    );
    if (existingUser) {
      const isSameEmail = existingUser.email?.toLowerCase() === cleanEmail;
      res.status(409).json({ error: isSameEmail ? 'Email is already registered.' : 'Username is already registered.' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const minerToken = generateMinerToken();
    const now = Date.now();

    // If first user, make admin automatically for convenience
    const usersCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const isAdmin = (usersCount && usersCount.count === 0) ? 1 : 0;

    // STRICT: balance_s3 = 0, total_mined = 0
    runQuery(
      `INSERT INTO users (
        username, email, password_hash, miner_token, balance_s3, total_mined, created_at, last_login, status, is_admin
      ) VALUES (?, ?, ?, ?, 0.0, 0.0, ?, ?, 'active', ?)`,
      [cleanUsername, cleanEmail, passwordHash, minerToken, now, now, isAdmin]
    );

    const newUser = queryOne<AuthUser>(
      'SELECT id, username, email, miner_token, balance_s3, total_mined, created_at, last_login, status, is_admin FROM users WHERE username = ? COLLATE NOCASE',
      [cleanUsername]
    );

    if (!newUser) {
      res.status(500).json({ error: 'Failed to create user account. Please try again.' });
      return;
    }

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, is_admin: newUser.is_admin },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`[AUTH] Registered new user: ${cleanUsername} (Admin: ${isAdmin ? 'YES' : 'NO'}, Balance: 0 S3)`);

    res.status(201).json({
      message: 'User registered successfully with initial 0 S3 balance.',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        miner_token: newUser.miner_token,
        balance_s3: newUser.balance_s3,
        total_mined: newUser.total_mined,
        is_admin: newUser.is_admin === 1,
      },
    });
  } catch (err: any) {
    console.error('[AUTH REGISTER ERROR]:', err);
    res.status(500).json({ error: err?.message || 'Registration failed due to server error.' });
  }
}

/**
 * Login user
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }
    const { username, password } = body || {};

    if (!username || !password) {
      res.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }

    const cleanIdent = String(username).trim().toLowerCase();
    const user = queryOne<AuthUser & { password_hash: string }>(
      'SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE',
      [cleanIdent, cleanIdent]
    );

    if (!user || !user.password_hash) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'Your account is suspended. Contact administrator.' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const now = Date.now();
    try {
      runQuery('UPDATE users SET last_login = ? WHERE id = ?', [now, user.id]);
    } catch (updateErr) {
      console.warn('[AUTH] Could not update last_login:', updateErr);
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`[AUTH] User logged in: ${user.username}`);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        miner_token: user.miner_token,
        balance_s3: user.balance_s3,
        total_mined: user.total_mined,
        is_admin: user.is_admin === 1,
      },
    });
  } catch (err: any) {
    console.error('[AUTH LOGIN ERROR]:', err);
    res.status(500).json({ error: err?.message || 'Login failed due to server error.' });
  }
}

/**
 * Get profile and balance
 */
export function getMeHandler(req: Request, res: Response): void {
  const user = (req as any).user as AuthUser;
  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      miner_token: user.miner_token,
      balance_s3: user.balance_s3,
      total_mined: user.total_mined,
      created_at: user.created_at,
      status: user.status,
      is_admin: user.is_admin === 1,
    },
  });
}

/**
 * Get balance only
 */
export function getBalanceHandler(req: Request, res: Response): void {
  const user = (req as any).user as AuthUser;
  const setting = queryOne('SELECT value FROM system_settings WHERE key = ?', ['exchange_rate']);
  const exchangeRate = setting ? parseFloat(setting.value) : 0.1;

  res.json({
    balance_s3: user.balance_s3,
    total_mined: user.total_mined,
    exchange_rate: exchangeRate,
    estimated_vnd: Math.floor(user.balance_s3 * exchangeRate),
  });
}

/**
 * Regenerate Miner Token for the authenticated user
 */
export function regenerateMinerTokenHandler(req: Request, res: Response): void {
  const user = (req as any).user as AuthUser;
  const newToken = generateMinerToken();

  runQuery('UPDATE users SET miner_token = ? WHERE id = ?', [newToken, user.id]);

  console.log(`[AUTH] Miner token regenerated for user ${user.username}`);
  res.json({
    message: 'Miner token successfully regenerated. Please update your ESP32 configuration.',
    miner_token: newToken,
  });
}
