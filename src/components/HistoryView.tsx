import React, { useState, useEffect } from 'react';
import { User, MiningSubmission } from '../types';
import { apiRequest } from '../apiClient';
import { History, CheckCircle2, XCircle, ArrowLeft, ArrowRight, ShieldCheck, Clock } from 'lucide-react';

interface HistoryViewProps {
  user: User | null;
  onOpenAuth: (mode: 'login' | 'register') => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ user, onOpenAuth }) => {
  const [submissions, setSubmissions] = useState<MiningSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchHistory = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ submissions: MiningSubmission[]; total: number }>(
        `/api/miner/history?page=${page}&limit=15`
      );
      setSubmissions(res.submissions);
      setTotal(res.total);
    } catch (err) {
      console.error('Failed to load mining history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [user, page]);

  if (!user) {
    return (
      <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center mx-auto text-cyan-400">
          <History className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Mining History</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Sign in to view real-time logs of blocks submitted by your ESP32-S3 or web miner.
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
      <div>
        <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1">
          <History className="w-4 h-4" />
          <span>Proof-of-Work Telemetry</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Mining Submission History</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Full audit trail of all SHA-256 blocks submitted from your miner tokens to the server.
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
              <tr>
                <th className="pb-3">Timestamp</th>
                <th className="pb-3">Height</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Submitted Hash</th>
                <th className="pb-3 text-right">Nonce</th>
                <th className="pb-3 text-right">Reward</th>
                <th className="pb-3">Audit Details / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 text-slate-400 font-sans">
                    {new Date(sub.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="py-3 font-bold text-cyan-400">#{sub.height}</td>
                  <td className="py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold ${
                        sub.status === 'accepted'
                          ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                          : 'bg-rose-950 border border-rose-800 text-rose-300'
                      }`}
                    >
                      {sub.status === 'accepted' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3 h-3 text-rose-400" />
                      )}
                      {sub.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 text-slate-300">
                    <span className="text-slate-400">{sub.hash.slice(0, 10)}</span>
                    <span className="text-slate-600">...</span>
                    <span className="text-slate-400">{sub.hash.slice(-8)}</span>
                  </td>
                  <td className="py-3 text-right text-slate-300">{sub.nonce.toLocaleString()}</td>
                  <td className="py-3 text-right font-bold text-emerald-400">
                    {sub.reward > 0 ? `+${sub.reward} S3` : '0 S3'}
                  </td>
                  <td className="py-3 text-slate-400 font-sans max-w-xs truncate">
                    {sub.reason || 'Verified'}
                  </td>
                </tr>
              ))}
              {submissions.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    No mining submissions logged yet. Start your miner to see live block verification logs!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 15 && (
          <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-4 text-xs text-slate-400">
            <div>
              Showing {Math.min((page - 1) * 15 + 1, total)} to {Math.min(page * 15, total)} of {total} submissions
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <span className="px-2 font-mono">Page {page}</span>
              <button
                disabled={page * 15 >= total}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer flex items-center gap-1"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
