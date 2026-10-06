'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface RepricingBucket {
  readonly label: string;
  readonly labelEs: string;
  readonly assets: number;
  readonly liabilities: number;
  readonly gap: number;
  readonly cumulativeGap: number;
  readonly gapAsPctAssets: number;
  readonly isPolicyBreach: boolean;
}

interface RepricingGapResult extends AlmDataShell {
  readonly buckets: readonly RepricingBucket[];
  // D1: null when there is no maturity-bucketed balance sheet to gap.
  readonly totalAssets: number | null;
  readonly totalLiabilities: number | null;
  readonly durationGap: number | null;
  readonly analysisDate: string;
  readonly policyLimitPct: number | null;
}

function validateRepricing(raw: unknown): RepricingGapResult {
  if (!raw || typeof raw !== 'object') throw new Error('Repricing gap response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null totals + gaps[]); validate
  // STRUCTURE only — `buckets` is the array the content maps over.
  if (!Array.isArray(r.buckets)) throw new Error('Repricing gap: buckets must be array');
  return r as unknown as RepricingGapResult;
}

function getDemo(): RepricingGapResult {
  return {
    buckets: [
      { label: '0–30 Days',   labelEs: '0–30 Días',      assets: 45,  liabilities: 95, gap: -50, cumulativeGap: -50, gapAsPctAssets: -11.2, isPolicyBreach: false },
      { label: '31–90 Days',  labelEs: '31–90 Días',     assets: 30,  liabilities: 55, gap: -25, cumulativeGap: -75, gapAsPctAssets:  -5.6, isPolicyBreach: false },
      { label: '91–180 Days', labelEs: '91–180 Días',    assets: 25,  liabilities: 40, gap: -15, cumulativeGap: -90, gapAsPctAssets:  -3.4, isPolicyBreach: false },
      { label: '181d–1 Year', labelEs: '181d–1 Año',     assets: 60,  liabilities: 35, gap:  25, cumulativeGap: -65, gapAsPctAssets:   5.6, isPolicyBreach: false },
      { label: '1–3 Years',   labelEs: '1–3 Años',       assets: 120, liabilities: 85, gap:  35, cumulativeGap: -30, gapAsPctAssets:   7.9, isPolicyBreach: false },
      { label: '3–5 Years',   labelEs: '3–5 Años',       assets:  80, liabilities: 45, gap:  35, cumulativeGap:   5, gapAsPctAssets:   7.9, isPolicyBreach: false },
      { label: 'Over 5 Years',labelEs: 'Más de 5 Años',  assets:  85, liabilities: 30, gap:  55, cumulativeGap:  60, gapAsPctAssets:  12.4, isPolicyBreach: false },
    ],
    totalAssets: 445,
    totalLiabilities: 385,
    durationGap: 2.1,
    analysisDate: new Date().toISOString(),
    policyLimitPct: 15,
  };
}

function RepricingContent({ data }: { data: RepricingGapResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'total_assets',       label: locale === 'es' ? 'Activos'       : 'Total Assets',     value: data.totalAssets,      unit: 'USD_M' },
    { key: 'total_liabilities',  label: locale === 'es' ? 'Pasivos'       : 'Total Liabilities', value: data.totalLiabilities, unit: 'USD_M' },
    { key: 'duration_gap',       label: locale === 'es' ? 'Brecha Duración' : 'Duration Gap',   value: data.durationGap,      unit: 'years' },
    { key: 'policy_limit',       label: locale === 'es' ? 'Límite Política' : 'Policy Limit',   value: data.policyLimitPct,   unit: '%' },
    { key: 'bucket_count',       label: locale === 'es' ? 'Segmentos'     : 'Buckets',          value: data.buckets.length,   unit: 'count' },
    { key: 'breach_count',       label: locale === 'es' ? 'Incumplim.'    : 'Breaches',         value: data.buckets.filter((b) => b.isPolicyBreach).length, unit: 'count' },
  ], [data, locale]);

  const chartData = useMemo(
    () => data.buckets.map((b) => ({
      bucket: locale === 'es' ? b.labelEs : b.label,
      assets: b.assets,
      liabilities: -b.liabilities,
      gap: b.gap,
    })),
    [data, locale],
  );

  const columns = useMemo<readonly DataTableColumn<RepricingBucket>[]>(() => [
    { id: 'bucket', header: locale === 'es' ? 'Segmento' : 'Bucket', kind: 'custom',
      accessor: (r) => locale === 'es' ? r.labelEs : r.label,
      render: (r) => <span className="text-xs font-medium text-slate-800">{locale === 'es' ? r.labelEs : r.label}</span>,
      align: 'text-left',
    },
    { id: 'assets',      header: locale === 'es' ? 'Activos'     : 'Assets',      kind: 'number', accessor: (r) => r.assets,         unit: 'USD_M' },
    { id: 'liabilities', header: locale === 'es' ? 'Pasivos'     : 'Liabilities', kind: 'number', accessor: (r) => r.liabilities,    unit: 'USD_M' },
    { id: 'gap',         header: locale === 'es' ? 'Brecha'      : 'Gap',         kind: 'delta',  accessor: (r) => r.gap,             unit: 'USD_M' },
    { id: 'cum',         header: locale === 'es' ? 'Acumulada'   : 'Cum. Gap',    kind: 'delta',  accessor: (r) => r.cumulativeGap,   unit: 'USD_M' },
    { id: 'pct',         header: locale === 'es' ? '% Activos'   : '% of Assets', kind: 'custom',
      accessor: (r) => r.gapAsPctAssets,
      render: (r) => (
        <span className={`font-mono text-xs font-bold tabular-nums ${r.isPolicyBreach ? 'text-rose-700' : 'text-slate-700'}`}>
          {r.gapAsPctAssets >= 0 ? '+' : ''}{r.gapAsPctAssets.toFixed(1)}%{r.isPolicyBreach ? ' ⚠' : ''}
        </span>
      ),
    },
  ], [locale]);

  // D1: no maturity-bucketed balance sheet → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.buckets.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No maturity-bucketed balance sheet is loaded. Load assets and liabilities with repricing dates to compute the OCIF Schedule 7 repricing gap.',
          es: 'No hay un balance de situación segmentado por vencimiento. Cargue activos y pasivos con fechas de repreciación para calcular la brecha de repricing (OCIF Anejo 7).',
        }}
      />
    );
  }

  return (
    <>
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Brecha por Segmento de Vencimiento' : 'Gap by Maturity Bucket'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="assets"      name={locale === 'es' ? 'Activos' : 'Assets'}      fill="#06b6d4" radius={[4, 4, 0, 0]} />
            <Bar dataKey="liabilities" name={locale === 'es' ? 'Pasivos' : 'Liabilities'} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          OCIF Schedule 7 — {locale === 'es' ? 'Análisis de Brecha de Repricing' : 'Repricing Gap Analysis'}
        </p>
        <DataTable rows={data.buckets} columns={columns} locale={locale} rowKey={(r) => r.label} />
      </section>
    </>
  );
}

export default function RepricingGapPage() {
  return (
    <AlmPage<RepricingGapResult>
      slug="repricing-gap"
      iconTint="sky"
      validate={validateRepricing}
      getDemo={getDemo}
    >
      {(data) => <RepricingContent data={data} />}
    </AlmPage>
  );
}
