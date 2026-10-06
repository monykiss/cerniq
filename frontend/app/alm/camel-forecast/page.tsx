'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';

interface AR2Params {
  readonly phi1: number;
  readonly phi2: number;
  readonly intercept: number;
  readonly r2: number;
}

interface Forecast {
  readonly dimension: string;
  readonly currentScore: number;
  readonly q2Forecast: number;
  readonly q4Forecast: number;
  readonly q2CI: readonly [number, number];
  readonly q4CI: readonly [number, number];
  readonly trend: 'improving' | 'stable' | 'deteriorating';
  readonly ar2Params: AR2Params;
}

type ForecastResponse = readonly Forecast[];

const DIM_LABELS: Record<string, { en: string; es: string }> = {
  capital:      { en: 'Capital',       es: 'Capital' },
  assetQuality: { en: 'Asset Quality', es: 'Calidad Activos' },
  management:   { en: 'Management',    es: 'Administración' },
  earnings:     { en: 'Earnings',      es: 'Rentabilidad' },
  liquidity:    { en: 'Liquidity',     es: 'Liquidez' },
};

const SCORE_COLORS: readonly string[] = ['', '#059669', '#16a34a', '#d97706', '#c2410c', '#b91c1c'];

function validateCamel(raw: unknown): ForecastResponse {
  if (!Array.isArray(raw)) throw new Error('CAMEL forecast response must be an array');
  return raw as ForecastResponse;
}

function getDemo(): ForecastResponse {
  return [
    { dimension: 'capital',      currentScore: 2, q2Forecast: 2,   q4Forecast: 2,   q2CI: [1.5, 2.5], q4CI: [1.5, 2.5], trend: 'stable',        ar2Params: { phi1: 0.3, phi2: 0.10, intercept: 1.2, r2: 0.78 } },
    { dimension: 'assetQuality', currentScore: 2, q2Forecast: 2.5, q4Forecast: 3,   q2CI: [2,   3],   q4CI: [2,   3.5], trend: 'deteriorating', ar2Params: { phi1: 0.5, phi2: 0.20, intercept: 0.8, r2: 0.65 } },
    { dimension: 'management',   currentScore: 2, q2Forecast: 2,   q4Forecast: 2,   q2CI: [1.5, 2.5], q4CI: [1.5, 2.5], trend: 'stable',        ar2Params: { phi1: 0.1, phi2: 0.05, intercept: 1.7, r2: 0.45 } },
    { dimension: 'earnings',     currentScore: 2, q2Forecast: 2,   q4Forecast: 2.5, q2CI: [1.5, 2.5], q4CI: [2,   3],   trend: 'deteriorating', ar2Params: { phi1: 0.4, phi2: 0.15, intercept: 1.0, r2: 0.72 } },
    { dimension: 'liquidity',    currentScore: 2, q2Forecast: 2,   q4Forecast: 1.5, q2CI: [1.5, 2.5], q4CI: [1,   2],   trend: 'improving',     ar2Params: { phi1: 0.2, phi2: 0.10, intercept: 1.5, r2: 0.60 } },
  ];
}

function CamelContent({ data }: { data: ForecastResponse }) {
  const { locale } = useTranslation();
  const t = (d: Forecast) => locale === 'es' ? DIM_LABELS[d.dimension]?.es ?? d.dimension : DIM_LABELS[d.dimension]?.en ?? d.dimension;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => {
    const avgCurrent = data.reduce((s, f) => s + f.currentScore, 0) / Math.max(1, data.length);
    const avgQ4      = data.reduce((s, f) => s + f.q4Forecast,  0) / Math.max(1, data.length);
    return [
      { key: 'dimensions',    label: locale === 'es' ? 'Dimensiones' : 'Dimensions', value: data.length, unit: 'count' },
      { key: 'avg_current',   label: locale === 'es' ? 'Promedio Actual' : 'Avg Current', value: avgCurrent, unit: 'x' },
      { key: 'avg_q4',        label: locale === 'es' ? 'Promedio Q4'     : 'Avg Q4',      value: avgQ4,      unit: 'x' },
      { key: 'deteriorating', label: locale === 'es' ? 'Deteriorando'    : 'Deteriorating', value: data.filter((f) => f.trend === 'deteriorating').length, unit: 'count' },
      { key: 'improving',     label: locale === 'es' ? 'Mejorando'       : 'Improving',     value: data.filter((f) => f.trend === 'improving').length,     unit: 'count' },
    ];
  }, [data, locale]);

  const chartData = useMemo(
    () => data.map((f) => ({
      dimension: t(f),
      current: f.currentScore,
      q2: f.q2Forecast,
      q4: f.q4Forecast,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable closure over locale
    [data, locale],
  );

  const deteriorating = data.filter((f) => f.trend === 'deteriorating');

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {deteriorating.length > 0 ? (
        <section className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-800">
              {locale === 'es' ? 'Alerta de Deterioro' : 'Deterioration Alert'}
            </p>
            <p className="mt-1 text-xs text-rose-700">
              {deteriorating.map((f) => t(f)).join(', ')}
              {locale === 'es'
                ? ' muestra(n) tendencia negativa. Revise antes del próximo examen COSSEC.'
                : ' showing negative trend. Review before next COSSEC exam.'}
            </p>
          </div>
        </section>
      ) : null}

      {/* Forecast bar chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Pronóstico CAMEL por Dimensión' : 'CAMEL Forecast by Dimension'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="dimension" tick={{ fontSize: 11 }} />
            <YAxis
              domain={[0.5, 5.5]}
              tick={{ fontSize: 11 }}
              reversed
              label={{ value: locale === 'es' ? 'Puntuación' : 'Score', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
            />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="current" name={locale === 'es' ? 'Actual'   : 'Current'} fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="q2"      name={locale === 'es' ? '+2 Trim.' : '+2Q'}      fill="#06b6d4" radius={[4, 4, 0, 0]} />
            <Bar dataKey="q4"      name={locale === 'es' ? '+4 Trim.' : '+4Q'}      fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Dimension detail cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {data.map((f) => {
          const Icon = f.trend === 'improving' ? TrendingDown : f.trend === 'deteriorating' ? TrendingUp : Minus;
          const trendColor = f.trend === 'improving' ? 'text-emerald-600' : f.trend === 'deteriorating' ? 'text-rose-600' : 'text-slate-500';
          const pill = (score: number, label: string) => (
            <div className="text-center">
              <p className="text-[9px] text-slate-400">{label}</p>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: SCORE_COLORS[Math.max(1, Math.min(5, Math.round(score)))] ?? '#6b7280' }}
              >
                {score}
              </div>
            </div>
          );
          return (
            <section key={f.dimension} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">{t(f)}</p>
                <Icon className={`h-4 w-4 ${trendColor}`} aria-label={f.trend} />
              </div>
              <div className="flex items-center gap-3">
                {pill(f.currentScore, locale === 'es' ? 'Actual' : 'Now')}
                <span className="text-slate-300">→</span>
                {pill(f.q2Forecast, '+2Q')}
                <span className="text-slate-300">→</span>
                {pill(f.q4Forecast, '+4Q')}
              </div>
              <p className="mt-2 text-[9px] text-slate-400">
                CI [{f.q4CI[0]}–{f.q4CI[1]}] · R² {f.ar2Params.r2.toFixed(2)}
              </p>
            </section>
          );
        })}
      </div>
    </>
  );
}

export default function CamelForecastPage() {
  return (
    <AlmPage<ForecastResponse>
      slug="camel-forecast"
      iconTint="violet"
      validate={validateCamel}
      getDemo={getDemo}
    >
      {(data) => <CamelContent data={data} />}
    </AlmPage>
  );
}
