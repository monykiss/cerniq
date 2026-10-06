'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ArrowDownUp } from 'lucide-react';

interface WWRResult {
  naiveCVA: number;
  adjustedCVA: number;
  wwrMultiplier: number;
  correlation: number;
  counterparties: Array<{ name: string; exposure: number; naiveCVA: number; adjustedCVA: number; correlation: number }>;
  exposurePath: Array<{ timeStep: string; naive: number; adjusted: number }>;
}

export default function WrongWayRiskPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<WWRResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/${selectedId}/wrong-way-risk`);
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Wrong-Way Risk" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50">
          <ArrowDownUp className="h-4 w-4 text-red-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Wrong-Way Risk — CVA Ajustado' : 'Wrong-Way Risk — Adjusted CVA'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'Exposición crece cuando la contraparte se deteriora' : 'Exposure increases when counterparty deteriorates'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={locale === 'es' ? 'CVA Naive' : 'Naive CVA'} value={`$${data.naiveCVA.toFixed(2)}M`} />
        <KPI label={locale === 'es' ? 'CVA Ajustado' : 'Adjusted CVA'} value={`$${data.adjustedCVA.toFixed(2)}M`} warn={data.adjustedCVA > data.naiveCVA * 1.3} />
        <KPI label={locale === 'es' ? 'Multiplicador WWR' : 'WWR Multiplier'} value={`${data.wwrMultiplier.toFixed(2)}x`} warn={data.wwrMultiplier > 1.5} />
        <KPI label={locale === 'es' ? 'Correlación' : 'Correlation'} value={data.correlation.toFixed(3)} warn={Math.abs(data.correlation) > 0.3} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Perfil de Exposición: Naive vs Ajustado' : 'Exposure Profile: Naive vs Adjusted'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.exposurePath}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="timeStep" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `$${Number(value ?? 0).toFixed(2)}M`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="naive" name={locale === 'es' ? 'Naive (sin WWR)' : 'Naive (no WWR)'} stroke="#94a3b8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="adjusted" name={locale === 'es' ? 'Ajustado (con WWR)' : 'Adjusted (with WWR)'} stroke="#ef4444" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? 'CVA por Contraparte' : 'CVA by Counterparty'}
        </p>
        <div className="space-y-2">
          {data.counterparties.map((cp, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{cp.name}</span>
                <span className="text-[10px] text-slate-400">Exp: ${cp.exposure}M</span>
              </div>
              <div className="flex items-center gap-4 text-xs tabular-nums">
                <span className="text-slate-500">Naive: ${cp.naiveCVA.toFixed(2)}M</span>
                <span className={cp.adjustedCVA > cp.naiveCVA * 1.3 ? 'text-rose-700 font-bold' : 'text-slate-700'}>
                  Adj: ${cp.adjustedCVA.toFixed(2)}M
                </span>
                <span className="text-[10px] text-slate-400">ρ={cp.correlation.toFixed(2)}</span>
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

function getDemo(): WWRResult {
  return {
    naiveCVA: 2.45, adjustedCVA: 3.82, wwrMultiplier: 1.56, correlation: -0.38,
    counterparties: [
      { name: 'FHLB Advances', exposure: 45, naiveCVA: 0.85, adjustedCVA: 1.42, correlation: -0.42 },
      { name: 'Interest Rate Swaps', exposure: 32, naiveCVA: 0.62, adjustedCVA: 0.95, correlation: -0.35 },
      { name: 'Correspondent Bank', exposure: 28, naiveCVA: 0.55, adjustedCVA: 0.78, correlation: -0.28 },
      { name: 'Municipal Derivatives', exposure: 18, naiveCVA: 0.28, adjustedCVA: 0.42, correlation: -0.32 },
      { name: 'Agency MBS Repo', exposure: 15, naiveCVA: 0.15, adjustedCVA: 0.25, correlation: -0.45 },
    ],
    exposurePath: Array.from({ length: 12 }, (_, i) => ({
      timeStep: `${(i + 1) * 3}M`,
      naive: 25 + i * 2.5 + Math.sin(i) * 3,
      adjusted: 25 + i * 3.8 + Math.sin(i) * 4 + i * 0.5,
    })),
  };
}
