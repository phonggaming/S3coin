import React, { useState, useEffect } from 'react';
import { User, Withdrawal } from '../types';
import { apiRequest } from '../apiClient';
import {
  ArrowDownToLine,
  Building2,
  Smartphone,
  Wallet,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  Banknote,
} from 'lucide-react';

interface WithdrawalViewProps {
  user: User | null;
  onRefreshUser: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
}

export const WithdrawalView: React.FC<WithdrawalViewProps> = ({
  user,
  onRefreshUser,
  onOpenAuth,
}) => {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [amountS3, setAmountS3] = useState<string>('1000000');
  const [method, setMethod] = useState<'BANK' | 'MOMO' | 'ZALOPAY'>('BANK');
  const [destination, setDestination] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const exchangeRate = 0.1; // 1 S3 = 0.1 VND
  const minVnd = 100000;
  const minS3 = minVnd / exchangeRate; // 1,000,000 S3

  const numericS3 = parseFloat(amountS3) || 0;
  const estimatedVnd = Math.floor(numericS3 * exchangeRate);

  const fetchWithdrawals = async () => {
    if (!user) return;
    try {
      const res = await apiRequest<{ withdrawals: Withdrawal[] }>('/api/withdrawals');
      setWithdrawals(res.withdrawals);
    } catch (err: any) {
      console.warn('Failed to load withdrawals:', err);
    }
  };

  useEffect(() => {
    fetchWithdrawals();
  }, [user]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (numericS3 < minS3) {
      setError(`Minimum withdrawal is ${minVnd.toLocaleString()} VND (${minS3.toLocaleString()} S3).`);
      return;
    }

    if (user && numericS3 > user.balance_s3) {
      setError(`Insufficient S3 balance. You have ${user.balance_s3.toLocaleString()} S3.`);
      return;
    }

    setLoading(true);
    try {
      await apiRequest('/api/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          amount_s3: numericS3,
          method,
          destination,
        }),
      });

      setSuccess('Withdrawal request submitted! S3 balance has been safely locked pending admin review.');
      setDestination('');
      onRefreshUser();
      fetchWithdrawals();
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center mx-auto text-cyan-400">
          <ArrowDownToLine className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">S3Coin Withdrawal</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Please log in to convert your mined S3Coin balance to fiat VND (Bank Transfer, MoMo, ZaloPay).
        </p>
        <button
          onClick={() => onOpenAuth('login')}
          className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 cursor-pointer"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1">
          <Banknote className="w-4 h-4" />
          <span>Fiat Off-Ramp</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Withdraw S3Coin to VND</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Request payouts directly to your Vietnam Bank account, MoMo, or ZaloPay at 1 S3 = 0.1 VND.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Withdrawal Form */}
        <div className="lg:col-span-1 p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="font-bold text-white text-base">New Withdrawal Request</h2>

          {/* User balance overview */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Available Balance:</span>
            <span className="font-mono font-bold text-emerald-400">
              {user.balance_s3.toLocaleString()} S3
            </span>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-900/60 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-900/60 text-xs text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleWithdraw} className="space-y-4 text-xs">
            {/* Amount input */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Amount in S3</label>
              <input
                type="number"
                required
                min={minS3}
                step="1"
                value={amountS3}
                onChange={(e) => setAmountS3(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>≈ {estimatedVnd.toLocaleString()} VND</span>
                <button
                  type="button"
                  onClick={() => setAmountS3(Math.floor(user.balance_s3).toString())}
                  className="text-cyan-400 hover:underline font-semibold"
                >
                  Max Available
                </button>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'BANK', label: 'Bank', icon: Building2 },
                  { id: 'MOMO', label: 'MoMo', icon: Smartphone },
                  { id: 'ZALOPAY', label: 'ZaloPay', icon: Wallet },
                ].map((m) => {
                  const Icon = m.icon;
                  const selected = method === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethod(m.id as any)}
                      className={`p-2.5 rounded-xl border text-center font-medium transition-all cursor-pointer ${
                        selected
                          ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 mx-auto mb-1" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Account Destination */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">
                {method === 'BANK' ? 'Bank Name & Account Number' : 'Phone Number (Wallet)'}
              </label>
              <input
                type="text"
                required
                placeholder={method === 'BANK' ? 'e.g. Vietcombank - 0123456789 - NGUYEN VAN A' : 'e.g. 0912345678'}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                <span>Accounting & Balance Locking:</span>
              </div>
              <p>
                When submitted, your S3 balance is locked to prevent double-spending. If the request is rejected by an administrator, the S3 is automatically refunded back to your balance.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || numericS3 < minS3 || numericS3 > user.balance_s3}
              className="w-full py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 shadow-md shadow-cyan-950 disabled:opacity-50 transition-all cursor-pointer"
            >
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        </div>

        {/* Right: Withdrawal History */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-white text-base">Your Withdrawal History</h2>
            <span className="text-xs font-mono text-slate-400">{withdrawals.length} Requests</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
                <tr>
                  <th className="pb-2.5">Date</th>
                  <th className="pb-2.5">Amount (S3)</th>
                  <th className="pb-2.5">VND</th>
                  <th className="pb-2.5">Method</th>
                  <th className="pb-2.5">Destination</th>
                  <th className="pb-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {withdrawals.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 text-slate-400 font-sans">
                      {new Date(w.created_at).toLocaleDateString()}{' '}
                      <span className="text-slate-500 text-[10px]">
                        {new Date(w.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td className="py-3 font-semibold text-white">{w.amount_s3.toLocaleString()} S3</td>
                    <td className="py-3 text-emerald-400 font-semibold">{w.amount_vnd.toLocaleString()} đ</td>
                    <td className="py-3 text-slate-300 font-sans">{w.method}</td>
                    <td className="py-3 text-slate-400 max-w-[150px] truncate">{w.destination}</td>
                    <td className="py-3 text-right">
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
                        {w.status === 'PAID' && <CheckCircle2 className="w-3 h-3" />}
                        {w.status === 'REJECTED' && <XCircle className="w-3 h-3" />}
                        {w.status === 'PENDING' && <Clock className="w-3 h-3" />}
                        {w.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {withdrawals.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                      No withdrawal history found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
