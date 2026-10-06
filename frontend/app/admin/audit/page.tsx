'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient, type AdminAuditEntry } from '@/lib/api';
import { ArrowLeft, Clock, Filter, RefreshCw, Shield } from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-emerald-100 text-emerald-700',
  logout: 'bg-slate-100 text-slate-600',
  upload: 'bg-blue-100 text-blue-700',
  download: 'bg-cyan-100 text-cyan-700',
  payment_initiated: 'bg-amber-100 text-amber-700',
  report_generated: 'bg-violet-100 text-violet-700',
  institution_created: 'bg-indigo-100 text-indigo-700',
  analysis_run: 'bg-red-100 text-red-700',
  default: 'bg-slate-100 text-slate-600',
};

function getErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { status?: number } }).response?.status === 'number'
  ) {
    return (error as { response?: { status?: number } }).response?.status === 401
      ? 'Invalid admin key'
      : 'Failed to load audit trail';
  }
  return 'Failed to load audit trail';
}

export default function AuditTrailPage() {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await apiClient.getAdminAuditLogs(100));
    } catch (err: unknown) {
      setEntries([]);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const filtered =
    filter === 'all' ? entries : entries.filter((entry) => entry.action === filter);
  const actions = [...new Set(entries.map((entry) => entry.action))].sort();

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="border-b border-white/10 bg-slate-900/80 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-slate-400 transition hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Shield className="h-5 w-5 text-emerald-400" />
            <h1 className="text-lg font-bold">Audit Trail</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadEntries()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <div className="flex items-center gap-2 text-xs">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
              >
                <option value="all">All Actions</option>
                {actions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-xs text-slate-400">{filtered.length} entries</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-slate-900/60 px-6 py-16 text-center">
            <p className="text-sm text-slate-300">No audit events matched the current filter.</p>
            <p className="mt-2 text-xs text-slate-500">
              This page now reads the live admin audit endpoint instead of demo fallback data.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-900/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Resource</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Outcome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">IP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, index) => (
                  <tr
                    key={entry.id || index}
                    className="border-b border-white/5 hover:bg-white/[0.02]"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-400">
                      <Clock className="mr-1 inline h-3 w-3" />
                      {new Date(entry.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          ACTION_COLORS[entry.action] || ACTION_COLORS.default
                        }`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-300">{entry.resource}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs font-medium ${
                          entry.outcome === 'success'
                            ? 'text-emerald-400'
                            : entry.outcome === 'failure'
                              ? 'text-red-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                      {entry.userId?.slice(0, 8) || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {entry.ipAddress || '—'}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-slate-500">
                      {entry.metadata ? JSON.stringify(entry.metadata).slice(0, 80) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
