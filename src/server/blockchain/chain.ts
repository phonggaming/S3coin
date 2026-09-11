import crypto from 'crypto';
import { queryAll, queryOne, runQuery, runTransaction } from '../database/db';

export interface Block {
  height: number;
  hash: string;
  previous_hash: string;
  timestamp: number;
  difficulty: number;
  target: string;
  miner_user_id: number;
  miner_token: string;
  merkle_root: string;
  nonce: number;
  reward: number;
  created_at: number;
}

// 256-bit base target corresponding to difficulty = 1
// 0x000007ff... requires ~5.5 hex zeros / 21 leading zero bits (approx 524,288 to 1,048,576 hashes)
// This ensures ESP32-S3 has to perform sustained Proof-of-Work (~30-60+ seconds per block on dual core)
// and prevents members from earning coins too quickly.
export const BASE_TARGET_HEX = '000007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
export const BASE_TARGET_BIGINT = BigInt('0x' + BASE_TARGET_HEX);
export const BLOCK_VERSION = 1;
export const RETARGET_INTERVAL = 5; // Retarget difficulty every 5 blocks

/**
 * Calculates 256-bit target hex string from numerical difficulty
 */
export function difficultyToTarget(difficulty: number): string {
  const diff = Math.max(1, Math.floor(difficulty));
  const targetBigInt = BASE_TARGET_BIGINT / BigInt(diff);
  return targetBigInt.toString(16).padStart(64, '0');
}

/**
 * Builds the canonical block header string for SHA-256 hashing.
 * Format: version:previous_hash:merkle_root:timestamp:difficulty:nonce
 */
export function buildBlockHeader(
  version: number,
  previous_hash: string,
  merkle_root: string,
  timestamp: number,
  difficulty: number,
  nonce: number
): string {
  return `${version}:${previous_hash}:${merkle_root}:${timestamp}:${difficulty}:${nonce}`;
}

/**
 * Calculates double or single SHA-256 hash of the block header.
 * We use standard SHA-256 in lowercase hex.
 */
export function calculateHeaderHash(
  version: number,
  previous_hash: string,
  merkle_root: string,
  timestamp: number,
  difficulty: number,
  nonce: number
): string {
  const header = buildBlockHeader(version, previous_hash, merkle_root, timestamp, difficulty, nonce);
  return crypto.createHash('sha256').update(header).digest('hex').toLowerCase();
}

/**
 * Checks if a hash satisfies the target difficulty
 */
export function isHashValid(hash: string, target: string): boolean {
  if (hash.length !== 64 || target.length !== 64) return false;
  // Lexicographical comparison works because both are 64-char lowercase hex
  return hash.localeCompare(target) <= 0;
}

/**
 * Calculates block reward based on height with halving
 */
export function calculateReward(height: number): number {
  if (height <= 0) return 0; // Genesis block has 0 reward

  const initialRewardRow = queryOne('SELECT value FROM system_settings WHERE key = ?', ['initial_reward']);
  const halvingIntervalRow = queryOne('SELECT value FROM system_settings WHERE key = ?', ['halving_interval']);

  const initialReward = initialRewardRow ? parseFloat(initialRewardRow.value) : 50;
  const halvingInterval = halvingIntervalRow ? parseInt(halvingIntervalRow.value, 10) : 1000;

  const halvings = Math.floor(height / halvingInterval);
  if (halvings >= 64) return 0;

  const reward = initialReward / Math.pow(2, halvings);
  return Math.max(0, Number(reward.toFixed(8)));
}

/**
 * Gets the latest block on the canonical chain
 */
export function getLatestBlock(): Block {
  const block = queryOne<Block>('SELECT * FROM blocks ORDER BY height DESC LIMIT 1');
  if (!block) {
    return initGenesisBlock();
  }
  return block;
}

/**
 * Gets a block by height
 */
export function getBlockByHeight(height: number): Block | null {
  return queryOne<Block>('SELECT * FROM blocks WHERE height = ?', [height]);
}

/**
 * Gets a block by hash
 */
export function getBlockByHash(hash: string): Block | null {
  return queryOne<Block>('SELECT * FROM blocks WHERE hash = ?', [hash]);
}

/**
 * Gets all blocks (paginated or limit)
 */
export function getBlocks(limit = 50, offset = 0): Block[] {
  return queryAll<Block>(
    'SELECT * FROM blocks ORDER BY height DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
}

export function getTotalBlocksCount(): number {
  const res = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM blocks');
  return res ? res.count : 0;
}

/**
 * Initializes genesis block if blockchain is empty
 */
export function initGenesisBlock(): Block {
  const existing = queryOne<Block>('SELECT * FROM blocks WHERE height = 0');
  if (existing) return existing;

  const height = 0;
  const previous_hash = '0'.repeat(64);
  const timestamp = 1700000000; // Fixed Genesis timestamp
  const difficulty = 1;
  const target = difficultyToTarget(difficulty);
  const miner_user_id = 0;
  const miner_token = '0000000000000000000000000000000000000000000000000000000000000000';
  const merkle_root = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
  const nonce = 0;
  const reward = 0; // Strictly 0 reward for genesis
  const created_at = Date.now();

  const hash = calculateHeaderHash(
    BLOCK_VERSION,
    previous_hash,
    merkle_root,
    timestamp,
    difficulty,
    nonce
  );

  runQuery(
    `INSERT INTO blocks (
      height, hash, previous_hash, timestamp, difficulty, target,
      miner_user_id, miner_token, merkle_root, nonce, reward, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      height, hash, previous_hash, timestamp, difficulty, target,
      miner_user_id, miner_token, merkle_root, nonce, reward, created_at
    ]
  );

  console.log(`[BLOCKCHAIN] Genesis block initialized. Hash: ${hash}`);
  return {
    height,
    hash,
    previous_hash,
    timestamp,
    difficulty,
    target,
    miner_user_id,
    miner_token,
    merkle_root,
    nonce,
    reward,
    created_at,
  };
}

/**
 * Gets current network difficulty
 */
export function getCurrentDifficulty(): number {
  const setting = queryOne('SELECT value FROM system_settings WHERE key = ?', ['current_difficulty']);
  if (setting && setting.value) {
    const d = parseInt(setting.value, 10);
    if (!isNaN(d) && d >= 1) return d;
  }
  return 1;
}

/**
 * Adjusts difficulty if block count reached retarget interval
 */
export function checkAndAdjustDifficulty(tipHeight: number): number {
  if (tipHeight <= 0 || tipHeight % RETARGET_INTERVAL !== 0) {
    return getCurrentDifficulty();
  }

  // Fetch last N blocks
  const blocks = queryAll<Block>(
    'SELECT * FROM blocks ORDER BY height DESC LIMIT ?',
    [RETARGET_INTERVAL]
  );

  if (blocks.length < RETARGET_INTERVAL) {
    return getCurrentDifficulty();
  }

  const latestBlock = blocks[0];
  const oldestBlock = blocks[blocks.length - 1];

  const actualTime = latestBlock.timestamp - oldestBlock.timestamp;
  const targetTimeSetting = queryOne('SELECT value FROM system_settings WHERE key = ?', ['block_target_time']);
  const targetBlockTime = targetTimeSetting ? parseInt(targetTimeSetting.value, 10) : 120;
  const expectedTime = targetBlockTime * (RETARGET_INTERVAL - 1);

  let currentDiff = getCurrentDifficulty();
  let newDiff = currentDiff;

  // If actual time is significantly faster (< 75% expected), increase difficulty
  if (actualTime < expectedTime * 0.75) {
    newDiff = currentDiff + 1;
    console.log(`[BLOCKCHAIN] Difficulty increased to ${newDiff} (blocks took ${actualTime}s vs expected ${expectedTime}s)`);
  } else if (actualTime > expectedTime * 1.35 && currentDiff > 1) {
    newDiff = currentDiff - 1;
    console.log(`[BLOCKCHAIN] Difficulty decreased to ${newDiff} (blocks took ${actualTime}s vs expected ${expectedTime}s)`);
  }

  runQuery('UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?', [
    String(newDiff),
    Date.now(),
    'current_difficulty',
  ]);

  return newDiff;
}

/**
 * Validates an individual block's structure and Proof-of-Work
 */
export function validateBlock(block: Block): { valid: boolean; reason?: string } {
  // Genesis block special check
  if (block.height === 0) {
    if (block.previous_hash !== '0'.repeat(64)) {
      return { valid: false, reason: 'Genesis previous hash must be 64 zeros' };
    }
    if (block.reward !== 0) {
      return { valid: false, reason: 'Genesis reward must be 0' };
    }
    return { valid: true };
  }

  // 1. Verify height
  if (typeof block.height !== 'number' || block.height <= 0) {
    return { valid: false, reason: 'Invalid block height' };
  }

  // 2. Verify previous hash exists
  if (!block.previous_hash || block.previous_hash.length !== 64) {
    return { valid: false, reason: 'Invalid previous_hash length' };
  }

  // 3. Verify target matches difficulty
  const expectedTarget = difficultyToTarget(block.difficulty);
  if (block.target.toLowerCase() !== expectedTarget.toLowerCase()) {
    return { valid: false, reason: `Target does not match difficulty: expected ${expectedTarget}, got ${block.target}` };
  }

  // 4. Recalculate SHA-256 from header
  const calculatedHash = calculateHeaderHash(
    BLOCK_VERSION,
    block.previous_hash,
    block.merkle_root,
    block.timestamp,
    block.difficulty,
    block.nonce
  );

  if (calculatedHash.toLowerCase() !== block.hash.toLowerCase()) {
    return {
      valid: false,
      reason: `Calculated hash ${calculatedHash} does not match block hash ${block.hash}`,
    };
  }

  // 5. Verify hash satisfies target
  if (!isHashValid(calculatedHash, block.target)) {
    return {
      valid: false,
      reason: `Hash ${calculatedHash} does not satisfy target ${block.target}`,
    };
  }

  // 6. Verify reward
  const expectedReward = calculateReward(block.height);
  if (Math.abs(block.reward - expectedReward) > 0.00000001) {
    return {
      valid: false,
      reason: `Invalid reward: expected ${expectedReward}, got ${block.reward}`,
    };
  }

  return { valid: true };
}

/**
 * Validates the entire blockchain from height 0 to tip
 */
export function validateBlockchain(): { valid: boolean; errorBlock?: number; reason?: string } {
  const allBlocks = queryAll<Block>('SELECT * FROM blocks ORDER BY height ASC');
  if (allBlocks.length === 0) {
    return { valid: false, reason: 'No blocks in chain' };
  }

  for (let i = 0; i < allBlocks.length; i++) {
    const current = allBlocks[i];

    if (current.height !== i) {
      return { valid: false, errorBlock: current.height, reason: `Gap in chain at height ${current.height}` };
    }

    const val = validateBlock(current);
    if (!val.valid) {
      return { valid: false, errorBlock: current.height, reason: val.reason };
    }

    if (i > 0) {
      const prev = allBlocks[i - 1];
      if (current.previous_hash.toLowerCase() !== prev.hash.toLowerCase()) {
        return {
          valid: false,
          errorBlock: current.height,
          reason: `previous_hash ${current.previous_hash} does not match block #${prev.height} hash ${prev.hash}`,
        };
      }
    }
  }

  return { valid: true };
}
