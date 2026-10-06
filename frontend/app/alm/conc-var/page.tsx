'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ShieldAlert } from 'lucide-react';

interface ConcentrationSegment {
  segment: string;
  shareOfPortfolio: number;
  el: number;
  ul: number;
}

interface ConcentrationVaRData {
  herfindahlIndex: number;
  granularityAdjustment: number;
  diversifiedVaR: number;
  concentrationVaR: number;
  concentrationPremium: number;
  concentrationPremiumPct: number;
  topConcentrations: ConcentrationSegment[];
  narrativeEs: string;
  narrativeEn: string;
}

export default function ConcVaRPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<ConcentrationVaRData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try { setData(await apiClient.getConcentrationVaR(selectedId)); }
      catch { setData(getDemoData()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Concentration VaR" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  const chartData = data.topConcentrations.map((concentration) => ({
    name: concentration.segment,
    share: +(concentration.shareOfPortfolio * 100).toFixed(1),
  }));

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50">
          <ShieldAlert className="h-4 w-4 text-rose-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'VaR de Concentración — Granularidad Basel II' : 'Concentration VaR — Basel II Granularity'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'Ajuste Gordy, índice Herfindahl, prima de concentración' : 'Gordy adjustment, Herfindahl index, concentration premium'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPI label="HHI" value={`${(data.herfindahlIndex * 100).toFixed(1)}%`} warn={data.herfindahlIndex > 0.15} />
        <KPI label={locale === 'es' ? 'Ajuste Granularidad' : 'Granularity Adj.'} value={`$${data.granularityAdjustment.toFixed(1)}M`} />
        <KPI label={locale === 'es' ? 'VaR Diversificado' : 'Diversified VaR'} value={`$${data.diversifiedVaR.toFixed(1)}M`} />
        <KPI label={locale === 'es' ? 'VaR Concentración' : 'Concentration VaR'} value={`$${data.concentrationVaR.toFixed(1)}M`} accent />
        <KPI label={locale === 'es' ? 'Prima Conc.' : 'Conc. Premium'} value={`$${data.concentrationPremium.toFixed(1)}M`} warn={data.concentrationPremium > 2} />
        <KPI label={locale === 'es' ? 'Prima %' : 'Premium %'} value={`${(data.concentrationPremiumPct * 100).toFixed(1)}%`} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">{locale === 'es' ? 'Participación por Segmento (%)' : 'Portfolio Share by Segment (%)'}</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="share" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => <Cell key={i} fill={entry.share > 25 ? '#ef4444' : entry.share > 15 ? '#f59e0b' : '#10b981'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{locale === 'es' ? 'Análisis' : 'Analysis'}</p>
        <p className="text-sm text-slate-700 leading-relaxed">{locale === 'es' ? data.narrativeEs : data.narrativeEn}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50/50">
            {[locale === 'es' ? 'Segmento' : 'Segment', locale === 'es' ? 'Participación' : 'Share', 'EL ($M)', 'UL ($M)'].map(h => (
              <th key={h} className="px-4 py-2 text-left text-[10px] font-medium text-slate-500">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {data.topConcentrations.map((concentration) => (
              <tr key={concentration.segment} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-700 text-xs">{concentration.segment}</td>
                <td className="px-4 py-2.5 tabular-nums text-xs">{(concentration.shareOfPortfolio * 100).toFixed(1)}%</td>
                <td className="px-4 py-2.5 tabular-nums text-xs text-amber-700">{concentration.el.toFixed(2)}</td>
                <td className="px-4 py-2.5 tabular-nums text-xs text-rose-700 font-medium">{concentration.ul.toFixed(2)}</td>
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
    <div className={`rounded-xl border p-3 ${warn ? 'border-rose-200 bg-rose-50' : accent ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[10px] font-medium uppercase text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-rose-700' : accent ? 'text-indigo-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function getDemoData(): ConcentrationVaRData {
  return {
    herfindahlIndex: 0.185, granularityAdjustment: 1.8, diversifiedVaR: 28.5, concentrationVaR: 30.3,
    concentrationPremium: 1.8, concentrationPremiumPct: 0.063,
    topConcentrations: [
      { segment: 'Commercial RE', shareOfPortfolio: 0.27, el: 4.97, ul: 8.40 },
      { segment: 'Residential Mortgage', shareOfPortfolio: 0.21, el: 3.29, ul: 5.70 },
      { segment: 'Consumer Loans', shareOfPortfolio: 0.19, el: 4.01, ul: 5.82 },
      { segment: 'Auto Loans', shareOfPortfolio: 0.14, el: 1.74, ul: 2.95 },
      { segment: 'C&I Loans', shareOfPortfolio: 0.12, el: 3.07, ul: 4.85 },
    ],
    narrativeEs: 'Riesgo de concentración elevado (HHI=18.5%). Los 3 segmentos principales representan 67% del portafolio. Prima de concentración: $1.8M.',
    narrativeEn: 'Elevated concentration risk (HHI=18.5%). Top 3 segments represent 67% of portfolio. Concentration premium: $1.8M.',
  };
}
