import React, { useState, useEffect } from 'react';
import { User, Withdrawal, AuditLog } from '../types';
import { apiRequest } from '../apiClient';
import {
  Shield,
  Users,
  Cpu,
  ArrowDownToLine,
  Settings,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

interface AdminViewProps {
  user: User | null;
}

export const AdminView: React.FC<AdminViewProps> = ({ user }) => {
  const [stats, setStats] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [miners, setMiners] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'withdrawals' | 'users' | 'miners' | 'settings' | 'audit'>('withdrawals');
  const [loading, setLoading] = useState(false);

  // Settings form
  const [exchangeRate, setExchangeRate] = useState('0.1');
  const [minWithdrawVnd, setMinWithdrawVnd] = useState('100000');
  const [blockTargetTime, setBlockTargetTime] = useState('120');

  // Chain validation state
  const [chainValidationResult, setChainValidationResult] = useState<any>(null);
  const [validatingChain, setValidatingChain] = useState(false);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, withdrawRes, minersRes, auditRes] = await Promise.all([
        apiRequest('/api/admin/stats'),
        apiRequest('/api/admin/users'),
        apiRequest('/api/admin/withdrawals'),
        apiRequest('/api/admin/miners'),
        apiRequest('/api/admin/audit-logs'),
      ]);

      setStats(statsRes);
      setUsersList(usersRes.users);
      setWithdrawals(withdrawRes.withdrawals);
      setMiners(minersRes.miners);
      setAuditLogs(auditRes.logs);

      if (statsRes.settings) {
        setExchangeRate(statsRes.settings.s3_exchange_rate || '0.1');
        setMinWithdrawVnd(statsRes.settings.min_withdraw_vnd || '100000');
        setBlockTargetTime(statsRes.settings.block_target_time || '120');
      }
    } catch (err: any) {
      console.warn('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const handleApproveWithdrawal = async (id: number) => {
    try {
      await apiRequest(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' });
      fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    }
  };

  const handlePayWithdrawal = async (id: number) => {
    try {
      await apiRequest(`/api/admin/withdrawals/${id}/pay`, { method: 'POST' });
      fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    }
  };

  const handleRejectWithdrawal = async (id: number) => {
    const reason = prompt('Please enter rejection reason (S3 will be refunded back to user):');
    if (reason === null) return;
    try {
      await apiRequest(`/api/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    }
  };

  const handleToggleUserBan = async (targetUser: any) => {
    const newStatus = targetUser.status === 'banned' ? 'active' : 'banned';
    if (!confirm(`Are you sure you want to change status of ${targetUser.username} to ${newStatus}?`)) return;

    try {
      await apiRequest(`/api/admin/users/${targetUser.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to update user');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          s3_exchange_rate: parseFloat(exchangeRate),
          min_withdraw_vnd: parseFloat(minWithdrawVnd),
          block_target_time: parseInt(blockTargetTime),
        }),
      });
      alert('System settings updated successfully!');
      fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to save settings');
    }
  };

  const handleValidateBlockchain = async () => {
    setValidatingChain(true);
    setChainValidationResult(null);
    try {
      const res = await apiRequest('/api/admin/validate-chain', { method: 'POST' });
      setChainValidationResult(res);
    } catch (err: any) {
      setChainValidationResult({ valid: false, error: err.message });
    } finally {
      setValidatingChain(false);
    }
  };

  if (!user?.is_admin) {
    return (
      <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Access Restricted</h2>
        <p className="text-xs text-slate-400">You must be logged in as an Administrator to view this console.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Shield className="w-4 h-4" />
            <span>Master Governance</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin & Network Control Panel</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage user accounts, audit withdrawals, inspect hardware miners, and verify chain integrity.
          </p>
        </div>

        <button
          onClick={fetchAdminData}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Admin Quick Metrics */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="text-xs text-slate-400 mb-1 font-medium">Circulating Supply</div>
            <div className="text-xl font-mono font-bold text-emerald-400">
              {stats.circulating_s3.toLocaleString()} <span className="text-xs font-normal">S3</span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="text-xs text-slate-400 mb-1 font-medium">Total Registered Users</div>
            <div className="text-xl font-mono font-bold text-white">
              {stats.total_users}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="text-xs text-slate-400 mb-1 font-medium">Pending Withdrawals</div>
            <div className="text-xl font-mono font-bold text-amber-400">
              {stats.pending_withdrawals_count}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="text-xs text-slate-400 mb-1 font-medium">Pending VND Payout</div>
            <div className="text-xl font-mono font-bold text-cyan-400">
              {stats.pending_withdrawals_amount_vnd.toLocaleString()} đ
            </div>
          </div>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto text-xs font-medium">
        {[
          { id: 'withdrawals', label: 'Withdrawal Approvals', icon: ArrowDownToLine },
          { id: 'users', label: 'User Directory', icon: Users },
          { id: 'miners', label: 'Connected ESP32 Miners', icon: Cpu },
          { id: 'settings', label: 'System Settings', icon: Settings },
          { id: 'audit', label: 'Audit Logs', icon: ShieldCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? 'bg-cyan-950 border border-cyan-800 text-cyan-300 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: WITHDRAWALS */}
      {activeSubTab === 'withdrawals' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white text-base">Withdrawal Requests Queue</h3>
            <span className="text-xs font-mono text-slate-400">{withdrawals.length} Total</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
                <tr>
                  <th className="pb-2.5">User</th>
                  <th className="pb-2.5">Amount S3</th>
                  <th className="pb-2.5">VND Payout</th>
                  <th className="pb-2.5">Method & Destination</th>
                  <th className="pb-2.5">Status</th>
                  <th className="pb-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {withdrawals.map((w: any) => (
                  <tr key={w.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 text-white font-sans font-medium">
                      {w.username || `User #${w.user_id}`}
                    </td>
                    <td className="py-3 text-white font-semibold">{w.amount_s3.toLocaleString()} S3</td>
                    <td className="py-3 text-emerald-400 font-bold">{w.amount_vnd.toLocaleString()} đ</td>
                    <td className="py-3 text-slate-300 font-sans">
                      <span className="font-semibold text-cyan-400">[{w.method}]</span> {w.destination}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold ${
                          w.status === 'PAID'
                            ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                            : w.status === 'APPROVED'
                            ? 'bg-cyan-950 border border-cyan-800 text-cyan-300'
                            : w.status === 'REJECTED'
                            ? 'bg-rose-950 border border-rose-800 text-rose-300'
                            : 'bg-amber-950 border border-amber-800 text-amber-300'
                        }`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {w.status === 'PENDING' && (
                        <div className="flex items-center justify-end gap-1.5 font-sans">
                          <button
                            onClick={() => handleApproveWithdrawal(w.id)}
                            className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleRejectWithdrawal(w.id)}
                            className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer"
                          >
                            Reject & Refund
                          </button>
                        </div>
                      )}
                      {w.status === 'APPROVED' && (
                        <button
                          onClick={() => handlePayWithdrawal(w.id)}
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium font-sans cursor-pointer"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {withdrawals.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                      No withdrawal requests at this time.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: USERS */}
      {activeSubTab === 'users' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white text-base">User Directory & Status</h3>
            <span className="text-xs font-mono text-slate-400">{usersList.length} Users</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
                <tr>
                  <th className="pb-2.5">User</th>
                  <th className="pb-2.5">Email</th>
                  <th className="pb-2.5">Balance</th>
                  <th className="pb-2.5">Total Mined</th>
                  <th className="pb-2.5">Status</th>
                  <th className="pb-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 text-white font-sans font-medium flex items-center gap-1.5">
                      {u.username}
                      {u.is_admin ? <span className="text-emerald-400 text-[10px]">(Admin)</span> : null}
                    </td>
                    <td className="py-3 text-slate-400 font-sans">{u.email}</td>
                    <td className="py-3 text-emerald-400 font-bold">{u.balance_s3.toLocaleString()} S3</td>
                    <td className="py-3 text-slate-300">{u.total_mined.toLocaleString()} S3</td>
                    <td className="py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-sans font-semibold ${
                          u.status === 'banned' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'
                        }`}
                      >
                        {u.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 text-right font-sans">
                      {!u.is_admin && (
                        <button
                          onClick={() => handleToggleUserBan(u)}
                          className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                            u.status === 'banned'
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-rose-600 hover:bg-rose-500 text-white'
                          }`}
                        >
                          {u.status === 'banned' ? 'Unban' : 'Ban User'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: MINERS */}
      {activeSubTab === 'miners' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="font-bold text-white text-base">Active ESP32-S3 Hardware Miners</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
                <tr>
                  <th className="pb-2.5">Miner Owner</th>
                  <th className="pb-2.5">Device Name</th>
                  <th className="pb-2.5">IP Address</th>
                  <th className="pb-2.5">Hashrate</th>
                  <th className="pb-2.5 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {miners.map((m: any, i: number) => (
                  <tr key={i}>
                    <td className="py-3 text-white font-sans">{m.username || 'Anonymous'}</td>
                    <td className="py-3 text-slate-300">{m.device_name || 'ESP32-S3'}</td>
                    <td className="py-3 text-slate-400">{m.ip_address}</td>
                    <td className="py-3 text-cyan-400 font-bold">{m.hashrate.toLocaleString()} H/s</td>
                    <td className="py-3 text-right text-slate-400 font-sans">
                      {new Date(m.last_seen).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
                {miners.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                      No active hardware miners currently connected.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SETTINGS & VALIDATE CHAIN */}
      {activeSubTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="font-bold text-white text-base">Monetary & Mining Parameters</h3>
            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  S3 to VND Exchange Rate (VND per 1 S3)
                </label>
                <input
                  type="number"
                  step="0.001"
                  required
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Minimum Withdrawal in VND
                </label>
                <input
                  type="number"
                  step="1000"
                  required
                  value={minWithdrawVnd}
                  onChange={(e) => setMinWithdrawVnd(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Target Block Time (Seconds)
                </label>
                <input
                  type="number"
                  step="1"
                  required
                  value={blockTargetTime}
                  onChange={(e) => setBlockTargetTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs cursor-pointer"
              >
                Save System Parameters
              </button>
            </form>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Full Blockchain Mathematical Auditor</span>
            </h3>
            <p className="text-xs text-slate-400">
              Performs an exhaustive audit from Genesis Block #0 to the tip. Recalculates canonical SHA-256 header hashes, checks previous hash links, and confirms targets.
            </p>

            <button
              onClick={handleValidateBlockchain}
              disabled={validatingChain}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${validatingChain ? 'animate-spin' : ''}`} />
              <span>{validatingChain ? 'Auditing Ledger...' : 'Run Mathematical Verification'}</span>
            </button>

            {chainValidationResult && (
              <div
                className={`p-4 rounded-xl text-xs font-mono border ${
                  chainValidationResult.valid
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-800 text-rose-300'
                }`}
              >
                <div className="font-bold mb-1 font-sans">
                  {chainValidationResult.valid ? '✅ Blockchain Fully Validated' : '❌ Ledger Validation Failed'}
                </div>
                <div>Audited Blocks: {chainValidationResult.blocks_count}</div>
                {chainValidationResult.error && <div>Error: {chainValidationResult.error}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {activeSubTab === 'audit' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="font-bold text-white text-base">Administrative Audit Trail</h3>
          <div className="overflow-x-auto font-mono text-xs">
            <table className="w-full text-left">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-sans">
                <tr>
                  <th className="pb-2.5">Time</th>
                  <th className="pb-2.5">Actor</th>
                  <th className="pb-2.5">Action</th>
                  <th className="pb-2.5">Details</th>
                  <th className="pb-2.5 text-right">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 text-slate-400 font-sans">
                      {new Date(l.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 text-cyan-400 font-semibold">{l.actor}</td>
                    <td className="py-2.5 text-white font-sans">{l.action}</td>
                    <td className="py-2.5 text-slate-300 font-sans">{l.details}</td>
                    <td className="py-2.5 text-right text-slate-500">{l.ip_address || '127.0.0.1'}</td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500 font-sans">
                      No administrative actions logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
