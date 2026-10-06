'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getPublicApiUrl } from '@/lib/api-base';
import { MetricStrip, type MetricStripItem } from '@/components/ui/cerniq/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/ui/cerniq/DataTable';
import {
  ArrowLeft,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Filter,
  Beaker,
  BarChart3,
} from 'lucide-react';

/* ─── Types ─── */

type GovernedEntityStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'SUPERSEDED' | 'RETIRED';
type ScenarioScope = 'INSTITUTION' | 'SECTOR' | 'REGULATORY';
type BenchmarkType = 'YIELD_CURVE' | 'PEER_BENCHMARK' | 'REGULATORY_LIMIT' | 'MARKET_INDEX';

interface GovernedScenario {
  id: string;
  scenarioKey: string;
  displayName: string;
  description: string;
  version: string;
  scope: ScenarioScope;
  status: GovernedEntityStatus;
  source: string;
  ownerName: string;
  parameters: Record<string, unknown>;
  approvedUses: string[];
  approvedAt: string | null;
  approvedBy: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
}

interface GovernedBenchmark {
  id: string;
  datasetKey: string;
  displayName: string;
  description: string;
  benchmarkType: BenchmarkType;
  version: string;
  status: GovernedEntityStatus;
  asOfDate: string;
  source: string;
  ownerName: string;
  refreshPolicy: string;
  dataChecksum: string | null;
  fallbackPolicy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  retiredAt: string | null;
}

/* ─── Constants ─── */

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  APPROVED: CheckCircle2,
  DRAFT: Clock,
  UNDER_REVIEW: AlertTriangle,
  SUPERSEDED: AlertTriangle,
  RETIRED: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: 'text-emerald-600',
  DRAFT: 'text-slate-400',
  UNDER_REVIEW: 'text-amber-500',
  SUPERSEDED: 'text-orange-500',
  RETIRED: 'text-red-500',
};

const SCOPE_LABEL: Record<string, string> = {
  INSTITUTION: 'Institution',
  SECTOR: 'Sector',
  REGULATORY: 'Regulatory',
};

const BENCHMARK_TYPE_LABEL: Record<string, string> = {
  YIELD_CURVE: 'Yield Curve',
  PEER_BENCHMARK: 'Peer Benchmark',
  REGULATORY_LIMIT: 'Regulatory Limit',
  MARKET_INDEX: 'Market Index',
};

const REFRESH_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ON_PUBLICATION: 'On Publication',
};

/* ─── API ─── */

async function fetchWithAuth(path: string) {
  const token = typeof window !== 'undefined'
    ? document.cookie.match(/cerniq_token=([^;]+)/)?.[1] ?? ''
    : '';
  return fetch(getPublicApiUrl(path), {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

async function postWithAuth(path: string, body: Record<string, unknown>) {
  const token = typeof window !== 'undefined'
    ? document.cookie.match(/cerniq_token=([^;]+)/)?.[1] ?? ''
    : '';
  return fetch(getPublicApiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

/* ─── Page ─── */

type Tab = 'scenarios' | 'benchmarks';

export default function GovernanceAdminPage() {
  const [tab, setTab] = useState<Tab>('scenarios');
  const [scenarios, setScenarios] = useState<GovernedScenario[]>([]);
  const [benchmarks, setBenchmarks] = useState<GovernedBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters
  const [scopeFilter, setScopeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scenarioParams = new URLSearchParams();
      if (scopeFilter) scenarioParams.set('scope', scopeFilter);
      if (statusFilter) scenarioParams.set('status', statusFilter);
      const scenarioQs = scenarioParams.toString();

      const benchmarkParams = new URLSearchParams();
      if (typeFilter) benchmarkParams.set('benchmarkType', typeFilter);
      if (statusFilter) benchmarkParams.set('status', statusFilter);
      const benchmarkQs = benchmarkParams.toString();

      const [scenarioData, benchmarkData] = await Promise.all([
        fetchWithAuth(`/api/governance/scenarios${scenarioQs ? `?${scenarioQs}` : ''}`),
        fetchWithAuth(`/api/governance/benchmarks${benchmarkQs ? `?${benchmarkQs}` : ''}`),
      ]);
      setScenarios(scenarioData);
      setBenchmarks(benchmarkData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load governance data');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(entity: 'scenarios' | 'benchmarks', id: string) {
    setActionLoading(id);
    try {
      await postWithAuth(`/api/governance/${entity}/${id}/approve`, { approvedBy: 'admin' });
      await load();
    } catch (err: unknown) {
      setError(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRetire(entity: 'scenarios' | 'benchmarks', id: string) {
    const reason = entity === 'scenarios' ? 'Retired by admin' : undefined;
    setActionLoading(id);
    try {
      await postWithAuth(
        `/api/governance/${entity}/${id}/retire`,
        reason ? { reason } : {},
      );
      await load();
    } catch (err: unknown) {
      setError(`Retire failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  }

  /* ── Metric strips ── */
  const approvedScenarios = scenarios.filter((s) => s.status === 'APPROVED').length;
  const approvedBenchmarks = benchmarks.filter((b) => b.status === 'APPROVED').length;
  const regulatoryScenarios = scenarios.filter((s) => s.scope === 'REGULATORY').length;

  const metrics: MetricStripItem[] = [
    { label: 'Scenarios', value: scenarios.length },
    { label: 'Benchmarks', value: benchmarks.length },
    { label: 'Approved Scenarios', value: approvedScenarios },
    { label: 'Approved Benchmarks', value: approvedBenchmarks },
    { label: 'Regulatory', value: regulatoryScenarios },
  ];

  /* ── Scenario columns ── */
  const scenarioColumns: DataTableColumn<GovernedScenario>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      cell: (row) => {
        const Icon = STATUS_ICON[row.status] ?? Clock;
        return (
          <span className={`flex items-center gap-1.5 text-xs font-medium ${STATUS_COLOR[row.status] ?? 'text-slate-500'}`}>
            <Icon className="h-3.5 w-3.5" />
            {row.status}
          </span>
        );
      },
      sortValue: (row) => row.status,
    },
    {
      key: 'scenarioKey',
      header: 'Key',
      width: '220px',
      cell: (row) => <span className="font-mono text-xs text-slate-800">{row.scenarioKey}</span>,
      sortValue: (row) => row.scenarioKey,
    },
    {
      key: 'displayName',
      header: 'Name',
      cell: (row) => (
        <div>
          <div className="text-xs font-medium text-slate-900">{row.displayName}</div>
          <div className="text-[10px] text-slate-500 truncate max-w-[300px]">{row.description}</div>
        </div>
      ),
      sortValue: (row) => row.displayName,
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '100px',
      cell: (row) => (
        <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${row.scope === 'REGULATORY' ? 'bg-red-50 text-red-700' : row.scope === 'SECTOR' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
          {SCOPE_LABEL[row.scope] ?? row.scope}
        </span>
      ),
      sortValue: (row) => row.scope,
    },
    {
      key: 'version',
      header: 'Ver',
      width: '60px',
      cell: (row) => <span className="font-mono text-xs tabular-nums">{row.version}</span>,
    },
    {
      key: 'uses',
      header: 'Uses',
      width: '80px',
      align: 'right',
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {row.approvedUses?.length ?? 0}
        </span>
      ),
      sortValue: (row) => row.approvedUses?.length ?? 0,
      numeric: true,
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '140px',
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-slate-600">{row.ownerName}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      cell: (row) => (
        <div className="flex gap-1">
          {row.status !== 'APPROVED' && row.status !== 'RETIRED' && (
            <button
              onClick={() => handleApprove('scenarios', row.id)}
              disabled={actionLoading === row.id}
              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              Approve
            </button>
          )}
          {row.status !== 'RETIRED' && (
            <button
              onClick={() => handleRetire('scenarios', row.id)}
              disabled={actionLoading === row.id}
              className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Retire
            </button>
          )}
        </div>
      ),
    },
  ];

  /* ── Benchmark columns ── */
  const benchmarkColumns: DataTableColumn<GovernedBenchmark>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      cell: (row) => {
        const Icon = STATUS_ICON[row.status] ?? Clock;
        return (
          <span className={`flex items-center gap-1.5 text-xs font-medium ${STATUS_COLOR[row.status] ?? 'text-slate-500'}`}>
            <Icon className="h-3.5 w-3.5" />
            {row.status}
          </span>
        );
      },
      sortValue: (row) => row.status,
    },
    {
      key: 'datasetKey',
      header: 'Key',
      width: '220px',
      cell: (row) => <span className="font-mono text-xs text-slate-800">{row.datasetKey}</span>,
      sortValue: (row) => row.datasetKey,
    },
    {
      key: 'displayName',
      header: 'Name',
      cell: (row) => (
        <div>
          <div className="text-xs font-medium text-slate-900">{row.displayName}</div>
          <div className="text-[10px] text-slate-500 truncate max-w-[300px]">{row.description}</div>
        </div>
      ),
      sortValue: (row) => row.displayName,
    },
    {
      key: 'benchmarkType',
      header: 'Type',
      width: '120px',
      cell: (row) => (
        <span className="text-[10px] rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
          {BENCHMARK_TYPE_LABEL[row.benchmarkType] ?? row.benchmarkType}
        </span>
      ),
      sortValue: (row) => row.benchmarkType,
    },
    {
      key: 'asOfDate',
      header: 'As-Of',
      width: '90px',
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {row.asOfDate ? new Date(row.asOfDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
        </span>
      ),
      sortValue: (row) => row.asOfDate ?? '',
    },
    {
      key: 'refreshPolicy',
      header: 'Refresh',
      width: '100px',
      cell: (row) => (
        <span className="text-[10px] text-slate-600">
          {REFRESH_LABEL[row.refreshPolicy] ?? row.refreshPolicy}
        </span>
      ),
    },
    {
      key: 'checksum',
      header: 'Checksum',
      width: '100px',
      hideOnMobile: true,
      cell: (row) => (
        <span className="font-mono text-[10px] text-slate-400 truncate block max-w-[90px]" title={row.dataChecksum ?? ''}>
          {row.dataChecksum ? row.dataChecksum.slice(0, 12) + '…' : '—'}
        </span>
      ),
    },
    {
      key: 'fallback',
      header: 'Fallback',
      width: '100px',
      hideOnMobile: true,
      cell: (row) => (
        <span className={`text-[10px] font-medium ${row.fallbackPolicy === 'block_report' ? 'text-red-600' : row.fallbackPolicy === 'warn' ? 'text-amber-600' : 'text-slate-500'}`}>
          {row.fallbackPolicy ?? '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      cell: (row) => (
        <div className="flex gap-1">
          {row.status !== 'APPROVED' && row.status !== 'RETIRED' && (
            <button
              onClick={() => handleApprove('benchmarks', row.id)}
              disabled={actionLoading === row.id}
              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              Approve
            </button>
          )}
          {row.status !== 'RETIRED' && (
            <button
              onClick={() => handleRetire('benchmarks', row.id)}
              disabled={actionLoading === row.id}
              className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Retire
            </button>
          )}
        </div>
      ),
    },
  ];

  const hasFilters = scopeFilter || statusFilter || typeFilter;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <ShieldCheck className="h-5 w-5 text-indigo-700" />
          <h1 className="font-display text-lg font-semibold text-slate-900">
            Governance
          </h1>
          <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-indigo-700">
            FAANG P1
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Metrics */}
      <MetricStrip items={metrics} density="compact" className="mb-4" />

      {/* Tabs */}
      <div className="mb-3 flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('scenarios')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            tab === 'scenarios'
              ? 'border-b-2 border-indigo-600 text-indigo-700'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Beaker className="h-3.5 w-3.5" />
          Scenarios ({scenarios.length})
        </button>
        <button
          onClick={() => setTab('benchmarks')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            tab === 'benchmarks'
              ? 'border-b-2 border-indigo-600 text-indigo-700'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Benchmarks ({benchmarks.length})
        </button>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="">All Statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="DRAFT">Draft</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="SUPERSEDED">Superseded</option>
          <option value="RETIRED">Retired</option>
        </select>
        {tab === 'scenarios' && (
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="">All Scopes</option>
            {Object.entries(SCOPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        )}
        {tab === 'benchmarks' && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="">All Types</option>
            {Object.entries(BENCHMARK_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button
            onClick={() => { setScopeFilter(''); setStatusFilter(''); setTypeFilter(''); }}
            className="text-[10px] text-indigo-700 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Tables */}
      {loading && !scenarios.length && !benchmarks.length ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-400">
          Loading governance data...
        </div>
      ) : tab === 'scenarios' ? (
        <DataTable
          columns={scenarioColumns}
          rows={scenarios}
          rowKey={(row) => row.id}
          emptyMessage="No scenarios match the current filters"
          caption="Governed stress scenarios with lifecycle status"
        />
      ) : (
        <DataTable
          columns={benchmarkColumns}
          rows={benchmarks}
          rowKey={(row) => row.id}
          emptyMessage="No benchmarks match the current filters"
          caption="Governed benchmark datasets with refresh policies"
        />
      )}
    </div>
  );
}
