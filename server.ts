import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDatabase, queryAll, queryOne } from './src/server/database/db';
import {
  initGenesisBlock,
  getBlocks,
  getBlockByHeight,
  getBlockByHash,
  getLatestBlock,
  getCurrentDifficulty,
  difficultyToTarget,
  getTotalBlocksCount,
} from './src/server/blockchain/chain';
import { generateMiningJob, submitPoWBlock, authenticateMinerToken } from './src/server/mining/jobManager';
import {
  registerHandler,
  loginHandler,
  getMeHandler,
  getBalanceHandler,
  regenerateMinerTokenHandler,
  requireAuth,
  requireAdmin,
  AuthUser,
} from './src/server/auth/authController';
import {
  createWithdrawalHandler,
  getUserWithdrawalsHandler,
  getWithdrawalByIdHandler,
} from './src/server/withdrawals/withdrawalController';
import {
  getAdminStatsHandler,
  getAdminUsersHandler,
  toggleUserStatusHandler,
  getAdminMinersHandler,
  getAdminWithdrawalsHandler,
  approveWithdrawalHandler,
  payWithdrawalHandler,
  rejectWithdrawalHandler,
  updateSettingsHandler,
  validateChainHandler,
  getAuditLogsHandler,
  getMiningLogsHandler,
} from './src/server/admin/adminController';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[API] ${req.method} ${req.path} from ${ip}`);
  }
  next();
});

// ==========================================
// 1. AUTHENTICATION APIs
// ==========================================
app.post('/api/auth/register', registerHandler);
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', (req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully.' });
});
app.get('/api/me', requireAuth, getMeHandler);
app.get('/api/balance', requireAuth, getBalanceHandler);
app.post('/api/miner/token/regenerate', requireAuth, regenerateMinerTokenHandler);

// ==========================================
// 2. MINING APIs (For ESP32-S3 & Miners)
// ==========================================

/**
 * GET /api/miner/job
 * Returns next Proof-of-Work job with current difficulty and target
 */
app.get('/api/miner/job', (req: Request, res: Response) => {
  try {
    const job = generateMiningJob();
    res.json(job);
  } catch (err: any) {
    console.error('[MINER API] Error generating job:', err);
    res.status(500).json({ error: 'Failed to generate mining job' });
  }
});

/**
 * POST /api/miner/submit
 * ESP32-S3 submits mined block with nonce and SHA-256 hash
 * Server strictly verifies PoW before accepting!
 */
app.post('/api/miner/submit', (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') as string;
  const result = submitPoWBlock(req.body, ip);

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * GET /api/miner/status
 * Returns current miner status for given miner_token
 */
app.get('/api/miner/status', (req: Request, res: Response) => {
  const minerToken = (req.query.miner_token as string) || (req.headers['x-miner-token'] as string);
  if (!minerToken) {
    res.status(400).json({ error: 'miner_token query parameter or header is required' });
    return;
  }

  const user = authenticateMinerToken(minerToken);
  if (!user) {
    res.status(401).json({ error: 'Invalid miner token' });
    return;
  }

  const minerRecord = queryOne('SELECT * FROM miners WHERE miner_token = ?', [minerToken]);
  const userSubmissions = queryAll(
    'SELECT status, count(*) as count FROM mining_submissions WHERE miner_token = ? GROUP BY status',
    [minerToken]
  );

  let accepted = 0;
  let rejected = 0;
  for (const s of userSubmissions) {
    if (s.status === 'accepted') accepted = s.count;
    if (s.status === 'rejected') rejected = s.count;
  }

  res.json({
    miner_token: minerToken,
    user: {
      username: user.username,
      balance_s3: user.balance_s3,
      total_mined: user.total_mined,
    },
    accepted,
    rejected,
    device: minerRecord || { status: 'unregistered_device' },
  });
});

/**
 * GET /api/miner/history
 * Returns mining submissions history for user
 */
app.get('/api/miner/history', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  const limit = parseInt(req.query.limit as string, 10) || 50;

  const history = queryAll(
    `SELECT id, job_id, height, nonce, hash, status, reason, reward, submitted_at 
     FROM mining_submissions 
     WHERE miner_user_id = ? 
     ORDER BY id DESC LIMIT ?`,
    [user.id, limit]
  );

  res.json({ history });
});

// ==========================================
// 3. BLOCKCHAIN & EXPLORER APIs
// ==========================================

/**
 * GET /api/blockchain/stats
 * Overview of blockchain state
 */
app.get('/api/blockchain/stats', (req: Request, res: Response) => {
  const tip = getLatestBlock();
  const currentDiff = getCurrentDifficulty();
  const currentTarget = difficultyToTarget(currentDiff);
  const totalBlocks = getTotalBlocksCount();

  const totalMinersCount = queryOne<{ count: number }>(
    'SELECT COUNT(DISTINCT miner_user_id) as count FROM blocks WHERE height > 0'
  )?.count || 0;

  const activeMinersCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM miners WHERE last_seen > ?',
    [Math.floor(Date.now() / 1000) - 300]
  )?.count || 0;

  const setting = queryOne('SELECT value FROM system_settings WHERE key = ?', ['exchange_rate']);
  const exchangeRate = setting ? parseFloat(setting.value) : 0.1;

  res.json({
    ticker: 'S3',
    name: 'S3Coin',
    chain_tip: tip.height,
    latest_block_hash: tip.hash,
    current_difficulty: currentDiff,
    current_target: currentTarget,
    total_blocks: totalBlocks,
    active_miners: activeMinersCount,
    unique_miners: totalMinersCount,
    exchange_rate: exchangeRate,
    block_target_time: 120,
  });
});

/**
 * GET /api/blocks
 * Paginated blocks for Block Explorer
 */
app.get('/api/blocks', (req: Request, res: Response) => {
  const limit = Math.min(100, parseInt(req.query.limit as string, 10) || 20);
  const offset = parseInt(req.query.offset as string, 10) || 0;

  const blocks = getBlocks(limit, offset);
  const total = getTotalBlocksCount();

  // Map miner names for explorer view
  const enriched = blocks.map((b) => {
    const user = queryOne<{ username: string }>('SELECT username FROM users WHERE id = ?', [b.miner_user_id]);
    return {
      ...b,
      miner_username: user ? user.username : (b.height === 0 ? 'Genesis' : 'Unknown'),
    };
  });

  res.json({
    blocks: enriched,
    total,
    limit,
    offset,
  });
});

/**
 * GET /api/blocks/:identifier
 * Retrieve block by height or 64-char hash
 */
app.get('/api/blocks/:identifier', (req: Request, res: Response) => {
  const id = req.params.identifier;
  let block;

  if (/^\d+$/.test(id)) {
    block = getBlockByHeight(parseInt(id, 10));
  } else if (/^[a-fA-F0-9]{64}$/.test(id)) {
    block = getBlockByHash(id.toLowerCase());
  }

  if (!block) {
    res.status(404).json({ error: 'Block not found.' });
    return;
  }

  const miner = queryOne<{ username: string }>('SELECT username FROM users WHERE id = ?', [block.miner_user_id]);

  res.json({
    block: {
      ...block,
      miner_username: miner ? miner.username : (block.height === 0 ? 'Genesis' : 'Unknown'),
    },
  });
});

// ==========================================
// 4. WITHDRAWALS APIs
// ==========================================
app.post('/api/withdrawals', requireAuth, createWithdrawalHandler);
app.get('/api/withdrawals', requireAuth, getUserWithdrawalsHandler);
app.get('/api/withdrawals/:id', requireAuth, getWithdrawalByIdHandler);

// ==========================================
// 5. ADMIN APIs
// ==========================================
app.get('/api/admin/stats', requireAuth, requireAdmin, getAdminStatsHandler);
app.get('/api/admin/users', requireAuth, requireAdmin, getAdminUsersHandler);
app.post('/api/admin/users/:id/status', requireAuth, requireAdmin, toggleUserStatusHandler);
app.get('/api/admin/miners', requireAuth, requireAdmin, getAdminMinersHandler);
app.get('/api/admin/withdrawals', requireAuth, requireAdmin, getAdminWithdrawalsHandler);
app.post('/api/admin/withdrawals/:id/approve', requireAuth, requireAdmin, approveWithdrawalHandler);
app.post('/api/admin/withdrawals/:id/pay', requireAuth, requireAdmin, payWithdrawalHandler);
app.post('/api/admin/withdrawals/:id/reject', requireAuth, requireAdmin, rejectWithdrawalHandler);
app.post('/api/admin/settings', requireAuth, requireAdmin, updateSettingsHandler);
app.post('/api/admin/validate-chain', requireAuth, requireAdmin, validateChainHandler);
app.get('/api/admin/audit-logs', requireAuth, requireAdmin, getAuditLogsHandler);
app.get('/api/admin/mining-logs', requireAuth, requireAdmin, getMiningLogsHandler);

// ==========================================
// 6. INITIALIZE DB & START SERVER
// ==========================================
async function start() {
  try {
    console.log('[S3COIN] Booting S3Coin Node...');
    await initDatabase();
    initGenesisBlock();

    // Vite middleware for dev mode
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[S3COIN] S3Coin server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('[S3COIN] Fatal error during startup:', err);
    process.exit(1);
  }
}

start();
