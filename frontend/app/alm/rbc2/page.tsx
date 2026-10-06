'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
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
 * NCUA Risk-Based Capital (RBC2) — D1-hardened + wired to the real backend.
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1): NO `getDemo` fallback is
 * supplied — an NCUA capital filing (Letter 15-CU-02) must never render a
 * fabricated sample. Two problems were fixed together: (1) the page's result
 * shape NEVER matched the backend — `validateRBC2` required `rbc2Ratio` while
 * `ncua-rbc2.service` returns `riskBasedCapitalRatio` (+ `isWellCapitalized`,
 * a `{nameEs,riskWeight,exposure,charge}` component shape, a narrative, and NO
 * `thresholds`), so the real 200-OK response THREW in validate and the page
 * fell to the fabricated getDemo() (an 11.49% ratio / $285.4M RWA) on EVERY
 * load; (2) on an empty balance sheet the backend returns an honest
 * `overallStatus:'data_unavailable'` shell (null numerics + a CRITICAL
 * EMPTY_BALANCE_SHEET gap). This page now consumes the real shape, renders the
 * data_unavailable shell as <AlmDataUnavailable>, and discloses the standing
 * IRR-duration WARNING gap via <DataGapBanner>. A genuine network / 5xx error
 * renders <AlmPage>'s error screen. Rewired + dropped getDemo 2026-06-08.
 *
 * NOTE: `riskBasedCapitalRatio` is already a PERCENT (e.g. 11.49), not a
 * fraction — it is displayed directly, never ×100.
 */

interface RBC2Component {
  readonly name: string;
  readonly nameEs: string;
  readonly riskWeight: number;
  readonly exposure: number;
  readonly charge: number;
}

interface RBC2Result extends AlmDataShell {
  readonly components: readonly RBC2Component[];
  readonly totalRiskWeightedAssets: number | null;
  readonly totalRiskBasedCapitalCharge: number | null;
  readonly netWorth: number | null;
  readonly riskBasedCapitalRatio: number | null; // already a percent (e.g. 11.49)
  readonly isWellCapitalized: boolean;
  readonly isAdequatelyCapitalized: boolean;
  readonly surplus: number | null;
  readonly narrativeEs: string;
  readonly narrativeEn: string;
}

// NCUA RBC2 capital thresholds (Letter 15-CU-02), fixed reference percentages.
const WELL_CAPITALIZED_PCT = 10;
const ADEQUATELY_CAPITALIZED_PCT = 8;

const COMPONENT_COLORS = [
  '#0ea5e9', '#6366f1', '#f59e0b', '#10b981',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
] as const;

function validateRBC2(raw: unknown): RBC2Result {
  if (!raw || typeof raw !== 'object') throw new Error('RBC2 response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null `riskBasedCapitalRatio` +
  // gaps[]) — validate STRUCTURE only. `components` is the array the content
  // maps over; NEVER throw on a null numeric or the honest gap would be
  // mis-routed into an error screen.
  if (!Array.isArray(r.components)) throw new Error('RBC2: components must be an array');
  return r as unknown as RBC2Result;
}

interface ComponentRow extends RBC2Component {
  readonly label: string;
  readonly color: string;
}

function RBC2Content({ data }: { data: RBC2Result }) {
  const { locale } = useTranslation();
  const es = locale === 'es';
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const componentRows = useMemo<readonly ComponentRow[]>(
    () =>
      data.components.map((c, i) => ({
        ...c,
        label: es ? c.nameEs : c.name,
        color: COMPONENT_COLORS[i % COMPONENT_COLORS.length]!,
      })),
    [data, es],
  );

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'rbc2_ratio',      label: es ? 'Ratio RBC2'      : 'RBC2 Ratio',     value: data.riskBasedCapitalRatio,    unit: '%' },
    { key: 'net_worth',       label: es ? 'Patrimonio Neto'  : 'Net Worth',     value: data.netWorth,                 unit: 'USD_M' },
    { key: 'total_rwa',       label: es ? 'Activos Pond.'   : 'Risk-Weighted',  value: data.totalRiskWeightedAssets,  unit: 'USD_M' },
    { key: 'surplus',         label: es ? 'Excedente'       : 'Surplus',        value: data.surplus,                  unit: 'USD_M' },
    { key: 'component_count', label: es ? 'Componentes'     : 'Components',     value: data.components.length,        unit: 'count' },
  ], [data, es]);

  const columns = useMemo<readonly DataTableColumn<ComponentRow>[]>(() => [
    { id: 'name', header: es ? 'Componente' : 'Component', kind: 'custom',
      accessor: (r) => r.label,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs text-slate-700">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
          {r.label}
        </span>
      ),
      align: 'text-left',
    },
    { id: 'weight',   header: es ? 'Peso'      : 'Weight',   kind: 'number', accessor: (r) => r.riskWeight, unit: 'ratio' },
    { id: 'exposure', header: es ? 'Exposición' : 'Exposure', kind: 'number', accessor: (r) => r.exposure,  unit: 'USD_M' },
    { id: 'charge',   header: es ? 'Cargo'     : 'Charge',   kind: 'number', accessor: (r) => r.charge,     unit: 'USD_M' },
  ], [es]);

  // D1: balance sheet not loaded → honest neutral panel + the CRITICAL gap,
  // never a fabricated NCUA capital filing.
  if (isDataUnavailable(data)) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No balance sheet is loaded. Load assets and liabilities before computing risk-based capital (RBC2) — filing against phantom data is a regulatory exposure.',
          es: 'No hay balance de situación cargado. Cargue los activos y pasivos antes de calcular el capital basado en riesgo (RBC2) — radicar con datos ficticios es una exposición regulatoria.',
        }}
      />
    );
  }

  const status = data.isWellCapitalized ? 'well' : data.isAdequatelyCapitalized ? 'adequate' : 'under';
  const statusStyles = {
    well:     { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: es ? 'Bien Capitalizado' : 'Well Capitalized' },
    adequate: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   label: es ? 'Adecuadamente Capitalizado' : 'Adequately Capitalized' },
    under:    { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    label: es ? 'Subcapitalizado' : 'Undercapitalized' },
  }[status];

  return (
    <>
      {/* D1: disclose the standing IRR-duration placeholder (and any other)
          WARNING gaps rather than papering over them. */}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Status banner */}
      <section className={`flex items-center justify-between rounded-xl border p-4 ${statusStyles.bg} ${statusStyles.border}`}>
        <div>
          <p className={`text-sm font-bold ${statusStyles.text}`}>{statusStyles.label}</p>
          <p className="text-xs text-slate-600">
            {es
              ? `Bien ≥${WELL_CAPITALIZED_PCT}% · Adecuado ≥${ADEQUATELY_CAPITALIZED_PCT}% — Carta NCUA 15-CU-02`
              : `Well ≥${WELL_CAPITALIZED_PCT}% · Adequate ≥${ADEQUATELY_CAPITALIZED_PCT}% — NCUA Letter 15-CU-02`}
          </p>
        </div>
        <div className={`font-mono text-xl font-bold tabular-nums ${statusStyles.text}`}>
          {data.riskBasedCapitalRatio != null ? `${data.riskBasedCapitalRatio.toFixed(2)}%` : '—'}
        </div>
      </section>

      {/* Component charge waterfall */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {es ? 'Componentes Ponderados por Riesgo' : 'Risk-Weighted Components'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={componentRows as unknown as RBC2Component[]} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, es ? 'Cargo' : 'Charge']}
            />
            <Bar dataKey="charge" radius={[0, 4, 4, 0]}>
              {componentRows.map((c) => (
                <Cell key={c.label} fill={c.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Component detail table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {es ? 'Detalle de Componentes' : 'Component Detail'}
        </p>
        <DataTable rows={componentRows} columns={columns} locale={locale} rowKey={(r) => r.label} />
      </section>

      {/* Narrative — the backend's plain-language conclusion. */}
      {(es ? data.narrativeEs : data.narrativeEn) ? (
        <p className="text-xs leading-relaxed text-slate-600">
          {es ? data.narrativeEs : data.narrativeEn}
        </p>
      ) : null}
    </>
  );
}

export default function RBC2Page() {
  return (
    <AlmPage<RBC2Result>
      slug="rbc2"
      iconTint="blue"
      validate={validateRBC2}
    >
      {(data) => <RBC2Content data={data} />}
    </AlmPage>
  );
}
