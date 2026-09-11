import React, { useEffect, useState } from 'react';
import { User, BlockchainStats, Block } from '../types';
import { apiRequest } from '../apiClient';
import {
  Wallet,
  TrendingUp,
  Cpu,
  Layers,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Zap,
  ArrowRight,
  ShieldAlert,
  Clock,
} from 'lucide-react';

interface DashboardViewProps {
  user: User | null;
  stats: BlockchainStats | null;
  onOpenAuth: (mode: 'login' | 'register') => void;
  setActiveTab: (tab: string) => void;
  onRefreshUser: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  stats,
  onOpenAuth,
  setActiveTab,
  onRefreshUser,
}) => {
  const [minerStatus, setMinerStatus] = useState<{ accepted: number; rejected: number; device?: any } | null>(null);
  const [recentBlocks, setRecentBlocks] = useState<Block[]>([]);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    // Fetch recent blocks
    apiRequest<{ blocks: Block[] }>('/api/blocks?limit=5')
      .then((res) => setRecentBlocks(res?.blocks || []))
      .catch((err) => console.warn('Recent blocks temporarily unavailable:', err));

    // If user is logged in, fetch their miner device status
    if (user?.miner_token) {
      apiRequest<{ accepted: number; rejected: number; device: any }>(
        `/api/miner/status?miner_token=${user.miner_token}`
      )
        .then((res) => setMinerStatus(res))
        .catch(() => setMinerStatus(null));
    }
  }, [user]);

  const handleCopyToken = () => {
    if (!user?.miner_token) return;
    navigator.clipboard.writeText(user.miner_token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const balanceS3 = user?.balance_s3 || 0;
  const exchangeRate = stats?.exchange_rate || 0.1;
  const estimatedVnd = Math.floor(balanceS3 * exchangeRate);
  const totalMined = user?.total_mined || 0;

  // Blocks mined estimation based on accepted
  const accepted = minerStatus?.accepted || 0;
  const rejected = minerStatus?.rejected || 0;
  const reportedHashrate = minerStatus?.device?.hashrate || 0;

  return (
    <div className="space-y-6">
      {/* Top Banner if not logged in */}
      {!user && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 border border-cyan-800/40 shadow-xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-900/60 border border-cyan-700/60 text-xs font-semibold text-cyan-300 mb-2">
                <Cpu className="w-3.5 h-3.5" /> Hardware-Centric PoW
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                ESP32-S3 Proof-of-Work Cryptocurrency
              </h1>
              <p className="text-sm text-slate-300 mt-1 max-w-2xl">
                Real SHA-256 hash brute-forcing running on ESP32-S3 dual-core hardware. 100% server-verified blocks, zero random coins, zero starting balance.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onOpenAuth('register')}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 shadow-md shadow-cyan-900/40 transition-all cursor-pointer flex items-center gap-2"
              >
                Start Mining S3 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Balance S3 */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden group hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Available Balance</span>
            <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-800/40 text-cyan-400">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-mono font-bold text-white">
              {balanceS3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            <span className="text-sm font-mono text-cyan-400 font-bold">S3</span>
          </div>
          <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
            <span>≈</span>
            <span className="font-mono text-emerald-400 font-medium">{estimatedVnd.toLocaleString()} VND</span>
            <span className="text-slate-500">(@ {exchangeRate} VND/S3)</span>
          </div>
        </div>

        {/* Card 2: Total Mined */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Mined</span>
            <div className="p-2 rounded-xl bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-mono font-bold text-white">
              {totalMined.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            <span className="text-sm font-mono text-emerald-400 font-bold">S3</span>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            Blocks verified by network:{' '}
            <span className="font-mono font-semibold text-slate-200">{accepted}</span>
          </div>
        </div>

        {/* Card 3: Miner Status & Speed */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Miner Telemetry</span>
            <div className="p-2 rounded-xl bg-purple-950/60 border border-purple-800/40 text-purple-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-mono font-bold text-white">
              {reportedHashrate >= 1000 ? (reportedHashrate / 1000).toFixed(1) + ' k' : reportedHashrate.toFixed(0)}
            </span>
            <span className="text-sm font-mono text-purple-400 font-bold">H/s</span>
          </div>
          <div className="mt-2 text-xs flex items-center gap-3">
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> {accepted} Acc
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <XCircle className="w-3.5 h-3.5" /> {rejected} Rej
            </span>
          </div>
        </div>

        {/* Card 4: Blockchain Tip */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Blockchain Tip</span>
            <div className="p-2 rounded-xl bg-amber-950/60 border border-amber-800/40 text-amber-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl lg:text-3xl font-mono font-bold text-white">#{stats?.chain_tip ?? 0}</span>
            <span className="text-xs font-mono text-amber-400 font-medium">Diff: {stats?.current_difficulty ?? 1}</span>
          </div>
          <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>Target Block Time: 120s</span>
          </div>
        </div>
      </div>

      {/* Quick Action & Miner Token Bar */}
      {user && (
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-cyan-950/70 border border-cyan-800/50 text-cyan-400 shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-300">Your ESP32-S3 Miner Token</div>
              <div className="font-mono text-xs text-slate-400 truncate max-w-md">
                {user.miner_token}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleCopyToken}
              className="flex-1 sm:flex-initial px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {copiedToken ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedToken ? 'Copied Token!' : 'Copy Miner Token'}</span>
            </button>
            <button
              onClick={() => setActiveTab('miner')}
              className="flex-1 sm:flex-initial px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-xs font-semibold text-white shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>ESP32 Miner Setup & Firmware</span>
            </button>
          </div>
        </div>
      )}

      {/* Network & Economic Rules Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Recent Mined Blocks */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">Latest Verified Blocks</h2>
            </div>
            <button
              onClick={() => setActiveTab('explorer')}
              className="text-xs font-semibold text-cyan-400 hover:underline flex items-center gap-1"
            >
              View Explorer <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
                <tr>
                  <th className="pb-2.5 font-semibold">Height</th>
                  <th className="pb-2.5 font-semibold">Block Hash</th>
                  <th className="pb-2.5 font-semibold">Miner</th>
                  <th className="pb-2.5 font-semibold text-right">Nonce</th>
                  <th className="pb-2.5 font-semibold text-right">Reward</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {recentBlocks.map((block) => (
                  <tr key={block.height} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 font-bold text-emerald-400">#{block.height}</td>
                    <td className="py-2.5 text-slate-300 font-mono">
                      {block.hash.slice(0, 10)}...{block.hash.slice(-8)}
                    </td>
                    <td className="py-2.5 text-slate-400 font-sans">
                      {block.miner_username || (block.height === 0 ? 'Genesis' : 'Miner #' + block.miner_user_id)}
                    </td>
                    <td className="py-2.5 text-right text-slate-400">{block.nonce.toLocaleString()}</td>
                    <td className="py-2.5 text-right font-semibold text-cyan-400">+{block.reward} S3</td>
                  </tr>
                ))}
                {recentBlocks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500 font-sans">
                      No blocks found. Start mining to produce Block #1!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Protocol Rules & Halving Stats */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-slate-200">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold uppercase tracking-wide">Network Protocol Rules</h2>
          </div>

          <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="font-semibold text-white mb-1 flex items-center justify-between">
                <span>Proof-of-Work Algorithm</span>
                <span className="font-mono text-cyan-400 text-[11px]">SHA-256</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Header: <code className="text-slate-300 font-mono">version:prev_hash:merkle:time:diff:nonce</code>. Target verified server-side.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="font-semibold text-white mb-1 flex items-center justify-between">
                <span>Block Reward Halving</span>
                <span className="font-mono text-amber-400 text-[11px]">Every 1,000 Blocks</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Initial: 50 S3. Halvings: 50 → 25 → 12.5 → 6.25 S3. Next halving at Block #1000.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="font-semibold text-white mb-1 flex items-center justify-between">
                <span>Withdrawal Economics</span>
                <span className="font-mono text-emerald-400 text-[11px]">Min 100,000 VND</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Fixed system rate: 1 S3 = 0.1 VND. Supported methods: Bank Transfer, MoMo, ZaloPay.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
