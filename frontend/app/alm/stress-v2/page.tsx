'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Play, RefreshCw, Check, X } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';

/**
 * DFAST Stress 2.0 — migrated to AlmPage.
 *
 * Behaviour change: the original page required clicking "Run" before any
 * data loaded. This version auto-loads via AlmPage's useAlmEndpoint on
 * mount and exposes a "Re-run" button via a run-nonce that bumps the
 * hook's deps. Users still get the explicit re-run affordance.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface StressQuarterPoint {
  readonly quarter: string;
  readonly nii: number;
  readonly nwr: number;
  readonly lcr: number;
  readonly eve: number;
  readonly nsfr: number;
  readonly el: number;
}

interface StressScenarioResult {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly quarters: readonly StressQuarterPoint[];
  readonly minNWR: number;
  readonly minLCR: number;
  readonly cumulativeNIILoss: number;
  readonly isCapitalAdequate: boolean;
  readonly narrativeEs: string;
  readonly narrativeEn: string;
}

// Registry endpoint returns an array, not a wrapped object.
type StressResponse = readonly StressScenarioResult[];

const SCENARIO_COLORS = ['#dc2626', '#f59e0b', '#8b5cf6'] as const;

// ─── Validation + demo ──────────────────────────────────────────────────────

function validateStress(raw: unknown): StressResponse {
  if (!Array.isArray(raw)) throw new Error('Stress response must be an array');
  for (const r of raw) {
    if (!r || typeof r !== 'object') throw new Error('Stress scenario must be an object');
    const s = r as Record<string, unknown>;
    if (typeof s.scenarioId !== 'string') throw new Error('Stress scenario missing scenarioId');
    if (!Array.isArray(s.quarters)) throw new Error('Stress scenario missing quarters array');
  }
  return raw as StressResponse;
}

function getDemo(): StressResponse {
  const mkQuarters = (base: number, trend: number): StressQuarterPoint[] =>
    Array.from({ length: 9 }, (_, q) => ({
      quarter: `Q${(q % 4) + 1} ${2026 + Math.floor(q / 4)}`,
      nii: +(3.2 + trend * q * 0.1).toFixed(2),
      nwr: +(base + trend * q * 0.3).toFixed(1),
      lcr: +(115 + trend * q * 2).toFixed(0),
      eve: 50,
      nsfr: 108,
      el: 0.5,
    }));
  return [
    { scenarioId: 'dfast-severe',     scenarioName: 'Severe Adverse', quarters: mkQuarters(9.2, -0.3),  minNWR: 6.5, minLCR: 88, cumulativeNIILoss: -4.2, isCapitalAdequate: false,
      narrativeEs: 'Bajo escenario severamente adverso, NWR cae a 6.5% — subcapitalizada.',
      narrativeEn: 'Under severe adverse, NWR falls to 6.5% — undercapitalized.' },
    { scenarioId: 'dfast-hurricane',  scenarioName: 'Hurricane',      quarters: mkQuarters(9.2, -0.5),  minNWR: 5.2, minLCR: 72, cumulativeNIILoss: -8.1, isCapitalAdequate: false,
      narrativeEs: 'Escenario huracán: NWR cae a 5.2%, LCR a 72%.',
      narrativeEn: 'Hurricane: NWR falls to 5.2%, LCR to 72%.' },
    { scenarioId: 'dfast-stagflation',scenarioName: 'Stagflation',    quarters: mkQuarters(9.2, -0.15), minNWR: 7.8, minLCR: 95, cumulativeNIILoss: -2.1, isCapitalAdequate: true,
      narrativeEs: 'Estanflación: institución mantiene capitalización adecuada.',
      narrativeEn: 'Stagflation: institution maintains adequate capitalization.' },
  ];
}

// ─── Content ─────────────────────────────────────────────────────────────────

interface ScenarioRow extends StressScenarioResult {
  readonly color: string;
}

function StressContent({ data }: { data: StressResponse }) {
  const { locale } = useTranslation();

  const rows = useMemo<readonly ScenarioRow[]>(
    () => data.map((s, i) => ({ ...s, color: SCENARIO_COLORS[i % SCENARIO_COLORS.length]! })),
    [data],
  );

  const stripItems = useMemo<readonly MetricStripItem[]>(() => {
    const worstNwr = Math.min(...data.map((s) => s.minNWR));
    const worstLcr = Math.min(...data.map((s) => s.minLCR));
    const adequateCount = data.filter((s) => s.isCapitalAdequate).length;
    const worstNiiLoss = Math.min(...data.map((s) => s.cumulativeNIILoss));
    return [
      { key: 'scenario_count',    label: locale === 'es' ? 'Escenarios'       : 'Scenarios',         value: data.length, unit: 'count' },
      { key: 'min_nwr',           label: locale === 'es' ? 'NWR Peor Caso'    : 'Worst-Case NWR',    value: worstNwr, unit: '%' },
      { key: 'min_lcr',           label: locale === 'es' ? 'LCR Peor Caso'    : 'Worst-Case LCR',    value: worstLcr, unit: '%' },
      { key: 'cum_nii_loss',      label: locale === 'es' ? 'Pérdida NII Acum.': 'Cum. NII Loss',     value: worstNiiLoss, unit: 'USD_M' },
      { key: 'adequate_count',    label: locale === 'es' ? 'Adecuados'         : 'Capital Adequate', value: adequateCount, unit: 'count' },
    ];
  }, [data, locale]);

  const columns = useMemo<readonly DataTableColumn<ScenarioRow>[]>(() => [
    {
      id: 'scenario',
      header: locale === 'es' ? 'Escenario' : 'Scenario',
      kind: 'custom',
      accessor: (r) => r.scenarioName,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
          {r.scenarioName}
        </span>
      ),
    },
    { id: 'min_nwr', header: 'Min NWR', kind: 'number', accessor: (r) => r.minNWR, unit: '%' },
    { id: 'min_lcr', header: 'Min LCR', kind: 'number', accessor: (r) => r.minLCR, unit: '%' },
    { id: 'cum_nii', header: locale === 'es' ? 'Pérdida NII' : 'NII Loss', kind: 'number', accessor: (r) => r.cumulativeNIILoss, unit: 'USD_M' },
    {
      id: 'status',
      header: locale === 'es' ? 'Adecuado' : 'Adequate',
      kind: 'custom',
      accessor: (r) => (r.isCapitalAdequate ? 'yes' : 'no'),
      align: 'text-center',
      render: (r) => (
        r.isCapitalAdequate
          ? <Check className="inline h-4 w-4 text-emerald-600" aria-label={locale === 'es' ? 'Adecuado' : 'Adequate'} />
          : <X     className="inline h-4 w-4 text-rose-600"    aria-label={locale === 'es' ? 'Inadecuado' : 'Inadequate'} />
      ),
    },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Resumen por Escenario' : 'Scenario Summary'}
        </p>
        <DataTable rows={rows} columns={columns} locale={locale} rowKey={(r) => r.scenarioId} />
      </section>

      {/* NWR path chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Trayectoria NWR — 9 Trimestres' : 'NWR Path — 9 Quarters'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="quarter" tick={{ fontSize: 10 }} allowDuplicatedCategory={false} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={7} stroke="#dc2626" strokeDasharray="8 4"
              label={{ value: '7% min', position: 'insideTopRight', style: { fontSize: 10, fill: '#dc2626' } }} />
            {rows.map((r) => (
              <Line
                key={r.scenarioId}
                data={r.quarters as StressQuarterPoint[]}
                type="monotone"
                dataKey="nwr"
                stroke={r.color}
                strokeWidth={2}
                dot={false}
                name={r.scenarioName}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Narratives */}
      <section className="space-y-2">
        {rows.map((r) => (
          <div key={r.scenarioId} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
              <p className="text-sm font-semibold text-slate-800">{r.scenarioName}</p>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{locale === 'es' ? r.narrativeEs : r.narrativeEn}</p>
          </div>
        ))}
      </section>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StressV2Page() {
  const { locale } = useTranslation();
  const [runNonce, setRunNonce] = useState(0);

  return (
    <AlmPage<StressResponse>
      slug="stress-v2"
      iconTint="red"
      validate={validateStress}
      getDemo={getDemo}
      deps={[runNonce]}
      controls={
        <button
          type="button"
          onClick={() => setRunNonce((n) => n + 1)}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
        >
          {runNonce === 0 ? <Play className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {runNonce === 0
            ? (locale === 'es' ? 'Ejecutar' : 'Run')
            : (locale === 'es' ? 'Re-ejecutar' : 'Re-run')}
        </button>
      }
    >
      {(data) => <StressContent data={data} />}
    </AlmPage>
  );
}
