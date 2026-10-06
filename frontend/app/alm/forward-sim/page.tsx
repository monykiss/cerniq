'use client';

import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface ForwardQuarter {
  readonly quarter: string;
  readonly ratePath: string;
  readonly projectedNII: number;
  readonly projectedEVE: number;
  readonly projectedLCR: number;
  readonly projectedNSFR: number;
  readonly projectedNWR: number;
  readonly totalAssets: number;
  readonly totalLiabilities: number;
}

interface ForwardSimResult extends AlmDataShell {
  readonly config: { readonly horizon: number; readonly ratePaths: readonly string[] } | null;
  readonly quarters: readonly ForwardQuarter[];
  // D1: null when there is no balance sheet to project forward.
  readonly summary: {
    readonly baseNIIYear1: number;
    readonly baseNIIYear3: number;
    readonly up200NIIYear3: number;
    readonly down100NIIYear3: number;
    readonly worstCaseNWR: number;
    readonly worstCaseLCR: number;
  } | null;
}

const PATH_COLORS: Readonly<Record<string, string>> = {
  base:    '#0f172a',
  up200:   '#dc2626',
  down100: '#2563eb',
};

const PATH_LABELS: Readonly<Record<string, { readonly en: string; readonly es: string }>> = {
  base:    { en: 'Base (Current Rates)', es: 'Base (Tasas Actuales)' },
  up200:   { en: '+200bps Parallel',     es: '+200bps Paralelo' },
  down100: { en: '-100bps Parallel',     es: '-100bps Paralelo' },
};

function validateForwardSim(raw: unknown): ForwardSimResult {
  if (!raw || typeof raw !== 'object') throw new Error('Forward sim response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null summary + gaps[]); validate
  // STRUCTURE only — `quarters` is the array the content maps over.
  if (!Array.isArray(r.quarters)) throw new Error('Forward sim: quarters must be array');
  return r as unknown as ForwardSimResult;
}

function getDemo(): ForwardSimResult {
  const paths = ['base', 'up200', 'down100'] as const;
  const quarters: ForwardQuarter[] = [];
  for (const path of paths) {
    const shock = path === 'up200' ? 200 : path === 'down100' ? -100 : 0;
    for (let q = 1; q <= 12; q++) {
      const growth = Math.pow(1.03, q / 4);
      const rateEffect = (shock / 10000) * 0.5 * q / 12;
      quarters.push({
        quarter: `Q${((q - 1) % 4) + 1} ${2026 + Math.floor((q - 1) / 4)}`,
        ratePath: path,
        projectedNII:  +(3.2 * growth + 3.2 * rateEffect).toFixed(2),
        projectedEVE:  +(52 * growth - shock * 0.08 * q / 12).toFixed(1),
        projectedLCR:  +Math.min(180, Math.max(80,  115 + shock * 0.01  - q * 0.5)).toFixed(1),
        projectedNSFR: +Math.min(160, Math.max(85,  108 + shock * 0.005)).toFixed(1),
        projectedNWR:  +Math.max(5, 9.2 - q * 0.05 + shock * 0.001).toFixed(1),
        totalAssets: Math.round(445 * growth),
        totalLiabilities: Math.round(385 * growth),
      });
    }
  }
  return {
    config:  { horizon: 3, ratePaths: ['base', 'up200', 'down100'] },
    quarters,
    summary: { baseNIIYear1: 12.8, baseNIIYear3: 41.2, up200NIIYear3: 48.5, down100NIIYear3: 35.8, worstCaseNWR: 6.8, worstCaseLCR: 88 },
  };
}

type Metric = 'NII' | 'LCR' | 'NWR';

function ForwardSimContent({ data }: { data: ForwardSimResult }) {
  const { locale } = useTranslation();
  const [metric, setMetric] = useState<Metric>('NII');
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'base_nii_y1',    label: locale === 'es' ? 'NII Base Año 1' : 'Base NII Y1',    value: data.summary?.baseNIIYear1 ?? null,   unit: 'USD_M' },
    { key: 'base_nii_y3',    label: locale === 'es' ? 'NII Base Año 3' : 'Base NII Y3',    value: data.summary?.baseNIIYear3 ?? null,   unit: 'USD_M' },
    { key: 'up200_nii_y3',   label: '+200 NII Y3',                                          value: data.summary?.up200NIIYear3 ?? null,  unit: 'USD_M' },
    { key: 'down100_nii_y3', label: '-100 NII Y3',                                          value: data.summary?.down100NIIYear3 ?? null, unit: 'USD_M' },
    { key: 'worst_nwr',      label: locale === 'es' ? 'Peor NWR' : 'Worst NWR',            value: data.summary?.worstCaseNWR ?? null,    unit: '%' },
    { key: 'worst_lcr',      label: locale === 'es' ? 'Peor LCR' : 'Worst LCR',            value: data.summary?.worstCaseLCR ?? null,    unit: '%' },
  ], [data, locale]);

  // Build chart data: one entry per base quarter with path-specific keys.
  const chartData = useMemo(() => {
    const baseQuarters = data.quarters.filter((q) => q.ratePath === 'base');
    const paths = data.config?.ratePaths ?? [];
    return baseQuarters.map((bq) => {
      const entry: Record<string, string | number> = { quarter: bq.quarter };
      for (const path of paths) {
        const pq = data.quarters.find((q) => q.quarter === bq.quarter && q.ratePath === path);
        if (!pq) continue;
        entry[`${path}_NII`] = pq.projectedNII;
        entry[`${path}_LCR`] = pq.projectedLCR;
        entry[`${path}_NWR`] = pq.projectedNWR;
      }
      return entry;
    });
  }, [data]);

  // D1: no balance sheet to project forward → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.quarters.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'Forward simulation needs a loaded balance sheet to project NII/LCR/NWR across rate paths. Load assets and liabilities to run the 12-quarter projection.',
          es: 'La simulación prospectiva requiere un balance de situación para proyectar NII/LCR/NWR bajo las trayectorias de tasa. Cargue activos y pasivos para correr la proyección de 12 trimestres.',
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

      {/* Metric selector */}
      <div className="flex gap-2">
        {(['NII', 'LCR', 'NWR'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            aria-pressed={metric === m}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              metric === m ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {m === 'NII' ? (locale === 'es' ? 'Ingreso Neto' : 'Net Interest Income') :
             m === 'LCR' ? 'LCR' :
                           (locale === 'es' ? 'Ratio Capital' : 'Net Worth Ratio')}
          </button>
        ))}
      </div>

      {/* Path chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {metric} — {locale === 'es' ? '12 Trimestres, 3 Escenarios' : '12 Quarters, 3 Scenarios'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="quarter" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (metric === 'NII' ? `$${v}M` : `${v}%`)} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {metric === 'NWR' ? (
              <ReferenceLine y={7} stroke="#dc2626" strokeDasharray="8 4" strokeWidth={1} label={{ value: '7% min', position: 'insideTopRight', style: { fontSize: 10, fill: '#dc2626' } }} />
            ) : null}
            {metric === 'LCR' ? (
              <ReferenceLine y={100} stroke="#dc2626" strokeDasharray="8 4" strokeWidth={1} label={{ value: '100% min', position: 'insideTopRight', style: { fontSize: 10, fill: '#dc2626' } }} />
            ) : null}
            {(data.config?.ratePaths ?? []).map((path) => (
              <Line
                key={path}
                type="monotone"
                dataKey={`${path}_${metric}`}
                stroke={PATH_COLORS[path] ?? '#6b7280'}
                strokeWidth={path === 'base' ? 3 : 2}
                dot={path === 'base'}
                name={PATH_LABELS[path]?.[locale] ?? path}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>
    </>
  );
}

export default function ForwardSimPage() {
  return (
    <AlmPage<ForwardSimResult>
      slug="forward-sim"
      iconTint="violet"
      method="POST"
      body={{}}
      validate={validateForwardSim}
      getDemo={getDemo}
    >
      {(data) => <ForwardSimContent data={data} />}
    </AlmPage>
  );
}
