'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';
import { useSSEStream } from '@/hooks/useSSEStream';
import { Brain, AlertTriangle, Shield, TrendingUp, Wallet, Target, Play, RefreshCw } from 'lucide-react';
import DOMPurify from 'dompurify';

// ─── Types ────────────────────────────────────────────────────

interface HealthScore {
  overall: number;
  capital: number;
  liquidity: number;
  rateRisk: number;
  credit: number;
  concentration: number;
  label: 'STRONG' | 'SATISFACTORY' | 'FAIR' | 'MARGINAL' | 'UNSATISFACTORY';
}

interface RiskAlert {
  rank: number;
  domain: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  messageEs: string;
  regulatoryRef: string;
  remediation: string;
  remediationEs: string;
}

type HealthDimensionKey = 'capital' | 'liquidity' | 'rateRisk' | 'credit' | 'concentration';

const SCORE_COLORS: Record<string, { ring: string; text: string; bg: string }> = {
  STRONG: { ring: 'stroke-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  SATISFACTORY: { ring: 'stroke-cyan-500', text: 'text-cyan-700', bg: 'bg-cyan-50' },
  FAIR: { ring: 'stroke-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  MARGINAL: { ring: 'stroke-orange-500', text: 'text-orange-700', bg: 'bg-orange-50' },
  UNSATISFACTORY: { ring: 'stroke-rose-500', text: 'text-rose-700', bg: 'bg-rose-50' },
};

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: 'border-rose-200 bg-rose-50 text-rose-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  LOW: 'border-cyan-200 bg-cyan-50 text-cyan-700',
};

const DIMENSION_ICONS: Array<{ key: HealthDimensionKey; icon: typeof Wallet; label: string; labelEs: string }> = [
  { key: 'capital', icon: Wallet, label: 'Capital', labelEs: 'Capital' },
  { key: 'liquidity', icon: Shield, label: 'Liquidity', labelEs: 'Liquidez' },
  { key: 'rateRisk', icon: TrendingUp, label: 'Rate Risk', labelEs: 'Riesgo Tasa' },
  { key: 'credit', icon: AlertTriangle, label: 'Credit', labelEs: 'Crédito' },
  { key: 'concentration', icon: Target, label: 'Concentration', labelEs: 'Concentración' },
];

const NODE_API_URL = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');

// ─── Main Page ────────────────────────────────────────────────

export default function AdvisorV2Page() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const { text: narrativeText, isStreaming, start: startStream, reset } = useSSEStream();

  const [health, setHealth] = useState<HealthScore | null>(null);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const data = await apiClient.getAdvisorNarrative(selectedId, locale);
        setHealth(data.healthScore);
        setAlerts(data.alerts ?? []);
      } catch {
        setHealth(getDemoHealth());
        setAlerts(getDemoAlerts());
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedId, locale]);

  const handleStream = useCallback(() => {
    if (!selectedId) return;
    reset();
    const url = `${NODE_API_URL}/api/alm/${selectedId}/advisor/stream?lang=${locale}`;
    startStream(url);
  }, [selectedId, locale, startStream, reset]);

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
      </div>
    );
  }

  const scoreStyle = health ? SCORE_COLORS[health.label] || SCORE_COLORS.FAIR : SCORE_COLORS.FAIR;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-purple-200 bg-purple-50">
            <Brain className="h-4 w-4 text-purple-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">
              {locale === 'es' ? 'Asesor ALM Inteligente' : 'AI ALM Advisor'}
            </h1>
            <p className="text-xs text-slate-500">
              {locale === 'es' ? 'Resumen ejecutivo, alertas y pulso regulatorio' : 'Executive summary, risk alerts & regulatory pulse'}
            </p>
          </div>
        </div>
        <button
          onClick={handleStream}
          disabled={isStreaming}
          className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50"
        >
          {isStreaming ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {isStreaming
            ? (locale === 'es' ? 'Generando...' : 'Generating...')
            : (locale === 'es' ? 'Generar Narrativa' : 'Generate Narrative')}
        </button>
      </div>

      {/* Health Score Gauge */}
      {health && (
        <div className={`rounded-xl border p-5 ${scoreStyle.bg} border-slate-200`}>
          <div className="flex items-center gap-6">
            {/* Circular gauge */}
            <div className="relative h-28 w-28 shrink-0">
              <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  className={scoreStyle.ring}
                  strokeWidth="2.5"
                  strokeDasharray={`${health.overall} ${100 - health.overall}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold tabular-nums ${scoreStyle.text}`}>{health.overall}</span>
                <span className="text-[9px] text-slate-500">/100</span>
              </div>
            </div>

            {/* Sub-scores */}
            <div className="flex-1">
              <p className={`text-lg font-bold ${scoreStyle.text} mb-2`}>
                {locale === 'es'
                  ? { STRONG: 'Fuerte', SATISFACTORY: 'Satisfactorio', FAIR: 'Regular', MARGINAL: 'Marginal', UNSATISFACTORY: 'Insatisfactorio' }[health.label]
                  : health.label}
              </p>
              <div className="grid grid-cols-5 gap-2">
                {DIMENSION_ICONS.map(({ key, icon: Icon, label, labelEs }) => (
                  <div key={key} className="text-center">
                    <Icon className="h-4 w-4 mx-auto text-slate-500 mb-1" />
                    <p className="text-[10px] text-slate-500">{locale === 'es' ? labelEs : label}</p>
                    <p className="text-sm font-bold tabular-nums text-slate-800">{health[key]}/20</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Risk Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {locale === 'es' ? 'Principales Alertas de Riesgo' : 'Top Risk Alerts'}
          </p>
          {alerts.map((alert) => (
            <div key={alert.rank} className={`rounded-xl border p-4 ${SEVERITY_STYLES[alert.severity]}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">#{alert.rank}</span>
                  <span className="text-sm font-semibold">{alert.domain}</span>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold border">{alert.severity}</span>
              </div>
              <p className="text-sm">{locale === 'es' ? alert.messageEs : alert.message}</p>
              <p className="text-[10px] mt-1 opacity-70">Ref: {alert.regulatoryRef}</p>
              <p className="text-xs mt-2 font-medium">
                {locale === 'es' ? '→ ' + alert.remediationEs : '→ ' + alert.remediation}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Streaming Narrative */}
      {(narrativeText || isStreaming) && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
            {locale === 'es' ? 'Narrativa Ejecutiva' : 'Executive Narrative'}
          </p>
          <div className="prose prose-sm prose-slate max-w-none">
            <div
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                  narrativeText
                    .replace(/## (.+)/g, '<h3 class="text-base font-bold text-slate-950 mt-4 mb-2">$1</h3>')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/_(.+?)_/g, '<em>$1</em>')
                    .replace(/\n/g, '<br/>'),
                ),
              }}
            />
            {isStreaming && <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-0.5" />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Demo Data ────────────────────────────────────────────────

function getDemoHealth(): HealthScore {
  return { overall: 72, capital: 16, liquidity: 16, rateRisk: 12, credit: 14, concentration: 14, label: 'SATISFACTORY' };
}

function getDemoAlerts(): RiskAlert[] {
  return [
    { rank: 1, domain: 'Interest Rate Risk', severity: 'HIGH',
      message: 'Duration gap of 2.1 years exceeds prudent levels. EVE sensitivity at +200bps is -18.2%.',
      messageEs: 'La brecha de duración de 2.1 años excede niveles prudentes. Sensibilidad EVE a +200bps es -18.2%.',
      regulatoryRef: 'COSSEC Examen Art. 7.3',
      remediation: 'Consider receive-fixed swaps or ladder CD maturities to reduce gap.',
      remediationEs: 'Considere swaps de tasa fija o escalone vencimientos de CDs para reducir la brecha.' },
    { rank: 2, domain: 'Concentration Risk', severity: 'MEDIUM',
      message: 'Commercial RE at 27% of assets — approaching 30% policy limit.',
      messageEs: 'CRE al 27% de activos — acercándose al límite de política del 30%.',
      regulatoryRef: 'COSSEC Examen Art. 8.2',
      remediation: 'Diversify new originations; consider loan participations.',
      remediationEs: 'Diversifique nuevas originaciones; considere participaciones de préstamos.' },
    { rank: 3, domain: 'Liquidity', severity: 'LOW',
      message: 'LCR at 115% provides adequate buffer above 100% minimum.',
      messageEs: 'LCR al 115% proporciona colchón adecuado sobre el mínimo de 100%.',
      regulatoryRef: 'Basel III LCR',
      remediation: 'Maintain current HQLA levels; monitor wholesale funding stability.',
      remediationEs: 'Mantenga niveles actuales de HQLA; monitoree estabilidad de fondeo mayorista.' },
  ];
}
