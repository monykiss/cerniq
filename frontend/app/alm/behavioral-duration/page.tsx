'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { Timer } from 'lucide-react';

interface BehavioralDurationResult {
  contractualEVE: number;
  behavioralEVE: number;
  eveOverstatement: number;
  deposits: Array<{
    category: string;
    contractualDuration: number;
    behavioralDuration: number;
    balance: number;
    decayRate: number;
    surgeFactor: number;
  }>;
  survivalCurve: Array<{ month: number; contractual: number; behavioral: number }>;
  nmdParameters: { beta0: number; beta1: number; gamma: number; theta: number };
}

export default function BehavioralDurationPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<BehavioralDurationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/${selectedId}/behavioral-duration`);
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Behavioral Duration" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-fuchsia-200 bg-fuchsia-50">
          <Timer className="h-4 w-4 text-fuchsia-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">
            {locale === 'es' ? 'Duración Conductual — Hutchison-Pennacchi NMD' : 'Behavioral Duration — Hutchison-Pennacchi NMD'}
          </h1>
          <p className="text-xs text-slate-500">
            {locale === 'es'
              ? 'Corrige sobreestimación EVE: duración contractual vs conductual de depósitos sin vencimiento'
              : 'Corrects EVE overestimation: contractual vs behavioral duration of non-maturity deposits'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={locale === 'es' ? 'EVE Contractual' : 'Contractual EVE'} value={`-${data.contractualEVE.toFixed(1)}%`} warn />
        <KPI label={locale === 'es' ? 'EVE Conductual' : 'Behavioral EVE'} value={`-${data.behavioralEVE.toFixed(1)}%`} accent />
        <KPI label={locale === 'es' ? 'Sobreestimación' : 'Overstatement'} value={`${data.eveOverstatement.toFixed(1)}pp`} warn={data.eveOverstatement > 3} />
        <KPI label={locale === 'es' ? 'Modelo' : 'Model'} value="H-P NMD" accent />
      </div>

      {/* Warning callout */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <p className="text-xs font-bold text-amber-800 mb-1">
          {locale === 'es' ? 'Por qué importa la duración conductual' : 'Why Behavioral Duration Matters'}
        </p>
        <p className="text-[11px] text-amber-700 leading-relaxed">
          {locale === 'es'
            ? `La duración contractual trata los depósitos a la vista como overnight (duración ~0). En realidad, los depósitos core tienen duraciones conductuales de 3-7 años. Sin este ajuste, su EVE está sobreestimado en ${data.eveOverstatement.toFixed(1)} puntos porcentuales — señalando falso riesgo al regulador.`
            : `Contractual duration treats demand deposits as overnight (duration ~0). In reality, core deposits have behavioral durations of 3-7 years. Without this adjustment, your EVE is overstated by ${data.eveOverstatement.toFixed(1)} percentage points — signaling false risk to the regulator.`}
        </p>
      </div>

      {/* Contractual vs Behavioral comparison */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Duración Contractual vs Conductual por Depósito' : 'Contractual vs Behavioral Duration by Deposit'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.deposits}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: locale === 'es' ? 'Años' : 'Years', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => {
                const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
                return `${numericValue.toFixed(2)} yr`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="contractualDuration" name={locale === 'es' ? 'Contractual' : 'Contractual'} fill="#94a3b8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="behavioralDuration" name={locale === 'es' ? 'Conductual (H-P)' : 'Behavioral (H-P)'} fill="#a855f7" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Survival Curve */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Curva de Supervivencia de Depósitos NMD' : 'NMD Deposit Survival Curve'}
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.survivalCurve}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} label={{ value: locale === 'es' ? 'Meses' : 'Months', position: 'insideBottomRight', style: { fontSize: 10 } }} />
            <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => {
                const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
                return `${numericValue.toFixed(1)}%`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="contractual" name={locale === 'es' ? 'Contractual (step)' : 'Contractual (step)'} stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 3" dot={false} />
            <Line type="monotone" dataKey="behavioral" name={locale === 'es' ? 'Conductual (H-P decay)' : 'Behavioral (H-P decay)'} stroke="#a855f7" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Model Parameters + Detail Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
            {locale === 'es' ? 'Parámetros Hutchison-Pennacchi' : 'Hutchison-Pennacchi Parameters'}
          </p>
          <div className="space-y-2">
            {[
              { label: 'β₀ (Base Decay)', value: data.nmdParameters.beta0.toFixed(4) },
              { label: 'β₁ (Rate Sensitivity)', value: data.nmdParameters.beta1.toFixed(4) },
              { label: 'γ (Surge Adjustment)', value: data.nmdParameters.gamma.toFixed(4) },
              { label: 'θ (Mean Reversion)', value: data.nmdParameters.theta.toFixed(4) },
            ].map(p => (
              <div key={p.label} className="flex justify-between items-center rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs text-slate-600">{p.label}</span>
                <span className="text-xs font-mono font-bold text-fuchsia-700">{p.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
            {locale === 'es' ? 'Detalle por Categoría' : 'Category Detail'}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-1.5 text-left text-slate-500">{locale === 'es' ? 'Depósito' : 'Deposit'}</th>
                <th className="py-1.5 text-right text-slate-500">{locale === 'es' ? 'Saldo' : 'Balance'}</th>
                <th className="py-1.5 text-right text-slate-500">{locale === 'es' ? 'Decay' : 'Decay'}</th>
                <th className="py-1.5 text-right text-slate-500">{locale === 'es' ? 'Surge' : 'Surge'}</th>
              </tr>
            </thead>
            <tbody>
              {data.deposits.map((d, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">{d.category}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">${d.balance}M</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{(d.decayRate * 100).toFixed(1)}%/yr</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{d.surgeFactor.toFixed(2)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
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

function getDemo(): BehavioralDurationResult {
  return {
    contractualEVE: 12.8, behavioralEVE: 7.2, eveOverstatement: 5.6,
    deposits: [
      { category: 'Demand Deposits', contractualDuration: 0.01, behavioralDuration: 4.8, balance: 200, decayRate: 0.08, surgeFactor: 1.15 },
      { category: 'Regular Savings', contractualDuration: 0.01, behavioralDuration: 5.2, balance: 150, decayRate: 0.06, surgeFactor: 1.10 },
      { category: 'Money Market', contractualDuration: 0.01, behavioralDuration: 3.1, balance: 120, decayRate: 0.15, surgeFactor: 1.25 },
      { category: 'NOW Accounts', contractualDuration: 0.01, behavioralDuration: 6.8, balance: 80, decayRate: 0.04, surgeFactor: 1.05 },
      { category: 'Club Accounts', contractualDuration: 0.01, behavioralDuration: 7.5, balance: 30, decayRate: 0.03, surgeFactor: 1.02 },
    ],
    survivalCurve: Array.from({ length: 25 }, (_, i) => ({
      month: i * 6,
      contractual: i === 0 ? 100 : 0,
      behavioral: 100 * Math.exp(-0.008 * i * 6),
    })),
    nmdParameters: { beta0: 0.0082, beta1: 0.0035, gamma: 0.12, theta: 0.045 },
  };
}
