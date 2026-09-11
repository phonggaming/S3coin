import { Request, Response } from 'express';
import { queryAll, queryOne, runQuery, runTransaction } from '../database/db';
import { AuthUser } from '../auth/authController';

export interface Withdrawal {
  id: number;
  user_id: number;
  amount_s3: number;
  amount_vnd: number;
  exchange_rate: number;
  method: string;
  destination: string;
  status: string; // PENDING, APPROVED, REJECTED, PAID
  admin_note: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Creates a new withdrawal request with atomic balance locking
 */
export function createWithdrawalHandler(req: Request, res: Response): void {
  const user = (req as any).user as AuthUser;
  const { amount_s3, method, destination } = req.body;

  const numS3 = parseFloat(amount_s3);
  if (isNaN(numS3) || numS3 <= 0) {
    res.status(400).json({ error: 'Invalid S3 withdrawal amount.' });
    return;
  }

  const validMethods = ['BANK', 'MOMO', 'ZALOPAY'];
  const cleanMethod = String(method || '').toUpperCase().trim();
  if (!validMethods.includes(cleanMethod)) {
    res.status(400).json({ error: `Invalid payment method. Must be one of: ${validMethods.join(', ')}` });
    return;
  }

  const cleanDestination = String(destination || '').trim();
  if (!cleanDestination || cleanDestination.length < 5) {
    res.status(400).json({ error: 'Destination account/phone number is required (min 5 chars).' });
    return;
  }

  // Fetch exchange rate & min withdraw setting
  const rateSetting = queryOne('SELECT value FROM system_settings WHERE key = ?', ['exchange_rate']);
  const minVndSetting = queryOne('SELECT value FROM system_settings WHERE key = ?', ['min_withdraw_vnd']);

  const exchangeRate = rateSetting ? parseFloat(rateSetting.value) : 0.1;
  const minVnd = minVndSetting ? parseFloat(minVndSetting.value) : 100000;
  const amountVnd = Math.floor(numS3 * exchangeRate);

  if (amountVnd < minVnd) {
    res.status(400).json({
      error: `Minimum withdrawal is ${minVnd.toLocaleString()} VND (requires at least ${(minVnd / exchangeRate).toLocaleString()} S3). You requested ${amountVnd.toLocaleString()} VND.`,
    });
    return;
  }

  // Atomic check and lock balance
  try {
    const withdrawal = runTransaction(() => {
      // Re-query user balance inside transaction for consistency
      const freshUser = queryOne<{ balance_s3: number }>('SELECT balance_s3 FROM users WHERE id = ?', [user.id]);
      if (!freshUser || freshUser.balance_s3 < numS3) {
        throw new Error(`Insufficient S3 balance. Available: ${freshUser?.balance_s3 || 0} S3, requested: ${numS3} S3`);
      }

      const now = Date.now();

      // 1. Lock/deduct S3 balance from user
      runQuery('UPDATE users SET balance_s3 = balance_s3 - ? WHERE id = ?', [numS3, user.id]);

      // 2. Insert withdrawal record
      runQuery(
        `INSERT INTO withdrawals (
          user_id, amount_s3, amount_vnd, exchange_rate, method, destination, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        [user.id, numS3, amountVnd, exchangeRate, cleanMethod, cleanDestination, now, now]
      );

      const created = queryOne<Withdrawal>(
        'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [user.id]
      );

      // 3. Log audit
      runQuery(
        'INSERT INTO audit_logs (action, actor, details, timestamp) VALUES (?, ?, ?, ?)',
        [
          'WITHDRAWAL_REQUESTED',
          user.username,
          JSON.stringify({ withdrawalId: created?.id, amount_s3: numS3, amount_vnd: amountVnd, method: cleanMethod }),
          now,
        ]
      );

      return created;
    });

    console.log(`[WITHDRAWAL] User ${user.username} requested withdrawal #${withdrawal?.id} for ${numS3} S3 (${amountVnd} VND)`);

    res.status(201).json({
      message: 'Withdrawal request created successfully. Funds have been reserved pending review.',
      withdrawal,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to process withdrawal request.' });
  }
}

/**
 * List withdrawals for current user
 */
export function getUserWithdrawalsHandler(req: Request, res: Response): void {
  const user = (req as any).user as AuthUser;
  const withdrawals = queryAll<Withdrawal>(
    'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC',
    [user.id]
  );
  res.json({ withdrawals });
}

/**
 * Get withdrawal details by id
 */
export function getWithdrawalByIdHandler(req: Request, res: Response): void {
  const user = (req as any).user as AuthUser;
  const id = parseInt(req.params.id, 10);

  const withdrawal = queryOne<Withdrawal>(
    'SELECT * FROM withdrawals WHERE id = ? AND (user_id = ? OR ? = 1)',
    [id, user.id, user.is_admin]
  );

  if (!withdrawal) {
    res.status(404).json({ error: 'Withdrawal request not found.' });
    return;
  }

  res.json({ withdrawal });
}
