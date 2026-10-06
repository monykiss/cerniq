'use client';

import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ZAxis,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface FrontierPoint {
  readonly risk: number;
  readonly ret: number;
  readonly label: string;
}

interface WeightRow {
  readonly asset: string;
  readonly current: number;
  readonly optimal: number;
}

interface CVaRResult extends AlmDataShell {
  // D1: null when there is no investable portfolio to optimize against.
  readonly optimalReturn: number | null;
  readonly optimalCVaR: number | null;
  readonly optimalSharpe: number | null;
  readonly confidenceLevel: number;
  readonly frontier: readonly FrontierPoint[];
  readonly currentPortfolio: { readonly risk: number; readonly ret: number } | null;
  readonly optimalPortfolio: { readonly risk: number; readonly ret: number } | null;
  readonly weights: readonly WeightRow[];
}

function validateCVaR(raw: unknown): CVaRResult {
  if (!raw || typeof raw !== 'object') throw new Error('CVaR response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null optimalReturn + gaps[]);
  // validate STRUCTURE only — the arrays the content maps over.
  if (!Array.isArray(r.frontier)) throw new Error('CVaR: frontier must be array');
  if (!Array.isArray(r.weights)) throw new Error('CVaR: weights must be array');
  return r as unknown as CVaRResult;
}

function getDemo(): CVaRResult {
  const frontier = Array.from({ length: 15 }, (_, i) => ({
    risk: +(0.02 + i * 0.006).toFixed(5),
    ret:  +(0.03 + i * 0.004).toFixed(5),
    label: `P${i + 1}`,
  }));
  return {
    optimalReturn: 0.072,
    optimalCVaR: 0.054,
    optimalSharpe: 0.68,
    confidenceLevel: 95,
    frontier,
    currentPortfolio: { risk: 0.065, ret: 0.055 },
    optimalPortfolio: { risk: 0.054, ret: 0.072 },
    weights: [
      { asset: 'US Treasuries', current: 0.30, optimal: 0.25 },
      { asset: 'MBS',           current: 0.25, optimal: 0.18 },
      { asset: 'Munis',         current: 0.10, optimal: 0.22 },
      { asset: 'Corporates',    current: 0.20, optimal: 0.20 },
      { asset: 'Agency Bonds',  current: 0.10, optimal: 0.10 },
      { asset: 'Cash',          current: 0.05, optimal: 0.05 },
    ],
  };
}

function CVaRContent({ data }: { data: CVaRResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'optimal_return',  label: locale === 'es' ? 'Retorno Óptimo'   : 'Optimal Return', value: data.optimalReturn, unit: 'ratio' },
    { key: 'optimal_cvar',    label: `CVaR ${data.confidenceLevel}%`,     value: data.optimalCVaR,   unit: 'ratio' },
    { key: 'optimal_sharpe',  label: 'Sharpe',                            value: data.optimalSharpe, unit: 'x' },
    { key: 'current_return',  label: locale === 'es' ? 'Retorno Actual'   : 'Current Return', value: data.currentPortfolio?.ret ?? null, unit: 'ratio' },
    { key: 'current_cvar',    label: locale === 'es' ? 'Riesgo Actual'    : 'Current Risk', value: data.currentPortfolio?.risk ?? null, unit: 'ratio' },
    { key: 'improvement',     label: locale === 'es' ? 'Mejora Retorno'   : 'Return Uplift',
      value: data.optimalPortfolio && data.currentPortfolio ? (data.optimalPortfolio.ret - data.currentPortfolio.ret) * 10000 : null, unit: 'bps' },
  ], [data, locale]);

  const columns = useMemo<readonly DataTableColumn<WeightRow>[]>(() => [
    { id: 'asset',   header: locale === 'es' ? 'Clase' : 'Asset Class', kind: 'text',   accessor: (r) => r.asset },
    { id: 'current', header: locale === 'es' ? 'Actual'   : 'Current',   kind: 'number', accessor: (r) => r.current, unit: 'ratio' },
    { id: 'optimal', header: locale === 'es' ? 'Óptimo'   : 'Optimal',   kind: 'number', accessor: (r) => r.optimal, unit: 'ratio' },
    { id: 'delta',   header: 'Δ', kind: 'delta', accessor: (r) => (r.optimal - r.current) * 10000, unit: 'bps' },
  ], [locale]);

  // D1: no investable portfolio to optimize → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.frontier.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'CVaR optimization needs an investable portfolio with a loss-scenario set. Load the securities portfolio to compute the efficient frontier.',
          es: 'La optimización CVaR requiere una cartera invertible con un conjunto de escenarios de pérdida. Cargue la cartera de valores para calcular la frontera eficiente.',
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

      {/* Efficient frontier */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Frontera Eficiente CVaR' : 'CVaR Efficient Frontier'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="risk"
              name={locale === 'es' ? 'Riesgo (CVaR)' : 'Risk (CVaR)'}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
            />
            <YAxis
              dataKey="ret"
              name={locale === 'es' ? 'Retorno' : 'Return'}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
            />
            <ZAxis range={[50, 50]} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(2)}%`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Scatter name={locale === 'es' ? 'Frontera' : 'Frontier'} data={data.frontier as FrontierPoint[]} fill="#8b5cf6" />
            <Scatter name={locale === 'es' ? 'Actual'   : 'Current'} data={data.currentPortfolio ? [data.currentPortfolio] : []} fill="#dc2626" />
            <Scatter name={locale === 'es' ? 'Óptimo'   : 'Optimal'} data={data.optimalPortfolio ? [data.optimalPortfolio] : []} fill="#059669" />
          </ScatterChart>
        </ResponsiveContainer>
      </section>

      {/* Weights table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pesos: Actual vs Óptimo' : 'Weights: Current vs Optimal'}
        </p>
        <DataTable rows={data.weights} columns={columns} locale={locale} rowKey={(r) => r.asset} />
      </section>
    </>
  );
}

export default function CVaROptimizerPage() {
  return (
    <AlmPage<CVaRResult>
      slug="cvar-optimizer"
      iconTint="violet"
      method="POST"
      body={{}}
      validate={validateCVaR}
      getDemo={getDemo}
    >
      {(data) => <CVaRContent data={data} />}
    </AlmPage>
  );
}
