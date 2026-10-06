'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient, type AdminPipelineSnapshot } from '@/lib/api';
import {
  Clock, CheckCircle, AlertTriangle, Loader2, XCircle,
  RefreshCw, Play, RotateCcw,
} from 'lucide-react';

interface PipelineJob {
  id: string;
  institutionName: string;
  status: string;
  retryCount: number;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  user?: { email: string; name: string };
}

interface PipelineHealth {
  awaitingData: number;
  processing: number;
  complete: number;
  failed: number;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  AWAITING_DATA: <Clock className="h-4 w-4 text-gray-400" />,
  VALIDATING: <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />,
  QUEUED: <Clock className="h-4 w-4 text-amber-400" />,
  PROCESSING: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  GENERATING_PDF: <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />,
  UPLOADING: <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />,
  COMPLETE: <CheckCircle className="h-4 w-4 text-green-500" />,
  FAILED: <XCircle className="h-4 w-4 text-red-500" />,
  VALIDATION_FAILED: <AlertTriangle className="h-4 w-4 text-orange-500" />,
};

export default function AdminPipeline() {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: AdminPipelineSnapshot = await apiClient.getAdminPipeline(statusFilter || undefined);
      setJobs(data.jobs || []);
      setHealth(data.health || null);
    } catch {
      setError('Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchJobs();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchJobs]);

  const forceAction = async (jobId: string, action: string) => {
    await apiClient.runAdminPipelineAction(
      jobId,
      action as 'force-advance' | 'force-fail' | 'force-regenerate',
      action === 'force-fail'
        ? { reason: 'Manually failed by admin' }
        : undefined,
    );
    void fetchJobs();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Report Pipeline</h1>
            <p className="text-sm text-slate-400">Monitor and manage report generation jobs</p>
          </div>
          <button
            onClick={() => fetchJobs()}
            className="inline-flex items-center gap-2 bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm hover:bg-slate-600 transition"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {/* Health Cards */}
        {health && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Awaiting Data', value: health.awaitingData, color: 'text-gray-400' },
              { label: 'Processing', value: health.processing, color: 'text-blue-400' },
              { label: 'Complete', value: health.complete, color: 'text-green-400' },
              { label: 'Failed', value: health.failed, color: 'text-red-400' },
            ].map(card => (
              <div key={card.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {['', 'AWAITING_DATA', 'QUEUED', 'PROCESSING', 'COMPLETE', 'FAILED'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === s
                  ? 'bg-amber-500 text-slate-900'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        {/* Jobs Table */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No jobs found</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Institution</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Client</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Status</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Created</th>
                  <th className="text-right text-xs text-slate-500 font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {jobs.map(job => (
                  <tr key={job.id} className="hover:bg-slate-700/30 transition">
                    <td className="px-4 py-3">
                      <p className="text-sm text-white font-medium">{job.institutionName}</p>
                      <p className="text-xs text-slate-500 font-mono">{job.id.slice(0, 8)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-300">{job.user?.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {STATUS_ICONS[job.status] || <Clock className="h-4 w-4 text-gray-400" />}
                        <span className="text-xs text-slate-300">{job.status.replace(/_/g, ' ')}</span>
                        {job.retryCount > 0 && (
                          <span className="text-[10px] text-amber-400">(retry {job.retryCount})</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {['AWAITING_DATA', 'VALIDATION_FAILED'].includes(job.status) && (
                          <button
                            onClick={() => forceAction(job.id, 'force-advance')}
                            title="Force advance to QUEUED"
                            className="p-1.5 rounded hover:bg-slate-600 text-slate-400 hover:text-white transition"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {['PROCESSING', 'GENERATING_PDF', 'UPLOADING'].includes(job.status) && (
                          <button
                            onClick={() => forceAction(job.id, 'force-fail')}
                            title="Force fail"
                            className="p-1.5 rounded hover:bg-red-900/30 text-slate-400 hover:text-red-400 transition"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {job.status === 'FAILED' && (
                          <button
                            onClick={() => forceAction(job.id, 'force-regenerate')}
                            title="Re-queue"
                            className="p-1.5 rounded hover:bg-slate-600 text-slate-400 hover:text-amber-400 transition"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
