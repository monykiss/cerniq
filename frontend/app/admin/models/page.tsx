'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getPublicApiUrl } from '@/lib/api-base';
import { MetricStrip, type MetricStripItem } from '@/components/ui/cerniq/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/ui/cerniq/DataTable';
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Filter,
} from 'lucide-react';

interface RegistryModel {
  id: string;
  modelKey: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  riskTier: string;
  status: string;
  ownerName: string;
  serviceFile: string;
  entryFunction: string;
  approvedAt: string | null;
  approvedBy: string | null;
  retiredAt: string | null;
  validationArtifacts: Array<{
    id: string;
    artifactType: string;
    label: string;
    checksum: string | null;
  }>;
}

interface RegistrySummary {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byTier: Record<string, number>;
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  APPROVED: CheckCircle2,
  DRAFT: Clock,
  CANDIDATE: AlertTriangle,
  DEPRECATED: AlertTriangle,
  RETIRED: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: 'text-emerald-600',
  DRAFT: 'text-slate-400',
  CANDIDATE: 'text-amber-500',
  DEPRECATED: 'text-orange-500',
  RETIRED: 'text-red-500',
};

const TIER_LABEL: Record<string, string> = {
  TIER_1: 'T1 — Regulatory',
  TIER_2: 'T2 — Committee',
  TIER_3: 'T3 — Advisory',
};

const CATEGORY_LABEL: Record<string, string> = {
  ALM_CORE: 'ALM Core',
  CREDIT_RISK: 'Credit Risk',
  LIQUIDITY: 'Liquidity',
  INTEREST_RATE: 'Interest Rate',
  STRESS_TEST: 'Stress Test',
  CAPITAL: 'Capital',
  REGULATORY: 'Regulatory',
  PRICING: 'Pricing/FTP',
  RISK_METRICS: 'Risk Metrics',
  REPORTING: 'Reporting',
  PEER_ANALYTICS: 'Peer Analytics',
  PORTFOLIO: 'Portfolio',
};

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

export default function AdminModelsPage() {
  const router = useRouter();
  const [models, setModels] = useState<RegistryModel[]>([]);
  const [summary, setSummary] = useState<RegistrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (tierFilter) params.set('riskTier', tierFilter);
      const qs = params.toString();
      const [modelsData, summaryData] = await Promise.all([
        fetchWithAuth(`/api/model-registry${qs ? `?${qs}` : ''}`),
        fetchWithAuth('/api/model-registry/summary'),
      ]);
      setModels(modelsData);
      setSummary(summaryData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load model registry');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, statusFilter, tierFilter]);

  useEffect(() => { load(); }, [load]);

  // ── MetricStrip ──
  const metrics: MetricStripItem[] = summary
    ? [
        { label: 'Total Models', value: summary.total },
        { label: 'Approved', value: summary.byStatus.APPROVED ?? 0 },
        { label: 'Draft', value: summary.byStatus.DRAFT ?? 0 },
        { label: 'Deprecated', value: summary.byStatus.DEPRECATED ?? 0 },
        { label: 'Retired', value: summary.byStatus.RETIRED ?? 0 },
        { label: 'Tier 1 (Regulatory)', value: summary.byTier.TIER_1 ?? 0 },
        { label: 'Categories', value: Object.keys(summary.byCategory).length },
      ]
    : [];

  // ── DataTable columns ──
  const columns: DataTableColumn<RegistryModel>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '90px',
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
      key: 'modelKey',
      header: 'Model Key',
      width: '200px',
      cell: (row) => (
        <button
          onClick={() => router.push(`/admin/models/${row.id}`)}
          className="font-mono text-xs text-cyan-700 hover:underline text-left"
        >
          {row.modelKey}
        </button>
      ),
      sortValue: (row) => row.modelKey,
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
      key: 'version',
      header: 'Ver',
      width: '60px',
      cell: (row) => <span className="font-mono text-xs tabular-nums">{row.version}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      width: '120px',
      cell: (row) => (
        <span className="text-[10px] rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
          {CATEGORY_LABEL[row.category] ?? row.category}
        </span>
      ),
      sortValue: (row) => row.category,
    },
    {
      key: 'riskTier',
      header: 'Tier',
      width: '130px',
      cell: (row) => (
        <span className={`text-[10px] font-medium ${row.riskTier === 'TIER_1' ? 'text-red-600' : row.riskTier === 'TIER_2' ? 'text-amber-600' : 'text-slate-500'}`}>
          {TIER_LABEL[row.riskTier] ?? row.riskTier}
        </span>
      ),
      sortValue: (row) => row.riskTier,
    },
    {
      key: 'artifacts',
      header: 'Artifacts',
      width: '70px',
      align: 'right',
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {row.validationArtifacts?.length ?? 0}
        </span>
      ),
      sortValue: (row) => row.validationArtifacts?.length ?? 0,
      numeric: true,
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '140px',
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-slate-600">{row.ownerName}</span>,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Shield className="h-5 w-5 text-cyan-700" />
          <h1 className="font-display text-lg font-semibold text-slate-900">
            Model Registry
          </h1>
          <span className="rounded bg-cyan-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-cyan-700">
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
      {summary && <MetricStrip items={metrics} density="compact" className="mb-4" />}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="">All Statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="DRAFT">Draft</option>
          <option value="CANDIDATE">Candidate</option>
          <option value="DEPRECATED">Deprecated</option>
          <option value="RETIRED">Retired</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
        >
          <option value="">All Tiers</option>
          <option value="TIER_1">T1 — Regulatory</option>
          <option value="TIER_2">T2 — Committee</option>
          <option value="TIER_3">T3 — Advisory</option>
        </select>
        {(categoryFilter || statusFilter || tierFilter) && (
          <button
            onClick={() => { setCategoryFilter(''); setStatusFilter(''); setTierFilter(''); }}
            className="text-[10px] text-cyan-700 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
          {models.length} model{models.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {loading && !models.length ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-400">
          Loading model registry...
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={models}
          rowKey={(row) => row.id}
          emptyMessage="No models match the current filters"
          caption="Production model inventory with governance status"
        />
      )}
    </div>
  );
}
