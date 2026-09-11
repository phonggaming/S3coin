import { Request, Response } from 'express';
import { queryAll, queryOne, runQuery, runTransaction } from '../database/db';
import { AuthUser } from '../auth/authController';
import { validateBlockchain, getCurrentDifficulty, difficultyToTarget } from '../blockchain/chain';

/**
 * Get overall system stats for admin dashboard
 */
export function getAdminStatsHandler(req: Request, res: Response): void {
  const usersCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users')?.count || 0;
  const blocksCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM blocks')?.count || 0;
  const minersCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM miners')?.count || 0;
  const activeMinersCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM miners WHERE last_seen > ?',
    [Math.floor(Date.now() / 1000) - 300]
  )?.count || 0;

  const totalMinedRow = queryOne<{ total: number }>('SELECT SUM(reward) as total FROM blocks');
  const totalMined = totalMinedRow?.total || 0;

  const totalUserBalanceRow = queryOne<{ total: number }>('SELECT SUM(balance_s3) as total FROM users');
  const totalUserBalance = totalUserBalanceRow?.total || 0;

  const pendingWithdrawalsRow = queryOne<{ count: number; total_s3: number }>(
    "SELECT COUNT(*) as count, SUM(amount_s3) as total_s3 FROM withdrawals WHERE status = 'PENDING'"
  );

  const settings = queryAll('SELECT key, value FROM system_settings');
  const settingsMap: Record<string, string> = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  const currentDiff = getCurrentDifficulty();
  const target = difficultyToTarget(currentDiff);

  res.json({
    usersCount,
    blocksCount,
    minersCount,
    activeMinersCount,
    totalMined,
    totalUserBalance,
    pendingWithdrawals: {
      count: pendingWithdrawalsRow?.count || 0,
      total_s3: pendingWithdrawalsRow?.total_s3 || 0,
    },
    currentDifficulty: currentDiff,
    currentTarget: target,
    settings: settingsMap,
  });
}

/**
 * Get all users
 */
export function getAdminUsersHandler(req: Request, res: Response): void {
  const users = queryAll(
    'SELECT id, username, email, miner_token, balance_s3, total_mined, created_at, last_login, status, is_admin FROM users ORDER BY id DESC'
  );
  res.json({ users });
}

/**
 * Toggle user status (active / banned)
 */
export function toggleUserStatusHandler(req: Request, res: Response): void {
  const admin = (req as any).user as AuthUser;
  const userId = parseInt(req.params.id, 10);
  const { status } = req.body;

  if (userId === admin.id) {
    res.status(400).json({ error: 'Cannot ban your own admin account.' });
    return;
  }

  const validStatuses = ['active', 'banned'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status. Must be active or banned.' });
    return;
  }

  runQuery('UPDATE users SET status = ? WHERE id = ?', [status, userId]);

  runQuery(
    'INSERT INTO audit_logs (action, actor, details, timestamp) VALUES (?, ?, ?, ?)',
    ['USER_STATUS_CHANGED', admin.username, JSON.stringify({ userId, newStatus: status }), Date.now()]
  );

  res.json({ message: `User status changed to ${status}.` });
}

/**
 * Get all connected miner devices
 */
export function getAdminMinersHandler(req: Request, res: Response): void {
  const miners = queryAll(`
    SELECT m.*, u.username, u.email 
    FROM miners m
    JOIN users u ON m.user_id = u.id
    ORDER BY m.last_seen DESC
  `);
  res.json({ miners });
}

/**
 * Get all withdrawals
 */
export function getAdminWithdrawalsHandler(req: Request, res: Response): void {
  const statusFilter = req.query.status as string;
  let sql = `
    SELECT w.*, u.username, u.email 
    FROM withdrawals w
    JOIN users u ON w.user_id = u.id
  `;
  const params: any[] = [];
  if (statusFilter && statusFilter !== 'ALL') {
    sql += ' WHERE w.status = ?';
    params.push(statusFilter);
  }
  sql += ' ORDER BY w.id DESC';

  const withdrawals = queryAll(sql, params);
  res.json({ withdrawals });
}

/**
 * Approve a pending withdrawal
 */
export function approveWithdrawalHandler(req: Request, res: Response): void {
  const admin = (req as any).user as AuthUser;
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;

  const w = queryOne('SELECT * FROM withdrawals WHERE id = ?', [id]);
  if (!w) {
    res.status(404).json({ error: 'Withdrawal not found.' });
    return;
  }

  if (w.status !== 'PENDING') {
    res.status(400).json({ error: `Cannot approve withdrawal with status: ${w.status}` });
    return;
  }

  const now = Date.now();
  runQuery(
    "UPDATE withdrawals SET status = 'APPROVED', admin_note = ?, updated_at = ? WHERE id = ?",
    [note || 'Approved by admin', now, id]
  );

  runQuery(
    'INSERT INTO audit_logs (action, actor, details, timestamp) VALUES (?, ?, ?, ?)',
    ['WITHDRAWAL_APPROVED', admin.username, JSON.stringify({ withdrawalId: id, note }), now]
  );

  res.json({ message: 'Withdrawal request approved.' });
}

/**
 * Mark an approved or pending withdrawal as PAID
 */
export function payWithdrawalHandler(req: Request, res: Response): void {
  const admin = (req as any).user as AuthUser;
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;

  const w = queryOne('SELECT * FROM withdrawals WHERE id = ?', [id]);
  if (!w) {
    res.status(404).json({ error: 'Withdrawal not found.' });
    return;
  }

  if (w.status !== 'PENDING' && w.status !== 'APPROVED') {
    res.status(400).json({ error: `Cannot mark as paid withdrawal with status: ${w.status}` });
    return;
  }

  const now = Date.now();
  runQuery(
    "UPDATE withdrawals SET status = 'PAID', admin_note = ?, updated_at = ? WHERE id = ?",
    [note || 'Payout sent to user account', now, id]
  );

  runQuery(
    'INSERT INTO audit_logs (action, actor, details, timestamp) VALUES (?, ?, ?, ?)',
    ['WITHDRAWAL_PAID', admin.username, JSON.stringify({ withdrawalId: id, note }), now]
  );

  res.json({ message: 'Withdrawal marked as PAID.' });
}

/**
 * Reject a withdrawal and REFUND held S3 back to user
 */
export function rejectWithdrawalHandler(req: Request, res: Response): void {
  const admin = (req as any).user as AuthUser;
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;

  try {
    runTransaction(() => {
      const w = queryOne<{ user_id: number; amount_s3: number; status: string }>(
        'SELECT * FROM withdrawals WHERE id = ?',
        [id]
      );
      if (!w) {
        throw new Error('Withdrawal not found.');
      }

      if (w.status !== 'PENDING' && w.status !== 'APPROVED') {
        throw new Error(`Cannot reject withdrawal with status: ${w.status}`);
      }

      const now = Date.now();

      // 1. Update withdrawal status
      runQuery(
        "UPDATE withdrawals SET status = 'REJECTED', admin_note = ?, updated_at = ? WHERE id = ?",
        [note || 'Rejected by admin. S3 balance refunded.', now, id]
      );

      // 2. REFUND held S3 coins back to the user balance!
      runQuery('UPDATE users SET balance_s3 = balance_s3 + ? WHERE id = ?', [w.amount_s3, w.user_id]);

      // 3. Audit log
      runQuery(
        'INSERT INTO audit_logs (action, actor, details, timestamp) VALUES (?, ?, ?, ?)',
        [
          'WITHDRAWAL_REJECTED_REFUNDED',
          admin.username,
          JSON.stringify({ withdrawalId: id, refunded_s3: w.amount_s3, note }),
          now,
        ]
      );
    });

    res.json({ message: 'Withdrawal rejected and S3 balance successfully refunded to user.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to reject withdrawal.' });
  }
}

/**
 * Update system settings (exchange rate, difficulty, etc.)
 */
export function updateSettingsHandler(req: Request, res: Response): void {
  const admin = (req as any).user as AuthUser;
  const { exchange_rate, min_withdraw_vnd, block_target_time, initial_reward, halving_interval, current_difficulty } = req.body;
  const now = Date.now();

  const updates: Record<string, string> = {};
  if (exchange_rate !== undefined) updates['exchange_rate'] = String(parseFloat(exchange_rate));
  if (min_withdraw_vnd !== undefined) updates['min_withdraw_vnd'] = String(parseFloat(min_withdraw_vnd));
  if (block_target_time !== undefined) updates['block_target_time'] = String(parseInt(block_target_time, 10));
  if (initial_reward !== undefined) updates['initial_reward'] = String(parseFloat(initial_reward));
  if (halving_interval !== undefined) updates['halving_interval'] = String(parseInt(halving_interval, 10));
  if (current_difficulty !== undefined) updates['current_difficulty'] = String(Math.max(1, parseInt(current_difficulty, 10)));

  for (const [key, value] of Object.entries(updates)) {
    runQuery(
      'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [key, value, now]
    );
  }

  runQuery(
    'INSERT INTO audit_logs (action, actor, details, timestamp) VALUES (?, ?, ?, ?)',
    ['SETTINGS_UPDATED', admin.username, JSON.stringify(updates), now]
  );

  res.json({ message: 'System settings updated successfully.', updates });
}

/**
 * Validate the entire blockchain
 */
export function validateChainHandler(req: Request, res: Response): void {
  const result = validateBlockchain();
  res.json(result);
}

/**
 * Get audit logs
 */
export function getAuditLogsHandler(req: Request, res: Response): void {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const logs = queryAll('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
  res.json({ logs });
}

/**
 * Get all mining submissions logs
 */
export function getMiningLogsHandler(req: Request, res: Response): void {
  const limit = parseInt(req.query.limit as string, 10) || 100;
  const logs = queryAll(`
    SELECT s.*, u.username 
    FROM mining_submissions s
    LEFT JOIN users u ON s.miner_user_id = u.id
    ORDER BY s.id DESC LIMIT ?
  `, [limit]);
  res.json({ logs });
}
