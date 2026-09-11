import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database } from 'sql.js';

function getSafeDirname(): string {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  try {
    // In ESM environments
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  return process.cwd();
}

let dbInstance: Database | null = null;

// Determine writable directory for SQLite database
function getWritableDbDir(): string {
  if (process.env.DATABASE_DIR) return process.env.DATABASE_DIR;
  if (process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return '/tmp';
  }
  const localDir = path.join(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const testFile = path.join(localDir, '.write_test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return localDir;
  } catch {
    return '/tmp';
  }
}

function resolveDbPath(): string {
  if (process.env.DATABASE_PATH) {
    // If running in serverless / Vercel with read-only root, redirect to /tmp
    if (process.env.VERCEL || process.env.NOW_REGION) {
      return path.join('/tmp', path.basename(process.env.DATABASE_PATH));
    }
    return path.resolve(process.env.DATABASE_PATH);
  }
  return path.join(getWritableDbDir(), 's3coin.sqlite');
}

const DB_PATH = resolveDbPath();
const BACKUP_JSON_PATH = path.join(path.dirname(DB_PATH), 's3coin_backup.json');

// Helper to ensure directory exists safely
function ensureDirExists(filePath: string) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[DB] Could not ensure directory for ${filePath}:`, err);
  }
}

let inTransaction = false;

// Persist the database to disk
export function saveDatabase(): void {
  if (!dbInstance || inTransaction) return;
  try {
    ensureDirExists(DB_PATH);
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);

    // Also export a readable JSON snapshot fallback
    try {
      const users = queryAll('SELECT * FROM users');
      const blocks = queryAll('SELECT * FROM blocks ORDER BY height ASC');
      const withdrawals = queryAll('SELECT * FROM withdrawals');
      const settings = queryAll('SELECT * FROM system_settings');
      const snapshot = { users, blocks, withdrawals, settings, exported_at: Date.now() };
      fs.writeFileSync(BACKUP_JSON_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch {
      // JSON snapshot is best-effort
    }
  } catch (err) {
    console.error('[DB] Error saving database to disk:', err);
  }
}

// Initialize SQLite database
export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  ensureDirExists(DB_PATH);

  let SQL: any;
  try {
    const dir = getSafeDirname();
    const possibleWasmPaths = [
      path.join(process.cwd(), 'public', 'sql-wasm.wasm'),
      path.join(process.cwd(), 'dist', 'sql-wasm.wasm'),
      path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
      path.resolve(dir, 'sql-wasm.wasm'),
      path.resolve(dir, '..', 'public', 'sql-wasm.wasm'),
      path.resolve(dir, '..', 'dist', 'sql-wasm.wasm'),
      path.resolve(dir, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    ];

    let wasmBinary: Buffer | undefined;
    let resolvedWasmPath: string | undefined;

    for (const p of possibleWasmPaths) {
      if (fs.existsSync(p)) {
        try {
          wasmBinary = fs.readFileSync(p);
          resolvedWasmPath = p;
          break;
        } catch {}
      }
    }

    SQL = await initSqlJs({
      ...(wasmBinary ? { wasmBinary } : {}),
      locateFile: (file: string) => {
        if (file.endsWith('.wasm') && resolvedWasmPath) {
          return resolvedWasmPath;
        }
        return file;
      },
    });
  } catch (wasmErr) {
    console.warn('[DB] Custom wasm loader failed, falling back to default initSqlJs:', wasmErr);
    SQL = await initSqlJs();
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_PATH);
      dbInstance = new SQL.Database(fileBuffer);
      console.log(`[DB] Successfully loaded existing SQLite database from ${DB_PATH}`);
    } catch (err) {
      console.warn(`[DB] Could not load ${DB_PATH}, creating fresh database:`, err);
      dbInstance = new SQL.Database();
    }
  } else {
    console.log(`[DB] Creating fresh SQLite database at ${DB_PATH}`);
    dbInstance = new SQL.Database();
  }

  // Create tables with constraints and indexes
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      miner_token TEXT UNIQUE NOT NULL,
      balance_s3 REAL NOT NULL DEFAULT 0,
      total_mined REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_login INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS miners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      miner_token TEXT UNIQUE NOT NULL,
      device_name TEXT,
      ip_address TEXT,
      last_seen INTEGER,
      hashrate REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      height INTEGER PRIMARY KEY,
      hash TEXT UNIQUE NOT NULL,
      previous_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      difficulty INTEGER NOT NULL,
      target TEXT NOT NULL,
      miner_user_id INTEGER NOT NULL,
      miner_token TEXT NOT NULL,
      merkle_root TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      reward REAL NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mining_jobs (
      job_id TEXT PRIMARY KEY,
      height INTEGER NOT NULL,
      previous_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      difficulty INTEGER NOT NULL,
      target TEXT NOT NULL,
      version INTEGER NOT NULL,
      merkle_root TEXT NOT NULL,
      reward REAL NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS mining_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      height INTEGER NOT NULL,
      miner_user_id INTEGER NOT NULL,
      miner_token TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      hash TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      reward REAL DEFAULT 0,
      submitted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_s3 REAL NOT NULL,
      amount_vnd REAL NOT NULL,
      exchange_rate REAL NOT NULL,
      method TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
    CREATE INDEX IF NOT EXISTS idx_blocks_miner ON blocks(miner_user_id);
    CREATE INDEX IF NOT EXISTS idx_users_miner_token ON users(miner_token);
    CREATE INDEX IF NOT EXISTS idx_jobs_height ON mining_jobs(height);
    CREATE INDEX IF NOT EXISTS idx_submissions_miner ON mining_submissions(miner_user_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
  `);

  // Initialize default system settings if not present
  const now = Date.now();
  const defaultSettings: Record<string, string> = {
    exchange_rate: process.env.S3_EXCHANGE_RATE || '0.1',
    min_withdraw_vnd: process.env.MIN_WITHDRAW_VND || '100000',
    block_target_time: process.env.BLOCK_TARGET_TIME || '120',
    initial_reward: process.env.INITIAL_BLOCK_REWARD || '50',
    halving_interval: process.env.HALVING_INTERVAL || '1000',
    current_difficulty: '1',
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    const existing = queryOne('SELECT value FROM system_settings WHERE key = ?', [key]);
    if (!existing) {
      runQuery('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)', [key, value, now]);
    }
  }

  saveDatabase();
  return dbInstance;
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized! Call initDatabase() first.');
  }
  return dbInstance;
}

// Query helper returning array of objects
export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

// Query helper returning single object
export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const all = queryAll<T>(sql, params);
  return all.length > 0 ? all[0] : null;
}

// Execute an INSERT/UPDATE/DELETE query
export function runQuery(sql: string, params: any[] = []): { changes: number } {
  const db = getDb();
  db.run(sql, params);
  saveDatabase();
  return { changes: db.getRowsModified() };
}

// Execute a series of statements atomically inside a transaction
export function runTransaction<T>(callback: () => T): T {
  const db = getDb();
  if (inTransaction) {
    return callback();
  }

  inTransaction = true;
  db.run('BEGIN TRANSACTION;');
  try {
    const result = callback();
    db.run('COMMIT;');
    inTransaction = false;
    saveDatabase();
    return result;
  } catch (error) {
    console.error('[DB Transaction Error]', error);
    try {
      db.run('ROLLBACK;');
    } catch {
      // Ignore rollback failure if transaction already aborted
    }
    inTransaction = false;
    throw error;
  }
}
