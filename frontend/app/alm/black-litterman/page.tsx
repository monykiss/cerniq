'use client';

import { useMemo } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

/**
 * Black-Litterman — Bayesian posterior allocation (POST endpoint).
 *
 * Uses useAlmEndpoint's method='POST' support. Empty body '{}' for now;
 * when the backend accepts view overrides we'll wire them into the body
 * via the hook's `body` prop.
 */

interface BLView {
  readonly asset: string;
  readonly view: string;
  readonly confidence: number;
}

interface BLRadarPoint {
  readonly asset: string;
  readonly prior: number;
  readonly posterior: number;
}

interface BLResult extends AlmDataShell {
  readonly priorWeights: Readonly<Record<string, number>>;
  readonly posteriorWeights: Readonly<Record<string, number>>;
  // D1: null when there is no investable portfolio / market equilibrium to
  // anchor the Bayesian posterior.
  readonly expectedReturn: number | null;
  readonly riskBudget: number | null;
  readonly sharpeRatio: number | null;
  readonly views: readonly BLView[];
  readonly radarData: readonly BLRadarPoint[];
}

function validateBL(raw: unknown): BLResult {
  if (!raw || typeof raw !== 'object') throw new Error('BL response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null returns + gaps[]); validate
  // STRUCTURE only — the arrays the content maps over.
  if (!Array.isArray(r.views)) throw new Error('BL: views must be array');
  if (!Array.isArray(r.radarData)) throw new Error('BL: radarData must be array');
  return r as unknown as BLResult;
}

function getDemo(): BLResult {
  return {
    expectedReturn: 0.0682,
    riskBudget: 0.112,
    sharpeRatio: 0.61,
    views: [
      { asset: 'US Treasuries', view: 'Outperform +50bp', confidence: 0.85 },
      { asset: 'MBS',           view: 'Underperform -30bp', confidence: 0.60 },
      { asset: 'Munis',         view: 'Outperform +40bp', confidence: 0.75 },
    ],
    priorWeights:     { 'US Treasuries': 0.25, MBS: 0.20, Munis: 0.15, Corporates: 0.20, 'Agency Bonds': 0.10, Cash: 0.10 },
    posteriorWeights: { 'US Treasuries': 0.32, MBS: 0.14, Munis: 0.22, Corporates: 0.18, 'Agency Bonds': 0.08, Cash: 0.06 },
    radarData: [
      { asset: 'US Treasuries', prior: 0.25, posterior: 0.32 },
      { asset: 'MBS',           prior: 0.20, posterior: 0.14 },
      { asset: 'Munis',         prior: 0.15, posterior: 0.22 },
      { asset: 'Corporates',    prior: 0.20, posterior: 0.18 },
      { asset: 'Agency Bonds',  prior: 0.10, posterior: 0.08 },
      { asset: 'Cash',          prior: 0.10, posterior: 0.06 },
    ],
  };
}

function BLContent({ data }: { data: BLResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'expected_return', label: locale === 'es' ? 'Retorno Esperado'    : 'Expected Return', value: data.expectedReturn, unit: 'ratio' },
    { key: 'risk_budget',     label: locale === 'es' ? 'Presupuesto Riesgo'  : 'Risk Budget',     value: data.riskBudget,     unit: 'ratio' },
    { key: 'sharpe',          value: data.sharpeRatio, unit: 'x' },
    { key: 'view_count',      label: locale === 'es' ? 'Opiniones'           : 'Active Views',    value: data.views.length,   unit: 'count' },
    { key: 'asset_count',     label: locale === 'es' ? 'Clases Activo'       : 'Asset Classes',   value: data.radarData.length, unit: 'count' },
  ], [data, locale]);

  const weightsColumns = useMemo<readonly DataTableColumn<BLRadarPoint>[]>(() => [
    { id: 'asset',     header: locale === 'es' ? 'Clase de Activo' : 'Asset Class', kind: 'text', accessor: (r) => r.asset },
    { id: 'prior',     header: locale === 'es' ? 'Prior (CAPM)'    : 'Prior (CAPM)', kind: 'number', accessor: (r) => r.prior, unit: 'ratio' },
    { id: 'posterior', header: locale === 'es' ? 'Posterior (BL)'  : 'Posterior (BL)', kind: 'number', accessor: (r) => r.posterior, unit: 'ratio' },
    { id: 'delta',     header: 'Δ', kind: 'delta', accessor: (r) => (r.posterior - r.prior) * 100, unit: 'bps' },
  ], [locale]);

  const viewColumns = useMemo<readonly DataTableColumn<BLView>[]>(() => [
    { id: 'asset', header: locale === 'es' ? 'Activo'     : 'Asset',     kind: 'text',   accessor: (r) => r.asset },
    { id: 'view',  header: locale === 'es' ? 'Opinión'    : 'View',      kind: 'custom', accessor: (r) => r.view,
      render: (r) => <span className="text-xs text-slate-700">{r.view}</span>,
      align: 'text-left' },
    { id: 'conf',  header: locale === 'es' ? 'Confianza'  : 'Confidence', kind: 'number', accessor: (r) => r.confidence, unit: 'ratio' },
  ], [locale]);

  // D1: no investable portfolio to anchor the posterior → honest neutral panel.
  if (isDataUnavailable(data) || data.radarData.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'Black-Litterman needs an investable portfolio and its market-equilibrium weights. Load the securities portfolio to compute the Bayesian posterior allocation.',
          es: 'Black-Litterman requiere una cartera invertible y sus pesos de equilibrio de mercado. Cargue la cartera de valores para calcular la asignación posterior bayesiana.',
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

      {/* Prior vs Posterior radar */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pesos: Prior vs Posterior' : 'Prior vs Posterior Weights'}
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <RadarChart data={data.radarData as BLRadarPoint[]}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="asset" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Radar name={locale === 'es' ? 'Prior (CAPM)'  : 'Prior (CAPM)'}   dataKey="prior"     stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.2} />
            <Radar name={locale === 'es' ? 'Posterior (BL)' : 'Posterior (BL)'} dataKey="posterior" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
          </RadarChart>
        </ResponsiveContainer>
      </section>

      {/* Weights table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pesos por Clase de Activo' : 'Weights by Asset Class'}
        </p>
        <DataTable
          rows={data.radarData}
          columns={weightsColumns}
          locale={locale}
          rowKey={(r) => r.asset}
        />
      </section>

      {/* Views table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Opiniones del Inversor' : 'Investor Views'}
        </p>
        <DataTable
          rows={data.views}
          columns={viewColumns}
          locale={locale}
          rowKey={(r) => r.asset}
        />
      </section>
    </>
  );
}

export default function BlackLittermanPage() {
  return (
    <AlmPage<BLResult>
      slug="black-litterman"
      iconTint="indigo"
      method="POST"
      body={{}}
      validate={validateBL}
      getDemo={getDemo}
    >
      {(data) => <BLContent data={data} />}
    </AlmPage>
  );
}
