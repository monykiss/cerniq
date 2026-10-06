'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
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
 * NIM Attribution — migrated to AlmPage.
 *
 * Decomposes the quarter-over-quarter NIM delta into contributing factors
 * (rate environment, deposit beta, volume, mix, repricing lag, prepayment,
 * credit quality). Bars above the reference line contribute positively to
 * NIM; below the line drag NIM down.
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1): the backend now returns honest
 * shells — `status:'data_unavailable'` (null fields + CRITICAL gap) on an empty
 * balance sheet, or `status:'ok'` with a real `nimCurrent` but null
 * `nimPrior`/`nimDeltaBps` + empty `attribution` + a WARNING gap when there is
 * no prior board-report snapshot to attribute the change against.
 * `validateNim` accepts those shells (it never throws on a null numeric, only
 * on a non-object / non-array `attribution`), and the content renders the
 * honest gap (`<AlmDataUnavailable>` / `<DataGapBanner>` + `—`) rather than
 * the page's `getDemo` sample. `getDemo` survives ONLY as the labeled
 * network/server-error fallback (the amber "Sample data" banner via
 * `source === 'demo'`).
 */

interface NIMAttributionFactor {
  readonly factor: string;
  readonly factorEs: string;
  readonly bps: number;
  readonly explanation: string;
  readonly explanationEs: string;
}

interface NIMAttributionData extends AlmDataShell {
  // D1: nullable per the backend shell. `nimCurrent` is null when there is no
  // earning-asset base; `nimPrior`/delta/explained/residual are null and
  // `attribution` empty when no prior board-report snapshot exists.
  readonly nimCurrent: number | null;
  readonly nimPrior: number | null;
  readonly nimDeltaBps: number | null;
  readonly attribution: readonly NIMAttributionFactor[];
  readonly totalExplainedBps: number | null;
  readonly residualBps: number | null;
}

function validateNim(raw: unknown): NIMAttributionData {
  if (!raw || typeof raw !== 'object') throw new Error('NIM response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: a `data_unavailable` shell is a VALID 200 response (null numerics +
  // gaps[]), not a schema error. Validate STRUCTURE only — `attribution` is the
  // array the content maps over. NEVER throw on a null `nimCurrent`/`nimPrior`,
  // or the honest gap would be mis-routed into the getDemo sample fallback.
  if (!Array.isArray(r.attribution)) throw new Error('NIM: attribution must be an array');
  return r as unknown as NIMAttributionData;
}

function getDemo(): NIMAttributionData {
  return {
    nimCurrent: 3.42,
    nimPrior: 3.68,
    nimDeltaBps: -26,
    attribution: [
      { factor: 'Rate Environment', factorEs: 'Entorno de Tasas',    bps: -9, explanation: 'Fed rate changes impacting repricing.', explanationEs: 'Cambios Fed impactando repreciación.' },
      { factor: 'Deposit Beta',     factorEs: 'Beta de Depósitos',   bps: -7, explanation: 'Deposit costs rising faster than yields.', explanationEs: 'Costos de depósitos subiendo más rápido.' },
      { factor: 'Volume Growth',    factorEs: 'Crecimiento Volumen', bps:  4, explanation: 'New loans at current rates.', explanationEs: 'Nuevos préstamos a tasas actuales.' },
      { factor: 'Mix Shift',        factorEs: 'Cambio en Mezcla',    bps: -3, explanation: 'Shift toward lower-yield assets.', explanationEs: 'Movimiento hacia activos de menor rendimiento.' },
      { factor: 'Repricing Lag',    factorEs: 'Rezago Repreciación', bps: -5, explanation: 'Fixed-rate assets not yet repriced.', explanationEs: 'Activos de tasa fija sin repreciar.' },
      { factor: 'Prepayment',       factorEs: 'Prepago',             bps: -4, explanation: 'High-rate mortgages prepaying.', explanationEs: 'Hipotecas de alta tasa prepagando.' },
      { factor: 'Credit Quality',   factorEs: 'Calidad Crediticia',  bps: -2, explanation: 'Higher provisions.', explanationEs: 'Mayor provisión.' },
    ],
    totalExplainedBps: -26,
    residualBps: 0,
  };
}

function NimContent({ data }: { data: NIMAttributionData }) {
  const { locale } = useTranslation();
  const es = locale === 'es';
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'nim_prior',     label: es ? 'NIM Previo'   : 'NIM Prior',   value: data.nimPrior,   unit: '%' },
    { key: 'nim_current',   label: es ? 'NIM Actual'   : 'NIM Current', value: data.nimCurrent, unit: '%' },
    { key: 'nim_delta',     label: es ? 'Cambio NIM'   : 'NIM Change',  value: data.nimDeltaBps,unit: 'bps' },
    { key: 'explained_bps', label: es ? 'Explicado'    : 'Explained',   value: data.totalExplainedBps, unit: 'bps' },
    { key: 'residual_bps',  label: es ? 'Residual'     : 'Residual',    value: data.residualBps, unit: 'bps' },
  ], [data, es]);

  const chartData = useMemo(
    () => data.attribution.map((f) => ({
      name: es ? f.factorEs : f.factor,
      bps: f.bps,
    })),
    [data, es],
  );

  type FactorRow = NIMAttributionFactor;
  const columns = useMemo<readonly DataTableColumn<FactorRow>[]>(() => [
    {
      id: 'factor',
      header: es ? 'Factor' : 'Factor',
      kind: 'custom',
      accessor: (r) => r.factor,
      render: (r) => <span className="text-xs font-medium text-slate-800">{es ? r.factorEs : r.factor}</span>,
    },
    { id: 'bps',  header: 'bps',                                    kind: 'number', accessor: (r) => r.bps, unit: 'bps' },
    { id: 'exp',  header: es ? 'Explicación' : 'Explanation', kind: 'custom',
      accessor: (r) => r.explanation,
      render: (r) => (
        <span className="text-[11px] text-slate-500">{es ? r.explanationEs : r.explanation}</span>
      ),
      align: 'text-left',
    },
  ], [es]);

  // D1: no earning-asset base / empty balance sheet → honest neutral panel,
  // never a fabricated sample.
  if (isDataUnavailable(data)) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'NIM attribution needs a loaded balance sheet with an earning-asset base. Load it to decompose the margin change by factor.',
          es: 'La atribución del NIM requiere un balance de situación con base de activos productivos. Cárguelo para descomponer el cambio del margen por factor.',
        }}
      />
    );
  }

  const hasAttribution = chartData.length > 0;

  return (
    <>
      {/* D1: WARNING/partial gaps (e.g. no prior board-report snapshot) render
          alongside the real current-NIM rather than papering over them. */}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {hasAttribution ? (
        <>
          {/* Waterfall */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {es ? 'Cascada de Factores NIM (bps)' : 'NIM Factor Waterfall (bps)'}
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'bps', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="bps" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.bps >= 0 ? '#059669' : '#dc2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>

          {/* Factor detail table */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {es ? 'Detalle por Factor' : 'Factor Detail'}
            </p>
            <DataTable
              rows={data.attribution}
              columns={columns}
              locale={locale}
              rowKey={(r) => r.factor}
            />
          </section>
        </>
      ) : (
        /* D1 partial: current NIM is real but the change cannot be attributed
           without a prior snapshot — explain instead of drawing an empty chart. */
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          {es
            ? 'El NIM actual está disponible, pero no hay un NIM previo (de un informe de junta anterior) para descomponer el cambio por factor. Genere un informe de junta para establecer una línea base.'
            : 'The current NIM is available, but there is no prior NIM (from an earlier board report) to decompose the change by factor. Generate a board report to set a baseline.'}
        </section>
      )}
    </>
  );
}

export default function NIMAttributionPage() {
  return (
    <AlmPage<NIMAttributionData>
      slug="nim-attribution"
      iconTint="amber"
      validate={validateNim}
      getDemo={getDemo}
    >
      {(data) => <NimContent data={data} />}
    </AlmPage>
  );
}
