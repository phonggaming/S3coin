import crypto from 'crypto';
import { queryAll, queryOne, runQuery, runTransaction } from '../database/db';
import {
  BLOCK_VERSION,
  calculateHeaderHash,
  calculateReward,
  checkAndAdjustDifficulty,
  difficultyToTarget,
  getCurrentDifficulty,
  getLatestBlock,
  isHashValid,
  Block,
} from '../blockchain/chain';

export interface MiningJob {
  job_id: string;
  height: number;
  previous_hash: string;
  timestamp: number;
  difficulty: number;
  target: string;
  version: number;
  merkle_root: string;
  reward: number;
  expires_at: number;
  status: string;
}

export interface MiningSubmissionPayload {
  miner_token: string;
  job_id: string;
  height: number;
  nonce: number;
  hash: string;
  timestamp?: number;
  device_name?: string;
  hashrate?: number;
}

const JOB_TTL_SECONDS = parseInt(process.env.JOB_EXPIRY_SECONDS || '180', 10);

/**
 * Creates or retrieves an active mining job for the next block
 */
export function generateMiningJob(): MiningJob {
  const tip = getLatestBlock();
  const nextHeight = tip.height + 1;
  const currentDiff = getCurrentDifficulty();
  const target = difficultyToTarget(currentDiff);
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + JOB_TTL_SECONDS;
  const reward = calculateReward(nextHeight);

  // Generate deterministic merkle root based on next block index and timestamp
  const merkle_root = crypto
    .createHash('sha256')
    .update(`s3coin:merkle:h${nextHeight}:t${now}:${crypto.randomBytes(8).toString('hex')}`)
    .digest('hex');

  const job_id = crypto.randomUUID();

  runQuery(
    `INSERT INTO mining_jobs (
      job_id, height, previous_hash, timestamp, difficulty, target,
      version, merkle_root, reward, expires_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      job_id,
      nextHeight,
      tip.hash,
      now,
      currentDiff,
      target,
      BLOCK_VERSION,
      merkle_root,
      reward,
      expires_at,
    ]
  );

  console.log(`[MINING] Created job ${job_id} for Block #${nextHeight} (Diff: ${currentDiff}, Target: ${target.slice(0, 8)}...)`);

  return {
    job_id,
    height: nextHeight,
    previous_hash: tip.hash,
    timestamp: now,
    difficulty: currentDiff,
    target,
    version: BLOCK_VERSION,
    merkle_root,
    reward,
    expires_at,
    status: 'active',
  };
}

/**
 * Authenticates miner token and returns associated user
 */
export function authenticateMinerToken(token: string) {
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return null;
  }
  return queryOne<{
    id: number;
    username: string;
    email: string;
    balance_s3: number;
    total_mined: number;
    status: string;
  }>('SELECT id, username, email, balance_s3, total_mined, status FROM users WHERE miner_token = ?', [token.trim()]);
}

/**
 * Validates and processes a block submission from an ESP32 or miner client
 */
export function submitPoWBlock(payload: MiningSubmissionPayload, clientIp: string) {
  const { miner_token, job_id, height, nonce, hash, device_name, hashrate } = payload;
  const now = Math.floor(Date.now() / 1000);

  // 1. Authenticate Miner Token
  const user = authenticateMinerToken(miner_token);
  if (!user) {
    console.warn(`[SECURITY] Block rejected: Invalid or unknown miner token`);
    return {
      success: false,
      status: 'rejected',
      reason: 'Invalid miner authentication token',
    };
  }

  if (user.status !== 'active') {
    return {
      success: false,
      status: 'rejected',
      reason: 'User account is suspended or inactive',
    };
  }

  // Record or update miner device tracking
  try {
    const existingMiner = queryOne('SELECT id FROM miners WHERE miner_token = ?', [miner_token]);
    if (existingMiner) {
      runQuery(
        'UPDATE miners SET last_seen = ?, ip_address = ?, hashrate = ?, device_name = COALESCE(?, device_name) WHERE miner_token = ?',
        [now, clientIp, hashrate || 0, device_name || 'ESP32-S3', miner_token]
      );
    } else {
      runQuery(
        'INSERT INTO miners (user_id, miner_token, device_name, ip_address, last_seen, hashrate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, miner_token, device_name || 'ESP32-S3', clientIp, now, hashrate || 0, now]
      );
    }
  } catch (err) {
    console.warn('[MINER] Failed to update miner metadata:', err);
  }

  // 2. Validate input parameters
  if (typeof nonce !== 'number' || nonce < 0 || !Number.isInteger(nonce)) {
    return recordSubmissionAndReject(job_id, height, user.id, miner_token, nonce || 0, hash || '', 'Invalid nonce format');
  }

  if (!hash || typeof hash !== 'string' || hash.length !== 64) {
    return recordSubmissionAndReject(job_id, height, user.id, miner_token, nonce, hash || '', 'Invalid hash length (must be 64-char hex)');
  }

  // 3. Load Job from DB
  const job = queryOne<MiningJob>('SELECT * FROM mining_jobs WHERE job_id = ?', [job_id]);
  if (!job) {
    return recordSubmissionAndReject(job_id, height, user.id, miner_token, nonce, hash, 'Job not found');
  }

  // 4. Check Job Expiration
  if (now > job.expires_at) {
    return recordSubmissionAndReject(job_id, height, user.id, miner_token, nonce, hash, 'Mining job expired');
  }

  // 5. Check Blockchain Tip & Height
  const tip = getLatestBlock();
  if (height !== tip.height + 1) {
    return recordSubmissionAndReject(
      job_id,
      height,
      user.id,
      miner_token,
      nonce,
      hash,
      `Stale block: Height #${height} does not match next chain tip #${tip.height + 1}`
    );
  }

  if (job.previous_hash.toLowerCase() !== tip.hash.toLowerCase()) {
    return recordSubmissionAndReject(
      job_id,
      height,
      user.id,
      miner_token,
      nonce,
      hash,
      `Stale block: Job previous_hash does not match current tip hash ${tip.hash.slice(0, 10)}...`
    );
  }

  // 6. Check Duplicate block in blockchain
  const existingBlockByHeight = queryOne('SELECT height FROM blocks WHERE height = ?', [height]);
  if (existingBlockByHeight) {
    return recordSubmissionAndReject(job_id, height, user.id, miner_token, nonce, hash, `Block #${height} already mined`);
  }

  const existingBlockByHash = queryOne('SELECT height FROM blocks WHERE hash = ?', [hash.toLowerCase()]);
  if (existingBlockByHash) {
    return recordSubmissionAndReject(job_id, height, user.id, miner_token, nonce, hash, 'Duplicate block hash already exists in chain');
  }

  // 7. Rebuild canonical block header and recalculate SHA-256
  const recalculatedHash = calculateHeaderHash(
    job.version,
    job.previous_hash,
    job.merkle_root,
    job.timestamp,
    job.difficulty,
    nonce
  );

  // 8. Compare calculated hash with submitted hash
  if (recalculatedHash.toLowerCase() !== hash.toLowerCase()) {
    console.warn(`[SECURITY] Block rejected: Hash mismatch. Server: ${recalculatedHash}, Submitted: ${hash}`);
    return recordSubmissionAndReject(
      job_id,
      height,
      user.id,
      miner_token,
      nonce,
      hash,
      `Hash calculation mismatch! Server computed: ${recalculatedHash}, submitted: ${hash}`
    );
  }

  // 9. Check Proof-of-Work against Target
  if (!isHashValid(recalculatedHash, job.target)) {
    console.warn(`[SECURITY] Block rejected: Hash does not meet target. Hash: ${recalculatedHash}, Target: ${job.target}`);
    return recordSubmissionAndReject(
      job_id,
      height,
      user.id,
      miner_token,
      nonce,
      hash,
      `Proof-of-Work failed: Hash does not satisfy difficulty target (${job.target.slice(0, 12)}...)`
    );
  }

  // 10. ACCEPT BLOCK - Perform Atomic Database Transaction
  try {
    const result = runTransaction(() => {
      const reward = job.reward;
      const createdAt = Date.now();

      // a. Insert new block
      runQuery(
        `INSERT INTO blocks (
          height, hash, previous_hash, timestamp, difficulty, target,
          miner_user_id, miner_token, merkle_root, nonce, reward, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          height,
          recalculatedHash,
          job.previous_hash,
          job.timestamp,
          job.difficulty,
          job.target,
          user.id,
          miner_token,
          job.merkle_root,
          nonce,
          reward,
          createdAt,
        ]
      );

      // b. Insert accepted mining submission log
      runQuery(
        `INSERT INTO mining_submissions (
          job_id, height, miner_user_id, miner_token, nonce, hash, status, reason, reward, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', 'Valid Proof-of-Work verified', ?, ?)`,
        [job_id, height, user.id, miner_token, nonce, recalculatedHash, reward, createdAt]
      );

      // c. Update user balance and total_mined atomically
      runQuery(
        'UPDATE users SET balance_s3 = balance_s3 + ?, total_mined = total_mined + ? WHERE id = ?',
        [reward, reward, user.id]
      );

      // d. Invalidate all existing active jobs for this height or older
      runQuery(
        "UPDATE mining_jobs SET status = 'completed' WHERE height <= ?",
        [height]
      );

      // e. Fetch updated user balance
      const updatedUser = queryOne<{ balance_s3: number; total_mined: number }>(
        'SELECT balance_s3, total_mined FROM users WHERE id = ?',
        [user.id]
      );

      return {
        reward,
        new_balance: updatedUser ? updatedUser.balance_s3 : user.balance_s3 + reward,
        block_height: height,
        block_hash: recalculatedHash,
      };
    });

    console.log(
      `[MINING] >>> BLOCK #${height} ACCEPTED! <<< Mined by ${user.username} (Nonce: ${nonce}, Hash: ${recalculatedHash.slice(0, 16)}..., Reward: ${result.reward} S3)`
    );

    // Audit and retarget difficulty
    checkAndAdjustDifficulty(height);

    return {
      success: true,
      status: 'accepted',
      block_height: result.block_height,
      block_hash: result.block_hash,
      reward: result.reward,
      new_balance: result.new_balance,
    };
  } catch (err: any) {
    console.error(`[MINING] Error processing block acceptance transaction:`, err);
    return recordSubmissionAndReject(
      job_id,
      height,
      user.id,
      miner_token,
      nonce,
      hash,
      `Transaction error: ${err?.message || 'Database error'}`
    );
  }
}

function recordSubmissionAndReject(
  job_id: string,
  height: number,
  userId: number,
  minerToken: string,
  nonce: number,
  hash: string,
  reason: string
) {
  try {
    runQuery(
      `INSERT INTO mining_submissions (
        job_id, height, miner_user_id, miner_token, nonce, hash, status, reason, reward, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, 0, ?)`,
      [job_id, height, userId, minerToken, nonce, hash, reason, Date.now()]
    );
  } catch (err) {
    // Ignore logging failures
  }

  return {
    success: false,
    status: 'rejected',
    reason,
  };
}
