'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import { ShieldAlert } from 'lucide-react';

interface CreditMetricsResult {
  portfolioVaR: number;
  expectedLoss: number;
  unexpectedLoss: number;
  economicCapital: number;
  segments: Array<{ name: string; exposure: number; pd: number; lgd: number; varContrib: number; ulContrib: number }>;
  migrationMatrix: Array<{ from: string; AAA: number; AA: number; A: number; BBB: number; BB: number; B: number; Default: number }>;
}

type RatingColumn = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'Default';

const RATING_COLUMNS: RatingColumn[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'Default'];

export default function CreditMetricsPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<CreditMetricsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/${selectedId}/credit-metrics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="CreditMetrics" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50">
          <ShieldAlert className="h-4 w-4 text-rose-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'CreditMetrics — Modelo JP Morgan' : 'CreditMetrics — JP Morgan Model'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'VaR por migración crediticia con correlaciones de activos' : 'Credit migration VaR with asset correlations'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={locale === 'es' ? 'VaR Portafolio' : 'Portfolio VaR'} value={`$${data.portfolioVaR.toFixed(1)}M`} warn />
        <KPI label={locale === 'es' ? 'Pérdida Esperada' : 'Expected Loss'} value={`$${data.expectedLoss.toFixed(2)}M`} />
        <KPI label={locale === 'es' ? 'Pérdida Inesperada' : 'Unexpected Loss'} value={`$${data.unexpectedLoss.toFixed(2)}M`} warn={data.unexpectedLoss > 5} />
        <KPI label={locale === 'es' ? 'Capital Económico' : 'Economic Capital'} value={`$${data.economicCapital.toFixed(1)}M`} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Contribución VaR por Segmento' : 'VaR Contribution by Segment'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.segments} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tickFormatter={v => `$${v}M`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `$${Number(value ?? 0).toFixed(2)}M`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="varContrib" name="VaR Contrib" radius={[0, 4, 4, 0]}>
              {data.segments.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? 'Matriz de Migración (1Y)' : 'Migration Matrix (1Y)'}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 text-left text-slate-500">From ↓</th>
              {RATING_COLUMNS.map(r => (
                <th key={r} className="py-2 text-right text-slate-500">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.migrationMatrix.map((row, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 font-medium text-slate-700">{row.from}</td>
                {RATING_COLUMNS.map((rating) => (
                  <td key={rating} className={`py-1.5 text-right tabular-nums ${row[rating] > 0.5 ? 'font-bold text-slate-900' : 'text-slate-400'}`}>
                    {(row[rating] * 100).toFixed(1)}%
                  </td>
                ))}
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

function getDemo(): CreditMetricsResult {
  return {
    portfolioVaR: 12.4, expectedLoss: 3.2, unexpectedLoss: 9.2, economicCapital: 18.6,
    segments: [
      { name: 'Consumer RE', exposure: 85, pd: 0.012, lgd: 0.35, varContrib: 4.2, ulContrib: 3.1 },
      { name: 'Commercial', exposure: 62, pd: 0.018, lgd: 0.40, varContrib: 3.5, ulContrib: 2.8 },
      { name: 'Auto Loans', exposure: 38, pd: 0.025, lgd: 0.55, varContrib: 2.1, ulContrib: 1.6 },
      { name: 'Personal', exposure: 22, pd: 0.035, lgd: 0.70, varContrib: 1.5, ulContrib: 1.1 },
      { name: 'Credit Cards', exposure: 15, pd: 0.045, lgd: 0.85, varContrib: 0.8, ulContrib: 0.4 },
      { name: 'Munis', exposure: 28, pd: 0.002, lgd: 0.15, varContrib: 0.3, ulContrib: 0.2 },
    ],
    migrationMatrix: [
      { from: 'AAA', AAA: 0.92, AA: 0.06, A: 0.015, BBB: 0.004, BB: 0.001, B: 0, Default: 0 },
      { from: 'AA', AAA: 0.01, AA: 0.91, A: 0.06, BBB: 0.015, BB: 0.004, B: 0.001, Default: 0 },
      { from: 'A', AAA: 0.001, AA: 0.02, A: 0.90, BBB: 0.06, BB: 0.012, B: 0.005, Default: 0.002 },
      { from: 'BBB', AAA: 0, AA: 0.003, A: 0.04, BBB: 0.87, BB: 0.06, B: 0.02, Default: 0.007 },
      { from: 'BB', AAA: 0, AA: 0, A: 0.005, BBB: 0.06, BB: 0.82, B: 0.08, Default: 0.035 },
    ],
  };
}
