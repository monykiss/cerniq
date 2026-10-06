'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ArrowUpDown } from 'lucide-react';

interface CapFloorResult {
  capStrike: number;
  floorStrike: number;
  totalCapPremium: number;
  totalFloorPremium: number;
  collarCost: number;
  niiProtection: number;
  caplets: Array<{ date: string; notional: number; capletValue: number; floorletValue: number; forwardRate: number }>;
}

export default function CapFloorPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<CapFloorResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/derivatives/cap-floor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ institutionId: selectedId }) });
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Caps and Floors" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50">
          <ArrowUpDown className="h-4 w-4 text-cyan-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'IR Cap/Floor — Cobertura de Tasa' : 'IR Cap/Floor — Rate Hedging'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'Valoración Black-76, collar structure, protección NII' : 'Black-76 pricing, collar structure, NII protection'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label={locale === 'es' ? 'Strike Cap' : 'Cap Strike'} value={`${(data.capStrike * 100).toFixed(2)}%`} />
        <KPI label={locale === 'es' ? 'Strike Floor' : 'Floor Strike'} value={`${(data.floorStrike * 100).toFixed(2)}%`} />
        <KPI label={locale === 'es' ? 'Prima Cap' : 'Cap Premium'} value={`$${data.totalCapPremium.toFixed(0)}K`} />
        <KPI label={locale === 'es' ? 'Costo Collar' : 'Collar Cost'} value={`$${data.collarCost.toFixed(0)}K`} accent={data.collarCost < 100} />
        <KPI label={locale === 'es' ? 'Protección NII' : 'NII Protection'} value={`$${data.niiProtection.toFixed(1)}M`} accent />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Caplet / Floorlet Values por Fecha' : 'Caplet / Floorlet Values by Date'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.caplets}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `$${v}K`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `$${Number(value ?? 0).toFixed(1)}K`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="capletValue" name={locale === 'es' ? 'Caplet' : 'Caplet'} fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="floorletValue" name={locale === 'es' ? 'Floorlet' : 'Floorlet'} fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? 'Schedule de Caplets' : 'Caplet Schedule'}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 text-left text-slate-500">{locale === 'es' ? 'Fecha' : 'Date'}</th>
              <th className="py-2 text-right text-slate-500">{locale === 'es' ? 'Nocional' : 'Notional'}</th>
              <th className="py-2 text-right text-slate-500">{locale === 'es' ? 'Fwd Rate' : 'Fwd Rate'}</th>
              <th className="py-2 text-right text-slate-500">Caplet ($K)</th>
              <th className="py-2 text-right text-slate-500">Floorlet ($K)</th>
            </tr>
          </thead>
          <tbody>
            {data.caplets.map((c, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 text-slate-700">{c.date}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">${c.notional}M</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">{(c.forwardRate * 100).toFixed(2)}%</td>
                <td className="py-1.5 text-right tabular-nums text-red-600">{c.capletValue.toFixed(1)}</td>
                <td className="py-1.5 text-right tabular-nums text-blue-600">{c.floorletValue.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function getDemo(): CapFloorResult {
  const quarters = ['Q2 26', 'Q3 26', 'Q4 26', 'Q1 27', 'Q2 27', 'Q3 27', 'Q4 27', 'Q1 28'];
  return {
    capStrike: 0.055, floorStrike: 0.035, totalCapPremium: 285, totalFloorPremium: 142, collarCost: 143, niiProtection: 4.2,
    caplets: quarters.map((date, i) => ({
      date, notional: 50,
      capletValue: 25 + i * 8 + Math.random() * 15,
      floorletValue: 35 - i * 3 + Math.random() * 10,
      forwardRate: 0.0475 - i * 0.003,
    })),
  };
}
