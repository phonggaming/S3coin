import React from 'react';
import { User, BlockchainStats } from '../types';
import { Cpu, LogIn, LogOut, Shield, Wallet, Layers, Pickaxe, History, ArrowDownToLine, Radio } from 'lucide-react';

interface NavbarProps {
  user: User | null;
  stats: BlockchainStats | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  stats,
  activeTab,
  setActiveTab,
  onOpenAuth,
  onLogout,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Wallet },
    { id: 'miner', label: 'ESP32 Miner Setup', icon: Cpu },
    { id: 'explorer', label: 'Explorer', icon: Layers },
    { id: 'withdraw', label: 'Withdraw', icon: ArrowDownToLine },
    { id: 'history', label: 'Mining History', icon: History },
    ...(user?.is_admin ? [{ id: 'admin', label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0f172a]/95 backdrop-blur border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & Ticker */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 text-left group focus:outline-none"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 p-0.5 shadow-lg shadow-cyan-500/20 group-hover:scale-105 transition-transform">
                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-cyan-400" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-lg text-white tracking-tight">S3Coin</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/60 text-cyan-400 font-semibold">
                    S3
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block">ESP32-S3 SHA-256 PoW</p>
              </div>
            </button>

            {/* Network Quick Stats */}
            {stats && (
              <div className="hidden lg:flex items-center gap-3 pl-4 border-l border-slate-800/80 text-xs">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-slate-400">Tip:</span>
                  <span className="font-mono font-medium text-emerald-400">#{stats.chain_tip}</span>
                </div>
                <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                  <span className="text-slate-400">Diff:</span>{' '}
                  <span className="font-mono font-medium text-amber-400">{stats.current_difficulty}</span>
                </div>
                <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                  <span className="text-slate-400">Rate:</span>{' '}
                  <span className="font-mono text-cyan-400">1 S3 = {stats.exchange_rate} VND</span>
                </div>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User Auth Section */}
          <div className="flex items-center gap-2.5">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-slate-400 font-medium">
                    {user.username} {user.is_admin && <span className="text-emerald-400 font-semibold">(Admin)</span>}
                  </div>
                  <div className="text-sm font-mono font-bold text-emerald-400">
                    {user.balance_s3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} S3
                  </div>
                </div>

                <button
                  onClick={onLogout}
                  title="Logout"
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition-colors border border-transparent hover:border-slate-700"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenAuth('login')}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                >
                  Login
                </button>
                <button
                  onClick={() => onOpenAuth('register')}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 shadow-sm transition-all"
                >
                  Register
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Navigation Scrollbar */}
      <div className="md:hidden flex overflow-x-auto border-t border-slate-800/80 px-2 py-1.5 gap-1 scrollbar-none">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap font-medium transition-colors ${
                isActive
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
};
