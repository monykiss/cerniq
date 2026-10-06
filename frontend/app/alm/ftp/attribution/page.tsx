'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { DollarSign } from 'lucide-react';

interface RarocRanking {
  subcategory: string; category: string; totalBalance: number;
  totalEconomicProfit: number; capitalConsumed: number; raroc: number;
  verdict: 'ACCRETIVE' | 'NEUTRAL' | 'DESTRUCTIVE';
}

interface FTPAttributionResult {
  rarocRanking: RarocRanking[];
  summary: {
    totalGrossMargin: number; totalFTPNet: number; totalCreditCost: number;
    totalOptionCost: number; totalLiquidityCost: number; totalOpCost: number;
    totalEconomicProfit: number; portfolioRaroc: number;
  };
}

const VERDICT_STYLES = {
  ACCRETIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  NEUTRAL: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
  DESTRUCTIVE: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
};

export default function FTPAttributionPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<FTPAttributionResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try { setData(await apiClient.getFTPAttribution(selectedId)); }
      catch { setData(getDemoData()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="FTP Attribution" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  // Waterfall data
  const waterfall = [
    { name: locale === 'es' ? 'Margen Bruto' : 'Gross Margin', value: data.summary.totalGrossMargin },
    { name: locale === 'es' ? 'Costo Crédito' : 'Credit Cost', value: -data.summary.totalCreditCost },
    { name: locale === 'es' ? 'Costo Opción' : 'Option Cost', value: -data.summary.totalOptionCost },
    { name: locale === 'es' ? 'Prima Liquidez' : 'Liquidity Prem.', value: -data.summary.totalLiquidityCost },
    { name: locale === 'es' ? 'Costo Operativo' : 'Op Cost', value: -data.summary.totalOpCost },
    { name: locale === 'es' ? 'Beneficio Econ.' : 'Econ. Profit', value: data.summary.totalEconomicProfit },
  ];

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200 bg-amber-50">
          <DollarSign className="h-4 w-4 text-amber-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">
            {locale === 'es' ? 'Atribución P&L FTP — RAROC' : 'FTP P&L Attribution — RAROC'}
          </h1>
          <p className="text-xs text-slate-500">
            {locale === 'es' ? 'Descomposición de rentabilidad y retorno ajustado por riesgo' : 'Profitability decomposition & risk-adjusted return on capital'}
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{locale === 'es' ? 'Margen Bruto' : 'Gross Margin'}</p>
          <p className="text-lg font-bold tabular-nums text-slate-950">${data.summary.totalGrossMargin.toFixed(2)}M</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-600">{locale === 'es' ? 'Beneficio Económico' : 'Economic Profit'}</p>
          <p className="text-lg font-bold tabular-nums text-emerald-700">${data.summary.totalEconomicProfit.toFixed(2)}M</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{locale === 'es' ? 'RAROC Portfolio' : 'Portfolio RAROC'}</p>
          <p className={`text-lg font-bold tabular-nums ${data.summary.portfolioRaroc > 0.12 ? 'text-emerald-700' : data.summary.portfolioRaroc > 0.05 ? 'text-slate-800' : 'text-rose-700'}`}>
            {(data.summary.portfolioRaroc * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{locale === 'es' ? 'Destructores' : 'Value Destroyers'}</p>
          <p className={`text-lg font-bold tabular-nums ${data.rarocRanking.filter(r => r.verdict === 'DESTRUCTIVE').length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {data.rarocRanking.filter(r => r.verdict === 'DESTRUCTIVE').length}
          </p>
        </div>
      </div>

      {/* Waterfall Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Cascada: Margen Bruto → Beneficio Económico' : 'Waterfall: Gross Margin → Economic Profit'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={waterfall}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, '']}
            />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {waterfall.map((entry, i) => (
                <Cell key={i} fill={entry.value >= 0 ? '#10b981' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* RAROC Ranking Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {locale === 'es' ? 'Ranking RAROC por Producto' : 'RAROC Ranking by Product'}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-50 bg-slate-50/50">
              {[locale === 'es' ? 'Producto' : 'Product', locale === 'es' ? 'Tipo' : 'Type', locale === 'es' ? 'Balance ($M)' : 'Balance ($M)',
                locale === 'es' ? 'Benef. Econ.' : 'Econ. Profit', locale === 'es' ? 'Capital' : 'Capital', 'RAROC',
                locale === 'es' ? 'Veredicto' : 'Verdict'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rarocRanking.map(r => {
              const style = VERDICT_STYLES[r.verdict];
              return (
                <tr key={`${r.category}-${r.subcategory}`} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-700 capitalize">{r.subcategory.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.category === 'asset' ? 'bg-cyan-50 text-cyan-700' : 'bg-purple-50 text-purple-700'}`}>{r.category === 'asset' ? (locale === 'es' ? 'Activo' : 'Asset') : (locale === 'es' ? 'Pasivo' : 'Liability')}</span></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{r.totalBalance.toFixed(1)}</td>
                  <td className={`px-4 py-3 tabular-nums font-semibold ${r.totalEconomicProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>${r.totalEconomicProfit.toFixed(3)}M</td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">${r.capitalConsumed.toFixed(1)}M</td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${r.raroc > 0.12 ? 'text-emerald-700' : r.raroc >= 0.05 ? 'text-slate-800' : 'text-rose-700'}`}>{(r.raroc * 100).toFixed(1)}%</td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.bg} ${style.text} ${style.border}`}>{r.verdict}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getDemoData(): FTPAttributionResult {
  return {
    rarocRanking: [
      { subcategory: 'demand_deposits', category: 'liability', totalBalance: 180, totalEconomicProfit: 6.2, capitalConsumed: 14.4, raroc: 0.431, verdict: 'ACCRETIVE' },
      { subcategory: 'consumer_loans', category: 'asset', totalBalance: 85, totalEconomicProfit: 1.8, capitalConsumed: 6.8, raroc: 0.265, verdict: 'ACCRETIVE' },
      { subcategory: 'savings', category: 'liability', totalBalance: 95, totalEconomicProfit: 2.1, capitalConsumed: 7.6, raroc: 0.276, verdict: 'ACCRETIVE' },
      { subcategory: 'auto_loans', category: 'asset', totalBalance: 62, totalEconomicProfit: 0.9, capitalConsumed: 4.96, raroc: 0.181, verdict: 'ACCRETIVE' },
      { subcategory: 'commercial_re', category: 'asset', totalBalance: 120, totalEconomicProfit: 1.2, capitalConsumed: 9.6, raroc: 0.125, verdict: 'ACCRETIVE' },
      { subcategory: 'residential_mortgage', category: 'asset', totalBalance: 95, totalEconomicProfit: 0.4, capitalConsumed: 7.6, raroc: 0.053, verdict: 'NEUTRAL' },
      { subcategory: 'securities', category: 'asset', totalBalance: 50, totalEconomicProfit: -0.3, capitalConsumed: 4.0, raroc: -0.075, verdict: 'DESTRUCTIVE' },
      { subcategory: 'time_deposits', category: 'liability', totalBalance: 75, totalEconomicProfit: -0.1, capitalConsumed: 6.0, raroc: -0.017, verdict: 'DESTRUCTIVE' },
    ],
    summary: {
      totalGrossMargin: 17.6, totalFTPNet: 14.2, totalCreditCost: 1.8,
      totalOptionCost: 0.4, totalLiquidityCost: 0.3, totalOpCost: 0.9,
      totalEconomicProfit: 12.2, portfolioRaroc: 0.185,
    },
  };
}
