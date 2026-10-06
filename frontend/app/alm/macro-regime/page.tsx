'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Activity } from 'lucide-react';

type MacroRegime = 'RISING_RATES' | 'PLATEAU' | 'EASING' | 'CRISIS';

interface MacroRegimeProbability {
  regime: MacroRegime;
  probability: number;
}

interface MacroRegimeData {
  currentRegime: MacroRegime;
  currentProbabilities: MacroRegimeProbability[];
  regimePersistence: number;
  almImplications: string;
  almImplicationsEs: string;
}

const REGIME_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  RISING_RATES: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  PLATEAU: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  EASING: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  CRISIS: { bg: 'bg-slate-900', text: 'text-white', border: 'border-slate-700' },
};

export default function MacroRegimePage() {
  const { locale } = useTranslation();
  const [data, setData] = useState<MacroRegimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/market/macro-regime`);
        if (res.ok) { setData(await res.json() as MacroRegimeData); setIsDemo(false); }
        else { setData(getDemoData()); setIsDemo(true); }
      } catch { setData(getDemoData()); setIsDemo(true); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  const style = REGIME_STYLES[data.currentRegime] ?? REGIME_STYLES.PLATEAU;
  const chartData = data.currentProbabilities.map((probability) => ({
    regime: probability.regime.replace(/_/g, ' '),
    probability: +(probability.probability * 100).toFixed(1),
  }));

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {isDemo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
          <strong>Sample data</strong> — Connect your institution for live analysis.
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 bg-violet-50">
          <Activity className="h-4 w-4 text-violet-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Detección de Régimen Macro — HMM' : 'Macro Regime Detection — HMM'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'Modelo Oculto de Markov — 4 estados, algoritmo de Viterbi' : 'Hidden Markov Model — 4 states, Viterbi algorithm'}</p>
        </div>
      </div>

      {/* Current Regime Banner */}
      <div className={`rounded-xl border p-6 text-center ${style.bg} ${style.border}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">{locale === 'es' ? 'Régimen Actual Detectado' : 'Current Detected Regime'}</p>
        <p className={`text-3xl font-black mt-2 ${style.text}`}>{data.currentRegime.replace(/_/g, ' ')}</p>
        <p className="text-xs mt-2 opacity-70">{locale === 'es' ? 'Persistencia' : 'Persistence'}: {(data.regimePersistence * 100).toFixed(0)}%</p>
      </div>

      {/* Probability Distribution */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">{locale === 'es' ? 'Probabilidad por Régimen' : 'Regime Probabilities'}</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="regime" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="probability" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => <Cell key={i} fill={['#ef4444', '#06b6d4', '#10b981', '#1e293b'][i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ALM Implications */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{locale === 'es' ? 'Implicaciones para ALM' : 'ALM Implications'}</p>
        <p className="text-sm text-slate-700 leading-relaxed">{locale === 'es' ? data.almImplicationsEs : data.almImplications}</p>
      </div>
    </div>
  );
}

function getDemoData(): MacroRegimeData {
  return {
    currentRegime: 'PLATEAU',
    currentProbabilities: [
      { regime: 'RISING_RATES', probability: 0.15 },
      { regime: 'PLATEAU', probability: 0.55 },
      { regime: 'EASING', probability: 0.25 },
      { regime: 'CRISIS', probability: 0.05 },
    ],
    regimePersistence: 0.80,
    almImplications: 'Rate plateau regime. NIM stable but under pressure from competitive deposit pricing. Focus on mix optimization and fee income diversification.',
    almImplicationsEs: 'Régimen de meseta de tasas. NIM estable pero bajo presión por precios competitivos de depósitos. Enfóquese en optimización de mezcla y diversificación de ingresos por comisiones.',
  };
}
