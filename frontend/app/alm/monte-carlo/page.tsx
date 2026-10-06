'use client';

import { useMemo, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Play, RefreshCw } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

/**
 * Monte Carlo — Vasicek short-rate path simulation with user-tunable
 * parameters. Migrated to AlmPage with a POST endpoint via pathSuffix='/run'
 * and a two-body pattern: a `live` body drives the input controls, and a
 * `committed` body is what AlmPage actually POSTs. Clicking Run copies
 * live → committed and bumps the nonce, re-firing the fetch.
 */

interface VasicekParams {
  readonly kappa: number;
  readonly theta: number;
  readonly sigma: number;
  readonly r0: number;
}

interface MCFanPoint {
  readonly quarter: string;
  readonly p5: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}

interface MCDistribution {
  readonly buckets: readonly { readonly min: number; readonly max: number; readonly count: number }[];
  readonly mean: number;
  readonly std: number;
}

interface MonteCarloResult extends AlmDataShell {
  readonly paths: number;
  readonly quarters: number;
  // D1: null when there is no balance sheet to simulate NII paths over.
  readonly vasicekParams: VasicekParams | null;
  readonly meanNII: number | null;
  readonly stdNII: number | null;
  readonly var95NII: number | null;
  readonly cvar99NII: number | null;
  readonly meanEVE?: number;
  readonly var95EVE?: number;
  readonly fanChart: readonly MCFanPoint[];
  readonly distribution: MCDistribution | null;
}

interface RunBody {
  readonly paths: number;
  readonly quarters: number;
  readonly kappa: number;
  readonly theta: number;
  readonly sigma: number;
}

function validateMC(raw: unknown): MonteCarloResult {
  if (!raw || typeof raw !== 'object') throw new Error('Monte Carlo response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null meanNII + gaps[]); validate
  // STRUCTURE only — `fanChart` is the array the content maps over.
  if (!Array.isArray(r.fanChart)) throw new Error('MC: fanChart must be array');
  return r as unknown as MonteCarloResult;
}

function getDemo(): MonteCarloResult {
  const now = new Date();
  return {
    paths: 10000,
    quarters: 12,
    vasicekParams: { kappa: 0.15, theta: 0.035, sigma: 0.012, r0: 0.0475 },
    meanNII: 38.4,
    stdNII: 4.2,
    var95NII: 31.5,
    cvar99NII: 28.8,
    fanChart: Array.from({ length: 12 }, (_, q) => {
      const d = new Date(now.getFullYear(), now.getMonth() + (q + 1) * 3, 1);
      const base = 3.2 + q * 0.05;
      return {
        quarter: `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`,
        p5:  +(base - 0.8 - q * 0.05).toFixed(3),
        p25: +(base - 0.3).toFixed(3),
        p50: +base.toFixed(3),
        p75: +(base + 0.3).toFixed(3),
        p95: +(base + 0.8 + q * 0.04).toFixed(3),
      };
    }),
    distribution: {
      buckets: Array.from({ length: 20 }, (_, i) => {
        const min = 25 + i * 1.3;
        const dist = Math.abs(i - 10);
        return { min: +min.toFixed(2), max: +(min + 1.3).toFixed(2), count: Math.max(50, 800 - dist * dist * 8) };
      }),
      mean: 38.4,
      std: 4.2,
    },
  };
}

interface ContentProps {
  readonly data: MonteCarloResult;
}

function MCContent({ data }: ContentProps) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'paths',      label: locale === 'es' ? 'Senderos'       : 'Paths',          value: data.paths,      unit: 'count' },
    { key: 'mean_nii',   label: locale === 'es' ? 'NII Esperado'   : 'Expected NII',   value: data.meanNII,    unit: 'USD_M' },
    { key: 'std_nii',    label: locale === 'es' ? 'Desv. Estándar' : 'Std Deviation',  value: data.stdNII,     unit: 'USD_M' },
    { key: 'var_95',     label: 'VaR 95%',  value: data.var95NII,  unit: 'USD_M' },
    { key: 'cvar_99',    label: 'CVaR 99%', value: data.cvar99NII, unit: 'USD_M' },
    { key: 'kappa',      value: data.vasicekParams?.kappa ?? null },
    { key: 'theta',      value: data.vasicekParams?.theta ?? null, unit: 'ratio' },
    { key: 'sigma',      value: data.vasicekParams?.sigma ?? null, unit: 'ratio' },
  ], [data, locale]);

  // D1: no balance sheet to simulate NII paths over → honest neutral panel.
  if (isDataUnavailable(data) || data.fanChart.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'The Monte Carlo simulation needs a loaded balance sheet to project NII paths. Load assets and liabilities to run the Vasicek short-rate simulation.',
          es: 'La simulación Monte Carlo requiere un balance de situación cargado para proyectar las trayectorias de NII. Cargue activos y pasivos para correr la simulación Vasicek de tasa corta.',
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

      {/* Fan chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Fan Chart — NII Trimestral' : 'Fan Chart — Quarterly NII'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data.fanChart as MCFanPoint[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="quarter" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(v) => `$${Number(v).toFixed(1)}M`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value) => [`$${Number(value ?? 0).toFixed(3)}M`, '']}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="p95" stroke="none" fill="#dcfce7" fillOpacity={0.5} name="P95" />
            <Area type="monotone" dataKey="p75" stroke="none" fill="#bbf7d0" fillOpacity={0.5} name="P75" />
            <Area type="monotone" dataKey="p50" stroke="#0f172a" fill="none" strokeWidth={2.5} name={locale === 'es' ? 'Mediana' : 'Median'} />
            <Area type="monotone" dataKey="p25" stroke="none" fill="#fed7aa" fillOpacity={0.5} name="P25" />
            <Area type="monotone" dataKey="p5"  stroke="none" fill="#fecaca" fillOpacity={0.5} name="P5 (VaR)" />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* Distribution histogram */}
      {data.distribution && data.distribution.buckets.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es'
              ? `Distribución NII — ${data.paths.toLocaleString()} Senderos`
              : `NII Distribution — ${data.paths.toLocaleString()} Paths`}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.distribution.buckets as MCDistribution['buckets']}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="min" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {data.distribution.buckets.map((b) => (
                  <Cell
                    key={b.min}
                    fill={
                      b.min < (data.var95NII ?? 0) ? '#fca5a5' :
                      b.min < (data.meanNII ?? 0)  ? '#fcd34d' :
                      '#86efac'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex justify-center gap-6 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-300" /> {locale === 'es' ? '< VaR 95%' : '< VaR 95%'}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-300" /> {locale === 'es' ? '< Media' : '< Mean'}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-300" /> {locale === 'es' ? '> Media' : '> Mean'}</span>
          </div>
        </section>
      ) : null}
    </>
  );
}

// ─── Page with two-body param pattern ───────────────────────────────────────

export default function MonteCarloPage() {
  const { locale } = useTranslation();
  const [liveBody, setLiveBody] = useState<RunBody>({
    paths: 10000,
    quarters: 12,
    kappa: 0.15,
    theta: 0.035,
    sigma: 0.012,
  });
  const [committedBody, setCommittedBody] = useState<RunBody>(liveBody);
  const [runNonce, setRunNonce] = useState(0);

  const runSim = () => {
    setCommittedBody(liveBody);
    setRunNonce((n) => n + 1);
  };

  const paramInputs: { key: keyof RunBody; label: string; step: number; min: number; max: number }[] = [
    { key: 'paths', label: locale === 'es' ? 'Senderos' : 'Paths', step: 1000, min: 1000, max: 50000 },
    { key: 'kappa', label: 'κ', step: 0.01,  min: 0.01,  max: 1.0 },
    { key: 'theta', label: 'θ', step: 0.005, min: 0.01,  max: 0.1 },
    { key: 'sigma', label: 'σ', step: 0.001, min: 0.001, max: 0.05 },
  ];

  return (
    <AlmPage<MonteCarloResult>
      slug="monte-carlo"
      iconTint="red"
      method="POST"
      pathSuffix="/run"
      body={committedBody}
      deps={[runNonce]}
      validate={validateMC}
      getDemo={getDemo}
      controls={
        <div className="flex items-center gap-2">
          {paramInputs.map((p) => (
            <label key={p.key} className="flex items-center gap-1 text-[10px] text-slate-500">
              <span className="font-semibold">{p.label}</span>
              <input
                type="number"
                step={p.step}
                min={p.min}
                max={p.max}
                value={liveBody[p.key]}
                onChange={(e) =>
                  setLiveBody((b) => ({ ...b, [p.key]: parseFloat(e.target.value) || p.min }))
                }
                className="w-20 rounded border border-slate-200 px-1.5 py-1 text-right text-[11px] tabular-nums focus:border-rose-400 focus:outline-none"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={runSim}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
          >
            {runNonce === 0 ? <Play className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {locale === 'es' ? 'Ejecutar' : 'Run'}
          </button>
        </div>
      }
    >
      {(data) => <MCContent data={data} />}
    </AlmPage>
  );
}
