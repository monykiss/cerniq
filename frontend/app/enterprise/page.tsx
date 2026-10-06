'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Modal } from '@/components/ui/Modal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface UsageMetrics {
  requestsThisMonth: number;
  batchJobsTotal: number;
  webhookDeliveries: number;
  requestLimit: number;
}

interface BatchJob {
  batchId: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  created: string;
  eta: string | null;
  institutionCount: number;
}

interface WebhookDelivery {
  id: string;
  url: string;
  status: 'success' | 'failed' | 'pending';
  attempts: number;
  responseCode: number | null;
  timestamp: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  active: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('capex_access_token') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

// ─── Demo data ──────────────────────────────────────────────────────────────

const DEMO_USAGE: UsageMetrics = {
  requestsThisMonth: 12_450,
  batchJobsTotal: 28,
  webhookDeliveries: 156,
  requestLimit: 50_000,
};

const DEMO_BATCHES: BatchJob[] = [
  { batchId: 'batch-001', type: 'Full ALM Analysis', status: 'running', progress: 67, created: '2026-04-16T08:00:00Z', eta: '2026-04-16T10:30:00Z', institutionCount: 5 },
  { batchId: 'batch-002', type: 'Liquidity Report', status: 'completed', progress: 100, created: '2026-04-15T14:00:00Z', eta: null, institutionCount: 12 },
  { batchId: 'batch-003', type: 'Exam Readiness', status: 'queued', progress: 0, created: '2026-04-16T09:30:00Z', eta: '2026-04-16T12:00:00Z', institutionCount: 3 },
  { batchId: 'batch-004', type: 'Credit Risk Scan', status: 'failed', progress: 45, created: '2026-04-15T10:00:00Z', eta: null, institutionCount: 8 },
];

const DEMO_WEBHOOKS: WebhookDelivery[] = [
  { id: 'wh1', url: 'https://erp.client.com/hooks/cerniq', status: 'success', attempts: 1, responseCode: 200, timestamp: '2026-04-16T09:15:00Z' },
  { id: 'wh2', url: 'https://erp.client.com/hooks/cerniq', status: 'success', attempts: 1, responseCode: 200, timestamp: '2026-04-15T14:30:00Z' },
  { id: 'wh3', url: 'https://api.partner.co/webhooks', status: 'failed', attempts: 3, responseCode: 502, timestamp: '2026-04-15T10:45:00Z' },
  { id: 'wh4', url: 'https://erp.client.com/hooks/cerniq', status: 'pending', attempts: 0, responseCode: null, timestamp: '2026-04-16T09:45:00Z' },
];

const DEMO_API_KEYS: ApiKey[] = [
  { id: 'k1', name: 'Production', prefix: 'ck_prod_****Xf9q', createdAt: '2026-01-15T00:00:00Z', lastUsed: '2026-04-16T09:10:00Z', active: true },
  { id: 'k2', name: 'Staging', prefix: 'ck_stg_****R2mN', createdAt: '2026-03-01T00:00:00Z', lastUsed: '2026-04-14T16:00:00Z', active: true },
  { id: 'k3', name: 'Legacy (deprecated)', prefix: 'ck_old_****Lp4x', createdAt: '2025-09-01T00:00:00Z', lastUsed: '2026-02-10T00:00:00Z', active: false },
];

// ALM modules for the batch creation wizard
const ALM_MODULE_GROUPS = [
  { group: 'Core Risk', modules: ['liquidity', 'credit-risk', 'var', 'stress-test', 'sensitivity'] },
  { group: 'Interest Rate', modules: ['repricing-gap', 'key-rate-durations', 'nim-optimizer', 'hull-white', 'svensson'] },
  { group: 'Compliance', modules: ['compliance', 'exam-prep', 'capital-optimizer', 'nsfr', 'rbc2'] },
  { group: 'Advanced', modules: ['monte-carlo', 'copula-credit', 'garch', 'pca-yield-curve', 'black-litterman'] },
];

// ─── Status badge ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: 'bg-slate-400',
    running: 'bg-blue-500 animate-pulse',
    completed: 'bg-emerald-500',
    failed: 'bg-rose-500',
    success: 'bg-emerald-500',
    pending: 'bg-amber-500',
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] || 'bg-slate-400'}`} />;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function EnterprisePage() {
  const { locale } = useTranslation();

  const [usage, setUsage] = useState<UsageMetrics>(DEMO_USAGE);
  const [batches, setBatches] = useState<BatchJob[]>(DEMO_BATCHES);
  const [webhooks, setWebhooks] = useState<WebhookDelivery[]>(DEMO_WEBHOOKS);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(DEMO_API_KEYS);
  const [loading, setLoading] = useState(true);
  const [newBatchOpen, setNewBatchOpen] = useState(false);

  // Batch wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedInstitutions, setSelectedInstitutions] = useState<string[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [outputFormat, setOutputFormat] = useState<'PDF' | 'JSON' | 'XLSX'>('PDF');
  const [webhookUrl, setWebhookUrl] = useState('');

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`${API}/api/enterprise/dashboard`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.usage) setUsage(data.usage);
          if (data.batches) setBatches(data.batches);
          if (data.webhooks) setWebhooks(data.webhooks);
          if (data.apiKeys) setApiKeys(data.apiKeys);
        }
      } catch {
        // demo
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const openNewBatch = () => {
    setWizardStep(1);
    setSelectedInstitutions([]);
    setSelectedModules([]);
    setOutputFormat('PDF');
    setWebhookUrl('');
    setNewBatchOpen(true);
  };

  const submitBatch = useCallback(async () => {
    try {
      await fetch(`${API}/api/enterprise/batches`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          institutions: selectedInstitutions,
          modules: selectedModules,
          outputFormat,
          webhookUrl: webhookUrl || undefined,
        }),
      });
    } catch { /* silent */ }
    setNewBatchOpen(false);
  }, [selectedInstitutions, selectedModules, outputFormat, webhookUrl]);

  const toggleModule = (slug: string) => {
    setSelectedModules((prev) =>
      prev.includes(slug) ? prev.filter((m) => m !== slug) : [...prev, slug]
    );
  };

  const usagePercent = Math.round((usage.requestsThisMonth / usage.requestLimit) * 100);

  // ─── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
          <div className="h-96 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#1e3a5f]">
              {locale === 'es' ? 'Portal Empresarial' : 'Enterprise API Dashboard'}
            </h1>
            <p className="text-xs text-slate-500">
              {locale === 'es' ? 'Gestione sus lotes, webhooks y claves API' : 'Manage batches, webhooks, and API keys'}
            </p>
          </div>
          <button
            onClick={openNewBatch}
            className="rounded-lg bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2a4f7f]"
          >
            + {locale === 'es' ? 'Nuevo Lote' : 'New Batch'}
          </button>
        </header>

        {/* Usage metrics */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {locale === 'es' ? 'Solicitudes Este Mes' : 'Requests This Month'}
            </p>
            <p className="mt-1 text-2xl font-bold text-[#1e3a5f]">{formatNumber(usage.requestsThisMonth)}</p>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div
                className={`h-2 rounded-full transition-all ${usagePercent > 80 ? 'bg-rose-500' : usagePercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{usagePercent}% of {formatNumber(usage.requestLimit)} limit</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {locale === 'es' ? 'Trabajos por Lote' : 'Batch Jobs'}
            </p>
            <p className="mt-1 text-2xl font-bold text-[#1e3a5f]">{usage.batchJobsTotal}</p>
            <p className="mt-1 text-[10px] text-slate-400">{locale === 'es' ? 'Total ejecutados' : 'Total executed'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {locale === 'es' ? 'Entregas Webhook' : 'Webhook Deliveries'}
            </p>
            <p className="mt-1 text-2xl font-bold text-[#1e3a5f]">{usage.webhookDeliveries}</p>
            <p className="mt-1 text-[10px] text-slate-400">{locale === 'es' ? 'Este mes' : 'This month'}</p>
          </div>
        </div>

        {/* Active batches */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1e3a5f]">
              {locale === 'es' ? 'Lotes Activos' : 'Active Batches'}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">Batch ID</th>
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Tipo' : 'Type'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Progreso' : 'Progress'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Creado' : 'Created'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">ETA</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batchId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">{b.batchId}</td>
                    <td className="px-5 py-3 text-xs text-slate-700">{b.type}</td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize text-slate-700">
                        <StatusDot status={b.status} />
                        {b.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              b.status === 'failed' ? 'bg-rose-500' : b.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${b.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono tabular-nums text-slate-500">{b.progress}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">{formatDate(b.created)}</td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">{b.eta ? formatDate(b.eta) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Webhook delivery log */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-bold text-[#1e3a5f]">
              {locale === 'es' ? 'Registro de Webhooks' : 'Webhook Delivery Log'}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">URL</th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Intentos' : 'Attempts'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Codigo' : 'Response'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Fecha' : 'Time'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((wh) => (
                  <tr key={wh.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-600 truncate max-w-xs">{wh.url}</td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize">
                        <StatusDot status={wh.status} />
                        {wh.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center text-xs text-slate-600">{wh.attempts}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`font-mono text-xs ${wh.responseCode === 200 ? 'text-emerald-600' : wh.responseCode ? 'text-rose-600' : 'text-slate-400'}`}>
                        {wh.responseCode ?? '-'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">{formatDate(wh.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* API key management */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1e3a5f]">
              {locale === 'es' ? 'Claves API' : 'API Keys'}
            </h2>
            <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              + {locale === 'es' ? 'Nueva Clave' : 'New Key'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Nombre' : 'Name'}
                  </th>
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Clave' : 'Key'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Creada' : 'Created'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Ultimo Uso' : 'Last Used'}
                  </th>
                  <th className="px-5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 text-xs font-medium text-slate-700">{key.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{key.prefix}</td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">{formatDate(key.createdAt)}</td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">{key.lastUsed ? formatDate(key.lastUsed) : '-'}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        key.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}>
                        {key.active ? (locale === 'es' ? 'Activa' : 'Active') : (locale === 'es' ? 'Inactiva' : 'Inactive')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Batch Modal — multi-step wizard */}
      <Modal
        open={newBatchOpen}
        onClose={() => setNewBatchOpen(false)}
        title={`${locale === 'es' ? 'Nuevo Lote' : 'New Batch'} (${wizardStep}/5)`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-5">
          {/* Progress steps */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  step === wizardStep ? 'bg-[#1e3a5f] text-white' :
                  step < wizardStep ? 'bg-emerald-500 text-white' :
                  'bg-slate-200 text-slate-500'
                }`}>
                  {step < wizardStep ? '\u2713' : step}
                </span>
                {step < 5 && <div className={`h-0.5 w-8 ${step < wizardStep ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Select institutions */}
          {wizardStep === 1 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                {locale === 'es' ? '1. Seleccionar Instituciones' : '1. Select Institutions'}
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {['Cooperativa Ejemplo Centro', 'Example League', 'Example FCU', 'Cooperativa Ejemplo Norte', 'Cooperativa Ejemplo Oeste'].map((name) => (
                  <label key={name} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selectedInstitutions.includes(name)}
                      onChange={() => setSelectedInstitutions((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])}
                      className="h-4 w-4 rounded border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                    />
                    <span className="text-sm text-slate-700">{name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Select modules */}
          {wizardStep === 2 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                {locale === 'es' ? '2. Seleccionar Modulos' : '2. Select Modules'}
              </h3>
              <div className="space-y-4 max-h-64 overflow-y-auto">
                {ALM_MODULE_GROUPS.map((g) => (
                  <div key={g.group}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">{g.group}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.modules.map((mod) => (
                        <button
                          key={mod}
                          onClick={() => toggleModule(mod)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                            selectedModules.includes(mod)
                              ? 'border-[#1e3a5f] bg-blue-50 text-[#1e3a5f]'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {mod.replace(/-/g, ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Output format */}
          {wizardStep === 3 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                {locale === 'es' ? '3. Formato de Salida' : '3. Choose Output Format'}
              </h3>
              <div className="flex gap-3">
                {(['PDF', 'JSON', 'XLSX'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setOutputFormat(fmt)}
                    className={`flex-1 rounded-xl border-2 p-4 text-center transition ${
                      outputFormat === fmt
                        ? 'border-[#1e3a5f] bg-blue-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-lg font-bold text-slate-700">{fmt}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {fmt === 'PDF' ? (locale === 'es' ? 'Reporte completo' : 'Full report') :
                       fmt === 'JSON' ? (locale === 'es' ? 'Datos estructurados' : 'Structured data') :
                       (locale === 'es' ? 'Hoja de calculo' : 'Spreadsheet')}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Webhook */}
          {wizardStep === 4 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                {locale === 'es' ? '4. URL de Webhook (Opcional)' : '4. Set Webhook URL (Optional)'}
              </h3>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhooks/cerniq"
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-[#1e3a5f] focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
              />
              <p className="mt-2 text-[11px] text-slate-400">
                {locale === 'es'
                  ? 'Recibiremos un POST cuando el lote termine. Deje en blanco para omitir.'
                  : 'We will POST to this URL when the batch completes. Leave blank to skip.'}
              </p>
            </div>
          )}

          {/* Step 5: Review and submit */}
          {wizardStep === 5 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">
                {locale === 'es' ? '5. Revisar y Enviar' : '5. Review & Submit'}
              </h3>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">{locale === 'es' ? 'Instituciones' : 'Institutions'}</span>
                  <span className="font-medium text-slate-700">{selectedInstitutions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{locale === 'es' ? 'Modulos' : 'Modules'}</span>
                  <span className="font-medium text-slate-700">{selectedModules.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{locale === 'es' ? 'Formato' : 'Format'}</span>
                  <span className="font-medium text-slate-700">{outputFormat}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Webhook</span>
                  <span className="font-medium text-slate-700 truncate max-w-48">{webhookUrl || '-'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between pt-2">
            <button
              onClick={() => wizardStep > 1 ? setWizardStep(wizardStep - 1) : setNewBatchOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {wizardStep === 1 ? (locale === 'es' ? 'Cancelar' : 'Cancel') : (locale === 'es' ? 'Atras' : 'Back')}
            </button>
            {wizardStep < 5 ? (
              <button
                onClick={() => setWizardStep(wizardStep + 1)}
                className="rounded-lg bg-[#1e3a5f] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2a4f7f]"
              >
                {locale === 'es' ? 'Siguiente' : 'Next'}
              </button>
            ) : (
              <button
                onClick={submitBatch}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {locale === 'es' ? 'Enviar Lote' : 'Submit Batch'}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
