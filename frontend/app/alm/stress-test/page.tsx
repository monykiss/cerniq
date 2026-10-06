'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';
import Link from 'next/link';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, XCircle, SlidersHorizontal } from 'lucide-react';
import RiskBadge from '@/components/alm/RiskBadge';
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface MonteCarloResult {
  paths: number;
  horizon: number;
  ratePaths: number[][];
  niiDistribution: { p5: number; p25: number; median: number; p75: number; p95: number };
  monthlyNIIBands: Array<{ month: number; p5: number; p25: number; median: number; p75: number; p95: number }>;
  worstCaseNII: number;
  expectedNII: number;
  niiAtRisk: number;
}

interface RegulatoryScenario {
  name: string;
  description: string;
  rateShock: number[];
  niImpact: number;
  mveImpact: number;
  lcrImpact: number;
  capitalImpact: number;
  passFailStatus: 'pass' | 'warn' | 'fail';
}

interface StressTestResult {
  monteCarlo: MonteCarloResult;
  regulatory: {
    scenarios: RegulatoryScenario[];
    overallRating: 'resilient' | 'adequate' | 'vulnerable' | 'critical';
  };
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pass':
      return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case 'fail':
      return <XCircle className="h-4 w-4 text-red-400" />;
    default:
      return null;
  }
}

const ratingColors: Record<string, string> = {
  resilient: 'text-emerald-400',
  adequate: 'text-blue-400',
  vulnerable: 'text-amber-400',
  critical: 'text-red-400',
};

const ratingBadge: Record<string, 'low' | 'moderate' | 'high' | 'critical'> = {
  resilient: 'low',
  adequate: 'moderate',
  vulnerable: 'high',
  critical: 'critical',
};

function StressTestLoadingAnimation() {
  const { t, ta } = useTranslation();
  const loadingSteps = ta('stressTest.loadingSteps');
  const stepTimings = [500, 1000, 500, 500, 300];
  const [completed, setCompleted] = useState<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let step = 0;
    const advance = () => {
      if (step < loadingSteps.length) {
        setCompleted((prev) => [...prev, step]);
        step++;
        timerRef.current = setTimeout(advance, stepTimings[step - 1] || 300);
      }
    };
    timerRef.current = setTimeout(advance, 200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/20 to-red-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
        <Zap className="h-6 w-6 text-orange-400 animate-pulse" />
      </div>
      <h3 className="text-white font-bold mb-1">{t('stressTest.runningTitle')}</h3>
      <p className="text-xs text-slate-500 mb-8">{t('stressTest.runningSubtitle')}</p>
      <div className="w-full max-w-xs space-y-3">
        {loadingSteps.map((text, i) => {
          const done = completed.includes(i);
          const current = !done && completed.length === i;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 transition-all duration-300 ${
                done ? 'opacity-100' : current ? 'opacity-70' : 'opacity-20'
              }`}
            >
              {done ? (
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : current ? (
                <div className="w-4 h-4 border-2 border-orange-500/40 border-t-orange-500 rounded-full animate-spin shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-white/[0.08] shrink-0" />
              )}
              <span className={`text-sm ${done ? 'text-slate-300' : 'text-slate-500'}`}>{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StressTestPage() {
  const { selectedId } = useALM();
  const { t } = useTranslation();
  const [result, setResult] = useState<StressTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runStressTest = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.runStressTest(selectedId, {
        paths: 1000,
        horizon: 12,
      });
      setResult(data);
      analytics.track(EVENTS.ALM_STRESS_TEST_RUN, {
        institutionId: selectedId,
        paths: 1000,
        niiAtRisk: data.monteCarlo.niiAtRisk,
        overallRating: data.regulatory.overallRating,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run stress test';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto" aria-hidden />
          <p className="text-slate-400 text-sm">{t('stressTest.noInstitution')}</p>
        </div>
      </div>
    );
  }

  const distributionItems = result ? [
    { label: t('stressTest.p5'), value: result.monteCarlo.niiDistribution.p5, color: 'text-red-400' },
    { label: t('stressTest.p25'), value: result.monteCarlo.niiDistribution.p25, color: 'text-orange-400' },
    { label: t('stressTest.median'), value: result.monteCarlo.niiDistribution.median, color: 'text-amber-400' },
    { label: t('stressTest.p75'), value: result.monteCarlo.niiDistribution.p75, color: 'text-emerald-400' },
    { label: t('stressTest.p95'), value: result.monteCarlo.niiDistribution.p95, color: 'text-cyan-400' },
  ] : [];

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
            <Zap className="h-4 w-4 text-orange-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{t('stressTest.title')}</h1>
            <p className="text-xs text-slate-500">{t('stressTest.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && <RiskBadge status={ratingBadge[result.regulatory.overallRating] || 'moderate'} size="sm" />}
          <button
            onClick={runStressTest}
            disabled={loading}
            className="flex items-center gap-1.5 bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 text-orange-300 px-3 py-1.5 rounded-lg text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? t('stressTest.running') : t('stressTest.runTest')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Pre-run state */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-red-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
            <Zap className="h-8 w-8 text-orange-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">{t('stressTest.preRunTitle')}</h2>
          <p className="text-sm text-slate-400 max-w-md mb-8 leading-relaxed">
            {t('stressTest.preRunDesc')}
          </p>
          <button
            onClick={runStressTest}
            className="px-6 py-2.5 bg-orange-500 hover:bg-orange-400 text-slate-900 text-sm font-semibold rounded-lg transition"
          >
            {t('stressTest.runTest')}
          </button>
        </div>
      )}

      {/* Loading — sequential computation animation */}
      {loading && <StressTestLoadingAnimation />}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Hero KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.06]">
            <div className="bg-gradient-to-br from-orange-500/10 to-red-500/5 px-5 py-5 text-center">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{t('stressTest.niiAtRisk')}</p>
              <p className="text-5xl font-bold text-orange-300 mt-2 tabular-nums">${result.monteCarlo.niiAtRisk}M</p>
              <p className="text-[11px] text-slate-500 mt-1.5 max-w-[220px] mx-auto leading-relaxed">{t('stressTest.niiAtRiskDesc')}</p>
            </div>
            <div className="bg-slate-900/80 px-5 py-4 text-center">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{t('stressTest.expectedNII')}</p>
              <p className="text-3xl font-bold text-white mt-1 tabular-nums">${result.monteCarlo.expectedNII}M</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{t('stressTest.median')} across {result.monteCarlo.paths} paths</p>
            </div>
            <div className="bg-slate-900/80 px-5 py-4 text-center">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{t('stressTest.regulatoryRating')}</p>
              <p className={`text-3xl font-bold mt-1 capitalize ${ratingColors[result.regulatory.overallRating]}`}>
                {result.regulatory.overallRating}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {result.regulatory.scenarios.filter((s) => s.passFailStatus === 'pass').length}/4 scenarios pass
              </p>
            </div>
          </div>

          {/* Monte Carlo Fan Chart */}
          <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">{t('stressTest.niiProjection')}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={result.monteCarlo.monthlyNIIBands} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  tickFormatter={(m: number) => `M${m}`}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  label={{ value: '$ Millions', angle: -90, position: 'insideLeft', fill: '#475569', fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    color: '#f1f5f9',
                    fontSize: 12,
                  }}
                  formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, '']}
                  labelFormatter={(label) => `Month ${label}`}
                />
                <Area type="monotone" dataKey="p95" stackId="1" stroke="none" fill="#22c55e" fillOpacity={0.08} name="95th %ile" />
                <Area type="monotone" dataKey="p75" stackId="2" stroke="none" fill="#22c55e" fillOpacity={0.12} name="75th %ile" />
                <Area type="monotone" dataKey="median" stackId="3" stroke="#f59e0b" strokeWidth={2} fill="#f59e0b" fillOpacity={0.08} name="Median" />
                <Area type="monotone" dataKey="p25" stackId="4" stroke="none" fill="#ef4444" fillOpacity={0.12} name="25th %ile" />
                <Area type="monotone" dataKey="p5" stackId="5" stroke="none" fill="#ef4444" fillOpacity={0.08} name="5th %ile" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 mt-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/20" /> 75-95th %ile</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-amber-500" /> {t('stressTest.median')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/20" /> 5-25th %ile</span>
            </div>
          </div>

          {/* NII Distribution */}
          <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.06]">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('stressTest.niiDistribution')}</h3>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-px bg-white/[0.02]">
              {distributionItems.map((item) => (
                <div key={item.label} className="bg-slate-900/60 text-center py-4 px-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
                  <p className={`text-lg font-bold mt-1 tabular-nums ${item.color}`}>${item.value}M</p>
                </div>
              ))}
            </div>
          </div>

          {/* Regulatory Scenario Cards */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('stressTest.regulatoryScenarios')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {result.regulatory.scenarios.map((scenario) => (
                <div
                  key={scenario.name}
                  className={`bg-slate-900/40 border rounded-xl p-4 ${
                    scenario.passFailStatus === 'pass'
                      ? 'border-emerald-500/15'
                      : scenario.passFailStatus === 'warn'
                      ? 'border-amber-500/15'
                      : 'border-red-500/15'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={scenario.passFailStatus} />
                      <h4 className="text-sm font-medium text-white">{scenario.name}</h4>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      scenario.passFailStatus === 'pass'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : scenario.passFailStatus === 'warn'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {scenario.passFailStatus}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">{scenario.description}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div>
                      <span className="text-slate-500">{t('stressTest.niiImpact')}</span>
                      <span className={`block font-mono font-medium tabular-nums ${scenario.niImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {scenario.niImpact >= 0 ? '+' : ''}${scenario.niImpact}M
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">{t('stressTest.mveImpact')}</span>
                      <span className={`block font-mono font-medium tabular-nums ${scenario.mveImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {scenario.mveImpact >= 0 ? '+' : ''}${scenario.mveImpact}M
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">{t('stressTest.lcrUnderStress')}</span>
                      <span className={`block font-mono font-medium tabular-nums ${scenario.lcrImpact >= 100 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {scenario.lcrImpact}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">{t('stressTest.capitalImpact')}</span>
                      <span className={`block font-mono font-medium tabular-nums ${scenario.capitalImpact >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {scenario.capitalImpact >= 0 ? '+' : ''}{scenario.capitalImpact}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Link to Scenario Builder */}
      <Link
        href={`/alm/scenario-builder?id=${selectedId}`}
        className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 transition hover:border-amber-300 hover:bg-amber-100/60"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200 bg-white">
          <SlidersHorizontal className="h-4 w-4 text-amber-700" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-950">Constructor de Escenarios / Scenario Builder</p>
          <p className="text-[11px] text-slate-500">Design custom stress scenarios with PR-specific presets</p>
        </div>
        <span className="text-xs text-amber-700 font-medium">Open &rarr;</span>
      </Link>
    </div>
  );
}
