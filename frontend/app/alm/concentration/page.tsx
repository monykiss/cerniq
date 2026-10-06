'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Check, X, AlertTriangle } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

type Status = 'compliant' | 'warning' | 'breach' | 'data_unavailable';

interface ConcentrationExposure {
  readonly limitName: string;
  readonly limitType: string;
  readonly maxPct: number;
  // D1: null when a limit has no underlying geographic / borrower data loaded.
  readonly currentPct: number | null;
  readonly currentBalance: number | null;
  readonly headroom: number | null;
  readonly status: Status;
  readonly utilizationPct: number | null;
}

interface ConcentrationAnalysis extends AlmDataShell {
  readonly exposures: readonly ConcentrationExposure[];
  readonly hhi: number | null;
  readonly hhiInterpretation: string | null;
  readonly diversificationScore: number | null;
  readonly breachCount: number;
  readonly warningCount: number;
  readonly totalAssets: number | null;
}

const STATUS_COLORS: Record<Status, { bg: string; text: string; border: string; bar: string }> = {
  compliant: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: '#059669' },
  warning:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   bar: '#d97706' },
  breach:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    bar: '#dc2626' },
  // D1: a limit with no data is a neutral gray semáforo — never a false PASS.
  data_unavailable: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', bar: '#94a3b8' },
};

function validateConcentration(raw: unknown): ConcentrationAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('Concentration response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null hhi + gaps[]); validate
  // STRUCTURE only — `exposures` is the array the content maps over.
  if (!Array.isArray(r.exposures)) throw new Error('Concentration: exposures must be array');
  return r as unknown as ConcentrationAnalysis;
}

function getDemo(): ConcentrationAnalysis {
  return {
    hhi: 1450,
    hhiInterpretation: 'Moderate',
    diversificationScore: 72,
    breachCount: 1,
    warningCount: 2,
    totalAssets: 18900,
    exposures: [
      { limitName: 'Commercial Real Estate',      limitType: 'Regulatory', maxPct: 0.30, currentPct: 0.28, currentBalance: 5292, headroom:  378, status: 'warning',   utilizationPct:  93 },
      { limitName: 'Single Borrower',              limitType: 'Board',      maxPct: 0.15, currentPct: 0.12, currentBalance: 2268, headroom:  567, status: 'compliant', utilizationPct:  80 },
      { limitName: 'Construction & Development',   limitType: 'Regulatory', maxPct: 0.10, currentPct: 0.11, currentBalance: 2079, headroom: -189, status: 'breach',    utilizationPct: 110 },
      { limitName: 'Consumer Unsecured',           limitType: 'Board',      maxPct: 0.20, currentPct: 0.14, currentBalance: 2646, headroom: 1134, status: 'compliant', utilizationPct:  70 },
      { limitName: 'Government Securities',        limitType: 'Policy',     maxPct: 0.25, currentPct: 0.22, currentBalance: 4158, headroom:  567, status: 'warning',   utilizationPct:  88 },
      { limitName: 'Municipal Bonds',              limitType: 'Board',      maxPct: 0.08, currentPct: 0.05, currentBalance:  945, headroom:  567, status: 'compliant', utilizationPct:  63 },
    ],
  };
}

function ConcentrationContent({ data }: { data: ConcentrationAnalysis }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'hhi',              label: 'HHI',                                                           value: data.hhi,                   unit: 'count' },
    { key: 'diversification',  label: locale === 'es' ? 'Diversificación' : 'Diversification',         value: data.diversificationScore,  unit: 'count' },
    { key: 'total_exposures',  label: locale === 'es' ? 'Exposiciones'     : 'Exposures',              value: data.exposures.length,      unit: 'count' },
    { key: 'breach_count',     label: locale === 'es' ? 'Incumplimientos' : 'Breaches',                value: data.breachCount,           unit: 'count' },
    { key: 'warning_count',    label: locale === 'es' ? 'Advertencias'    : 'Warnings',                value: data.warningCount,          unit: 'count' },
    { key: 'total_assets',     label: locale === 'es' ? 'Activos Totales' : 'Total Assets',            value: data.totalAssets,           unit: 'USD_M' },
  ], [data, locale]);

  const chartData = useMemo(
    () => data.exposures.map((e) => ({
      name: e.limitName,
      current: e.currentPct != null ? +(e.currentPct * 100).toFixed(1) : null,
      limit:   +(e.maxPct     * 100).toFixed(1),
      status:  e.status,
    })),
    [data],
  );

  const columns = useMemo<readonly DataTableColumn<ConcentrationExposure>[]>(() => [
    { id: 'name', header: locale === 'es' ? 'Exposición' : 'Exposure', kind: 'text', accessor: (r) => r.limitName, align: 'text-left' },
    { id: 'type', header: locale === 'es' ? 'Tipo'       : 'Type',     kind: 'custom',
      accessor: (r) => r.limitType,
      render: (r) => <span className="text-[11px] capitalize text-slate-500">{r.limitType.replace(/_/g, ' ')}</span>,
    },
    { id: 'balance',  header: locale === 'es' ? 'Balance' : 'Balance',   kind: 'number', accessor: (r) => r.currentBalance, unit: 'USD_M' },
    { id: 'current',  header: locale === 'es' ? 'Actual'  : 'Current',   kind: 'number', accessor: (r) => r.currentPct,     unit: 'ratio' },
    { id: 'limit',    header: locale === 'es' ? 'Límite'  : 'Limit',     kind: 'number', accessor: (r) => r.maxPct,          unit: 'ratio' },
    { id: 'util',     header: locale === 'es' ? 'Uso'     : 'Util',      kind: 'custom',
      accessor: (r) => r.utilizationPct,
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-100">
            <div
              className={`h-1.5 rounded-full ${
                r.status === 'breach' ? 'bg-rose-500' :
                r.status === 'warning' ? 'bg-amber-500' :
                                         'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(r.utilizationPct ?? 0, 100)}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-slate-500">{r.utilizationPct != null ? `${r.utilizationPct.toFixed(0)}%` : '—'}</span>
        </div>
      ),
    },
    { id: 'status', header: locale === 'es' ? 'Estado' : 'Status', kind: 'custom',
      accessor: (r) => r.status,
      align: 'text-center',
      render: (r) => {
        const s = STATUS_COLORS[r.status];
        return (
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.bg} ${s.text} ${s.border}`}>
            {r.status === 'compliant' ? <Check className="h-2.5 w-2.5" /> :
             r.status === 'warning'    ? <AlertTriangle className="h-2.5 w-2.5" /> :
                                         <X className="h-2.5 w-2.5" />}
            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
          </span>
        );
      },
    },
  ], [locale]);

  // D1: no portfolio / exposure data loaded → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.exposures.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No exposure data is loaded. Load the loan and securities book with borrower/geography tags to compute concentration limits and the HHI.',
          es: 'No hay datos de exposición cargados. Cargue la cartera de préstamos y valores con etiquetas de prestatario/geografía para calcular los límites de concentración y el HHI.',
        }}
      />
    );
  }

  return (
    <>
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <div className="text-[11px] text-slate-500">
        HHI {data.hhi != null ? data.hhi.toLocaleString() : '—'}{data.hhiInterpretation ? ` · ${data.hhiInterpretation}` : ''}
      </div>

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Exposure vs limits chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Exposición vs Límites de Política' : 'Exposure vs Policy Limits'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={150} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Bar dataKey="current" name={locale === 'es' ? 'Actual' : 'Current'} radius={[0, 4, 4, 0]}>
              {chartData.map((e) => (
                <Cell key={e.name} fill={STATUS_COLORS[e.status].bar} />
              ))}
            </Bar>
            <Bar dataKey="limit" name={locale === 'es' ? 'Límite' : 'Limit'} fill="#cbd5e1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Detail table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle de Exposiciones' : 'Exposure Detail'}
        </p>
        <DataTable rows={data.exposures} columns={columns} locale={locale} rowKey={(r) => r.limitName} />
      </section>
    </>
  );
}

export default function ConcentrationPage() {
  return (
    <AlmPage<ConcentrationAnalysis>
      slug="concentration"
      iconTint="rose"
      validate={validateConcentration}
      getDemo={getDemo}
    >
      {(data) => <ConcentrationContent data={data} />}
    </AlmPage>
  );
}
