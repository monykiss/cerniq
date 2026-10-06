'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { TrendingDown } from 'lucide-react';

interface FedFuturesResult {
  currentFFR: number;
  impliedTerminal: number;
  cutsImplied: number;
  nextMeetingDate: string;
  nextMeetingProb: { hold: number; cut25: number; cut50: number; hike25: number };
  ratePath: Array<{ date: string; implied: number; dots: number | null }>;
  niiImpact: { ifCuts: number; ifHold: number; ifHike: number };
}

export default function FedFuturesPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<FedFuturesResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/market/fed-futures`);
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Fed Futures" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50">
          <TrendingDown className="h-4 w-4 text-emerald-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Fed Futures — Trayectoria Implícita' : 'Fed Futures — Implied Rate Path'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'Probabilidades de mercado, dot plot vs futuros, impacto NII' : 'Market probabilities, dot plot vs futures, NII impact'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label={locale === 'es' ? 'FFR Actual' : 'Current FFR'} value={`${(data.currentFFR * 100).toFixed(2)}%`} />
        <KPI label={locale === 'es' ? 'Terminal Implícita' : 'Implied Terminal'} value={`${(data.impliedTerminal * 100).toFixed(2)}%`} />
        <KPI label={locale === 'es' ? 'Recortes Implícitos' : 'Implied Cuts'} value={`${data.cutsImplied}`} accent={data.cutsImplied > 0} />
        <KPI label={locale === 'es' ? 'NII si Recortan' : 'NII if Cuts'} value={`${data.niiImpact.ifCuts > 0 ? '+' : ''}$${data.niiImpact.ifCuts.toFixed(1)}M`} warn={data.niiImpact.ifCuts < 0} />
        <KPI label={locale === 'es' ? 'NII si Mantienen' : 'NII if Hold'} value={`${data.niiImpact.ifHold > 0 ? '+' : ''}$${data.niiImpact.ifHold.toFixed(1)}M`} accent={data.niiImpact.ifHold > 0} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Trayectoria Implícita vs Dot Plot' : 'Implied Path vs Dot Plot'}
        </p>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data.ratePath}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(1)}%`} tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => {
                if (value === null || value === undefined) {
                  return 'N/A';
                }
                return `${(Number(value) * 100).toFixed(2)}%`;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={data.currentFFR} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: 'Current', fontSize: 10 }} />
            <Line type="monotone" dataKey="implied" name={locale === 'es' ? 'Futuros Implícitos' : 'Futures Implied'} stroke="#10b981" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="dots" name="FOMC Dot Plot" stroke="#6366f1" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 4 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? `Próxima Reunión FOMC — ${data.nextMeetingDate}` : `Next FOMC Meeting — ${data.nextMeetingDate}`}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: locale === 'es' ? 'Mantener' : 'Hold', prob: data.nextMeetingProb.hold, color: '#94a3b8' },
            { label: '-25bp', prob: data.nextMeetingProb.cut25, color: '#10b981' },
            { label: '-50bp', prob: data.nextMeetingProb.cut50, color: '#059669' },
            { label: '+25bp', prob: data.nextMeetingProb.hike25, color: '#ef4444' },
          ].map(p => (
            <div key={p.label} className="text-center">
              <div className="h-20 bg-slate-50 rounded-lg flex items-end justify-center pb-1">
                <div className="w-12 rounded-t" style={{ height: `${p.prob * 100}%`, backgroundColor: p.color }} />
              </div>
              <p className="text-xs font-bold text-slate-800 mt-1">{p.label}</p>
              <p className="text-[10px] text-slate-500">{(p.prob * 100).toFixed(1)}%</p>
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

function getDemo(): FedFuturesResult {
  const months = ['Apr 26', 'Jun 26', 'Jul 26', 'Sep 26', 'Nov 26', 'Dec 26', 'Jan 27', 'Mar 27', 'Jun 27', 'Sep 27', 'Dec 27'];
  return {
    currentFFR: 0.0475, impliedTerminal: 0.035, cutsImplied: 5,
    nextMeetingDate: 'May 6-7, 2026',
    nextMeetingProb: { hold: 0.35, cut25: 0.52, cut50: 0.10, hike25: 0.03 },
    ratePath: months.map((date, i) => ({
      date,
      implied: 0.0475 - i * 0.0012 - Math.random() * 0.001,
      dots: i % 3 === 0 ? 0.0475 - i * 0.001 : null,
    })),
    niiImpact: { ifCuts: -2.8, ifHold: 1.2, ifHike: 3.5 },
  };
}
