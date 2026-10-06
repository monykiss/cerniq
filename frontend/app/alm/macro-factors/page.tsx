'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from 'recharts';
import { Activity } from 'lucide-react';

interface MacroFactorResult {
  r2: number;
  factors: Array<{ name: string; beta: number; tStat: number; significant: boolean }>;
  residualVol: number;
  forecastNII: number;
  historicalFit: Array<{ date: string; actual: number; predicted: number }>;
  scenarioImpact: Array<{ scenario: string; gdpShock: number; rateShock: number; niiChange: number }>;
}

export default function MacroFactorsPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<MacroFactorResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/${selectedId}/macro-factors`);
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Macro Factors" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-orange-200 bg-orange-50">
          <Activity className="h-4 w-4 text-orange-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Modelo Macro-Factor — Regresión Multi-Factor' : 'Macro Factor Model — Multi-Factor Regression'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'GDP, desempleo, tasas, inflación → impacto NII' : 'GDP, unemployment, rates, inflation → NII impact'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="R²" value={data.r2.toFixed(3)} accent={data.r2 > 0.7} />
        <KPI label={locale === 'es' ? 'Vol Residual' : 'Residual Vol'} value={`${(data.residualVol * 100).toFixed(1)}%`} />
        <KPI label={locale === 'es' ? 'NII Proyectado' : 'Forecast NII'} value={`$${data.forecastNII.toFixed(1)}M`} />
        <KPI label={locale === 'es' ? 'Factores Signif.' : 'Signif. Factors'} value={`${data.factors.filter(f => f.significant).length}/${data.factors.length}`} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Betas de Factor (Sensibilidad NII)' : 'Factor Betas (NII Sensitivity)'}
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data.factors} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="beta" name="Beta" radius={[0, 4, 4, 0]}>
              {data.factors.map((f, i) => <Cell key={i} fill={f.beta > 0 ? '#22c55e' : '#ef4444'} opacity={f.significant ? 1 : 0.4} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Ajuste Histórico: Actual vs Predicho' : 'Historical Fit: Actual vs Predicted'}
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.historicalFit}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `$${Number(value ?? 0).toFixed(2)}M`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="actual" name={locale === 'es' ? 'Actual' : 'Actual'} stroke="#0f172a" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="predicted" name={locale === 'es' ? 'Predicho' : 'Predicted'} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? 'Impacto por Escenario Macro' : 'Macro Scenario Impact'}
        </p>
        <div className="space-y-2">
          {data.scenarioImpact.map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-800">{s.scenario}</span>
              <div className="flex gap-4 text-xs tabular-nums">
                <span className="text-slate-500">GDP: {s.gdpShock > 0 ? '+' : ''}{s.gdpShock}%</span>
                <span className="text-slate-500">Rate: {s.rateShock > 0 ? '+' : ''}{s.rateShock}bp</span>
                <span className={s.niiChange >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                  NII: {s.niiChange > 0 ? '+' : ''}${s.niiChange.toFixed(1)}M
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'border-rose-200 bg-rose-50' : accent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[10px] font-medium uppercase text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-rose-700' : accent ? 'text-emerald-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function getDemo(): MacroFactorResult {
  const quarters = ['Q1 24', 'Q2 24', 'Q3 24', 'Q4 24', 'Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'];
  return {
    r2: 0.847, residualVol: 0.032, forecastNII: 37.8,
    factors: [
      { name: 'Fed Funds Rate', beta: 2.45, tStat: 5.8, significant: true },
      { name: 'GDP Growth', beta: 1.12, tStat: 3.2, significant: true },
      { name: 'Unemployment', beta: -0.85, tStat: -2.4, significant: true },
      { name: 'CPI Inflation', beta: 0.42, tStat: 1.6, significant: false },
      { name: 'Housing Index', beta: 0.38, tStat: 2.1, significant: true },
      { name: 'VIX', beta: -0.22, tStat: -1.3, significant: false },
    ],
    historicalFit: quarters.map((date, i) => ({
      date, actual: 35 + i * 0.4 + Math.sin(i) * 1.5, predicted: 35 + i * 0.4 + Math.sin(i) * 1.2,
    })),
    scenarioImpact: [
      { scenario: 'Baseline', gdpShock: 2.1, rateShock: 0, niiChange: 0.8 },
      { scenario: 'Mild Recession', gdpShock: -1.5, rateShock: -100, niiChange: -3.2 },
      { scenario: 'Stagflation', gdpShock: -0.5, rateShock: 150, niiChange: 1.4 },
      { scenario: 'Severe Recession', gdpShock: -4.0, rateShock: -200, niiChange: -7.8 },
    ],
  };
}
