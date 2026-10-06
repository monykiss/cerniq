'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, Cell,
} from 'recharts';
import { Calculator, Building2, AlertTriangle, RefreshCw } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { useALM } from '@/components/alm/ALMProvider';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmPageSkeleton } from '@/components/alm/AlmPageSkeleton';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { useAlmEndpoint, formatAlmError } from '@/hooks/useAlmEndpoint';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

import {
  validateCooperativaCecl,
  isCooperativaDataUnavailable,
  mapClassificationRows,
  buildCooperativaStripItems,
  countGapSeverities,
  sideLabel,
  yesNoLabel,
  PR_OVERLAY_DISCLOSURE,
  COLD_START_NOTE,
  type CooperativaCECLResult,
  type ClassificationViewRow,
} from './cecl-cooperativa-helpers';

/**
 * CECL — migrated to the AlmPage shell.
 *
 * Primary analysis fetch goes through <AlmPage>. The 8-quarter forecast is
 * a secondary endpoint on the same module (`/api/alm/{id}/cecl/forecast`),
 * wired through a SECOND useAlmEndpoint call using pathSuffix='/forecast'.
 * Both fetches share the same state machine, abort controller, error
 * categorization, and opt-in demo fallback.
 */

// ─── Domain types ────────────────────────────────────────────────────────────

interface CECLSegmentResult {
  readonly segmentName: string;
  readonly balance: number;
  readonly methodology: string;
  readonly historicalLossRate: number;
  readonly qualitativeAdj: number;
  readonly adjustedLossRate: number;
  readonly expectedLoss: number;
  readonly allowanceRequired: number;
  readonly coverageRatio: number;
}

interface CECLMacroScenarios {
  readonly baseline: number;
  readonly adverse: number;
  readonly severelyAdverse: number;
  readonly weighted: number;
}

interface CECLSummary extends AlmDataShell {
  // D1: null when there are no CECL-eligible loan segments to allowance.
  readonly totalBalance: number | null;
  readonly totalAllowance: number | null;
  readonly weightedCoverageRatio: number | null;
  readonly methodology: string;
  readonly segments: readonly CECLSegmentResult[];
  readonly macroScenarioBreakdown?: CECLMacroScenarios;
}

interface CECLForecastQuarter {
  readonly quarter: string;
  readonly allowance: number;
  readonly provisionExpense: number;
  readonly netChargeOffs: number;
  readonly coverageRatio: number;
}

interface CECLForecast {
  readonly quarters: readonly CECLForecastQuarter[];
  readonly totalProvision12M: number;
}

type Methodology = 'warm' | 'vintage' | 'pdlgd' | 'cooperativa';
/** The three generic CECL methods, sharing one response shape + demo factory. */
type GenericMethodology = Exclude<Methodology, 'cooperativa'>;

// ─── Constants ───────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<Methodology, { readonly en: string; readonly es: string }> = {
  warm:        { en: 'WARM',          es: 'WARM' },
  vintage:     { en: 'Vintage',       es: 'Cosecha' },
  pdlgd:       { en: 'PD × LGD',      es: 'PD × LGD' },
  cooperativa: { en: 'Cooperativa PR', es: 'Cooperativa PR' },
};

const METHOD_LONG: Record<Methodology, { readonly en: string; readonly es: string }> = {
  warm:        { en: 'Weighted-Avg Remaining Life', es: 'Vida Remanente Ponderada' },
  vintage:     { en: 'Vintage / Cohort Analysis',   es: 'Análisis de Cosechas'   },
  pdlgd:       { en: 'PD × LGD (Macro Scenarios)',  es: 'PD × LGD (Macro)'        },
  cooperativa: { en: 'PD×LGD — PR Macro Overlay',   es: 'PD×LGD — Recargo Macro PR' },
};

const SEGMENT_COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#ec4899'] as const;

// ─── Validation + demo data ─────────────────────────────────────────────────

function validateCecl(raw: unknown): CECLSummary {
  if (!raw || typeof raw !== 'object') throw new Error('CECL response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null/zero-sentinel totals + gaps[]);
  // validate STRUCTURE only — `segments` is the array the content maps over.
  if (!Array.isArray(r.segments)) throw new Error('CECL: segments must be an array');
  return r as unknown as CECLSummary;
}

function getDemoSummary(method: GenericMethodology): CECLSummary {
  const segments: CECLSegmentResult[] = [
    { segmentName: 'Consumer Loans',      balance: 85,  methodology: 'WARM', historicalLossRate: 0.018, qualitativeAdj: 0.002, adjustedLossRate: 0.020, expectedLoss: 5.95, allowanceRequired: 5.95, coverageRatio: 0.070 },
    { segmentName: 'Auto Loans',          balance: 62,  methodology: 'WARM', historicalLossRate: 0.012, qualitativeAdj: 0.001, adjustedLossRate: 0.013, expectedLoss: 3.39, allowanceRequired: 3.39, coverageRatio: 0.055 },
    { segmentName: 'Commercial RE',       balance: 120, methodology: 'WARM', historicalLossRate: 0.008, qualitativeAdj: 0.003, adjustedLossRate: 0.011, expectedLoss: 9.90, allowanceRequired: 9.90, coverageRatio: 0.083 },
    { segmentName: 'Residential Mortgage',balance: 95,  methodology: 'WARM', historicalLossRate: 0.004, qualitativeAdj: 0.001, adjustedLossRate: 0.005, expectedLoss: 7.13, allowanceRequired: 7.13, coverageRatio: 0.075 },
    { segmentName: 'Credit Cards',        balance: 28,  methodology: 'WARM', historicalLossRate: 0.035, qualitativeAdj: 0.005, adjustedLossRate: 0.040, expectedLoss: 1.68, allowanceRequired: 1.68, coverageRatio: 0.060 },
    { segmentName: 'Commercial & Industrial', balance: 55, methodology: 'WARM', historicalLossRate: 0.015, qualitativeAdj: 0.002, adjustedLossRate: 0.017, expectedLoss: 4.68, allowanceRequired: 4.68, coverageRatio: 0.085 },
  ];
  const totalBalance = segments.reduce((s, r) => s + r.balance, 0);
  const totalAllowance = segments.reduce((s, r) => s + r.allowanceRequired, 0);
  return {
    totalBalance,
    totalAllowance,
    weightedCoverageRatio: totalAllowance / totalBalance,
    methodology: method.toUpperCase(),
    segments,
    ...(method === 'pdlgd' ? {
      macroScenarioBreakdown: {
        baseline: totalAllowance * 0.75,
        adverse: totalAllowance * 1.35,
        severelyAdverse: totalAllowance * 2.25,
        weighted: totalAllowance,
      },
    } : {}),
  };
}

function getDemoForecast(): CECLForecast {
  const now = new Date();
  return {
    quarters: Array.from({ length: 8 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + (i + 1) * 3, 1);
      return {
        quarter: `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`,
        allowance: 32.73 + i * 0.4,
        provisionExpense: 1.2 + i * 0.15,
        netChargeOffs: 0.8 + i * 0.08,
        coverageRatio: 0.073 + i * 0.001,
      };
    }),
    totalProvision12M: 6.4,
  };
}

// ─── Content component ─────────────────────────────────────────────────────

interface ContentProps {
  readonly analysis: CECLSummary;
  readonly methodology: GenericMethodology;
}

interface SegmentRow extends CECLSegmentResult {
  readonly color: string;
}

function validateCeclForecast(raw: unknown): CECLForecast {
  if (!raw || typeof raw !== 'object') throw new Error('CECL forecast must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.quarters)) throw new Error('CECL forecast: quarters must be an array');
  return r as unknown as CECLForecast;
}

function CeclContent({ analysis, methodology }: ContentProps) {
  const { locale } = useTranslation();
  const { selectedId } = useALM();

  // Secondary endpoint: /api/alm/{id}/cecl/forecast, routed through the
  // same discriminated-union state machine as the primary analysis fetch.
  const forecastState = useAlmEndpoint<CECLForecast>('cecl', {
    institutionId: selectedId,
    validate: validateCeclForecast,
    pathSuffix: '/forecast',
    getDemo: getDemoForecast,
  });
  const forecast = forecastState.status === 'success' ? forecastState.data : null;
  const { gaps, criticalCount, warningCount } = useReportDataGaps(analysis.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'total_balance',    label: locale === 'es' ? 'Balance Total'     : 'Total Balance',     value: analysis.totalBalance,  unit: 'USD_M' },
    { key: 'allowance_required', label: locale === 'es' ? 'Provisión'         : 'Allowance Required', value: analysis.totalAllowance, unit: 'USD_M' },
    { key: 'coverage_ratio',   label: locale === 'es' ? 'Cobertura'         : 'Coverage Ratio',    value: analysis.weightedCoverageRatio, unit: 'ratio' },
    { key: 'provision_12m',    label: locale === 'es' ? 'Provisión 12M'     : '12M Provision',     value: forecast?.totalProvision12M ?? null, unit: 'USD_M' },
    { key: 'segment_count',    label: locale === 'es' ? 'Segmentos'         : 'Segments',          value: analysis.segments.length, unit: 'count' },
    { key: 'methodology',      label: locale === 'es' ? 'Método'            : 'Methodology',       value: null,
      // Methodology shows as a static label via the strip's label override
    },
  ], [analysis, forecast, locale]);

  const segmentRows = useMemo<readonly SegmentRow[]>(
    () => analysis.segments.map((seg, i) => ({ ...seg, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length]! })),
    [analysis.segments],
  );

  const segmentColumns = useMemo<readonly DataTableColumn<SegmentRow>[]>(() => [
    {
      id: 'name',
      header: locale === 'es' ? 'Segmento' : 'Segment',
      kind: 'custom',
      accessor: (r) => r.segmentName,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
          {r.segmentName}
        </span>
      ),
    },
    { id: 'bal',  header: locale === 'es' ? 'Balance' : 'Balance',         kind: 'number', accessor: (r) => r.balance,           unit: 'USD_M' },
    { id: 'hist', header: locale === 'es' ? 'Tasa Hist.' : 'Hist. Rate',   kind: 'number', accessor: (r) => r.historicalLossRate, unit: 'ratio' },
    { id: 'qual', header: locale === 'es' ? 'Ajuste Q' : 'Qual. Adj.',     kind: 'number', accessor: (r) => r.qualitativeAdj,     unit: 'ratio' },
    { id: 'adj',  header: locale === 'es' ? 'Tasa Aj.' : 'Adj. Rate',      kind: 'number', accessor: (r) => r.adjustedLossRate,   unit: 'ratio' },
    { id: 'all',  header: locale === 'es' ? 'Provisión' : 'Allowance',     kind: 'number', accessor: (r) => r.allowanceRequired,  unit: 'USD_M' },
    { id: 'cov',  header: locale === 'es' ? 'Cobertura' : 'Coverage',      kind: 'number', accessor: (r) => r.coverageRatio,      unit: 'ratio' },
  ], [locale]);

  // D1: no CECL-eligible loan segments → honest neutral panel + gaps, never the
  // $0.0M zero-sentinel summary or the fabricated demo allowance.
  if (isDataUnavailable(analysis) || analysis.segments.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={analysis.gaps}
        message={{
          en: 'No CECL-eligible loan segments are loaded. Load the loan book (balances by segment) to compute the lifetime expected-credit-loss allowance.',
          es: 'No hay segmentos de préstamos elegibles para CECL. Cargue la cartera de préstamos (saldos por segmento) para calcular la provisión por pérdida crediticia esperada de por vida.',
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

      {analysis.macroScenarioBreakdown ? (
        <section className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-700">
            {locale === 'es' ? 'Desglose por Escenario Macro' : 'Macro Scenario Breakdown'}
          </p>
          <div className="grid grid-cols-4 gap-3">
            {([
              { label: locale === 'es' ? 'Base (50%)'      : 'Baseline (50%)',    value: analysis.macroScenarioBreakdown.baseline },
              { label: locale === 'es' ? 'Adverso (30%)'   : 'Adverse (30%)',     value: analysis.macroScenarioBreakdown.adverse },
              { label: locale === 'es' ? 'Sev. Adv. (20%)' : 'Sev. Adverse (20%)', value: analysis.macroScenarioBreakdown.severelyAdverse },
              { label: locale === 'es' ? 'Ponderado'       : 'Weighted',          value: analysis.macroScenarioBreakdown.weighted },
            ] as const).map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-[10px] text-purple-600">{label}</p>
                <p className="text-sm font-bold tabular-nums text-purple-900">${value.toFixed(2)}M</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Segment detail DataTable */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle por Segmento' : 'Segment Detail'}
          {' '}
          <span className="text-slate-300">— {METHOD_LONG[methodology][locale]}</span>
        </p>
        <DataTable rows={segmentRows} columns={segmentColumns} locale={locale} rowKey={(r) => r.segmentName} />
      </section>

      {/* Allowance by segment chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Provisión por Segmento' : 'Allowance by Segment'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={segmentRows as unknown as CECLSegmentResult[]} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tickFormatter={(v) => `$${Number(v).toFixed(1)}M`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="segmentName" tick={{ fontSize: 11 }} width={130} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value) => [`$${Number(value ?? 0).toFixed(3)}M`, '']}
            />
            <Bar dataKey="allowanceRequired" name={locale === 'es' ? 'Provisión' : 'Allowance'} radius={[0, 4, 4, 0]}>
              {segmentRows.map((row) => (
                <Cell key={row.segmentName} fill={row.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* 8-quarter forecast (secondary fetch) */}
      {forecast ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Pronóstico de Provisión — 8 Trimestres' : 'Allowance Forecast — 8 Quarters'}
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={forecast.quarters as CECLForecastQuarter[]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="quarter" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${Number(v).toFixed(1)}M`} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                formatter={(value) => [`$${Number(value ?? 0).toFixed(3)}M`, '']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="allowance"       stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={2}   name={locale === 'es' ? 'Provisión'       : 'Allowance'} />
              <Area type="monotone" dataKey="provisionExpense" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.10} strokeWidth={2}   name={locale === 'es' ? 'Gasto Provisión' : 'Provision Expense'} />
              <Area type="monotone" dataKey="netChargeOffs"    stroke="#ef4444" fill="#ef4444" fillOpacity={0.10} strokeWidth={1.5} name={locale === 'es' ? 'Castigos Netos'  : 'Net Charge-Offs'} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      ) : null}
    </>
  );
}

// ─── Cooperativa PR content (4th methodology) ───────────────────────────────
//
// PR-native CECL: wires GET /api/alm/{id}/cecl/cooperativa as a SECONDARY fetch
// (mirroring the forecast pattern above) rather than the generic /cecl. The
// response carries a productClassification[] the generic view lacks, so this
// branch renders its own honest loading / error / data states. No `getDemo` is
// supplied — D1: a PR-calibrated allowance is never fabricated.

function EligibilityPill({
  value,
  es,
}: {
  readonly value: boolean | null;
  readonly es: boolean;
}) {
  const dot =
    value === true ? 'bg-emerald-500' : value === false ? 'bg-slate-400' : 'bg-slate-300';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {yesNoLabel(value, es)}
    </span>
  );
}

function CooperativaCeclContent() {
  const { locale } = useTranslation();
  const { selectedId } = useALM();
  const es = locale === 'es';

  // Secondary endpoint on the same module: /api/alm/{id}/cecl/cooperativa.
  const state = useAlmEndpoint<CooperativaCECLResult>('cecl', {
    institutionId: selectedId,
    validate: validateCooperativaCecl,
    pathSuffix: '/cooperativa',
  });

  const data = state.status === 'success' ? state.data : null;

  const stripItems = useMemo<readonly MetricStripItem[]>(
    () => (data ? buildCooperativaStripItems(data, es) : []),
    [data, es],
  );
  const classificationRows = useMemo<readonly ClassificationViewRow[]>(
    () => (data ? mapClassificationRows(data.productClassification, es) : []),
    [data, es],
  );
  const gapCounts = useMemo(() => countGapSeverities(data?.gaps), [data]);

  const columns = useMemo<readonly DataTableColumn<ClassificationViewRow>[]>(
    () => [
      {
        id: 'segment',
        header: es ? 'Segmento' : 'Segment',
        kind: 'custom',
        accessor: (r) => r.segmentName,
        render: (r) => (
          <span className="text-xs font-medium text-slate-800">{r.segmentName}</span>
        ),
      },
      {
        id: 'product',
        header: es ? 'Tipo de Producto' : 'Product Type',
        kind: 'custom',
        accessor: (r) => r.productLabel,
        render: (r) => <span className="text-xs text-slate-700">{r.productLabel}</span>,
      },
      {
        id: 'side',
        header: es ? 'Lado' : 'Side',
        kind: 'custom',
        accessor: (r) => r.side,
        render: (r) => <span className="text-xs text-slate-600">{sideLabel(r.side, es)}</span>,
      },
      {
        id: 'eligible',
        header: es ? '¿Elegible CECL?' : 'CECL-eligible?',
        kind: 'custom',
        accessor: (r) => yesNoLabel(r.ceclEligible, es),
        render: (r) => <EligibilityPill value={r.ceclEligible} es={es} />,
      },
      {
        id: 'defaults',
        header: es ? '¿Defaults aplicados?' : 'Defaults applied?',
        kind: 'custom',
        accessor: (r) => yesNoLabel(r.defaultsApplied, es),
        render: (r) => (
          <span className="text-xs text-slate-600">{yesNoLabel(r.defaultsApplied, es)}</span>
        ),
      },
    ],
    [es],
  );

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <AlmPageSkeleton
        label={es ? 'Cargando CECL Cooperativa PR' : 'Loading Cooperativa PR CECL'}
      />
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center justify-center py-16">
        <div
          className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center"
          role="alert"
        >
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-rose-900">
            {es ? 'No se pudo cargar CECL Cooperativa PR' : 'Could not load Cooperativa PR CECL'}
          </p>
          <p className="mt-1 text-xs text-rose-700">{formatAlmError(state.error, locale)}</p>
          {/* retry is a synchronous nonce-bump (useAlmEndpoint) that swaps this
              branch for the loading skeleton — there is no per-button async
              state to track, so aria-busy is a static false baseline. Keeps
              SR a11y parity with the other Layer-1 ALM pages. */}
          <button
            type="button"
            onClick={state.retry}
            aria-busy={false}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {es ? 'Reintentar' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const unavailable = isCooperativaDataUnavailable(state.data);

  return (
    <>
      {/* Methodology provenance + honest status chip. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
          <Building2 className="h-3.5 w-3.5" aria-hidden />
          {es ? 'Metodología' : 'Methodology'}: {state.data.methodology}
        </span>
        {unavailable ? (
          <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            {es ? 'Datos insuficientes' : 'Insufficient data'}
          </span>
        ) : null}
      </div>

      {/* D1: enumerate every cold-start / unmatched-segment gap. */}
      {state.data.gaps && state.data.gaps.length > 0 ? (
        <DataGapBanner
          gaps={state.data.gaps}
          criticalCount={gapCounts.critical}
          warningCount={gapCounts.warning}
        />
      ) : null}

      {/* Allowance summary — `—` (never $0.0M) when data_unavailable. */}
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Product classification against the PR cooperativa registry. */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {es
            ? 'Clasificación de Productos (Registro Cooperativa PR)'
            : 'Product Classification (PR Cooperativa Registry)'}
        </p>
        {classificationRows.length > 0 ? (
          <DataTable
            rows={classificationRows}
            columns={columns}
            locale={locale}
            rowKey={(r) => r.segmentName}
          />
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            {es
              ? 'No hay segmentos para clasificar — cargue el libro de préstamos de la cooperativa.'
              : 'No segments to classify — load the cooperativa loan book.'}
          </p>
        )}
      </section>

      {/* Disclosed PR macro overlay — configuration, explicitly NOT data. */}
      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          {es
            ? 'Recargo Macro PR (configuración divulgada, no datos)'
            : 'PR Macro Overlay (disclosed configuration, not data)'}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {PR_OVERLAY_DISCLOSURE.map((s) => (
            <div
              key={s.key}
              className="rounded-lg border border-amber-200/70 bg-white px-3 py-2 text-center"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-amber-600">
                {es ? s.es : s.en}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-amber-900">
                ×{s.pdMultiplier.toFixed(1)}
              </p>
              <p className="text-[10px] text-amber-500">
                {es ? 'Peso' : 'Weight'} {s.weightPct}%
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
          {es ? COLD_START_NOTE.es : COLD_START_NOTE.en}
        </p>
      </section>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CECLPage() {
  const { locale } = useTranslation();
  const [methodology, setMethodology] = useState<Methodology>('warm');

  return (
    <AlmPage<CECLSummary>
      slug="cecl"
      iconTint="emerald"
      validate={validateCecl}
      getDemo={() => getDemoSummary(methodology === 'cooperativa' ? 'pdlgd' : methodology)}
      deps={[methodology]}
      controls={
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label={locale === 'es' ? 'Metodología' : 'Methodology'}>
          {(Object.keys(METHOD_LABELS) as Methodology[]).map((m) => {
            const active = methodology === m;
            const MethodIcon = m === 'cooperativa' ? Building2 : Calculator;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMethodology(m)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  active ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <MethodIcon className="h-3 w-3" />
                {METHOD_LABELS[m][locale]}
              </button>
            );
          })}
        </div>
      }
    >
      {(analysis) =>
        methodology === 'cooperativa' ? (
          <CooperativaCeclContent />
        ) : (
          <CeclContent analysis={analysis} methodology={methodology} />
        )
      }
    </AlmPage>
  );
}
