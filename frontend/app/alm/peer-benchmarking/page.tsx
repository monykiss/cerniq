'use client';

import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  TrendingUp,
  Shield,
  Users,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface PeerMetric {
  metricName: string;
  metricNameEs: string;
  institutionValue: number;
  peerMin: number;
  peerP25: number;
  peerMedian: number;
  peerP75: number;
  peerMax: number;
  percentileRank: number;
  status: 'top_quartile' | 'above_median' | 'below_median' | 'bottom_quartile';
}

interface PeerResult {
  institutionId: string;
  peerGroupName: string;
  peerGroupNameEs: string;
  peerCount: number;
  assetTier: string;
  metrics: PeerMetric[];
}

// ─── Translations ───────────────────────────────────────────

interface PageStrings {
  title: string;
  subtitle: string;
  section1: string;
  section2: string;
  section3: string;
  section4: string;
  yourValue: string;
  peerMedian: string;
  percentile: string;
  strength: string;
  improvement: string;
  metric: string;
  yours: string;
  median: string;
  deviation: string;
  flag: string;
  totalInstitutions: string;
  medianAssets: string;
  medianCapitalRatio: string;
  medianNIM: string;
  noOutliers: string;
  peerGroup: string;
  institutions: string;
  loading: string;
  noInstitution: string;
  aboveMedian: string;
  belowMedian: string;
  systemTrend: string;
  trendUp: string;
  trendStable: string;
}

const T: Record<string, PageStrings> = {
  en: {
    title: 'Peer Benchmarking',
    subtitle: 'How your institution compares to peers',
    section1: 'Your Institution vs Peer Median',
    section2: 'Percentile Rankings',
    section3: 'Risk Flags vs Peers',
    section4: 'Sector Overview',
    yourValue: 'Your Value',
    peerMedian: 'Peer Median',
    percentile: 'percentile',
    strength: 'Strength',
    improvement: 'Area for Improvement',
    metric: 'Metric',
    yours: 'Yours',
    median: 'Median',
    deviation: 'Deviation',
    flag: 'Flag',
    totalInstitutions: 'Total Institutions',
    medianAssets: 'Median Assets',
    medianCapitalRatio: 'Median Capital Ratio',
    medianNIM: 'Median NIM',
    noOutliers: 'No significant outliers detected. Your institution is within normal range on all metrics.',
    peerGroup: 'Peer Group',
    institutions: 'institutions',
    loading: 'Loading peer benchmarking data...',
    noInstitution: 'Select an institution to view peer benchmarking.',
    aboveMedian: 'Above Median',
    belowMedian: 'Below Median',
    systemTrend: 'System-wide Trend',
    trendUp: 'Improving',
    trendStable: 'Stable',
  },
  es: {
    title: 'Benchmarking de Pares',
    subtitle: 'Como su institucion se compara con pares',
    section1: 'Su Institucion vs Mediana de Pares',
    section2: 'Rankings por Percentil',
    section3: 'Banderas de Riesgo vs Pares',
    section4: 'Resumen del Sector',
    yourValue: 'Su Valor',
    peerMedian: 'Mediana de Pares',
    percentile: 'percentil',
    strength: 'Fortaleza',
    improvement: 'Area de Mejora',
    metric: 'Metrica',
    yours: 'Suyo',
    median: 'Mediana',
    deviation: 'Desviacion',
    flag: 'Bandera',
    totalInstitutions: 'Total Instituciones',
    medianAssets: 'Activos Medianos',
    medianCapitalRatio: 'Ratio Capital Mediano',
    medianNIM: 'NIM Mediano',
    noOutliers: 'No se detectaron valores atipicos significativos. Su institucion esta dentro del rango normal en todas las metricas.',
    peerGroup: 'Grupo de Pares',
    institutions: 'instituciones',
    loading: 'Cargando datos de benchmarking...',
    noInstitution: 'Seleccione una institucion para ver el benchmarking de pares.',
    aboveMedian: 'Sobre la Mediana',
    belowMedian: 'Bajo la Mediana',
    systemTrend: 'Tendencia del Sistema',
    trendUp: 'Mejorando',
    trendStable: 'Estable',
  },
};

// ─── Key metric keys for the comparison bar chart ───────────

const KEY_METRICS = [
  'Capital Ratio',
  'Liquidity Coverage Ratio',
  'Net Interest Margin',
  'Return on Assets',
  'Efficiency Ratio',
];

const KEY_METRICS_ES: Record<string, string> = {
  'Capital Ratio': 'Ratio de Capital',
  'Liquidity Coverage Ratio': 'Ratio de Cobertura de Liquidez',
  'Net Interest Margin': 'Margen de Interes Neto',
  'Return on Assets': 'Retorno sobre Activos',
  'Efficiency Ratio': 'Ratio de Eficiencia',
};

// ─── Helpers ────────────────────────────────────────────────

function findMetricByPartialName(metrics: PeerMetric[], search: string): PeerMetric | undefined {
  return metrics.find(
    (m) =>
      m.metricName.toLowerCase().includes(search.toLowerCase()) ||
      m.metricNameEs.toLowerCase().includes(search.toLowerCase()),
  );
}

function computeStdDev(metric: PeerMetric): number {
  // Approximate std dev from IQR: sigma ~ IQR / 1.35
  const iqr = metric.peerP75 - metric.peerP25;
  return iqr / 1.35 || 1;
}

// ─── Section 1: Comparison Bar Chart ────────────────────────

function ComparisonBarChart({
  metrics,
  locale,
  t,
}: {
  metrics: PeerMetric[];
  locale: string;
  t: PageStrings;
}) {
  const chartData = useMemo(() => {
    return KEY_METRICS.map((name) => {
      const metric = findMetricByPartialName(metrics, name);
      if (!metric) return null;
      const exceedsMedian = metric.institutionValue >= metric.peerMedian;
      return {
        name: locale === 'es' ? (KEY_METRICS_ES[name] || metric.metricNameEs) : name,
        shortName: locale === 'es' ? (KEY_METRICS_ES[name] || metric.metricNameEs).slice(0, 18) : name.slice(0, 18),
        yours: metric.institutionValue,
        median: metric.peerMedian,
        exceedsMedian,
      };
    }).filter(Boolean) as Array<{
      name: string;
      shortName: string;
      yours: number;
      median: number;
      exceedsMedian: boolean;
    }>;
  }, [metrics, locale]);

  if (chartData.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-5">
      <h2 className="text-sm font-bold text-white mb-1">{t.section1}</h2>
      <p className="text-[11px] text-slate-400 mb-4">
        {locale === 'es'
          ? 'Verde = sobre la mediana, Ambar = bajo la mediana'
          : 'Green = above median, Amber = below median'}
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={4} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="shortName"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              axisLine={{ stroke: '#475569' }}
              tickLine={false}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              axisLine={{ stroke: '#475569' }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '0.75rem',
                color: '#e2e8f0',
                fontSize: '0.75rem',
              }}
              labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
            />
            <Bar dataKey="yours" name={t.yourValue} radius={[4, 4, 0, 0]}>
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.exceedsMedian ? '#10b981' : '#f59e0b'}
                />
              ))}
            </Bar>
            <Bar dataKey="median" name={t.peerMedian} fill="#64748b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          <span className="text-[10px] text-slate-400">{t.aboveMedian}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
          <span className="text-[10px] text-slate-400">{t.belowMedian}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-slate-500" />
          <span className="text-[10px] text-slate-400">{t.peerMedian}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Section 2: Percentile Rankings ─────────────────────────

function PercentileCard({
  metric,
  locale,
  t,
}: {
  metric: PeerMetric;
  locale: string;
  t: PageStrings;
}) {
  const pct = metric.percentileRank;
  const barColor =
    pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-cyan-500' : pct >= 25 ? 'bg-amber-500' : 'bg-rose-500';
  const textColor =
    pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-cyan-400' : pct >= 25 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-4">
      <p className="text-xs font-medium text-slate-300 truncate">
        {locale === 'es' ? metric.metricNameEs : metric.metricName}
      </p>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className={`text-xl font-bold tabular-nums ${textColor}`}>
          {pct}<sup className="text-[10px] font-normal">th</sup>
        </span>
        <span className="text-[10px] text-slate-500">{t.percentile}</span>
      </div>
      {/* Visual percentile bar */}
      <div className="relative mt-3">
        <div className="h-2 w-full rounded-full bg-slate-800" />
        <div
          className={`absolute top-0 left-0 h-2 rounded-full ${barColor} transition-all duration-700`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
        {/* 50th percentile marker */}
        <div className="absolute top-0 left-1/2 w-px h-2 bg-slate-600" />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-slate-600">0</span>
        <span className="text-[9px] text-slate-600">50</span>
        <span className="text-[9px] text-slate-600">100</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px]">
        <span className="text-slate-500">
          {t.yours}: <span className="text-slate-300 font-semibold tabular-nums">{metric.institutionValue}</span>
        </span>
        <span className="text-slate-500">
          {t.median}: <span className="text-slate-400 tabular-nums">{metric.peerMedian}</span>
        </span>
      </div>
    </div>
  );
}

function PercentileRankings({
  metrics,
  locale,
  t,
}: {
  metrics: PeerMetric[];
  locale: string;
  t: PageStrings;
}) {
  return (
    <div>
      <h2 className="text-sm font-bold text-white mb-3">{t.section2}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {metrics.map((m) => (
          <PercentileCard key={m.metricName} metric={m} locale={locale} t={t} />
        ))}
      </div>
    </div>
  );
}

// ─── Section 3: Risk Flags vs Peers ─────────────────────────

interface Outlier {
  metric: PeerMetric;
  zScore: number;
  isStrength: boolean;
}

function RiskFlagsTable({
  metrics,
  locale,
  t,
}: {
  metrics: PeerMetric[];
  locale: string;
  t: PageStrings;
}) {
  const outliers = useMemo<Outlier[]>(() => {
    return metrics
      .map((m) => {
        const sigma = computeStdDev(m);
        const z = (m.institutionValue - m.peerMedian) / sigma;
        if (Math.abs(z) > 1.5) {
          return { metric: m, zScore: z, isStrength: z > 0 };
        }
        return null;
      })
      .filter(Boolean) as Outlier[];
  }, [metrics]);

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/40">
        <h2 className="text-sm font-bold text-white">{t.section3}</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {locale === 'es'
            ? 'Metricas donde su institucion es un valor atipico (>1.5 desv. est. de la mediana)'
            : 'Metrics where your institution is an outlier (>1.5 std dev from median)'}
        </p>
      </div>

      {outliers.length === 0 ? (
        <div className="p-6 text-center">
          <Shield className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-slate-400">{t.noOutliers}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/40 bg-slate-800/40">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-400">{t.metric}</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-400">{t.yours}</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-400">{t.median}</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-400">{t.deviation}</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-400">{t.flag}</th>
              </tr>
            </thead>
            <tbody>
              {outliers.map(({ metric: m, zScore, isStrength }) => (
                <tr key={m.metricName} className="border-b border-slate-800/40 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-200">
                    {locale === 'es' ? m.metricNameEs : m.metricName}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-bold text-white">{m.institutionValue}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-400">{m.peerMedian}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-300">
                    {zScore > 0 ? '+' : ''}
                    {zScore.toFixed(1)} &sigma;
                  </td>
                  <td className="px-4 py-3">
                    {isStrength ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                        <ArrowUpRight className="h-3 w-3" />
                        {t.strength}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/50 bg-amber-950/50 px-2.5 py-0.5 text-[10px] font-bold text-amber-400">
                        <ArrowDownRight className="h-3 w-3" />
                        {t.improvement}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Section 4: Sector Overview ─────────────────────────────

function SectorOverview({
  data,
  metrics,
  locale,
  t,
}: {
  data: PeerResult;
  metrics: PeerMetric[];
  locale: string;
  t: PageStrings;
}) {
  // Derive sector stats from peer data
  const capitalMetric = findMetricByPartialName(metrics, 'Capital');
  const nimMetric = findMetricByPartialName(metrics, 'Interest Margin') || findMetricByPartialName(metrics, 'NIM');

  const stats = [
    {
      label: t.totalInstitutions,
      value: data.peerCount.toString(),
      icon: Users,
      color: 'text-cyan-400',
    },
    {
      label: t.medianAssets,
      value: data.assetTier === 'large'
        ? '$500M+'
        : data.assetTier === 'medium'
          ? '$50M-$300M'
          : '<$50M',
      icon: Building2,
      color: 'text-slate-300',
    },
    {
      label: t.medianCapitalRatio,
      value: capitalMetric ? `${capitalMetric.peerMedian}%` : 'N/A',
      icon: Shield,
      color: 'text-emerald-400',
    },
    {
      label: t.medianNIM,
      value: nimMetric ? `${nimMetric.peerMedian}%` : 'N/A',
      icon: TrendingUp,
      color: 'text-amber-400',
    },
  ];

  return (
    <div>
      <h2 className="text-sm font-bold text-white mb-3">{t.section4}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`h-4 w-4 ${s.color}`} />
                <span className="text-[11px] font-medium text-slate-400">{s.label}</span>
              </div>
              <p className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-cyan-400" />
          <span className="text-[11px] font-medium text-slate-400">{t.systemTrend}</span>
        </div>
        <p className="text-xs text-slate-300">
          {locale === 'es'
            ? `${data.peerCount} instituciones en grupo de pares "${data.peerGroupNameEs}". Las tendencias del sector muestran metricas estables con mejoras moderadas en ratios de capital entre las cooperativas de credito.`
            : `${data.peerCount} institutions in peer group "${data.peerGroupName}". System-wide trends show stable metrics with moderate improvements in capital ratios across credit unions.`}
        </p>
      </div>
    </div>
  );
}

// ─── Demo data fallback ─────────────────────────────────────

function getDemoData(): PeerResult {
  return {
    institutionId: 'demo',
    peerGroupName: 'PR Credit Unions $50M-$300M',
    peerGroupNameEs: 'Cooperativas PR $50M-$300M',
    peerCount: 43,
    assetTier: 'medium',
    metrics: [
      {
        metricName: 'Capital Ratio (%)',
        metricNameEs: 'Ratio de Capital (%)',
        institutionValue: 14.2,
        peerMin: 7.5,
        peerP25: 10.5,
        peerMedian: 12.0,
        peerP75: 14.5,
        peerMax: 22.0,
        percentileRank: 72,
        status: 'above_median',
      },
      {
        metricName: 'Liquidity Coverage Ratio (%)',
        metricNameEs: 'Ratio de Cobertura de Liquidez (%)',
        institutionValue: 145,
        peerMin: 78,
        peerP25: 102,
        peerMedian: 122,
        peerP75: 150,
        peerMax: 230,
        percentileRank: 68,
        status: 'above_median',
      },
      {
        metricName: 'Net Interest Margin (%)',
        metricNameEs: 'Margen de Interes Neto (%)',
        institutionValue: 3.1,
        peerMin: 2.0,
        peerP25: 3.0,
        peerMedian: 3.6,
        peerP75: 4.2,
        peerMax: 5.5,
        percentileRank: 38,
        status: 'below_median',
      },
      {
        metricName: 'Return on Assets (%)',
        metricNameEs: 'Retorno sobre Activos (%)',
        institutionValue: 0.95,
        peerMin: 0.1,
        peerP25: 0.45,
        peerMedian: 0.72,
        peerP75: 1.05,
        peerMax: 1.8,
        percentileRank: 74,
        status: 'above_median',
      },
      {
        metricName: 'Efficiency Ratio (%)',
        metricNameEs: 'Ratio de Eficiencia (%)',
        institutionValue: 68,
        peerMin: 42,
        peerP25: 58,
        peerMedian: 65,
        peerP75: 75,
        peerMax: 92,
        percentileRank: 42,
        status: 'below_median',
      },
      {
        metricName: 'CECL Allowance / Loans (%)',
        metricNameEs: 'Provision CECL / Prestamos (%)',
        institutionValue: 2.8,
        peerMin: 0.5,
        peerP25: 0.9,
        peerMedian: 1.3,
        peerP75: 2.0,
        peerMax: 3.5,
        percentileRank: 85,
        status: 'top_quartile',
      },
    ],
  };
}

// ─── Main Page ──────────────────────────────────────────────

export default function PeerBenchmarkingPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<PeerResult | null>(null);
  const [loading, setLoading] = useState(true);

  const t = locale === 'es' ? T.es : T.en;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const result = await apiClient.getPeerAnalytics(selectedId);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(getDemoData());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ─── Empty / Loading States ─────────────────────────────

  if (!selectedId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
        <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden />
        <p className="text-sm text-slate-400">{t.noInstitution}</p>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-500" />
        <p className="text-sm text-slate-400">{t.loading}</p>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-800/50 bg-cyan-950/60">
          <Activity className="h-4 w-4 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{t.title}</h1>
          <p className="text-xs text-slate-500">
            {t.peerGroup}: {locale === 'es' ? data.peerGroupNameEs : data.peerGroupName} ({data.peerCount}{' '}
            {t.institutions})
          </p>
        </div>
      </div>

      {/* Section 1: Comparison Bar Chart */}
      <ComparisonBarChart metrics={data.metrics} locale={locale} t={t} />

      {/* Section 2: Percentile Rankings */}
      <PercentileRankings metrics={data.metrics} locale={locale} t={t} />

      {/* Section 3: Risk Flags */}
      <RiskFlagsTable metrics={data.metrics} locale={locale} t={t} />

      {/* Section 4: Sector Overview */}
      <SectorOverview data={data} metrics={data.metrics} locale={locale} t={t} />
    </div>
  );
}
