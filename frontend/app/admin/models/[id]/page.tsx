'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getPublicApiUrl } from '@/lib/api-base';
import { MetricStrip, type MetricStripItem } from '@/components/ui/cerniq/MetricStrip';
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Play,
  Archive,
  Send,
  Hash,
  User,
  Calendar,
  Code,
  FileText,
  Lock,
} from 'lucide-react';

/* ─── Types ─── */

interface ValidationArtifact {
  id: string;
  artifactType: string;
  label: string;
  storageLocator: string;
  checksum: string | null;
  producedBy: string;
  producedAt: string;
  validationMetadata: Record<string, unknown> | null;
}

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
  requiredInputs: string[] | null;
  limitations: string[] | null;
  calibrationMetadata: Record<string, unknown> | null;
  approvedAt: string | null;
  approvedBy: string | null;
  retiredAt: string | null;
  retiredBy: string | null;
  retiredReason: string | null;
  createdAt: string;
  updatedAt: string;
  validationArtifacts: ValidationArtifact[];
}

/* ─── Constants ─── */

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

const STATUS_BG: Record<string, string> = {
  APPROVED: 'bg-emerald-50 border-emerald-200',
  DRAFT: 'bg-slate-50 border-slate-200',
  CANDIDATE: 'bg-amber-50 border-amber-200',
  DEPRECATED: 'bg-orange-50 border-orange-200',
  RETIRED: 'bg-red-50 border-red-200',
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

const ARTIFACT_ICON: Record<string, string> = {
  backtest: '📊',
  benchmark: '📈',
  golden_test: '🏆',
  methodology_doc: '📄',
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

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── Page ─── */

export default function ModelDetailPage() {
  const params = useParams();
  const modelId = params.id as string;

  const [model, setModel] = useState<RegistryModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'retire' | 'review' | null>(null);
  const [retireReason, setRetireReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWithAuth(`/api/model-registry/${modelId}`);
      setModel(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg === '404' ? 'Model not found' : `Failed to load: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action: 'approve' | 'retire' | 'review') {
    if (!model) return;
    setActionLoading(true);
    setError(null);
    try {
      if (action === 'approve') {
        await postWithAuth(`/api/model-registry/${model.id}/approve`, { approvedBy: 'admin' });
      } else if (action === 'retire') {
        await postWithAuth(`/api/model-registry/${model.id}/retire`, {
          retiredBy: 'admin',
          reason: retireReason || 'Retired by admin',
        });
      } else if (action === 'review') {
        await postWithAuth(`/api/model-registry/${model.id}/review`, {});
      }
      setConfirmAction(null);
      setRetireReason('');
      await load();
    } catch (err: unknown) {
      setError(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading && !model) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
        Loading model...
      </div>
    );
  }

  if (error && !model) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-6">
        <Link href="/admin/models" className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Model Registry
        </Link>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!model) return null;

  const Icon = STATUS_ICON[model.status] ?? Clock;

  const metrics: MetricStripItem[] = [
    { label: 'Version', value: model.version },
    { label: 'Artifacts', value: model.validationArtifacts.length },
    { label: 'Inputs', value: model.requiredInputs?.length ?? 0 },
    { label: 'Limitations', value: model.limitations?.length ?? 0 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/models" className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Shield className="h-5 w-5 text-cyan-700" />
          <div>
            <h1 className="font-display text-lg font-semibold text-slate-900">
              {model.displayName}
            </h1>
            <span className="font-mono text-xs text-slate-500">{model.modelKey}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Status + Actions bar */}
      <div className={`mb-4 flex items-center justify-between rounded border p-3 ${STATUS_BG[model.status] ?? 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 ${STATUS_COLOR[model.status]}`} />
          <div>
            <span className={`text-sm font-semibold ${STATUS_COLOR[model.status]}`}>{model.status}</span>
            {model.approvedAt && (
              <div className="text-[10px] text-slate-500">
                Approved {fmtDate(model.approvedAt)} by {model.approvedBy}
              </div>
            )}
            {model.retiredAt && (
              <div className="text-[10px] text-slate-500">
                Retired {fmtDate(model.retiredAt)}{model.retiredReason ? `: ${model.retiredReason}` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {model.status === 'DRAFT' && (
            <button
              onClick={() => setConfirmAction('review')}
              className="flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              <Send className="h-3 w-3" /> Submit for Review
            </button>
          )}
          {(model.status === 'CANDIDATE' || model.status === 'DRAFT') && (
            <button
              onClick={() => setConfirmAction('approve')}
              className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <CheckCircle2 className="h-3 w-3" /> Approve
            </button>
          )}
          {model.status !== 'RETIRED' && (
            <button
              onClick={() => setConfirmAction('retire')}
              className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <Archive className="h-3 w-3" /> Retire
            </button>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {confirmAction && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-medium text-amber-800 mb-2">
            Confirm: {confirmAction === 'approve' ? 'Approve this model for production?' : confirmAction === 'retire' ? 'Retire this model?' : 'Submit for review?'}
          </div>
          {confirmAction === 'retire' && (
            <input
              type="text"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              placeholder="Reason for retirement (required)"
              className="mb-2 w-full rounded border border-amber-200 px-2 py-1 text-xs"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => handleAction(confirmAction)}
              disabled={actionLoading || (confirmAction === 'retire' && !retireReason.trim())}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {actionLoading ? 'Processing...' : 'Confirm'}
            </button>
            <button
              onClick={() => { setConfirmAction(null); setRetireReason(''); }}
              className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Metrics */}
      <MetricStrip items={metrics} density="compact" className="mb-4" />

      {/* Detail grid */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Left: Metadata */}
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Model Metadata</h2>
          <div className="space-y-2">
            <DetailRow icon={Hash} label="Model Key" value={model.modelKey} mono />
            <DetailRow icon={Code} label="Version" value={model.version} mono />
            <DetailRow
              icon={Shield}
              label="Category"
              value={CATEGORY_LABEL[model.category] ?? model.category}
            />
            <DetailRow
              icon={AlertTriangle}
              label="Risk Tier"
              value={TIER_LABEL[model.riskTier] ?? model.riskTier}
              className={model.riskTier === 'TIER_1' ? 'text-red-600' : model.riskTier === 'TIER_2' ? 'text-amber-600' : undefined}
            />
            <DetailRow icon={User} label="Owner" value={model.ownerName} />
            <DetailRow icon={Calendar} label="Created" value={fmtDate(model.createdAt)} />
            <DetailRow icon={Calendar} label="Updated" value={fmtDate(model.updatedAt)} />
          </div>
        </div>

        {/* Right: Code reference */}
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Code Reference</h2>
          <div className="space-y-2">
            <DetailRow icon={FileText} label="Service File" value={model.serviceFile} mono />
            <DetailRow icon={Play} label="Entry Function" value={model.entryFunction} mono />
          </div>

          {model.requiredInputs && model.requiredInputs.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Required Inputs</h3>
              <div className="flex flex-wrap gap-1">
                {model.requiredInputs.map((input) => (
                  <span key={input} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                    {input}
                  </span>
                ))}
              </div>
            </div>
          )}

          {model.limitations && model.limitations.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Limitations</h3>
              <ul className="space-y-1">
                {model.limitations.map((lim, i) => (
                  <li key={i} className="text-[10px] text-slate-600 flex gap-1.5">
                    <span className="text-amber-500 mt-0.5">⚠</span>
                    {lim}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="mb-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Description</h2>
        <p className="text-xs leading-relaxed text-slate-700">{model.description}</p>
      </div>

      {/* Validation Artifacts */}
      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Validation Artifacts ({model.validationArtifacts.length})
        </h2>
        {model.validationArtifacts.length === 0 ? (
          <p className="text-xs text-slate-400">No validation artifacts attached.</p>
        ) : (
          <div className="space-y-2">
            {model.validationArtifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex items-start gap-3 rounded border border-slate-100 bg-slate-50 p-3"
              >
                <span className="text-base">{ARTIFACT_ICON[artifact.artifactType] ?? '📎'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-900">{artifact.label}</span>
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {artifact.artifactType}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500 truncate">
                    {artifact.storageLocator}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-400">
                    <span>By {artifact.producedBy}</span>
                    <span>{fmtDate(artifact.producedAt)}</span>
                    {artifact.checksum && (
                      <span className="flex items-center gap-1" title={artifact.checksum}>
                        <Lock className="h-2.5 w-2.5" />
                        {artifact.checksum.slice(0, 16)}…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calibration metadata */}
      {model.calibrationMetadata && Object.keys(model.calibrationMetadata).length > 0 && (
        <div className="mt-4 rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Calibration Metadata</h2>
          <pre className="overflow-x-auto rounded bg-slate-50 p-3 font-mono text-[10px] text-slate-700">
            {JSON.stringify(model.calibrationMetadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─── */

function DetailRow({
  icon: IconComponent,
  label,
  value,
  mono,
  className,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <IconComponent className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
      <span className="text-slate-500 w-24 flex-shrink-0">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-slate-800 truncate ${className ?? ''}`}>
        {value}
      </span>
    </div>
  );
}
