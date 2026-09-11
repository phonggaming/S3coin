/**
 * S3Coin (Ticker: S3) - ESP32-S3 Proof-of-Work Blockchain
 * Client Web Application
 */

import React, { useState, useEffect, useCallback } from 'react';
import { User, BlockchainStats } from './types';
import { apiRequest, getStoredToken, removeStoredToken } from './apiClient';
import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { DashboardView } from './components/DashboardView';
import { ExplorerView } from './components/ExplorerView';
import { MinerConfigView } from './components/MinerConfigView';
import { WithdrawalView } from './components/WithdrawalView';
import { HistoryView } from './components/HistoryView';
import { AdminView } from './components/AdminView';
import { Cpu, ShieldCheck, Activity, Terminal } from 'lucide-react';

const DEFAULT_STATS: BlockchainStats = {
  ticker: 'S3',
  name: 'S3Coin',
  chain_tip: 1,
  latest_block_hash: '0000000000000000000000000000000000000000000000000000000000000000',
  current_difficulty: 1,
  current_target: '000007ffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  total_blocks: 1,
  active_miners: 0,
  unique_miners: 0,
  exchange_rate: 0.1,
  block_target_time: 120,
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<BlockchainStats>(DEFAULT_STATS);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Load User Profile if token exists
  const fetchUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const res = await apiRequest<{ user: User }>('/api/me');
      setUser(res.user);
    } catch {
      removeStoredToken();
      setUser(null);
    }
  }, []);

  // Fetch network stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await apiRequest<BlockchainStats>('/api/blockchain/stats');
      if (res && res.ticker) {
        setStats(res);
      }
    } catch (err) {
      console.warn('Network stats temporarily unavailable:', err);
    }
  }, []);

  useEffect(() => {
    fetchUser();
    fetchStats();

    // Poll stats and user every 10 seconds
    const interval = setInterval(() => {
      fetchStats();
      if (getStoredToken()) {
        fetchUser();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchUser, fetchStats]);

  const handleOpenAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  const handleLogout = () => {
    removeStoredToken();
    setUser(null);
    if (activeTab === 'admin') {
      setActiveTab('dashboard');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0d14] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-300">
      {/* Top Navigation */}
      <Navbar
        user={user}
        stats={stats}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuth={handleOpenAuth}
        onLogout={handleLogout}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            user={user}
            stats={stats}
            onOpenAuth={handleOpenAuth}
            setActiveTab={setActiveTab}
            onRefreshUser={fetchUser}
          />
        )}

        {activeTab === 'miner' && (
          <MinerConfigView
            user={user}
            onRefreshUser={fetchUser}
            onOpenAuth={handleOpenAuth}
          />
        )}

        {activeTab === 'explorer' && <ExplorerView />}

        {activeTab === 'withdraw' && (
          <WithdrawalView
            user={user}
            onRefreshUser={fetchUser}
            onOpenAuth={handleOpenAuth}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            user={user}
            onOpenAuth={handleOpenAuth}
          />
        )}

        {activeTab === 'admin' && <AdminView user={user} />}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/80 bg-[#080b11] py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-slate-300">S3Coin (S3)</span>
            <span>—</span>
            <span>Hardware-Centric Proof-of-Work Blockchain for ESP32-S3</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400 font-mono text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> SHA-256
            </span>
            <span>•</span>
            <span>Target: 120s</span>
            <span>•</span>
            <span>Halving: 1,000 Blocks</span>
            <span>•</span>
            <span className="text-cyan-400">1 S3 = 0.1 VND</span>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={(loggedUser) => {
          setUser(loggedUser);
          fetchStats();
        }}
      />
    </div>
  );
}
