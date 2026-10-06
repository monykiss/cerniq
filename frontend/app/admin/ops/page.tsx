'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiClient, type AdminOpsSnapshot } from '@/lib/api';
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  Server,
  Database,
  Cpu,
  Clock,
  CreditCard,
  FileText,
} from 'lucide-react';

const NODE_API_URL = (
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '')
    : ''
);

interface HealthData {
  status: 'ok' | 'degraded' | 'down';
  db: 'connected' | 'error';
  memoryPercent: number;
  version: string;
  uptime: number;
  timestamp: string;
  services: Record<string, string>;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' || status === 'connected' || status === 'up' || status === 'healthy'
      ? 'bg-emerald-400'
      : status === 'degraded'
        ? 'bg-amber-400'
        : 'bg-red-400';
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${color} mr-2`}
    />
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function jobStatusBadge(status: string) {
  const map: Record<string, string> = {
    AWAITING_DATA: 'bg-slate-500/20 text-slate-300',
    QUEUED: 'bg-blue-500/20 text-blue-300',
    PROCESSING: 'bg-amber-500/20 text-amber-300',
    COMPLETED: 'bg-emerald-500/20 text-emerald-300',
    FAILED: 'bg-red-500/20 text-red-300',
    DELIVERED: 'bg-emerald-500/20 text-emerald-300',
  };
  return map[status] || 'bg-slate-500/20 text-slate-300';
}

export default function OpsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [ops, setOps] = useState<AdminOpsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [healthRes, opsRes] = await Promise.allSettled([
        fetch(`${NODE_API_URL}/health`).then((r) => r.json()),
        apiClient.getAdminOps(),
      ]);

      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
      } else {
        setHealth(null);
        setError('Could not reach health endpoint');
      }

      if (opsRes.status === 'fulfilled') {
        setOps(opsRes.value);
      } else {
        setOps(null);
      }

      setLastRefresh(new Date());
    } catch {
      setError('Failed to fetch ops data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh every 30 seconds
  useEffect(() => {
    void fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-slate-900/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-slate-400 hover:text-white transition"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Activity className="h-5 w-5 text-amber-400" />
            <h1 className="text-lg font-bold">Operations Dashboard</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {lastRefresh && (
              <span className="text-slate-500 text-xs hidden sm:inline">
                Last refresh:{' '}
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg text-sm transition"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
            <span className="text-red-400 text-sm">{error}</span>
            <button
              onClick={() => {
                setError(null);
                fetchAll();
              }}
              className="text-xs text-red-300 hover:text-white ml-auto underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Status Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Overall Health */}
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
              <Server className="h-3.5 w-3.5" /> System Status
            </div>
            {health ? (
              <div className="flex items-center gap-2">
                <StatusDot status={health.status} />
                <span className="text-2xl font-bold capitalize">
                  {health.status}
                </span>
              </div>
            ) : (
              <span className="text-slate-500 text-sm">--</span>
            )}
          </div>

          {/* Database */}
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
              <Database className="h-3.5 w-3.5" /> Database
            </div>
            {health ? (
              <div className="flex items-center gap-2">
                <StatusDot status={health.db} />
                <span className="text-2xl font-bold capitalize">
                  {health.db}
                </span>
              </div>
            ) : (
              <span className="text-slate-500 text-sm">--</span>
            )}
          </div>

          {/* Memory */}
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
              <Cpu className="h-3.5 w-3.5" /> Memory Usage
            </div>
            {health ? (
              <>
                <div className="text-2xl font-bold">
                  {health.memoryPercent}%
                </div>
                <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      health.memoryPercent >= 85
                        ? 'bg-red-400'
                        : health.memoryPercent >= 70
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(health.memoryPercent, 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="text-slate-500 text-sm">--</span>
            )}
          </div>

          {/* Uptime */}
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
              <Clock className="h-3.5 w-3.5" /> Uptime
            </div>
            {health ? (
              <div className="text-2xl font-bold">
                {formatUptime(health.uptime)}
              </div>
            ) : (
              <span className="text-slate-500 text-sm">--</span>
            )}
            {health && (
              <div className="text-xs text-slate-500 mt-1">
                v{health.version}
              </div>
            )}
          </div>
        </div>

        {/* Secondary Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
              <CreditCard className="h-3.5 w-3.5" /> Active Subscriptions
            </div>
            <div className="text-2xl font-bold">
              {ops ? ops.activeSubscriptions : '--'}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
              <FileText className="h-3.5 w-3.5" /> Analysis Runs
            </div>
            <div className="text-2xl font-bold">
              {ops ? ops.totalAnalysisRuns : '--'}
            </div>
          </div>

          {/* Services Status */}
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4 col-span-2 md:col-span-1">
            <div className="text-slate-400 text-xs mb-2">Services</div>
            {health ? (
              <div className="space-y-1">
                {Object.entries(health.services).map(([name, status]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-300 capitalize">{name}</span>
                    <span className="flex items-center">
                      <StatusDot status={status} />
                      <span className="text-xs text-slate-400">{status}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-slate-500 text-sm">--</span>
            )}
          </div>
        </div>

        {/* Pipeline Jobs Table */}
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Recent Pipeline Jobs
          </h2>
          <div className="bg-slate-900/60 border border-white/10 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-slate-400">
                    <th className="px-4 py-3 font-medium">Institution</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Triggered By</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Completed</th>
                    <th className="px-4 py-3 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {!ops || ops.recentJobs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No pipeline jobs yet
                      </td>
                    </tr>
                  ) : (
                    ops.recentJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-white/5 hover:bg-white/5"
                      >
                        <td className="px-4 py-3">{job.institutionName}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${jobStatusBadge(job.status)}`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {job.triggeredBy}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {new Date(job.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {job.completedAt
                            ? new Date(job.completedAt).toLocaleString()
                            : '--'}
                        </td>
                        <td className="px-4 py-3 text-red-400 text-xs max-w-[200px] truncate">
                          {job.errorMessage || '--'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Auto-refresh indicator */}
        <div className="text-center text-xs text-slate-600">
          Auto-refreshes every 30 seconds
        </div>
      </div>
    </div>
  );
}
