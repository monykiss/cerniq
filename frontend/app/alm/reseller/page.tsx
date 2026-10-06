'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, DollarSign, TrendingUp, AlertTriangle, Plus, Building2 } from 'lucide-react';

interface ResellerDashboard {
  totalClients: number;
  mrr: number;
  avgRevPerClient: number;
  churnRate: number;
  clients: Array<{ name: string; type: string; assets: number; tier: string; mrr: number; status: string; lastLogin: string }>;
  revenueByMonth: Array<{ month: string; revenue: number; clients: number }>;
}

export default function ResellerPage() {
  const { locale } = useTranslation();
  const [data, setData] = useState<ResellerDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/resellers`);
        if (res.ok) setData(await res.json());
        else setData(getDemo());
      } catch { setData(getDemo()); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50">
            <Users className="h-4 w-4 text-indigo-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Portal de Revendedor' : 'Reseller Portal'}</h1>
            <p className="text-xs text-slate-500">{locale === 'es' ? 'White-label: gestiona clientes, ingresos y onboarding' : 'White-label: manage clients, revenue & onboarding'}</p>
          </div>
        </div>
        <button className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> {locale === 'es' ? 'Añadir Cliente' : 'Add Client'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={locale === 'es' ? 'Clientes Totales' : 'Total Clients'} value={`${data.totalClients}`} icon={<Building2 className="h-3.5 w-3.5 text-indigo-500" />} />
        <KPI label="MRR" value={`$${data.mrr.toLocaleString()}`} accent icon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />} />
        <KPI label={locale === 'es' ? 'Rev/Cliente' : 'Rev/Client'} value={`$${data.avgRevPerClient.toLocaleString()}`} icon={<TrendingUp className="h-3.5 w-3.5 text-cyan-500" />} />
        <KPI label={locale === 'es' ? 'Tasa Churn' : 'Churn Rate'} value={`${data.churnRate}%`} warn={data.churnRate > 5} icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Ingresos Mensuales' : 'Monthly Revenue'}
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data.revenueByMonth}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `$${v / 1000}K`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value) => `$${Number(value ?? 0).toLocaleString()}`}
            />
            <Bar dataKey="revenue" name={locale === 'es' ? 'Ingresos' : 'Revenue'} fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {locale === 'es' ? 'Clientes' : 'Clients'}
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 text-left text-slate-500">{locale === 'es' ? 'Institución' : 'Institution'}</th>
              <th className="py-2 text-right text-slate-500">{locale === 'es' ? 'Activos' : 'Assets'}</th>
              <th className="py-2 text-right text-slate-500">Tier</th>
              <th className="py-2 text-right text-slate-500">MRR</th>
              <th className="py-2 text-right text-slate-500">{locale === 'es' ? 'Último Login' : 'Last Login'}</th>
              <th className="py-2 text-right text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.clients.map((c, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2">
                  <span className="font-medium text-slate-800">{c.name}</span>
                  <span className="ml-2 text-[10px] text-slate-400">{c.type}</span>
                </td>
                <td className="py-2 text-right tabular-nums text-slate-600">${c.assets}M</td>
                <td className="py-2 text-right"><span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold">{c.tier}</span></td>
                <td className="py-2 text-right tabular-nums font-medium text-slate-800">${c.mrr}</td>
                <td className="py-2 text-right text-slate-400">{c.lastLogin}</td>
                <td className="py-2 text-right">
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${c.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ label, value, accent, warn, icon }: { label: string; value: string; accent?: boolean; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'border-rose-200 bg-rose-50' : accent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-medium uppercase text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-rose-700' : accent ? 'text-emerald-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function getDemo(): ResellerDashboard {
  return {
    totalClients: 12, mrr: 18500, avgRevPerClient: 1542, churnRate: 2.1,
    clients: [
      { name: 'Cooperativa Ejemplo Este', type: 'Credit Union', assets: 450, tier: 'Enterprise', mrr: 2500, status: 'Active', lastLogin: '2d ago' },
      { name: 'Cooperativa Ejemplo Norte', type: 'Credit Union', assets: 380, tier: 'Enterprise', mrr: 2500, status: 'Active', lastLogin: '1d ago' },
      { name: 'Cooperativa Ejemplo Centro', type: 'Credit Union', assets: 320, tier: 'Pilot', mrr: 1200, status: 'Active', lastLogin: '3d ago' },
      { name: 'FCB Puerto Rico', type: 'Community Bank', assets: 850, tier: 'Enterprise', mrr: 3500, status: 'Active', lastLogin: '5h ago' },
      { name: 'Coop San Juan', type: 'Credit Union', assets: 280, tier: 'Pilot', mrr: 1200, status: 'Active', lastLogin: '1w ago' },
      { name: 'Caribbean Federal CU', type: 'Credit Union', assets: 190, tier: 'Pilot', mrr: 800, status: 'Trial', lastLogin: '2w ago' },
    ],
    revenueByMonth: [
      { month: 'Oct', revenue: 12000, clients: 8 },
      { month: 'Nov', revenue: 13500, clients: 9 },
      { month: 'Dec', revenue: 14200, clients: 10 },
      { month: 'Jan', revenue: 15800, clients: 10 },
      { month: 'Feb', revenue: 17200, clients: 11 },
      { month: 'Mar', revenue: 18500, clients: 12 },
    ],
  };
}
