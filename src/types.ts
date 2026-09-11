export interface User {
  id: number;
  username: string;
  email: string;
  miner_token: string;
  balance_s3: number;
  total_mined: number;
  created_at?: number;
  last_login?: number | null;
  status: string;
  is_admin: boolean;
}

export interface Block {
  height: number;
  hash: string;
  previous_hash: string;
  timestamp: number;
  difficulty: number;
  target: string;
  miner_user_id: number;
  miner_token: string;
  miner_username?: string;
  merkle_root: string;
  nonce: number;
  reward: number;
  created_at: number;
}

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

export interface MiningSubmission {
  id: number;
  job_id: string;
  height: number;
  nonce: number;
  hash: string;
  status: 'accepted' | 'rejected';
  reason?: string;
  reward: number;
  submitted_at: number;
}

export interface Withdrawal {
  id: number;
  user_id: number;
  amount_s3: number;
  amount_vnd: number;
  exchange_rate: number;
  method: 'BANK' | 'MOMO' | 'ZALOPAY';
  destination: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  admin_note: string | null;
  created_at: number;
  updated_at: number;
}

export interface BlockchainStats {
  ticker: string;
  name: string;
  chain_tip: number;
  latest_block_hash: string;
  current_difficulty: number;
  current_target: string;
  total_blocks: number;
  active_miners: number;
  unique_miners: number;
  exchange_rate: number;
  block_target_time: number;
}

export interface MinerDevice {
  id: number;
  user_id: number;
  miner_token: string;
  device_name: string;
  ip_address: string;
  last_seen: number;
  hashrate: number;
  created_at: number;
  username?: string;
  email?: string;
}

export interface AuditLog {
  id: number;
  action: string;
  actor: string;
  details: string;
  ip_address?: string;
  timestamp: number;
}
