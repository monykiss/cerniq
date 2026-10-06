'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { apiClient } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';
import { RefreshCw, TrendingUp, AlertTriangle, Info } from 'lucide-react';
import RiskBadge from '@/components/alm/RiskBadge';

const ScenarioChart = dynamic(
  () => import('@/components/alm/ScenarioChart'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64 rounded-xl border border-slate-200 bg-white animate-pulse">
        <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    ),
  }
);
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';

interface NIISensitivity {
  scenarios: Array<{
    name: string;
    shiftBps: number;
    niImpact: number;
    niImpactPct: number;
    mveImpact: number;
    mveImpactPct: number;
  }>;
  baseNII: number;
  riskRating: 'low' | 'moderate' | 'high' | 'critical';
}

interface DurationGap {
  assetDuration: number;
  liabilityDuration: number;
  durationGap: number;
  riskProfile: 'asset-sensitive' | 'liability-sensitive' | 'neutral';
}

function generateRiskNarrative(nii: NIISensitivity, dg: DurationGap): string {
  const profile = dg.riskProfile.replace('-', ' ');
  const worstScenario = nii.scenarios.reduce((worst, s) =>
    Math.abs(s.niImpact) > Math.abs(worst.niImpact) ? s : worst,
    nii.scenarios[0],
  );

  let narrative = `This institution is ${profile} with a duration gap of ${dg.durationGap > 0 ? '+' : ''}${dg.durationGap} years. `;
  narrative += `Asset-weighted duration is ${dg.assetDuration}yr versus liability duration of ${dg.liabilityDuration}yr. `;

  if (dg.riskProfile === 'asset-sensitive') {
    narrative += `Rising rates would increase NII as assets reprice faster than liabilities, while falling rates pose the primary risk. `;
  } else if (dg.riskProfile === 'liability-sensitive') {
    narrative += `Rising rates would compress NII as liabilities reprice faster than assets. `;
  } else {
    narrative += `The near-zero duration gap provides natural hedging against rate movements. `;
  }

  if (worstScenario) {
    narrative += `Under the worst-case scenario (${worstScenario.name}), NII changes by $${worstScenario.niImpact}M (${worstScenario.niImpactPct}%). `;
    narrative += `Market value of equity impact under this scenario is $${worstScenario.mveImpact}M (${worstScenario.mveImpactPct}%). `;
  }

  if (nii.riskRating === 'critical' || nii.riskRating === 'high') {
    narrative += `Overall interest rate risk is rated ${nii.riskRating.toUpperCase()} — immediate review of hedging strategies is recommended.`;
  } else {
    narrative += `Overall interest rate risk is rated ${nii.riskRating} — within acceptable parameters.`;
  }

  return narrative;
}

function SkeletonPulse() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-6 bg-slate-800 rounded w-48" />
      <div className="grid grid-cols-4 gap-px bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.06]">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-slate-900/80 px-4 py-4">
            <div className="h-3 bg-slate-800 rounded w-16 mb-3" />
            <div className="h-6 bg-slate-800 rounded w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="h-80 bg-slate-900/40 rounded-xl border border-white/[0.06]" />
        <div className="h-80 bg-slate-900/40 rounded-xl border border-white/[0.06]" />
      </div>
    </div>
  );
}

export default function SensitivityPage() {
  const { t } = useTranslation();
  const { selectedId } = useALM();
  const [nii, setNII] = useState<NIISensitivity | null>(null);
  const [durationGap, setDurationGap] = useState<DurationGap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const [niiData, dgData] = await Promise.all([
        apiClient.getNIISensitivity(selectedId),
        apiClient.getDurationGap(selectedId),
      ]);
      setNII(niiData);
      setDurationGap(dgData);
      analytics.track(EVENTS.ALM_ANALYSIS_RUN, {
        institutionId: selectedId,
        view: 'sensitivity',
        riskRating: niiData.riskRating,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load sensitivity data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto" aria-hidden />
          <p className="text-slate-400 text-sm">No institution selected. Select one from the top bar.</p>
        </div>
      </div>
    );
  }

  if (loading) return <SkeletonPulse />;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Rate Sensitivity</h1>
            <p className="text-xs text-slate-500">NII & MVE Impact Scenarios</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nii && <RiskBadge status={nii.riskRating} size="sm" />}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] text-slate-400 hover:text-white px-3 py-1.5 rounded-lg text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && (!nii || !durationGap) && (
        <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-10 text-center">
          <TrendingUp className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-1">No sensitivity data available</p>
          <p className="text-xs text-slate-600">Upload balance sheet data to generate NII and duration gap analysis.</p>
        </div>
      )}

      {nii && durationGap && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.06]">
            <div className="bg-slate-900/80 px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Base NII</p>
              <p className="text-xl font-bold text-white tabular-nums">${nii.baseNII.toFixed(1)}M</p>
              <p className="text-[11px] text-slate-500">Annual net interest income</p>
            </div>
            <div className="bg-slate-900/80 px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Asset Duration</p>
              <p className="text-xl font-bold text-white tabular-nums">{durationGap.assetDuration}yr</p>
              <p className="text-[11px] text-slate-500">Weighted average</p>
            </div>
            <div className="bg-slate-900/80 px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Liability Duration</p>
              <p className="text-xl font-bold text-white tabular-nums">{durationGap.liabilityDuration}yr</p>
              <p className="text-[11px] text-slate-500">Weighted average</p>
            </div>
            <div className="bg-slate-900/80 px-4 py-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Duration Gap</p>
              <p className={`text-xl font-bold tabular-nums ${Math.abs(durationGap.durationGap) < 1 ? 'text-emerald-400' : Math.abs(durationGap.durationGap) < 2 ? 'text-amber-400' : 'text-red-400'}`}>
                {durationGap.durationGap > 0 ? '+' : ''}{durationGap.durationGap}yr
              </p>
              <p className="text-[11px] text-slate-500 capitalize">{durationGap.riskProfile.replace(/-/g, ' ')}</p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-5">
              <ScenarioChart
                scenarios={nii.scenarios}
                dataKey="niImpact"
                title={t('risk.niiImpactByScenario')}
                yAxisLabel={t('risk.millions')}
              />
            </div>
            <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-5">
              <ScenarioChart
                scenarios={nii.scenarios}
                dataKey="mveImpact"
                title={`${t('stressTest.mveImpact')} by Scenario`}
                yAxisLabel={t('risk.millions')}
              />
            </div>
          </div>

          {/* Scenario Detail Table */}
          <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scenario Impact Detail</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    <th className="text-left py-2.5 px-5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Scenario</th>
                    <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Rate Shift</th>
                    <th className="text-right py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">NII ($M)</th>
                    <th className="text-right py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">NII (%)</th>
                    <th className="text-right py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">MVE ($M)</th>
                    <th className="text-right py-2.5 px-5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">MVE (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...nii.scenarios].sort((a, b) => a.shiftBps - b.shiftBps).map((s, i) => (
                    <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition">
                      <td className="py-2.5 px-5 text-white font-medium">{s.name}</td>
                      <td className="py-2.5 px-4 text-slate-400 font-mono text-xs">{s.shiftBps > 0 ? '+' : ''}{s.shiftBps} bps</td>
                      <td className={`py-2.5 px-4 text-right font-mono text-xs ${s.niImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.niImpact >= 0 ? '+' : ''}{s.niImpact.toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-mono text-xs ${s.niImpactPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.niImpactPct >= 0 ? '+' : ''}{s.niImpactPct.toFixed(2)}%
                      </td>
                      <td className={`py-2.5 px-4 text-right font-mono text-xs ${s.mveImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.mveImpact >= 0 ? '+' : ''}{s.mveImpact.toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-5 text-right font-mono text-xs ${s.mveImpactPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.mveImpactPct >= 0 ? '+' : ''}{s.mveImpactPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk Narrative */}
          <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-blue-400" />
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Risk Assessment</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {generateRiskNarrative(nii, durationGap)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
