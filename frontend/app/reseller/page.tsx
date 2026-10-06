'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Building2, Plus } from 'lucide-react';

interface ResellerClient {
  id: string;
  name: string;
  totalAssets: number;
  camelComposite: number;
  healthScore: number;
  openFindings: number;
  mrr: number;
}

export default function ResellerPortalPage() {
  const { locale } = useTranslation();
  const [clients] = useState<ResellerClient[]>(getDemoClients());

  const totalMRR = clients.reduce((s, c) => s + c.mrr, 0);
  const avgCAMEL = clients.length > 0 ? clients.reduce((s, c) => s + (c.camelComposite ?? 2), 0) / clients.length : 0;
  const needsAttention = clients.filter(c => c.openFindings > 0 || (c.camelComposite ?? 0) >= 3).length;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900"><Building2 className="h-4 w-4 text-white" /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Portal de Reseller' : 'Reseller Portal'}</h1>
            <p className="text-xs text-slate-500">{locale === 'es' ? 'Gestión de clientes, facturación, marca' : 'Client management, billing, branding'}</p>
          </div>
        </div>
        <button className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" />{locale === 'es' ? 'Agregar Cliente' : 'Add Client'}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-medium uppercase text-slate-400">{locale === 'es' ? 'Clientes' : 'Clients'}</p><p className="text-xl font-bold tabular-nums text-slate-950">{clients.length}</p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-medium uppercase text-emerald-600">MRR Total</p><p className="text-xl font-bold tabular-nums text-emerald-700">${totalMRR.toLocaleString()}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-medium uppercase text-slate-400">CAMEL Avg</p><p className="text-xl font-bold tabular-nums text-slate-950">{avgCAMEL.toFixed(1)}</p></div>
        <div className={`rounded-xl border p-3 ${needsAttention > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}><p className="text-[10px] font-medium uppercase text-slate-400">{locale === 'es' ? 'Requiere Atención' : 'Needs Attention'}</p><p className={`text-xl font-bold tabular-nums ${needsAttention > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{needsAttention}</p></div>
      </div>

      {/* Client Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50/50">
            {[locale === 'es' ? 'Institución' : 'Institution', locale === 'es' ? 'Activos' : 'Assets', 'CAMEL', locale === 'es' ? 'Salud' : 'Health', locale === 'es' ? 'Hallazgos' : 'Findings', 'MRR', locale === 'es' ? 'Acciones' : 'Actions'].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium text-slate-500">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-slate-700 text-xs">{c.name}</td>
                <td className="px-4 py-3 tabular-nums text-xs">${c.totalAssets}M</td>
                <td className="px-4 py-3"><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white`} style={{ backgroundColor: ['', '#009E3A', '#16A34A', '#D97706', '#C2410C', '#B91C1C'][c.camelComposite] }}>{c.camelComposite}</span></td>
                <td className="px-4 py-3 tabular-nums text-xs">{c.healthScore}/100</td>
                <td className={`px-4 py-3 tabular-nums text-xs ${c.openFindings > 0 ? 'text-amber-700 font-bold' : 'text-emerald-700'}`}>{c.openFindings}</td>
                <td className="px-4 py-3 tabular-nums text-xs font-medium">${c.mrr.toLocaleString()}</td>
                <td className="px-4 py-3"><button className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50">{locale === 'es' ? 'Abrir' : 'Open'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Revenue Share */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-[10px] font-semibold uppercase text-emerald-600 mb-1">{locale === 'es' ? 'Tu Participación (20%)' : 'Your Revenue Share (20%)'}</p>
        <p className="text-2xl font-bold tabular-nums text-emerald-700">${(totalMRR * 0.20).toLocaleString()}<span className="text-sm font-normal text-emerald-600">/month</span></p>
      </div>
    </div>
  );
}

function getDemoClients(): ResellerClient[] {
  return [
    { id: '1', name: 'Coop. Oriental', totalAssets: 450, camelComposite: 2, healthScore: 78, openFindings: 1, mrr: 3500 },
    { id: '2', name: 'Coop. Bayamón', totalAssets: 380, camelComposite: 2, healthScore: 72, openFindings: 0, mrr: 3500 },
    { id: '3', name: 'Coop. Caguas', totalAssets: 320, camelComposite: 1, healthScore: 85, openFindings: 0, mrr: 3500 },
    { id: '4', name: 'Coop. Ponce', totalAssets: 280, camelComposite: 3, healthScore: 62, openFindings: 2, mrr: 1500 },
    { id: '5', name: 'Coop. Mayagüez', totalAssets: 250, camelComposite: 2, healthScore: 70, openFindings: 0, mrr: 3500 },
  ];
}
