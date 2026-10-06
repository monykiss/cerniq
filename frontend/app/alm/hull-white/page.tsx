'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Line,
} from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';

interface HullWhiteParams {
  readonly a: number;
  readonly sigma: number;
  readonly dt: number;
  readonly thetaPoints: number;
}

interface HullWhiteSimulation {
  readonly meanPath: readonly number[];
  readonly percentiles: Readonly<Record<string, readonly number[]>>;
  readonly samplePaths: readonly (readonly number[])[];
}

interface HullWhiteResult {
  readonly params: HullWhiteParams;
  readonly initialRate: number;
  readonly simulation: HullWhiteSimulation;
  readonly baseCurve: readonly { tenor: number; rate: number }[];
}

function validateHW(raw: unknown): HullWhiteResult {
  if (!raw || typeof raw !== 'object') throw new Error('Hull-White response must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.params || typeof r.params !== 'object') throw new Error('Hull-White: missing params');
  if (!r.simulation || typeof r.simulation !== 'object') throw new Error('Hull-White: missing simulation');
  const sim = r.simulation as Record<string, unknown>;
  if (!Array.isArray(sim.meanPath)) throw new Error('Hull-White: simulation.meanPath must be array');
  return r as unknown as HullWhiteResult;
}

function getDemo(): HullWhiteResult {
  const steps = 21;
  const r0 = 0.045;
  const meanPath = Array.from({ length: steps }, (_, i) => r0 + (i * 0.00015));
  return {
    params: { a: 0.1, sigma: 0.01, dt: 0.25, thetaPoints: 20 },
    initialRate: r0,
    simulation: {
      meanPath,
      percentiles: {
        p5:  meanPath.map((v, i) => v - 0.008 - i * 0.001),
        p25: meanPath.map((v, i) => v - 0.003 - i * 0.0004),
        p50: meanPath,
        p75: meanPath.map((v, i) => v + 0.003 + i * 0.0004),
        p95: meanPath.map((v, i) => v + 0.008 + i * 0.001),
      },
      samplePaths: Array.from({ length: 5 }, (_, k) =>
        meanPath.map((v, i) => v + Math.sin((i + k) * 0.4) * 0.005),
      ),
    },
    baseCurve: [
      { tenor: 0.25, rate: 0.048 },  { tenor: 0.5, rate: 0.0465 }, { tenor: 1, rate: 0.044 },
      { tenor: 2, rate: 0.042 },     { tenor: 3, rate: 0.041 },    { tenor: 5, rate: 0.0405 },
    ],
  };
}

interface ParamRow {
  readonly key: string;
  readonly label: { en: string; es: string };
  readonly value: string;
}

interface PercentileRow {
  readonly pct: 'p5' | 'p25' | 'p50' | 'p75' | 'p95';
  readonly terminal: number;
}

function HullWhiteContent({ data }: { data: HullWhiteResult }) {
  const { locale } = useTranslation();

  const terminalRate = data.simulation.meanPath[data.simulation.meanPath.length - 1] ?? 0;
  const terminalP95 = data.simulation.percentiles.p95?.[data.simulation.percentiles.p95.length - 1] ?? 0;
  const terminalP5 = data.simulation.percentiles.p5?.[data.simulation.percentiles.p5.length - 1] ?? 0;
  const rangeBps = (terminalP95 - terminalP5) * 10000;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'initial_rate',   label: locale === 'es' ? 'Tasa Inicial'   : 'Initial Rate',  value: data.initialRate, unit: 'ratio' },
    { key: 'terminal_rate',  label: locale === 'es' ? 'Tasa Terminal'  : 'Terminal Rate', value: terminalRate,     unit: 'ratio' },
    { key: 'range_bps',      label: locale === 'es' ? 'Rango 90%'      : '90% Range',     value: rangeBps,         unit: 'bps' },
    { key: 'kappa',          value: data.params.a },
    { key: 'sigma',          value: data.params.sigma, unit: 'ratio' },
    { key: 'theta_points',   label: 'θ pts', value: data.params.thetaPoints, unit: 'count' },
  ], [data, terminalRate, rangeBps, locale]);

  const fanChartData = useMemo(
    () => data.simulation.meanPath.map((_, i) => ({
      quarter: `Q${i}`,
      p5:   +((data.simulation.percentiles.p5?.[i]  ?? 0) * 100).toFixed(2),
      p25:  +((data.simulation.percentiles.p25?.[i] ?? 0) * 100).toFixed(2),
      mean: +((data.simulation.meanPath[i]          ?? 0) * 100).toFixed(2),
      p75:  +((data.simulation.percentiles.p75?.[i] ?? 0) * 100).toFixed(2),
      p95:  +((data.simulation.percentiles.p95?.[i] ?? 0) * 100).toFixed(2),
    })),
    [data],
  );

  const paramRows = useMemo<readonly ParamRow[]>(() => [
    { key: 'a',            label: { en: 'Mean Reversion Speed (a)', es: 'Velocidad Reversión (a)' }, value: String(data.params.a) },
    { key: 'sigma',        label: { en: 'Volatility (σ)',            es: 'Volatilidad (σ)' },        value: String(data.params.sigma) },
    { key: 'dt',           label: { en: 'Time Step (Δt)',            es: 'Paso Temporal (Δt)' },     value: `${data.params.dt} y` },
    { key: 'theta_points', label: { en: 'Calibrated θ Points',       es: 'Puntos θ Calibrados' },    value: String(data.params.thetaPoints) },
    { key: 'paths',        label: { en: 'Simulated Paths',           es: 'Trayectorias Simuladas' }, value: '500' },
  ], [data]);

  const paramColumns = useMemo<readonly DataTableColumn<ParamRow>[]>(() => [
    { id: 'label', header: locale === 'es' ? 'Parámetro' : 'Parameter', kind: 'custom',
      accessor: (r) => r.label[locale],
      render: (r) => <span className="text-xs text-slate-600">{r.label[locale]}</span>,
      align: 'text-left',
    },
    { id: 'val',   header: locale === 'es' ? 'Valor' : 'Value', kind: 'custom',
      accessor: (r) => r.value,
      render: (r) => <span className="font-mono text-xs font-bold tabular-nums text-slate-950">{r.value}</span>,
    },
  ], [locale]);

  const percentileRows = useMemo<readonly PercentileRow[]>(
    () => (['p5', 'p25', 'p50', 'p75', 'p95'] as const).map((pct) => {
      const arr = data.simulation.percentiles[pct];
      return { pct, terminal: arr?.[arr.length - 1] ?? 0 };
    }),
    [data],
  );

  const percentileColumns = useMemo<readonly DataTableColumn<PercentileRow>[]>(() => [
    { id: 'pct',      header: locale === 'es' ? 'Percentil' : 'Percentile', kind: 'text',
      accessor: (r) => r.pct.toUpperCase() },
    { id: 'terminal', header: locale === 'es' ? 'Tasa 5Y' : '5Y Rate',      kind: 'number',
      accessor: (r) => r.terminal, unit: 'ratio' },
  ], [locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Fan chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Fan Chart — Tasa Corta 5 Años' : 'Fan Chart — Short Rate 5Y'}
        </h3>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={fanChartData}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="p95" name="P95" stroke="none" fill="#c4b5fd" fillOpacity={0.3} />
            <Area type="monotone" dataKey="p75" name="P75" stroke="none" fill="#a78bfa" fillOpacity={0.3} />
            <Area type="monotone" dataKey="p25" name="P25" stroke="none" fill="#a78bfa" fillOpacity={0.3} />
            <Area type="monotone" dataKey="p5"  name="P5"  stroke="none" fill="#c4b5fd" fillOpacity={0.3} />
            <Line type="monotone" dataKey="mean" name={locale === 'es' ? 'Media' : 'Mean'} stroke="#7c3aed" strokeWidth={2.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Parámetros del Modelo' : 'Model Parameters'}
          </p>
          <DataTable rows={paramRows} columns={paramColumns} locale={locale} rowKey={(r) => r.key} />
        </section>
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Distribución Terminal (5Y)' : 'Terminal Distribution (5Y)'}
          </p>
          <DataTable rows={percentileRows} columns={percentileColumns} locale={locale} rowKey={(r) => r.pct} />
        </section>
      </div>
    </>
  );
}

export default function HullWhitePage() {
  return (
    <AlmPage<HullWhiteResult>
      slug="hull-white"
      iconTint="violet"
      method="POST"
      body={{ numPaths: 500, horizonYears: 5 }}
      validate={validateHW}
      getDemo={getDemo}
    >
      {(data) => <HullWhiteContent data={data} />}
    </AlmPage>
  );
}
