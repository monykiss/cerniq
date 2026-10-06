'use client';

/**
 * Analyst Page — Bible §9.3 two-column layout.
 *
 * 65% left: SSE-streaming chat via AnalystPanel (4 Claude tools, rate-limited)
 * 35% right: Live COSSEC/ALM ratio sidebar from preflight endpoint
 *
 * The sidebar gives Maria (Controller) immediate context while asking
 * the analyst questions. She sees the numbers AND the AI's interpretation
 * side-by-side — no tab switching.
 */

import { useState, useEffect, useCallback } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import AnalystPanel from '@/components/portal/AnalystPanel';
import { useTranslation } from '@/lib/i18n';
import { getPublicApiUrl } from '@/lib/api-base';
import { getAccessToken } from '@/lib/api';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  Shield,
  BarChart3,
} from 'lucide-react';

// ─── Ratio Sidebar ────────────────────────────────────────────

interface RatioItem {
  label: string;
  value: string | number | null;
  status: 'compliant' | 'breach' | 'warning' | 'data_unavailable';
  threshold?: string;
}

interface PreflightData {
  ready: boolean;
  criticalCount: number;
  warningCount: number;
  gaps: Array<{ field: string; severity: string }>;
  modelLineage?: Array<{ modelKey: string; version: string; status: string }>;
  // Preflight returns sub-results keyed by report producer. Only the two
  // shapes we render below are typed here; add more as the sidebar grows.
  results?: {
    summary?: ALMSummary;
    cossec?: COSSECData;
  };
}

interface ALMSummary {
  riskScore: number | null;
  durationGap?: { durationGap: number; riskProfile: string };
  niiSensitivity?: { baseNII: number; riskRating: string };
  liquidity?: { lcr: number | null; status: string };
}

interface COSSECData {
  ratios?: Array<{
    nameEs: string;
    nameEn: string;
    value: number | null;
    unit: string;
    status: string;
  }>;
  overallStatus: string;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'compliant' || status === 'CUMPLE') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === 'breach' || status === 'INCUMPLE') return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  if (status === 'data_unavailable') return <Activity className="h-3.5 w-3.5 text-slate-400" />;
  return <TrendingDown className="h-3.5 w-3.5 text-amber-500" />;
}

function RatioSidebar({
  institutionId,
  locale,
}: {
  institutionId: string;
  locale: string;
}) {
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = (en: string, es: string) => (locale === 'es' ? es : en);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(
        getPublicApiUrl(`/alm/${institutionId}/preflight`),
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPreflight(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        {t('Loading ratios...', 'Cargando ratios...')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-500">
        {t('Error loading ratios', 'Error cargando ratios')}
        <button onClick={load} className="ml-2 underline">
          {t('Retry', 'Reintentar')}
        </button>
      </div>
    );
  }

  const summary = preflight?.results?.summary;
  const cossec = preflight?.results?.cossec;

  // Build ratio list from preflight results
  const ratios: RatioItem[] = [];

  // ALM core metrics
  if (summary?.liquidity?.lcr != null) {
    ratios.push({
      label: 'LCR',
      value: `${summary.liquidity.lcr.toFixed(1)}%`,
      status: summary.liquidity.status === 'compliant' ? 'compliant' : 'breach',
      threshold: '≥100%',
    });
  } else {
    ratios.push({ label: 'LCR', value: null, status: 'data_unavailable' });
  }

  if (summary?.durationGap) {
    const dg = summary.durationGap.durationGap;
    ratios.push({
      label: t('Duration Gap', 'Brecha Duración'),
      value: `${dg.toFixed(2)} yrs`,
      status: Math.abs(dg) < 2 ? 'compliant' : 'warning',
    });
  }

  if (summary?.niiSensitivity) {
    ratios.push({
      label: t('NII Risk', 'Riesgo NII'),
      value: summary.niiSensitivity.riskRating,
      status: summary.niiSensitivity.riskRating === 'low' ? 'compliant' : 'warning',
    });
  }

  if (summary?.riskScore != null) {
    ratios.push({
      label: t('Risk Score', 'Puntuación'),
      value: summary.riskScore,
      status: summary.riskScore >= 70 ? 'compliant' : summary.riskScore >= 50 ? 'warning' : 'breach',
    });
  }

  // COSSEC ratios
  if (cossec?.ratios) {
    for (const r of cossec.ratios.slice(0, 8)) {
      ratios.push({
        label: locale === 'es' ? r.nameEs : r.nameEn,
        value: r.value != null ? `${r.value}${r.unit}` : null,
        status: r.status === 'CUMPLE' ? 'compliant' : r.status === 'INCUMPLE' ? 'breach' : 'data_unavailable',
      });
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-cyan-700" />
          <span className="text-xs font-semibold text-slate-800">
            {t('Live Ratios', 'Ratios en Vivo')}
          </span>
          {preflight && (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                preflight.ready
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {preflight.ready
                ? t('Ready', 'Listo')
                : `${preflight.criticalCount} ${t('critical', 'criticos')}`}
            </span>
          )}
        </div>
      </div>

      {/* Ratio list */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="space-y-1">
          {ratios.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-slate-50"
            >
              <div className="flex items-center gap-1.5">
                <StatusIcon status={r.status} />
                <span className="text-slate-700">{r.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono tabular-nums ${
                    r.value == null
                      ? 'text-slate-400'
                      : r.status === 'breach'
                        ? 'text-red-600 font-medium'
                        : r.status === 'compliant'
                          ? 'text-emerald-700'
                          : 'text-amber-600'
                  }`}
                >
                  {r.value ?? '—'}
                </span>
                {r.threshold && (
                  <span className="text-[10px] text-slate-400">{r.threshold}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Model lineage footer */}
      {preflight?.modelLineage && preflight.modelLineage.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <BarChart3 className="h-3 w-3" />
            {preflight.modelLineage.length} {t('models', 'modelos')} ·{' '}
            {preflight.modelLineage.filter((m) => m.status === 'APPROVED').length}{' '}
            {t('approved', 'aprobados')}
          </div>
        </div>
      )}

      {/* Refresh */}
      <div className="border-t border-slate-100 px-4 py-2">
        <button
          onClick={load}
          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500 hover:bg-slate-50"
        >
          {t('Refresh Ratios', 'Actualizar Ratios')}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────

export default function AnalystPage() {
  const { selectedId, institution } = useALM();
  const { locale } = useTranslation();

  if (!selectedId) {
    return <AlmSelectionRequired moduleLabel="Conversational ALM Analyst" />;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* 65% — Chat */}
      <div className="flex w-[65%] flex-col border-r border-slate-200 bg-white">
        <AnalystPanel
          institutionId={selectedId}
          institutionName={institution?.name}
        />
      </div>

      {/* 35% — Live Ratio Sidebar */}
      <div className="w-[35%] bg-slate-50">
        <RatioSidebar institutionId={selectedId} locale={locale} />
      </div>
    </div>
  );
}
