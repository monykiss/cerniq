'use client';

import { useMemo } from 'react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

type Quartile = 'top_quartile' | 'above_median' | 'below_median' | 'bottom_quartile' | 'data_unavailable';

interface PeerMetric {
  readonly metricName: string;
  readonly metricNameEs: string;
  // D1: null when the institution has not loaded the input for this metric.
  readonly institutionValue: number | null;
  readonly peerMin: number;
  readonly peerP25: number;
  readonly peerMedian: number;
  readonly peerP75: number;
  readonly peerMax: number;
  readonly percentileRank: number | null;
  readonly status: Quartile;
}

interface PeerResult extends AlmDataShell {
  readonly institutionId: string;
  readonly peerGroupName: string;
  readonly peerGroupNameEs: string;
  readonly peerCount: number;
  readonly assetTier: string;
  readonly metrics: readonly PeerMetric[];
}

const QUARTILE_STYLES: Record<Quartile, { bg: string; text: string; border: string; label: { en: string; es: string }; dot: string }> = {
  top_quartile:    { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: { en: 'Top Quartile',    es: 'Cuartil Superior' }, dot: 'bg-emerald-500' },
  above_median:    { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200',    label: { en: 'Above Median',    es: 'Sobre la Mediana' }, dot: 'bg-cyan-500' },
  below_median:    { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   label: { en: 'Below Median',    es: 'Bajo la Mediana' },  dot: 'bg-amber-500' },
  bottom_quartile: { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    label: { en: 'Bottom Quartile', es: 'Cuartil Inferior' }, dot: 'bg-rose-500' },
  // D1: a metric with no institution input is a neutral gray dot — never ranked.
  data_unavailable:{ bg: 'bg-slate-50',   text: 'text-slate-500',   border: 'border-slate-200',   label: { en: 'Data Pending',    es: 'Datos Pendientes' }, dot: 'bg-slate-400' },
};

function validatePeer(raw: unknown): PeerResult {
  if (!raw || typeof raw !== 'object') throw new Error('Peer analytics response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (empty metrics + gaps[]); validate
  // STRUCTURE only — `metrics` is the array the content maps over.
  if (!Array.isArray(r.metrics)) throw new Error('Peer analytics: metrics must be array');
  return r as unknown as PeerResult;
}

function getDemo(): PeerResult {
  return {
    institutionId: 'demo',
    peerGroupName: 'PR Cooperativas $50M–$300M',
    peerGroupNameEs: 'Cooperativas PR $50M–$300M',
    peerCount: 43,
    assetTier: 'medium',
    metrics: [
      { metricName: 'Net Interest Margin (%)',       metricNameEs: 'Margen de Interés Neto (%)',   institutionValue: 3.5,  peerMin: 2.0,   peerP25: 3.0,   peerMedian: 3.6,   peerP75: 4.2,  peerMax: 5.5,  percentileRank: 45, status: 'below_median' },
      { metricName: 'EVE Sensitivity +200bps (%)',   metricNameEs: 'Sensibilidad EVE +200bps (%)', institutionValue: 15.2, peerMin: 3,     peerP25: 10,    peerMedian: 16,    peerP75: 24,   peerMax: 40,   percentileRank: 48, status: 'below_median' },
      { metricName: 'Liquidity Coverage Ratio (%)',  metricNameEs: 'Ratio Cobertura Liquidez (%)', institutionValue: 115,  peerMin: 78,    peerP25: 102,   peerMedian: 122,   peerP75: 150,  peerMax: 230,  percentileRank: 42, status: 'below_median' },
      { metricName: 'Implied Deposit Beta',          metricNameEs: 'Beta de Depósito Implícito',   institutionValue: 0.18, peerMin: 0.08,  peerP25: 0.12,  peerMedian: 0.17,  peerP75: 0.24, peerMax: 0.35, percentileRank: 52, status: 'above_median' },
      { metricName: 'Loan-to-Share Ratio (%)',       metricNameEs: 'Ratio Préstamos/Acciones (%)', institutionValue: 72,   peerMin: 48,    peerP25: 62,    peerMedian: 72,    peerP75: 82,   peerMax: 98,   percentileRank: 50, status: 'above_median' },
      { metricName: 'CECL Allowance / Loans (%)',    metricNameEs: 'Provisión CECL / Préstamos %', institutionValue: 1.3,  peerMin: 0.5,   peerP25: 0.9,   peerMedian: 1.3,   peerP75: 2.0,  peerMax: 3.5,  percentileRank: 50, status: 'above_median' },
    ],
  };
}

function PeerContent({ data }: { data: PeerResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'peer_count',      label: locale === 'es' ? 'Pares'          : 'Peers',             value: data.peerCount, unit: 'count' },
    { key: 'metrics',         label: locale === 'es' ? 'Métricas'       : 'Metrics',           value: data.metrics.length, unit: 'count' },
    { key: 'top_quartile',    label: locale === 'es' ? 'Top Cuartil'    : 'Top Quartile',      value: data.metrics.filter((m) => m.status === 'top_quartile').length,    unit: 'count' },
    { key: 'above_median',    label: locale === 'es' ? 'Sobre Mediana' : 'Above Median',      value: data.metrics.filter((m) => m.status === 'above_median').length,    unit: 'count' },
    { key: 'below_median',    label: locale === 'es' ? 'Bajo Mediana'  : 'Below Median',      value: data.metrics.filter((m) => m.status === 'below_median').length,    unit: 'count' },
    { key: 'bottom_quartile', label: locale === 'es' ? 'Bottom Cuartil' : 'Bottom Quartile',   value: data.metrics.filter((m) => m.status === 'bottom_quartile').length, unit: 'count' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<PeerMetric>[]>(() => [
    { id: 'metric', header: locale === 'es' ? 'Métrica' : 'Metric', kind: 'custom',
      accessor: (r) => r.metricName,
      render: (r) => <span className="text-xs font-medium text-slate-800">{locale === 'es' ? r.metricNameEs : r.metricName}</span>,
      align: 'text-left',
    },
    { id: 'value',  header: locale === 'es' ? 'Institución' : 'Institution', kind: 'custom',
      accessor: (r) => r.institutionValue,
      render: (r) => <span className="font-mono text-xs font-bold tabular-nums text-slate-900">{r.institutionValue ?? '—'}</span>,
    },
    { id: 'p25',    header: 'P25',    kind: 'custom', accessor: (r) => r.peerP25,
      render: (r) => <span className="font-mono text-[10px] tabular-nums text-slate-400">{r.peerP25}</span>,
    },
    { id: 'median', header: locale === 'es' ? 'Mediana' : 'Median', kind: 'custom', accessor: (r) => r.peerMedian,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-500">{r.peerMedian}</span>,
    },
    { id: 'p75',    header: 'P75',    kind: 'custom', accessor: (r) => r.peerP75,
      render: (r) => <span className="font-mono text-[10px] tabular-nums text-slate-400">{r.peerP75}</span>,
    },
    { id: 'gap',    header: locale === 'es' ? 'Brecha' : 'Gap', kind: 'delta',
      accessor: (r) => r.institutionValue != null ? r.institutionValue - r.peerMedian : null, unit: 'x' },
    { id: 'rank',   header: locale === 'es' ? 'Percentil' : 'Rank', kind: 'custom',
      accessor: (r) => r.percentileRank,
      render: (r) => <span className="font-mono text-xs tabular-nums text-slate-700">{r.percentileRank != null ? `P${r.percentileRank}` : '—'}</span>,
    },
    { id: 'quartile', header: locale === 'es' ? 'Cuartil' : 'Quartile', kind: 'custom',
      accessor: (r) => r.status,
      align: 'text-center',
      render: (r) => {
        const s = QUARTILE_STYLES[r.status];
        return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.bg} ${s.text} ${s.border}`}>{s.label[locale]}</span>;
      },
    },
  ], [locale]);

  // D1: no institution metrics to benchmark → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.metrics.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No institution metrics are available to benchmark. Load the balance sheet and ratios to compare against the Puerto Rico cooperativa peer group.',
          es: 'No hay métricas de la institución para comparar. Cargue el balance de situación y las razones para compararse contra el grupo de pares de cooperativas de Puerto Rico.',
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
        {locale === 'es' ? data.peerGroupNameEs : data.peerGroupName} · {data.peerCount} {locale === 'es' ? 'instituciones' : 'institutions'}
      </div>

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Dot-plots */}
      <div className="space-y-3">
        {data.metrics.map((m) => {
          const s = QUARTILE_STYLES[m.status];
          const range = m.peerMax - m.peerMin || 1;
          const pct       = m.institutionValue != null ? ((m.institutionValue - m.peerMin) / range) * 100 : 0;
          const medianPct = ((m.peerMedian       - m.peerMin) / range) * 100;
          const p25Pct    = ((m.peerP25          - m.peerMin) / range) * 100;
          const p75Pct    = ((m.peerP75          - m.peerMin) / range) * 100;
          return (
            <section key={m.metricName} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{locale === 'es' ? m.metricNameEs : m.metricName}</p>
                  <p className="text-[10px] text-slate-500">
                    {locale === 'es' ? 'Rango' : 'Range'}: {m.peerMin} — {m.peerMax}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-bold tabular-nums text-slate-950">{m.institutionValue ?? '—'}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.bg} ${s.text} ${s.border}`}>
                    {m.percentileRank != null ? `P${m.percentileRank}` : '—'}
                  </span>
                </div>
              </div>
              <div className="relative mt-2 h-6">
                <div className="absolute left-0 right-0 top-2.5 h-1 rounded-full bg-slate-100" />
                <div
                  className="absolute top-1.5 h-3 rounded bg-slate-200"
                  style={{ left: `${p25Pct}%`, width: `${p75Pct - p25Pct}%` }}
                />
                <div
                  className="absolute top-0.5 h-5 w-0.5 bg-slate-500"
                  style={{ left: `${medianPct}%` }}
                />
                <div
                  className={`absolute top-0 -ml-3 flex h-6 w-6 items-center justify-center rounded-full border-2 ${s.border} ${s.bg}`}
                  style={{ left: `${Math.max(3, Math.min(97, pct))}%` }}
                >
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                </div>
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                <span>{m.peerMin}</span>
                <span>p25 {m.peerP25}</span>
                <span className="font-medium text-slate-600">median {m.peerMedian}</span>
                <span>p75 {m.peerP75}</span>
                <span>{m.peerMax}</span>
              </div>
            </section>
          );
        })}
      </div>

      {/* Summary table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Resumen' : 'Summary'}
        </p>
        <DataTable rows={data.metrics} columns={columns} locale={locale} rowKey={(r) => r.metricName} />
      </section>
    </>
  );
}

export default function PeerAnalyticsPage() {
  return (
    <AlmPage<PeerResult>
      slug="peer-analytics"
      iconTint="indigo"
      validate={validatePeer}
      getDemo={getDemo}
    >
      {(data) => <PeerContent data={data} />}
    </AlmPage>
  );
}
