'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Layers } from 'lucide-react';

interface DurationMismatchBucket {
  bucket: string;
  assetDuration: number;
  liabDuration: number;
  mismatch: number;
}

interface ConvexityContributor {
  name: string;
  balance: number;
  convexity: number;
  contribution: number;
}

interface OptionalityData {
  portfolioModDuration: number;
  portfolioEffDuration: number;
  portfolioConvexity: number;
  durationGap: number;
  negConvexityBalance: number;
  negConvexityPct: number;
  durationMismatchHeatmap: DurationMismatchBucket[];
  convexityContributors: ConvexityContributor[];
}

export default function OptionalityPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<OptionalityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try { setData(await apiClient.getOptionality(selectedId) as OptionalityData); }
      catch { setData(getDemoData()); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Optionality Suite" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50">
          <Layers className="h-4 w-4 text-indigo-700" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Suite de Opcionalidad — KRD + Convexidad' : 'Optionality Suite — KRD + Convexity'}</h1>
          <p className="text-xs text-slate-500">{locale === 'es' ? 'Duración efectiva, convexidad negativa, mapa de desfase' : 'Effective duration, negative convexity, mismatch heatmap'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPI label={locale === 'es' ? 'Dur. Modificada' : 'Mod. Duration'} value={`${data.portfolioModDuration} yr`} />
        <KPI label={locale === 'es' ? 'Dur. Efectiva' : 'Eff. Duration'} value={`${data.portfolioEffDuration} yr`} accent />
        <KPI label={locale === 'es' ? 'Convexidad' : 'Convexity'} value={data.portfolioConvexity.toFixed(2)} warn={data.portfolioConvexity < -0.5} />
        <KPI label={locale === 'es' ? 'Brecha Dur.' : 'Dur. Gap'} value={`${data.durationGap} yr`} />
        <KPI label={locale === 'es' ? 'Conv. Neg. ($M)' : 'Neg Conv ($M)'} value={`$${data.negConvexityBalance}M`} warn={data.negConvexityPct > 20} />
        <KPI label={locale === 'es' ? '% Conv. Neg.' : '% Neg Conv'} value={`${data.negConvexityPct}%`} warn={data.negConvexityPct > 20} />
      </div>

      {/* Duration Mismatch Heatmap */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">{locale === 'es' ? 'Mapa de Desfase de Duración' : 'Duration Mismatch Heatmap'}</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.durationMismatchHeatmap}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="assetDuration" name={locale === 'es' ? 'Activos' : 'Assets'} fill="#06b6d4" radius={[4, 4, 0, 0]} />
            <Bar dataKey="liabDuration" name={locale === 'es' ? 'Pasivos' : 'Liabilities'} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top Convexity Contributors */}
      {data.convexityContributors?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{locale === 'es' ? 'Principales Contribuidores de Convexidad (más negativa primero)' : 'Top Convexity Contributors (most negative first)'}</p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-50 bg-slate-50/50">
              {[locale === 'es' ? 'Instrumento' : 'Instrument', locale === 'es' ? 'Balance' : 'Balance', locale === 'es' ? 'Convexidad' : 'Convexity', locale === 'es' ? 'Contribución' : 'Contribution'].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[10px] font-medium text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.convexityContributors.map((contributor, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-700">{contributor.name}</td>
                  <td className="px-4 py-2.5 text-xs tabular-nums">${contributor.balance}M</td>
                  <td className={`px-4 py-2.5 text-xs tabular-nums font-medium ${contributor.convexity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{contributor.convexity.toFixed(2)}</td>
                  <td className={`px-4 py-2.5 text-xs tabular-nums ${contributor.contribution < 0 ? 'text-rose-700 font-bold' : ''}`}>{contributor.contribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function getDemoData(): OptionalityData {
  return {
    portfolioModDuration: 4.2, portfolioEffDuration: 3.6, portfolioConvexity: -0.8,
    durationGap: 1.8, negConvexityBalance: 130, negConvexityPct: 29.2,
    durationMismatchHeatmap: [
      { bucket: '0-1Y', assetDuration: 0.3, liabDuration: 0.8, mismatch: -0.5 },
      { bucket: '1-3Y', assetDuration: 1.2, liabDuration: 0.6, mismatch: 0.6 },
      { bucket: '3-5Y', assetDuration: 0.8, liabDuration: 0.3, mismatch: 0.5 },
      { bucket: '5-10Y', assetDuration: 0.9, liabDuration: 0.1, mismatch: 0.8 },
      { bucket: '10Y+', assetDuration: 0.4, liabDuration: 0.0, mismatch: 0.4 },
    ],
    convexityContributors: [
      { name: 'FNMA 30Y MBS', balance: 35, convexity: -2.4, contribution: -84 },
      { name: 'FHLMC 15Y MBS', balance: 15, convexity: -1.5, contribution: -22.5 },
      { name: 'Residential Mortgages', balance: 80, convexity: -0.6, contribution: -48 },
    ],
  };
}
