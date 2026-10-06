'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

/**
 * Yield Curve Modeling — migrated to AlmPage.
 *
 * Drops the edit-mode custom curve feature for now (it requires a POST to a
 * different endpoint). The core Nelson-Siegel fit, forward rates, and 6
 * Basel IRRBB shock scenarios are preserved along with the NII/EVE impact
 * DataTable. Restore edit mode in a follow-up by adding a second
 * useAlmEndpoint with method='POST' + pathSuffix='/custom-curve'.
 */

interface TenorRate {
  readonly tenor: number;
  readonly rate: number;
}

interface NelsonSiegelParams {
  readonly beta0: number;
  readonly beta1: number;
  readonly beta2: number;
  readonly lambda: number;
}

interface ShockedCurve {
  readonly shockType: string;
  readonly shockLabel: string;
  readonly baseCurve: readonly TenorRate[];
  readonly shockedCurve: readonly TenorRate[];
}

interface NIIImpactRow {
  readonly shockType: string;
  readonly label: string;
  readonly niiChangePct: number;
  readonly eveChangePct: number;
}

interface YieldCurveAnalysis {
  readonly baseCurve: readonly TenorRate[];
  readonly nelsonSiegelParams: NelsonSiegelParams;
  readonly forwardRates: readonly TenorRate[];
  readonly shockedCurves: readonly ShockedCurve[];
  readonly niiImpact: readonly NIIImpactRow[];
}

const TENOR_LABELS: Readonly<Record<number, string>> = {
  0.25: '3M', 0.5: '6M', 1: '1Y', 2: '2Y', 3: '3Y',
  5: '5Y', 7: '7Y', 10: '10Y', 20: '20Y', 30: '30Y',
};

const SHOCK_COLORS: Readonly<Record<string, string>> = {
  parallel_up:   '#dc2626',
  parallel_down: '#2563eb',
  steepener:     '#f59e0b',
  flattener:     '#8b5cf6',
  short_up:      '#ea580c',
  short_down:    '#06b6d4',
};

function validateYieldCurve(raw: unknown): YieldCurveAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('Yield curve response must be an object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.baseCurve)) throw new Error('Yield curve: baseCurve must be array');
  if (!Array.isArray(r.shockedCurves)) throw new Error('Yield curve: shockedCurves must be array');
  if (!r.nelsonSiegelParams || typeof r.nelsonSiegelParams !== 'object') throw new Error('Yield curve: missing nelsonSiegelParams');
  return r as unknown as YieldCurveAnalysis;
}

function getDemo(): YieldCurveAnalysis {
  const baseCurve: TenorRate[] = [
    { tenor: 0.25, rate: 0.0480 }, { tenor: 0.5, rate: 0.0465 }, { tenor: 1, rate: 0.0440 },
    { tenor: 2,    rate: 0.0420 }, { tenor: 3,   rate: 0.0410 }, { tenor: 5, rate: 0.0405 },
    { tenor: 7,    rate: 0.0410 }, { tenor: 10,  rate: 0.0420 }, { tenor: 20, rate: 0.0455 }, { tenor: 30, rate: 0.0465 },
  ];

  const shifts: Readonly<Record<string, Record<number, number>>> = {
    parallel_up:   Object.fromEntries(baseCurve.map((p) => [p.tenor,  200])),
    parallel_down: Object.fromEntries(baseCurve.map((p) => [p.tenor, -200])),
    steepener: { 0.25: -100, 0.5: -90, 1: -75, 2: -50, 3: -30, 5: 0, 7:  30, 10:  60, 20:  90, 30:  100 },
    flattener: { 0.25:  100, 0.5:  90, 1:  75, 2:  50, 3:  30, 5: 0, 7: -30, 10: -60, 20: -90, 30: -100 },
    short_up:  { 0.25:  300, 0.5: 275, 1: 250, 2: 200, 3: 150, 5: 75, 7:  40, 10:   0, 20:   0, 30:    0 },
    short_down:{ 0.25: -300, 0.5:-275, 1:-250, 2:-200, 3:-150, 5:-75, 7: -40, 10:   0, 20:   0, 30:    0 },
  };
  const shockDefs: Array<[string, string]> = [
    ['parallel_up',   'Parallel +200bps'],
    ['parallel_down', 'Parallel -200bps'],
    ['steepener',     'Steepener'],
    ['flattener',     'Flattener'],
    ['short_up',      'Short Rate +300bps'],
    ['short_down',    'Short Rate -300bps'],
  ];

  const shockedCurves: ShockedCurve[] = shockDefs.map(([type, label]) => ({
    shockType: type,
    shockLabel: label,
    baseCurve,
    shockedCurve: baseCurve.map((p) => ({
      tenor: p.tenor,
      rate: Math.max(0, p.rate + (shifts[type]?.[p.tenor] ?? 0) / 10000),
    })),
  }));

  return {
    baseCurve,
    nelsonSiegelParams: { beta0: 0.0465, beta1: -0.0025, beta2: -0.0060, lambda: 1.8 },
    forwardRates: [
      { tenor: 0.5, rate: 0.0450 }, { tenor: 1, rate: 0.0415 }, { tenor: 2, rate: 0.0400 },
      { tenor: 3,   rate: 0.0400 }, { tenor: 5, rate: 0.0398 }, { tenor: 7, rate: 0.0418 },
      { tenor: 10,  rate: 0.0435 }, { tenor: 20, rate: 0.0490 }, { tenor: 30, rate: 0.0495 },
    ],
    shockedCurves,
    niiImpact: [
      { shockType: 'parallel_up',   label: 'Parallel +200bps',   niiChangePct: 12.4, eveChangePct: -18.2 },
      { shockType: 'parallel_down', label: 'Parallel -200bps',   niiChangePct: -10.8, eveChangePct: 15.6 },
      { shockType: 'steepener',     label: 'Steepener',          niiChangePct:   3.2, eveChangePct:  -6.1 },
      { shockType: 'flattener',     label: 'Flattener',          niiChangePct:  -2.8, eveChangePct:   4.9 },
      { shockType: 'short_up',      label: 'Short Rate +300bps', niiChangePct:  18.7, eveChangePct:  -8.4 },
      { shockType: 'short_down',    label: 'Short Rate -300bps', niiChangePct: -16.2, eveChangePct:   7.1 },
    ],
  };
}

type ChartPoint = Record<string, string | number> & { tenor: string; base: number; forward?: number };

function YieldCurveContent({ data }: { data: YieldCurveAnalysis }) {
  const { locale } = useTranslation();
  const [activeShocks, setActiveShocks] = useState<Set<string>>(
    () => new Set(['parallel_up', 'steepener']),
  );

  const toggleShock = (type: string) => {
    setActiveShocks((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'beta0',        label: 'β₀ (Level)',      value: data.nelsonSiegelParams.beta0,  unit: 'ratio' },
    { key: 'beta1',        label: 'β₁ (Slope)',      value: data.nelsonSiegelParams.beta1,  unit: 'ratio' },
    { key: 'beta2',        label: 'β₂ (Curvature)',  value: data.nelsonSiegelParams.beta2,  unit: 'ratio' },
    { key: 'lambda',       label: 'λ (Decay)',       value: data.nelsonSiegelParams.lambda },
    { key: 'tenor_points', label: locale === 'es' ? 'Puntos Tenor' : 'Tenor Points', value: data.baseCurve.length, unit: 'count' },
    { key: 'shock_count',  label: locale === 'es' ? 'Choques' : 'Shocks',            value: data.shockedCurves.length, unit: 'count' },
  ], [data, locale]);

  const chartData = useMemo<ChartPoint[]>(() => {
    return data.baseCurve.map((point) => {
      const entry: ChartPoint = {
        tenor: TENOR_LABELS[point.tenor] ?? `${point.tenor}Y`,
        base: +(point.rate * 100).toFixed(3),
      };
      data.shockedCurves.forEach((sc) => {
        if (activeShocks.has(sc.shockType)) {
          const sp = sc.shockedCurve.find((p) => p.tenor === point.tenor);
          if (sp) entry[sc.shockType] = +(sp.rate * 100).toFixed(3);
        }
      });
      const fwd = data.forwardRates.find((f) => f.tenor === point.tenor);
      if (fwd) entry.forward = +(fwd.rate * 100).toFixed(3);
      return entry;
    });
  }, [data, activeShocks]);

  const impactColumns = useMemo<readonly DataTableColumn<NIIImpactRow>[]>(() => [
    { id: 'scenario', header: locale === 'es' ? 'Escenario' : 'Scenario', kind: 'custom',
      accessor: (r) => r.label,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SHOCK_COLORS[r.shockType] ?? '#94a3b8' }} aria-hidden />
          {r.label}
        </span>
      ),
      align: 'text-left',
    },
    { id: 'nii', header: locale === 'es' ? 'Cambio NII' : 'NII Change', kind: 'delta', accessor: (r) => r.niiChangePct, unit: '%' },
    { id: 'eve', header: locale === 'es' ? 'Cambio EVE' : 'EVE Change', kind: 'delta', accessor: (r) => r.eveChangePct, unit: '%' },
    {
      id: 'risk',
      header: locale === 'es' ? 'Riesgo' : 'Risk',
      kind: 'custom',
      accessor: (r) => {
        const m = Math.max(Math.abs(r.niiChangePct), Math.abs(r.eveChangePct));
        return m > 15 ? 'high' : m > 8 ? 'medium' : 'low';
      },
      align: 'text-center',
      render: (r) => {
        const m = Math.max(Math.abs(r.niiChangePct), Math.abs(r.eveChangePct));
        const tone = m > 15 ? { bg: 'bg-rose-50',    text: 'text-rose-700',    label: locale === 'es' ? 'Alto'  : 'High' } :
                     m > 8  ? { bg: 'bg-amber-50',   text: 'text-amber-700',   label: locale === 'es' ? 'Medio' : 'Medium' } :
                              { bg: 'bg-emerald-50', text: 'text-emerald-700', label: locale === 'es' ? 'Bajo'  : 'Low' };
        return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.bg} ${tone.text}`}>{tone.label}</span>;
      },
    },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Curvas: Base vs Choques' : 'Curves: Base vs Shocks'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(value) => `${Number(value ?? 0).toFixed(3)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="base"    stroke="#0f172a" strokeWidth={3}   dot={{ r: 4 }} name={locale === 'es' ? 'Curva Base' : 'Base Curve'} />
            <Line type="monotone" dataKey="forward" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name={locale === 'es' ? 'Forward' : 'Forward Rates'} />
            {data.shockedCurves
              .filter((sc) => activeShocks.has(sc.shockType))
              .map((sc) => (
                <Line
                  key={sc.shockType}
                  type="monotone"
                  dataKey={sc.shockType}
                  stroke={SHOCK_COLORS[sc.shockType] ?? '#6b7280'}
                  strokeWidth={2}
                  dot={false}
                  name={sc.shockLabel}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Shock toggles */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Escenarios Basel IRRBB' : 'Basel IRRBB Shock Scenarios'}
        </p>
        <div className="flex flex-wrap gap-2">
          {data.shockedCurves.map((sc) => {
            const active = activeShocks.has(sc.shockType);
            return (
              <button
                key={sc.shockType}
                type="button"
                onClick={() => toggleShock(sc.shockType)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SHOCK_COLORS[sc.shockType] ?? '#6b7280' }} aria-hidden />
                {sc.shockLabel}
              </button>
            );
          })}
        </div>
      </section>

      {/* NII / EVE impact DataTable */}
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Impacto NII / EVE por Escenario' : 'NII / EVE Impact by Scenario'}
        </p>
        <DataTable rows={data.niiImpact} columns={impactColumns} locale={locale} rowKey={(r) => r.shockType} />
      </section>
    </>
  );
}

export default function YieldCurvePage() {
  return (
    <AlmPage<YieldCurveAnalysis>
      slug="yield-curve"
      iconTint="cyan"
      validate={validateYieldCurve}
      getDemo={getDemo}
    >
      {(data) => <YieldCurveContent data={data} />}
    </AlmPage>
  );
}
