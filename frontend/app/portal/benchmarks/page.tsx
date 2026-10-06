'use client';

import React, { useState, useEffect } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { useTranslation } from '@/lib/i18n';

// ─── Types ──────────────────────────────────────────────────────────────────

interface InstitutionProfile {
  name: string;
  totalAssets: number;
  type: string;
}

interface PeerGroup {
  id: string;
  label: string;
  count: number;
  assetRange: string;
}

interface RadarMetric {
  metric: string;
  metricEs: string;
  institution: number;
  peerMedian: number;
  fullMark: number;
}

interface QuartileRow {
  metric: string;
  metricEs: string;
  value: number;
  p25: number;
  p50: number;
  p75: number;
  quartile: 1 | 2 | 3 | 4;
  unit: string;
}

interface FindingCell {
  category: string;
  categoryEs: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('capex_access_token') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function currencyCompact(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

// ─── Demo data ──────────────────────────────────────────────────────────────

const DEMO_PROFILE: InstitutionProfile = {
  name: 'Cooperativa de Ahorro Caguas',
  totalAssets: 2_800_000_000,
  type: 'Credit Union (Cooperativa)',
};

const DEMO_PEER_GROUPS: PeerGroup[] = [
  { id: 'pg1', label: 'Auto (0.5x-2x assets)', count: 14, assetRange: '$1.4B - $5.6B' },
  { id: 'pg2', label: 'Large CUs (>$1B)', count: 22, assetRange: '$1.0B+' },
  { id: 'pg3', label: 'All PR Cooperativas', count: 109, assetRange: '$10M - $6B' },
];

const DEMO_RADAR: RadarMetric[] = [
  { metric: 'Duration Gap', metricEs: 'Brecha de Duracion', institution: 75, peerMedian: 65, fullMark: 100 },
  { metric: 'NII Sensitivity', metricEs: 'Sensibilidad NII', institution: 68, peerMedian: 72, fullMark: 100 },
  { metric: 'EVE Change', metricEs: 'Cambio EVE', institution: 82, peerMedian: 70, fullMark: 100 },
  { metric: 'LCR', metricEs: 'LCR', institution: 90, peerMedian: 85, fullMark: 100 },
  { metric: 'Capital Adequacy', metricEs: 'Adecuacion Capital', institution: 85, peerMedian: 78, fullMark: 100 },
  { metric: 'Net Worth', metricEs: 'Patrimonio Neto', institution: 78, peerMedian: 74, fullMark: 100 },
];

const DEMO_QUARTILES: QuartileRow[] = [
  { metric: 'Duration Gap', metricEs: 'Brecha de Duracion', value: 1.2, p25: 0.8, p50: 1.5, p75: 2.1, quartile: 2, unit: 'yr' },
  { metric: 'NII Sensitivity (+200bp)', metricEs: 'Sensibilidad NII (+200bp)', value: -4.8, p25: -6.2, p50: -3.5, p75: -1.8, quartile: 3, unit: '%' },
  { metric: 'EVE Change (+200bp)', metricEs: 'Cambio EVE (+200bp)', value: -6.2, p25: -8.5, p50: -5.0, p75: -2.5, quartile: 3, unit: '%' },
  { metric: 'LCR', metricEs: 'LCR', value: 142.3, p25: 110.0, p50: 125.0, p75: 150.0, quartile: 1, unit: '%' },
  { metric: 'Capital Ratio', metricEs: 'Razon de Capital', value: 12.5, p25: 9.0, p50: 11.0, p75: 13.5, quartile: 1, unit: '%' },
  { metric: 'Net Worth / Assets', metricEs: 'Patrimonio / Activos', value: 10.8, p25: 8.5, p50: 10.0, p75: 12.0, quartile: 2, unit: '%' },
];

const DEMO_FINDINGS: FindingCell[] = [
  { category: 'Capital Adequacy', categoryEs: 'Adecuacion Capital', low: 3, medium: 1, high: 0, critical: 0 },
  { category: 'Asset Quality', categoryEs: 'Calidad de Activos', low: 2, medium: 3, high: 1, critical: 0 },
  { category: 'Management', categoryEs: 'Gestion', low: 4, medium: 2, high: 0, critical: 0 },
  { category: 'Earnings', categoryEs: 'Rendimiento', low: 1, medium: 2, high: 1, critical: 0 },
  { category: 'Liquidity', categoryEs: 'Liquidez', low: 2, medium: 0, high: 0, critical: 0 },
  { category: 'Sensitivity', categoryEs: 'Sensibilidad', low: 3, medium: 1, high: 1, critical: 1 },
  { category: 'IT/Cyber', categoryEs: 'TI/Ciber', low: 1, medium: 3, high: 2, critical: 1 },
  { category: 'BSA/AML', categoryEs: 'BSA/AML', low: 2, medium: 1, high: 0, critical: 0 },
];

// ─── Quartile badge ─────────────────────────────────────────────────────────

function QuartileBadge({ q }: { q: 1 | 2 | 3 | 4 }) {
  const styles = {
    1: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    2: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    3: 'bg-amber-50 text-amber-700 border-amber-200',
    4: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${styles[q]}`}>
      Q{q}
    </span>
  );
}

// ─── Heatmap cell ───────────────────────────────────────────────────────────

function heatColor(count: number): string {
  if (count === 0) return 'bg-slate-50 text-slate-300';
  if (count === 1) return 'bg-amber-50 text-amber-700';
  if (count === 2) return 'bg-orange-50 text-orange-700';
  return 'bg-rose-50 text-rose-700';
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function BenchmarksPage() {
  const { locale } = useTranslation();

  const [profile, setProfile] = useState<InstitutionProfile>(DEMO_PROFILE);
  const [peerGroups, setPeerGroups] = useState<PeerGroup[]>(DEMO_PEER_GROUPS);
  const [selectedPeerGroup, setSelectedPeerGroup] = useState<string>(DEMO_PEER_GROUPS[0].id);
  const [radarData, setRadarData] = useState<RadarMetric[]>(DEMO_RADAR);
  const [quartiles, setQuartiles] = useState<QuartileRow[]>(DEMO_QUARTILES);
  const [findings, setFindings] = useState<FindingCell[]>(DEMO_FINDINGS);
  const [loading, setLoading] = useState(true);

  // Fetch
  useEffect(() => {
    async function fetchData() {
      try {
        const instId = typeof window !== 'undefined' ? sessionStorage.getItem('institution_id') || 'demo' : 'demo';
        const res = await fetch(`${API}/api/benchmarks/${instId}?peerGroup=${selectedPeerGroup}`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.profile) setProfile(data.profile);
          if (data.peerGroups) setPeerGroups(data.peerGroups);
          if (data.radar) setRadarData(data.radar);
          if (data.quartiles) setQuartiles(data.quartiles);
          if (data.findings) setFindings(data.findings);
        }
      } catch {
        // Use demo
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [selectedPeerGroup]);

  const radarChartData = radarData.map((d) => ({
    subject: locale === 'es' ? d.metricEs : d.metric,
    Institution: d.institution,
    'Peer Median': d.peerMedian,
    fullMark: d.fullMark,
  }));

  // ─── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-96 animate-pulse rounded-xl bg-slate-200" />
            <div className="h-96 animate-pulse rounded-xl bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* Institution profile + peer group selector */}
        <header className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h1 className="text-lg font-bold text-[#1e3a5f]">{profile.name}</h1>
            <p className="text-xs text-slate-500">
              {currencyCompact(profile.totalAssets)} {locale === 'es' ? 'en activos' : 'in assets'} &middot; {profile.type}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-500">
              {locale === 'es' ? 'Grupo de Pares' : 'Peer Group'}
            </label>
            <select
              value={selectedPeerGroup}
              onChange={(e) => setSelectedPeerGroup(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1e3a5f] focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
              aria-label={locale === 'es' ? 'Seleccionar grupo de pares' : 'Select peer group'}
            >
              {peerGroups.map((pg) => (
                <option key={pg.id} value={pg.id}>
                  {pg.label} ({pg.count} {locale === 'es' ? 'inst.' : 'inst.'})
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="text-[11px] text-slate-400 italic">
          {locale === 'es'
            ? 'Todos los datos de pares son anonimizados. No se muestran nombres de instituciones individuales.'
            : 'All peer data is anonymized. No individual institution names are displayed.'}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Radar chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-4 text-sm font-bold text-[#1e3a5f]">
              {locale === 'es' ? 'Comparacion de 6 Metricas Clave' : '6 Key Metrics Comparison'}
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarChartData}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name={locale === 'es' ? 'Institucion' : 'Institution'} dataKey="Institution" stroke="#1e3a5f" fill="#1e3a5f" fillOpacity={0.25} strokeWidth={2} />
                <Radar name={locale === 'es' ? 'Mediana Pares' : 'Peer Median'} dataKey="Peer Median" stroke="#d97706" fill="#d97706" fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 4" />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex items-center justify-center gap-6">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-6 rounded bg-[#1e3a5f] opacity-60" />
                <span className="text-[10px] text-slate-500">{locale === 'es' ? 'Institucion' : 'Institution'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-0.5 w-6 rounded bg-amber-600" style={{ borderTop: '2px dashed #d97706' }} />
                <span className="text-[10px] text-slate-500">{locale === 'es' ? 'Mediana Pares' : 'Peer Median'}</span>
              </div>
            </div>
          </div>

          {/* Quartile rankings */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-bold text-[#1e3a5f]">
                {locale === 'es' ? 'Rankings por Cuartil' : 'Quartile Rankings'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {locale === 'es' ? 'Metrica' : 'Metric'}
                    </th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {locale === 'es' ? 'Valor' : 'Value'}
                    </th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">P25</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">P50</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">P75</th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {locale === 'es' ? 'Cuartil' : 'Quartile'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quartiles.map((row) => (
                    <tr key={row.metric} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-medium text-slate-700">
                        {locale === 'es' ? row.metricEs : row.metric}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums font-semibold text-[#1e3a5f]">
                        {row.value}{row.unit}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">{row.p25}{row.unit}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">{row.p50}{row.unit}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">{row.p75}{row.unit}</td>
                      <td className="px-3 py-2.5 text-center">
                        <QuartileBadge q={row.quartile} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* COSSEC findings heatmap */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-bold text-[#1e3a5f]">
            {locale === 'es' ? 'Mapa de Calor: Hallazgos COSSEC (Pares Anonimizados)' : 'COSSEC Findings Heatmap (Anonymized Peers)'}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {locale === 'es' ? 'Categoria' : 'Category'}
                  </th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                    {locale === 'es' ? 'Bajo' : 'Low'}
                  </th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                    {locale === 'es' ? 'Medio' : 'Medium'}
                  </th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-orange-600">
                    {locale === 'es' ? 'Alto' : 'High'}
                  </th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-rose-600">
                    {locale === 'es' ? 'Critico' : 'Critical'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f.category} className="border-b border-slate-50">
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-700">
                      {locale === 'es' ? f.categoryEs : f.category}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded text-xs font-bold ${heatColor(f.low)}`}>{f.low}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded text-xs font-bold ${heatColor(f.medium)}`}>{f.medium}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded text-xs font-bold ${heatColor(f.high)}`}>{f.high}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded text-xs font-bold ${heatColor(f.critical)}`}>{f.critical}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
