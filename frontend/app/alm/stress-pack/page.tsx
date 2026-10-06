'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Check, X, AlertTriangle } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps, type DataGap } from '@/hooks/useReportDataGaps';

type RegulatoryStatus = 'PASS' | 'WATCH' | 'FAIL';

interface StressPackResult {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly scenarioNameEs: string;
  // D1: every COMPUTED field is null when there is no balance sheet to stress
  // (the 5 COSSEC scenarios are a fixed reference catalog; their status flips
  // to data_unavailable with a per-scenario CRITICAL gap).
  readonly daysOfLiquidity: number | null;
  readonly lcr: number | null;
  readonly hqlaCoverage: number | null;
  readonly availableLiquid: number | null;
  readonly netOutflow: number | null;
  readonly surplus: number | null;
  readonly regulatoryStatus: RegulatoryStatus | null;
  readonly narrative: string | null;
  readonly narrativeEs: string | null;
  readonly status?: 'ok' | 'data_unavailable';
  readonly gaps?: DataGap[];
}

type StressPackResponse = readonly StressPackResult[];

const STATUS_STYLES: Record<RegulatoryStatus, { bg: string; text: string; border: string; bar: string }> = {
  PASS:  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: '#059669' },
  WATCH: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   bar: '#d97706' },
  FAIL:  { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    bar: '#dc2626' },
};

// D1: a data_unavailable scenario has a null regulatoryStatus — render it as a
// neutral gray semáforo, never coerced into a PASS/FAIL.
const NEUTRAL_STYLE = { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', bar: '#94a3b8' };
function statusStyle(s: RegulatoryStatus | null) {
  return s ? STATUS_STYLES[s] : NEUTRAL_STYLE;
}

function validateStressPack(raw: unknown): StressPackResponse {
  if (!Array.isArray(raw)) throw new Error('Stress pack response must be an array');
  for (const r of raw) {
    if (!r || typeof r !== 'object') throw new Error('Stress pack scenario must be an object');
    const s = r as Record<string, unknown>;
    // D1: scenarioId is reference data (always present); the computed
    // daysOfLiquidity is null in the data_unavailable shell — never throw on it.
    if (typeof s.scenarioId !== 'string') throw new Error('Stress pack scenario missing scenarioId');
  }
  return raw as StressPackResponse;
}

function getDemo(): StressPackResponse {
  return [
    { scenarioId: 'SCEN-1', scenarioName: '72-Hour Acute Stress',   scenarioNameEs: 'Estrés Agudo 72 Horas',     daysOfLiquidity:  8, lcr:  62, hqlaCoverage:  62, availableLiquid: 45, netOutflow: 72,   surplus: -27,  regulatoryStatus: 'FAIL',  narrative: 'Under 72-hour acute stress, 8 days of liquidity.',   narrativeEs: 'Bajo estrés agudo 72 horas, 8 días de liquidez.' },
    { scenarioId: 'SCEN-2', scenarioName: '30-Day Prolonged Stress', scenarioNameEs: 'Estrés Prolongado 30 Días', daysOfLiquidity: 42, lcr:  85, hqlaCoverage:  85, availableLiquid: 52, netOutflow: 61,   surplus:  -9,  regulatoryStatus: 'WATCH', narrative: 'Under 30-day prolonged stress, 42 days of liquidity.', narrativeEs: 'Bajo estrés prolongado 30 días, 42 días de liquidez.' },
    { scenarioId: 'SCEN-3', scenarioName: 'Seasonal Outflow',        scenarioNameEs: 'Salida Estacional',         daysOfLiquidity: 65, lcr: 135, hqlaCoverage: 135, availableLiquid: 52, netOutflow: 38.5, surplus: 13.5, regulatoryStatus: 'PASS',  narrative: 'Under seasonal outflow, 65 days of liquidity.',      narrativeEs: 'Bajo salida estacional, 65 días de liquidez.' },
    { scenarioId: 'SCEN-4', scenarioName: 'Member Concentration',    scenarioNameEs: 'Concentración de Socios',   daysOfLiquidity:  3, lcr:  28, hqlaCoverage:  28, availableLiquid: 20, netOutflow: 72,   surplus: -52,  regulatoryStatus: 'FAIL',  narrative: 'Under member concentration, 3 days of liquidity.',   narrativeEs: 'Bajo concentración de socios, 3 días de liquidez.' },
    { scenarioId: 'SCEN-5', scenarioName: 'Hurricane/Disaster',      scenarioNameEs: 'Huracán/Desastre',          daysOfLiquidity: 12, lcr:  48, hqlaCoverage:  48, availableLiquid: 35, netOutflow: 72,   surplus: -37,  regulatoryStatus: 'FAIL',  narrative: 'Under hurricane scenario, 12 days of liquidity.',    narrativeEs: 'Bajo escenario de huracán, 12 días de liquidez.' },
  ];
}

function StressPackContent({ data }: { data: StressPackResponse }) {
  const { locale } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? data.find((r) => r.scenarioId === selectedId) ?? null : null;

  // D1: collect the per-scenario gap manifest (each data_unavailable scenario
  // carries the same EMPTY_BALANCE_SHEET gap) and de-dup to a representative one.
  const shellGaps = data.find((r) => r.gaps && r.gaps.length > 0)?.gaps;
  const { gaps, criticalCount, warningCount } = useReportDataGaps(shellGaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => {
    const passCount = data.filter((r) => r.regulatoryStatus === 'PASS').length;
    const failCount = data.filter((r) => r.regulatoryStatus === 'FAIL').length;
    // D1: null computed fields drop out of the worst-case reduction — never
    // coerced to 0 (which would read as the worst possible liquidity).
    const days = data.map((r) => r.daysOfLiquidity).filter((n): n is number => n != null);
    const lcrs = data.map((r) => r.lcr).filter((n): n is number => n != null);
    const worstDays = days.length > 0 ? Math.min(...days) : null;
    const worstLcr = lcrs.length > 0 ? Math.min(...lcrs) : null;
    return [
      { key: 'scenario_count', label: locale === 'es' ? 'Escenarios' : 'Scenarios', value: data.length, unit: 'count' },
      { key: 'pass_count',     label: 'PASS',  value: passCount, unit: 'count' },
      { key: 'fail_count',     label: 'FAIL',  value: failCount, unit: 'count' },
      { key: 'worst_days',     label: locale === 'es' ? 'Peor Caso Días' : 'Worst-Case Days', value: worstDays, unit: 'days' },
      { key: 'worst_lcr',      label: locale === 'es' ? 'Peor Caso LCR'  : 'Worst-Case LCR',  value: worstLcr,  unit: '%' },
    ];
  }, [data, locale]);

  const chartData = useMemo(
    () => data.map((r) => ({ name: r.scenarioId, days: r.daysOfLiquidity, status: r.regulatoryStatus })),
    [data],
  );

  const columns = useMemo<readonly DataTableColumn<StressPackResult>[]>(() => [
    { id: 'scenario', header: locale === 'es' ? 'Escenario' : 'Scenario', kind: 'custom',
      accessor: (r) => r.scenarioId,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs text-slate-800">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusStyle(r.regulatoryStatus).bar }} aria-hidden />
          <span className="font-mono font-bold">{r.scenarioId}</span>
          <span className="text-slate-500">{locale === 'es' ? r.scenarioNameEs : r.scenarioName}</span>
        </span>
      ),
      align: 'text-left',
    },
    { id: 'days',   header: locale === 'es' ? 'Días Liq.'  : 'Days Liq.',  kind: 'number', accessor: (r) => r.daysOfLiquidity, unit: 'days' },
    { id: 'lcr',    header: 'LCR',                                       kind: 'number', accessor: (r) => r.lcr,  unit: '%' },
    { id: 'hqla',   header: locale === 'es' ? 'HQLA Disp.' : 'Avail HQLA', kind: 'number', accessor: (r) => r.availableLiquid, unit: 'USD_M' },
    { id: 'outflow',header: locale === 'es' ? 'Salida Neta' : 'Net Outflow', kind: 'number', accessor: (r) => r.netOutflow,    unit: 'USD_M' },
    { id: 'surplus',header: locale === 'es' ? 'Excedente'   : 'Surplus',     kind: 'delta', accessor: (r) => r.surplus,        unit: 'USD_M' },
    {
      id: 'status',
      header: locale === 'es' ? 'Estado' : 'Status',
      kind: 'custom',
      accessor: (r) => r.regulatoryStatus,
      align: 'text-center',
      render: (r) => {
        const s = statusStyle(r.regulatoryStatus);
        return (
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.bg} ${s.text} ${s.border}`}>
            {r.regulatoryStatus === 'PASS' ? <Check className="h-2.5 w-2.5" /> :
             r.regulatoryStatus === 'FAIL' ? <X className="h-2.5 w-2.5" /> :
             r.regulatoryStatus === 'WATCH' ? <AlertTriangle className="h-2.5 w-2.5" /> : null}
            {r.regulatoryStatus ?? '—'}
          </span>
        );
      },
    },
  ], [locale]);

  // D1: every scenario data_unavailable (no balance sheet to stress) → honest
  // neutral panel + the gap manifest, never the fabricated 5-scenario sample.
  if (data.length === 0 || data.every((r) => r.status === 'data_unavailable')) {
    return (
      <AlmDataUnavailable
        gaps={shellGaps}
        message={{
          en: 'No balance sheet or liquidity position is loaded. Load them to run the 5 COSSEC liquidity stress scenarios.',
          es: 'No hay balance de situación ni posición de liquidez cargados. Cárguelos para correr los 5 escenarios de estrés de liquidez COSSEC.',
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

      {/* Days of liquidity chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Días de Liquidez por Escenario' : 'Days of Liquidity by Scenario'}
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: locale === 'es' ? 'Días' : 'Days', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Bar
              dataKey="days"
              radius={[4, 4, 0, 0]}
              onClick={(d: { name?: string }) => d?.name && setSelectedId((cur) => (cur === d.name ? null : d.name!))}
              style={{ cursor: 'pointer' }}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={statusStyle(entry.status).bar} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* COSSEC table */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Tabla COSSEC — Formato de Examen' : 'COSSEC Table — Examination Format'}
        </p>
        <DataTable rows={data} columns={columns} locale={locale} rowKey={(r) => r.scenarioId} />
      </section>

      {/* Detail panel */}
      {selected ? (
        <section className={`rounded-xl border p-5 ${statusStyle(selected.regulatoryStatus).bg} ${statusStyle(selected.regulatoryStatus).border}`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-950">
              {selected.scenarioId}: {locale === 'es' ? selected.scenarioNameEs : selected.scenarioName}
            </p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-slate-500 hover:text-slate-700"
              aria-label={locale === 'es' ? 'Cerrar detalle' : 'Close detail'}
            >
              ✕
            </button>
          </div>
          <p className="text-sm leading-relaxed text-slate-700">
            {locale === 'es' ? selected.narrativeEs : selected.narrative}
          </p>
        </section>
      ) : null}
    </>
  );
}

export default function StressPackPage() {
  return (
    <AlmPage<StressPackResponse>
      slug="stress-pack"
      iconTint="rose"
      validate={validateStressPack}
      getDemo={getDemo}
    >
      {(data) => <StressPackContent data={data} />}
    </AlmPage>
  );
}
