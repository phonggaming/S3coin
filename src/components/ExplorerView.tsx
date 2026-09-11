import React, { useState, useEffect } from 'react';
import { Block } from '../types';
import { apiRequest } from '../apiClient';
import { Search, Layers, ChevronRight, X, ShieldCheck, Clock, Hash, Cpu, ArrowLeft, ArrowRight } from 'lucide-react';

export const ExplorerView: React.FC = () => {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);

  const fetchBlocks = async () => {
    setLoading(true);
    try {
      if (searchQuery.trim()) {
        const query = searchQuery.trim();
        const block = await apiRequest<Block>(`/api/blocks/${query}`);
        setBlocks(block ? [block] : []);
        setTotalCount(block ? 1 : 0);
      } else {
        const res = await apiRequest<{ blocks: Block[]; total: number }>(`/api/blocks?page=${page}&limit=10`);
        setBlocks(res.blocks);
        setTotalCount(res.total);
      }
    } catch (err) {
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlocks();
  }, [page, searchQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchBlocks();
  };

  return (
    <div className="space-y-6">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Layers className="w-4 h-4" />
            <span>Immutable Ledger</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">S3Coin Block Explorer</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Transparent public verification of all Proof-of-Work blocks mined on the S3 network.
          </p>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="w-full sm:w-80 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search block height (e.g. 0) or hash..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setPage(1);
              }}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </div>

      {/* Block List Table */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400 uppercase font-medium">
              <tr>
                <th className="pb-3 font-semibold">Height</th>
                <th className="pb-3 font-semibold">Block Hash</th>
                <th className="pb-3 font-semibold">Miner</th>
                <th className="pb-3 font-semibold">Time</th>
                <th className="pb-3 font-semibold text-right">Difficulty</th>
                <th className="pb-3 font-semibold text-right">Nonce</th>
                <th className="pb-3 font-semibold text-right">Reward</th>
                <th className="pb-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {blocks.map((b) => (
                <tr
                  key={b.height}
                  onClick={() => setSelectedBlock(b)}
                  className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                >
                  <td className="py-3 font-bold text-emerald-400">
                    <span className="group-hover:underline">#{b.height}</span>
                  </td>
                  <td className="py-3 text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <span className="text-cyan-400 font-semibold">{b.hash.slice(0, 10)}</span>
                      <span className="text-slate-500">...</span>
                      <span className="text-slate-400">{b.hash.slice(-8)}</span>
                    </div>
                  </td>
                  <td className="py-3 text-slate-400 font-sans">
                    {b.miner_username || (b.height === 0 ? 'Genesis' : `Miner #${b.miner_user_id}`)}
                  </td>
                  <td className="py-3 text-slate-400 font-sans">
                    {new Date(b.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="py-3 text-right text-amber-400">{b.difficulty}</td>
                  <td className="py-3 text-right text-slate-300">{b.nonce.toLocaleString()}</td>
                  <td className="py-3 text-right font-semibold text-emerald-400">
                    +{b.reward} S3
                  </td>
                  <td className="py-3 text-right text-slate-500 group-hover:text-cyan-400">
                    <ChevronRight className="w-4 h-4 ml-auto" />
                  </td>
                </tr>
              ))}
              {blocks.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                    No blocks matched your query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!searchQuery && totalCount > 10 && (
          <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-4 text-xs text-slate-400">
            <div>
              Showing {Math.min((page - 1) * 10 + 1, totalCount)} to {Math.min(page * 10, totalCount)} of {totalCount} blocks
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
                disabled={page * 10 >= totalCount}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer flex items-center gap-1"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Block Detail Modal */}
      {selectedBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800/60 text-cyan-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">Block #{selectedBlock.height}</h3>
                  <div className="text-xs text-slate-400">PoW Verified by S3Coin Consensus Engine</div>
                </div>
              </div>
              <button
                onClick={() => setSelectedBlock(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                <div className="text-slate-500 mb-1">Block Hash (SHA-256)</div>
                <div className="text-emerald-400 break-all">{selectedBlock.hash}</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                <div className="text-slate-500 mb-1">Previous Block Hash</div>
                <div className="text-slate-300 break-all">{selectedBlock.previous_hash}</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                <div className="text-slate-500 mb-1">Difficulty Target (256-bit Hex)</div>
                <div className="text-amber-300 break-all">{selectedBlock.target}</div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div className="text-slate-500 mb-1">Difficulty</div>
                  <div className="text-amber-400 font-bold text-sm">{selectedBlock.difficulty}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div className="text-slate-500 mb-1">Nonce</div>
                  <div className="text-white font-bold text-sm">{selectedBlock.nonce.toLocaleString()}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div className="text-slate-500 mb-1">Reward</div>
                  <div className="text-emerald-400 font-bold text-sm">+{selectedBlock.reward} S3</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div className="text-slate-500 mb-1">Timestamp</div>
                  <div className="text-slate-300 text-xs">
                    {new Date(selectedBlock.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>

              {/* Canonical Header String Breakdown */}
              <div className="p-3 rounded-xl bg-slate-950 border border-cyan-900/40">
                <div className="text-cyan-400 font-semibold mb-1 font-sans">
                  Canonical SHA-256 Header Input Format:
                </div>
                <div className="text-slate-300 break-all text-[11px] bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  {`1:${selectedBlock.previous_hash}:${selectedBlock.merkle_root}:${selectedBlock.timestamp}:${selectedBlock.difficulty}:${selectedBlock.nonce}`}
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedBlock(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
