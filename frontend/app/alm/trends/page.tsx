'use client';

import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Eye, EyeOff } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';

interface TrendPoint {
  readonly date: string;
  readonly riskScore: number;
  readonly capitalRatio: number;
  readonly lcr: number;
  readonly durationGap: number;
}

type TrendResponse = readonly TrendPoint[];

interface MetricConfig {
  readonly key: keyof Omit<TrendPoint, 'date'>;
  readonly labelEn: string;
  readonly labelEs: string;
  readonly color: string;
  readonly unit: string;
}

const METRICS: readonly MetricConfig[] = [
  { key: 'riskScore',    labelEn: 'Risk Score',    labelEs: 'Puntuación de Riesgo',  color: '#06b6d4', unit: ''   },
  { key: 'capitalRatio', labelEn: 'Capital Ratio', labelEs: 'Ratio de Capital',      color: '#8b5cf6', unit: '%'  },
  { key: 'lcr',          labelEn: 'LCR',           labelEs: 'LCR',                   color: '#059669', unit: '%'  },
  { key: 'durationGap',  labelEn: 'Duration Gap',  labelEs: 'Brecha de Duración',    color: '#f59e0b', unit: 'yr' },
];

function validateTrends(raw: unknown): TrendResponse {
  // Server may return bare array or `{ data: [] }` envelope — normalize either.
  if (Array.isArray(raw)) return raw as TrendResponse;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.data)) return r.data as TrendResponse;
    if (Array.isArray(r.points)) return r.points as TrendResponse;
  }
  throw new Error('Trend response must be an array or { data/points: [] }');
}

function getDemo(): TrendResponse {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (11 - i));
    // Deterministic pseudo-random for stable demo renders
    const seed = (i * 13) % 20;
    return {
      date:         d.toISOString().slice(0, 10),
      riskScore:    62 + Math.round((seed * 1.2) % 20),
      capitalRatio: 10.5 + (seed % 10) / 10,
      lcr:          105 + (seed * 2) % 40,
      durationGap:  1.2 + (seed % 5) / 10,
    };
  });
}

function TrendsContent({ data }: { data: TrendResponse }) {
  const { locale } = useTranslation();
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set(METRICS.map((m) => m.key)));

  const toggleMetric = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const latest = data[data.length - 1];
  const earliest = data[0];

  const stripItems = useMemo<readonly MetricStripItem[]>(() => {
    if (!latest) return [];
    const delta = (key: keyof Omit<TrendPoint, 'date'>): number => (earliest ? latest[key] - earliest[key] : 0);
    return [
      { key: 'periods',      label: locale === 'es' ? 'Períodos'    : 'Periods',        value: data.length,       unit: 'count' },
      { key: 'risk_score',   label: locale === 'es' ? 'Riesgo'      : 'Risk Score',     value: latest.riskScore,  delta: delta('riskScore'),    unit: 'count' },
      { key: 'capital_ratio',label: locale === 'es' ? 'Ratio Capital' : 'Capital Ratio', value: latest.capitalRatio, delta: delta('capitalRatio'), unit: '%' },
      { key: 'lcr',          label: 'LCR',                                                 value: latest.lcr,        delta: delta('lcr'),          unit: '%' },
      { key: 'duration_gap', label: locale === 'es' ? 'Brecha Dur.' : 'Duration Gap',    value: latest.durationGap, delta: delta('durationGap'), unit: 'years' },
    ];
  }, [data, earliest, latest, locale]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Metric visibility toggles */}
      <div className="flex flex-wrap gap-2">
        {METRICS.map((m) => {
          const visible = visibleKeys.has(m.key);
          const Icon = visible ? Eye : EyeOff;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggleMetric(m.key)}
              aria-pressed={visible}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
                visible ? 'border-slate-300 bg-white text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: visible ? m.color : '#cbd5e1' }} aria-hidden />
              <Icon className="h-3 w-3" />
              {locale === 'es' ? m.labelEs : m.labelEn}
            </button>
          );
        })}
      </div>

      {/* Trend chart */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Serie Temporal — KPIs' : 'Time Series — KPIs'}
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={data as TrendPoint[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {METRICS.filter((m) => visibleKeys.has(m.key)).map((m) => (
              <Line
                key={m.key}
                type="monotone"
                dataKey={m.key}
                stroke={m.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                name={locale === 'es' ? m.labelEs : m.labelEn}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </section>
    </>
  );
}

export default function TrendsPage() {
  return (
    <AlmPage<TrendResponse>
      slug="trends"
      iconTint="cyan"
      validate={validateTrends}
      getDemo={getDemo}
    >
      {(data) => <TrendsContent data={data} />}
    </AlmPage>
  );
}
