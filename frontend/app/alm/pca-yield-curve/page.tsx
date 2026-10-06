'use client';

import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

interface FactorLoading {
  readonly tenor: string;
  readonly pc1: number;
  readonly pc2: number;
  readonly pc3: number;
}

interface PCAResult extends AlmDataShell {
  readonly varianceExplained: readonly number[];
  readonly cumulativeVariance: readonly number[];
  readonly factorLoadings: readonly FactorLoading[];
  // D1: null when there is no yield-curve history to decompose.
  readonly interpretation: { readonly pc1: string; readonly pc2: string; readonly pc3: string } | null;
  readonly niiSensitivity: { readonly pc1Impact: number; readonly pc2Impact: number; readonly pc3Impact: number } | null;
}

function validatePCA(raw: unknown): PCAResult {
  if (!raw || typeof raw !== 'object') throw new Error('PCA response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (empty factors + gaps[]); validate
  // STRUCTURE only — the arrays the content maps over.
  if (!Array.isArray(r.varianceExplained)) throw new Error('PCA: varianceExplained must be array');
  if (!Array.isArray(r.factorLoadings)) throw new Error('PCA: factorLoadings must be array');
  return r as unknown as PCAResult;
}

function getDemo(): PCAResult {
  const tenors = ['3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];
  return {
    varianceExplained:  [0.852, 0.112, 0.028],
    cumulativeVariance: [0.852, 0.964, 0.992],
    factorLoadings: tenors.map((tenor, i) => ({
      tenor,
      pc1: 0.30 + Math.sin(i * 0.15) * 0.02,
      pc2: 0.40 - i * 0.08,
      pc3: -0.3 + Math.abs(i - 5) * 0.08,
    })),
    interpretation: {
      pc1: 'Parallel shift: all tenors move together. Explains 85.2% of variance. A 1σ shock shifts the entire curve ~45bp.',
      pc2: 'Slope change: short rates move opposite to long rates. Bear flattening or bull steepening. Explains 11.2%.',
      pc3: 'Butterfly: belly of the curve moves opposite to wings. Affects 5Y-7Y most. Explains 2.8%.',
    },
    niiSensitivity: { pc1Impact: -4.2, pc2Impact: 1.8, pc3Impact: -0.3 },
  };
}

function PCAContent({ data }: { data: PCAResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'pc1_var',        label: 'PC1 (Level) %',                                           value: data.varianceExplained[0] != null ? data.varianceExplained[0] * 100 : null,   unit: '%' },
    { key: 'pc2_var',        label: 'PC2 (Slope) %',                                           value: data.varianceExplained[1] != null ? data.varianceExplained[1] * 100 : null,   unit: '%' },
    { key: 'pc3_var',        label: 'PC3 (Curvature) %',                                       value: data.varianceExplained[2] != null ? data.varianceExplained[2] * 100 : null,   unit: '%' },
    { key: 'cum_var',        label: locale === 'es' ? 'Var. Acumulada' : 'Cum. Variance',      value: data.cumulativeVariance[2] != null ? data.cumulativeVariance[2] * 100 : null,  unit: '%' },
    { key: 'pc1_nii_impact', label: locale === 'es' ? 'Impacto NII PC1' : 'NII Impact PC1',    value: data.niiSensitivity?.pc1Impact ?? null, unit: 'USD_M' },
    { key: 'pc2_nii_impact', label: locale === 'es' ? 'Impacto NII PC2' : 'NII Impact PC2',    value: data.niiSensitivity?.pc2Impact ?? null, unit: 'USD_M' },
    { key: 'pc3_nii_impact', label: locale === 'es' ? 'Impacto NII PC3' : 'NII Impact PC3',    value: data.niiSensitivity?.pc3Impact ?? null, unit: 'USD_M' },
  ], [data, locale]);

  // D1: no yield-curve history to decompose → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.factorLoadings.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No yield-curve history is available to decompose. The PCA factor model needs a time series of curve observations to extract the level/slope/curvature factors.',
          es: 'No hay historial de curva de rendimiento para descomponer. El modelo de factores PCA requiere una serie de tiempo de observaciones de la curva para extraer los factores de nivel/pendiente/curvatura.',
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

      {/* Factor loadings chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Cargas Factoriales por Tenor' : 'Factor Loadings by Tenor'}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data.factorLoadings as FactorLoading[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="tenor" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => Number(value ?? 0).toFixed(4)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="pc1" name="PC1 — Level"      stroke="#0d9488" fill="#0d9488" fillOpacity={0.15} strokeWidth={2} />
            <Area type="monotone" dataKey="pc2" name="PC2 — Slope"      stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.10} strokeWidth={2} />
            <Area type="monotone" dataKey="pc3" name="PC3 — Curvature"  stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.10} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* Factor interpretations */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {([
          { pc: 'PC1', name: locale === 'es' ? 'Nivel'     : 'Level',     desc: data.interpretation?.pc1 ?? '', tone: 'teal'   },
          { pc: 'PC2', name: locale === 'es' ? 'Pendiente' : 'Slope',     desc: data.interpretation?.pc2 ?? '', tone: 'amber'  },
          { pc: 'PC3', name: locale === 'es' ? 'Curvatura' : 'Curvature', desc: data.interpretation?.pc3 ?? '', tone: 'violet' },
        ] as const).map((f) => {
          const toneClass =
            f.tone === 'teal'   ? 'border-teal-200 bg-teal-50/50' :
            f.tone === 'amber'  ? 'border-amber-200 bg-amber-50/50' :
                                  'border-violet-200 bg-violet-50/50';
          return (
            <section key={f.pc} className={`rounded-xl border p-4 ${toneClass}`}>
              <p className="text-xs font-bold text-slate-800">{f.pc} — {f.name}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{f.desc}</p>
            </section>
          );
        })}
      </div>
    </>
  );
}

export default function PCAYieldCurvePage() {
  return (
    <AlmPage<PCAResult>
      slug="pca-yield-curve"
      iconTint="emerald"
      validate={validatePCA}
      getDemo={getDemo}
    >
      {(data) => <PCAContent data={data} />}
    </AlmPage>
  );
}
