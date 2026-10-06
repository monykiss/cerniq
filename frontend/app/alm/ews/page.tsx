'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

type AlertLevel = 'green' | 'yellow' | 'red';
type OverallLevel = 'GREEN' | 'YELLOW' | 'RED';
type Trend = 'improving' | 'stable' | 'deteriorating';

interface EWSIndicator {
  readonly id: string;
  readonly name: string;
  readonly nameEs: string;
  readonly value: number;
  readonly trend: Trend;
  readonly alertLevel: AlertLevel;
  readonly weight: number;
  readonly contribution: number;
}

interface EWSResult extends AlmDataShell {
  // D1: null when there is no asset-quality history to score.
  readonly compositeScore: number | null;
  readonly alertLevel: OverallLevel | null;
  readonly indicators: readonly EWSIndicator[];
  readonly topDeteriorating: readonly EWSIndicator[];
  readonly peerAlert: string | null;
  readonly peerAlertEs: string | null;
  readonly anomalyScore: number | null;
}

const ALERT_STYLES: Record<OverallLevel, { bg: string; text: string; border: string; ring: string }> = {
  GREEN:  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', ring: '#059669' },
  YELLOW: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   ring: '#d97706' },
  RED:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    ring: '#dc2626' },
};

const NEUTRAL_ALERT = { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', ring: '#94a3b8' };
function alertStyle(level: OverallLevel | null) {
  return level ? ALERT_STYLES[level] : NEUTRAL_ALERT;
}

const INDICATOR_COLORS: Record<AlertLevel, string> = {
  green:  'bg-emerald-50 border-emerald-200 text-emerald-800',
  yellow: 'bg-amber-50   border-amber-200   text-amber-800',
  red:    'bg-rose-50    border-rose-200    text-rose-800',
};

function validateEWS(raw: unknown): EWSResult {
  if (!raw || typeof raw !== 'object') throw new Error('EWS response must be an object');
  const r = raw as Record<string, unknown>;
  // D1: accept the data_unavailable shell (null compositeScore + gaps[]);
  // validate STRUCTURE only — `indicators` is the array the content maps over.
  if (!Array.isArray(r.indicators)) throw new Error('EWS: indicators must be array');
  return r as unknown as EWSResult;
}

function getDemo(): EWSResult {
  return {
    compositeScore: 72,
    alertLevel: 'YELLOW',
    indicators: [
      { id: 'delinquency_30d',  name: '30-Day Delinquency',  nameEs: 'Morosidad 30 Días',     value: 2.7,  trend: 'stable',        alertLevel: 'yellow', weight: 12, contribution: 6 },
      { id: 'delinquency_90d',  name: '90-Day Delinquency',  nameEs: 'Morosidad 90 Días',     value: 1.2,  trend: 'improving',     alertLevel: 'yellow', weight: 15, contribution: 7.5 },
      { id: 'npl_ratio',        name: 'NPL Ratio',           nameEs: 'Ratio NPL',             value: 2.2,  trend: 'stable',        alertLevel: 'yellow', weight: 12, contribution: 6 },
      { id: 'chargeoff_rate',   name: 'Charge-Off Rate',     nameEs: 'Tasa Castigos',         value: 0.9,  trend: 'stable',        alertLevel: 'yellow', weight: 10, contribution: 5 },
      { id: 'delinquency_trend',name: 'Delinquency Trend',   nameEs: 'Tendencia Morosidad',   value: 0.05, trend: 'improving',     alertLevel: 'green',  weight: 10, contribution: 10 },
      { id: 'ltv_re',           name: 'Avg LTV (RE)',        nameEs: 'LTV Promedio (RE)',     value: 72,   trend: 'stable',        alertLevel: 'green',  weight:  8, contribution: 8 },
      { id: 'dscr_commercial',  name: 'DSCR (Commercial)',   nameEs: 'DSCR (Comercial)',      value: 1.35, trend: 'improving',     alertLevel: 'green',  weight:  5, contribution: 5 },
      { id: 'classified_ratio', name: 'Classified Ratio',    nameEs: 'Ratio Clasificados',    value: 3.6,  trend: 'deteriorating', alertLevel: 'yellow', weight:  8, contribution: 4 },
      { id: 'oreo_growth',      name: 'OREO Growth',         nameEs: 'Crecimiento OREO',      value: 0.02, trend: 'improving',     alertLevel: 'green',  weight:  5, contribution: 5 },
      { id: 'consumer_60d_delta',name: 'Consumer 60d Δ',     nameEs: 'Δ Consumo 60d',         value: 0.03, trend: 'improving',     alertLevel: 'green',  weight:  5, contribution: 5 },
      { id: 'allowance_coverage',name: 'Allowance Coverage', nameEs: 'Cobertura Provisión',   value: 120,  trend: 'stable',        alertLevel: 'green',  weight:  5, contribution: 5 },
      { id: 'peer_delinquency_gap',name: 'Peer Gap',         nameEs: 'Brecha Pares',          value: 0.15, trend: 'stable',        alertLevel: 'green',  weight:  5, contribution: 5 },
    ],
    topDeteriorating: [
      { id: 'classified_ratio', name: 'Classified Ratio', nameEs: 'Ratio Clasificados', value: 3.6, trend: 'deteriorating', alertLevel: 'yellow', weight: 8, contribution: 4 },
    ],
    peerAlert:   'Asset quality is within peer group norms. Watch classified asset ratio trending upward.',
    peerAlertEs: 'La calidad de activos está dentro de normas del grupo de pares. Vigile ratio de clasificados con tendencia ascendente.',
    anomalyScore: 0.42,
  };
}

function EWSContent({ data }: { data: EWSResult }) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'composite_score', label: locale === 'es' ? 'Compuesto EWS' : 'EWS Composite', value: data.compositeScore, unit: 'count' },
    { key: 'anomaly_score',   label: locale === 'es' ? 'Anomalía'      : 'Anomaly',       value: data.anomalyScore,   unit: 'x' },
    { key: 'indicators',      label: locale === 'es' ? 'Indicadores' : 'Indicators',      value: data.indicators.length, unit: 'count' },
    { key: 'green_indicators',label: 'GREEN',                                              value: data.indicators.filter((i) => i.alertLevel === 'green').length,  unit: 'count' },
    { key: 'yellow_indicators',label: 'YELLOW',                                            value: data.indicators.filter((i) => i.alertLevel === 'yellow').length, unit: 'count' },
    { key: 'red_indicators',  label: 'RED',                                                value: data.indicators.filter((i) => i.alertLevel === 'red').length,    unit: 'count' },
  ], [data, locale]);

  // D1: no asset-quality history to score → honest neutral panel + gaps.
  if (isDataUnavailable(data) || data.indicators.length === 0) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'The early-warning system needs asset-quality history (delinquency, NPL, charge-offs). Load the loan performance data to compute the composite score.',
          es: 'El sistema de alerta temprana requiere historial de calidad de activos (morosidad, NPL, castigos). Cargue los datos de desempeño de préstamos para calcular la puntuación compuesta.',
        }}
      />
    );
  }

  const style = alertStyle(data.alertLevel);
  const composite = data.compositeScore ?? 0;
  const anomaly = data.anomalyScore ?? 0;

  return (
    <>
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* Composite gauge + anomaly + peer alert */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <section className={`rounded-xl border p-5 text-center ${style.bg} ${style.border}`}>
          <div className="relative mx-auto mb-3 h-32 w-32">
            <svg viewBox="0 0 36 36" className="h-32 w-32 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
              <circle
                cx="18"
                cy="18"
                r="15.9"
                fill="none"
                stroke={style.ring}
                strokeWidth="2.5"
                strokeDasharray={`${composite} ${100 - composite}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-mono text-3xl font-bold tabular-nums ${style.text}`}>{composite}</span>
              <span className="text-[10px] text-slate-500">/100</span>
            </div>
          </div>
          <p className={`text-sm font-bold ${style.text}`}>{data.alertLevel ?? '—'}</p>
          <p className="mt-1 text-[10px] text-slate-500">
            {locale === 'es' ? 'Puntuación Compuesta EWS' : 'EWS Composite Score'}
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Anomalía (Isolation Forest)' : 'Anomaly (Isolation Forest)'}
          </p>
          <p className={`font-mono text-3xl font-bold tabular-nums ${
            anomaly > 0.75 ? 'text-rose-700' :
            anomaly > 0.60 ? 'text-amber-700' :
                                        'text-emerald-700'
          }`}>
            {anomaly.toFixed(2)}
          </p>
          <div className="mt-3 h-2 rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full ${
                anomaly > 0.75 ? 'bg-rose-500' :
                anomaly > 0.60 ? 'bg-amber-500' :
                                            'bg-emerald-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, anomaly * 100))}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-slate-400">
            <span>0 {locale === 'es' ? 'Normal' : 'Normal'}</span>
            <span>0.60 Watch</span>
            <span>0.75 Warning</span>
            <span>1.0 Alert</span>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {locale === 'es' ? 'Alerta de Pares' : 'Peer Alert'}
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{locale === 'es' ? data.peerAlertEs : data.peerAlert}</p>
          {data.topDeteriorating.length > 0 ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase text-rose-600">
                {locale === 'es' ? 'En Deterioro' : 'Deteriorating'}
              </p>
              {data.topDeteriorating.map((ind) => (
                <p key={ind.id} className="text-xs text-rose-700">• {locale === 'es' ? ind.nameEs : ind.name}</p>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {/* 12-indicator grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {data.indicators.map((ind) => {
          const Icon = ind.trend === 'improving' ? TrendingUp : ind.trend === 'deteriorating' ? TrendingDown : Minus;
          const iconColor = ind.trend === 'improving' ? 'text-emerald-600' : ind.trend === 'deteriorating' ? 'text-rose-600' : 'text-slate-500';
          return (
            <div key={ind.id} className={`rounded-xl border p-3 ${INDICATOR_COLORS[ind.alertLevel]}`}>
              <div className="flex items-start justify-between">
                <p className="text-[10px] font-medium leading-tight">{locale === 'es' ? ind.nameEs : ind.name}</p>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} aria-label={ind.trend} />
              </div>
              <p className="mt-1 font-mono text-lg font-bold tabular-nums">
                {typeof ind.value === 'number' && ind.value < 1 ? `${(ind.value * 100).toFixed(2)}%` : ind.value}
              </p>
              <div className="mt-1 flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${
                  ind.alertLevel === 'green' ? 'bg-emerald-500' :
                  ind.alertLevel === 'yellow' ? 'bg-amber-500' :
                                                 'bg-rose-500'
                }`} aria-hidden />
                <span className="text-[9px] opacity-70">
                  {locale === 'es' ? 'Peso' : 'Weight'} {ind.weight}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function EWSPage() {
  return (
    <AlmPage<EWSResult>
      slug="ews"
      iconTint="amber"
      validate={validateEWS}
      getDemo={getDemo}
    >
      {(data) => <EWSContent data={data} />}
    </AlmPage>
  );
}
