'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { Play, RotateCcw } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface ForwardNIIQuarter {
  readonly quarter: string;
  readonly baselineNII: number;
  readonly shockedNII: number;
  readonly delta: number;
  readonly deltaPct: number;
}

type ForwardNIIResponse = readonly ForwardNIIQuarter[];

const TENORS: readonly { key: string; label: string }[] = [
  { key: '0.25', label: '3M' }, { key: '0.5', label: '6M' }, { key: '1', label: '1Y' },
  { key: '2',   label: '2Y' }, { key: '3',   label: '3Y' }, { key: '5', label: '5Y' },
  { key: '7',   label: '7Y' }, { key: '10',  label: '10Y' }, { key: '20', label: '20Y' }, { key: '30', label: '30Y' },
];

const PRESETS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  parallel_up:   Object.fromEntries(TENORS.map((t) => [t.key,  200])),
  parallel_down: Object.fromEntries(TENORS.map((t) => [t.key, -200])),
  steepener: { '0.25': -100, '0.5': -90, '1': -75, '2': -50, '3': -30, '5': 0, '7':  30, '10':  60, '20':  90, '30':  100 },
  flattener: { '0.25':  100, '0.5':  90, '1':  75, '2':  50, '3':  30, '5': 0, '7': -30, '10': -60, '20': -90, '30': -100 },
  short_up:  { '0.25':  300, '0.5': 275, '1': 250, '2': 200, '3': 150, '5': 75, '7':  40, '10':   0, '20':   0, '30':    0 },
};

const ZERO_SHOCKS: Readonly<Record<string, number>> = Object.fromEntries(TENORS.map((t) => [t.key, 0]));

function validateForwardNII(raw: unknown): ForwardNIIResponse {
  if (!Array.isArray(raw)) throw new Error('Forward-NII response must be an array');
  for (const q of raw) {
    if (!q || typeof q !== 'object') throw new Error('Forward-NII quarter must be an object');
    const s = q as Record<string, unknown>;
    if (typeof s.quarter !== 'string') throw new Error('Forward-NII quarter missing quarter label');
    if (typeof s.baselineNII !== 'number' || typeof s.shockedNII !== 'number') throw new Error('Forward-NII quarter missing numeric fields');
  }
  return raw as ForwardNIIResponse;
}

function makeDemoNII(shocks: Record<string, number>): ForwardNIIResponse {
  const avgShock = Object.values(shocks).reduce((a, b) => a + b, 0) / Math.max(1, Object.values(shocks).length);
  const now = new Date();
  return Array.from({ length: 12 }, (_, q) => {
    const qDate = new Date(now.getFullYear(), now.getMonth() + q * 3, 1);
    const base = 3.2 * (1 + q * 0.005);
    const effect = (avgShock / 10000) * base * Math.min(1, q / 4);
    return {
      quarter: `Q${Math.ceil((qDate.getMonth() + 1) / 3)} ${qDate.getFullYear()}`,
      baselineNII: +base.toFixed(2),
      shockedNII:  +(base + effect).toFixed(2),
      delta:       +effect.toFixed(2),
      deltaPct:    +((effect / base) * 100).toFixed(1),
    };
  });
}

function RateShockContent({ data }: { data: ForwardNIIResponse }) {
  const { locale } = useTranslation();

  const stripItems = useMemo<readonly MetricStripItem[]>(() => {
    const totalBaseline = data.reduce((s, q) => s + q.baselineNII, 0);
    const totalShocked  = data.reduce((s, q) => s + q.shockedNII, 0);
    const totalDelta = totalShocked - totalBaseline;
    const worstQuarter = data.reduce((worst, q) => (q.deltaPct < worst.deltaPct ? q : worst), data[0]!);
    return [
      { key: 'quarters',       label: locale === 'es' ? 'Trimestres' : 'Quarters', value: data.length, unit: 'count' },
      { key: 'total_baseline', label: locale === 'es' ? 'NII Base Total'    : 'Total Baseline NII', value: totalBaseline, unit: 'USD_M' },
      { key: 'total_shocked',  label: locale === 'es' ? 'NII Choque Total'  : 'Total Shocked NII',  value: totalShocked,  unit: 'USD_M' },
      { key: 'total_delta',    label: locale === 'es' ? 'Δ Total'           : 'Total Δ',            value: totalDelta,    unit: 'USD_M' },
      { key: 'worst_quarter',  label: locale === 'es' ? 'Peor Trimestre Δ'  : 'Worst Quarter Δ',    value: worstQuarter.deltaPct, unit: '%' },
    ];
  }, [data, locale]);

  const columns = useMemo<readonly DataTableColumn<ForwardNIIQuarter>[]>(() => [
    { id: 'quarter', header: 'Q',                                  kind: 'text',   accessor: (r) => r.quarter, align: 'text-left' },
    { id: 'base',    header: locale === 'es' ? 'Base'     : 'Base',    kind: 'number', accessor: (r) => r.baselineNII, unit: 'USD_M' },
    { id: 'shocked', header: locale === 'es' ? 'Choque'   : 'Shocked', kind: 'number', accessor: (r) => r.shockedNII,  unit: 'USD_M' },
    { id: 'delta',   header: 'Δ ($M)',                                 kind: 'delta',  accessor: (r) => r.delta,       unit: 'USD_M' },
    { id: 'delta_pct', header: 'Δ %',                                  kind: 'delta',  accessor: (r) => r.deltaPct,    unit: '%' },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* NII waterfall chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Cascada NII: Base vs Choque — 12 Trimestres' : 'NII Waterfall: Base vs Shocked — 12 Quarters'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data as ForwardNIIQuarter[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="quarter" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, '']} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="baselineNII" name={locale === 'es' ? 'NII Base' : 'Baseline NII'} fill="#06b6d4" radius={[4, 4, 0, 0]} />
            <Bar dataKey="shockedNII"  name={locale === 'es' ? 'NII Choque' : 'Shocked NII'} fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Quarter-by-quarter DataTable */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Detalle Trimestral' : 'Quarter-by-Quarter Detail'}
        </p>
        <DataTable rows={data} columns={columns} locale={locale} rowKey={(r) => r.quarter} />
      </section>
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RateShockV2Page() {
  const { locale } = useTranslation();
  const [liveShocks, setLiveShocks] = useState<Record<string, number>>({ ...ZERO_SHOCKS });
  const [committedShocks, setCommittedShocks] = useState<Record<string, number>>({ ...ZERO_SHOCKS });
  const [runNonce, setRunNonce] = useState(0);

  const curveBars = useMemo(
    () => TENORS.map((t) => ({ tenor: t.label, shock: liveShocks[t.key] ?? 0 })),
    [liveShocks],
  );

  const updateShock = (tenor: string, bps: number) => {
    setLiveShocks((prev) => ({ ...prev, [tenor]: bps }));
  };

  const applyPreset = (preset: Readonly<Record<string, number>>) => {
    setLiveShocks({ ...preset });
  };

  const resetShocks = () => {
    setLiveShocks({ ...ZERO_SHOCKS });
  };

  const runSim = () => {
    setCommittedShocks({ ...liveShocks });
    setRunNonce((n) => n + 1);
  };

  return (
    <AlmPage<ForwardNIIResponse>
      slug="rate-shock-v2"
      iconTint="amber"
      method="POST"
      body={{ shockBpsPerTenor: committedShocks, quarters: 12 }}
      deps={[runNonce]}
      validate={validateForwardNII}
      getDemo={() => makeDemoNII(committedShocks)}
      controls={
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {(['parallel_up', 'parallel_down', 'steepener', 'flattener', 'short_up'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => applyPreset(PRESETS[k]!)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:border-orange-300 hover:bg-orange-50"
              >
                {k === 'parallel_up'   ? (locale === 'es' ? 'Par +200' : 'Par +200') :
                 k === 'parallel_down' ? (locale === 'es' ? 'Par -200' : 'Par -200') :
                 k === 'steepener'     ? (locale === 'es' ? 'Empin.'   : 'Steep') :
                 k === 'flattener'     ? (locale === 'es' ? 'Aplan.'   : 'Flat') :
                                         (locale === 'es' ? 'Corto +300' : 'Short +300')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={resetShocks}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:border-slate-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          <button
            type="button"
            onClick={runSim}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600"
          >
            <Play className="h-3.5 w-3.5" />
            {locale === 'es' ? 'Ejecutar' : 'Run'}
          </button>
        </div>
      }
    >
      {(data) => (
        <>
          {/* Shock shape visualization — rendered in-content so users see
              their edits before they click Run. */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {locale === 'es' ? 'Forma del Choque (Editable)' : 'Shock Shape (Editable)'}
            </p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={curveBars}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'bps', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="shock" radius={[4, 4, 0, 0]}>
                  {curveBars.map((e) => (
                    <Cell key={e.tenor} fill={e.shock >= 0 ? '#f59e0b' : '#2563eb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-5 gap-2 md:grid-cols-10">
              {TENORS.map((t) => (
                <label key={t.key} className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] text-slate-400">{t.label}</span>
                  <input
                    type="number"
                    step={25}
                    value={liveShocks[t.key] ?? 0}
                    onChange={(e) => updateShock(t.key, parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded border border-slate-300 bg-white px-1 py-1 text-center text-[11px] tabular-nums focus:border-orange-400 focus:outline-none"
                    aria-label={`${t.label} shock in basis points`}
                  />
                </label>
              ))}
            </div>
          </section>

          <RateShockContent data={data} />
        </>
      )}
    </AlmPage>
  );
}
