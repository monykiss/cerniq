'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { AlmSampleDataBanner } from '@/components/alm/AlmSampleDataBanner';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertTriangle, Layers } from 'lucide-react';

interface OASResult {
  instrumentId: string; instrumentName: string; category: string; balance: number;
  nominalSpread: number; zSpread: number; oas: number; optionCost: number;
  effectiveDuration: number; effectiveConvexity: number; modifiedDuration: number;
}

interface OASPortfolio extends AlmDataShell {
  instruments: OASResult[];
  // D1 (never silent zeros): null when no balance-sheet instruments are loaded —
  // the backend oas-calculator.service emits a data_unavailable shell (these
  // five null + a CRITICAL gap) rather than a fabricated portfolio OAS.
  portfolioOAS: number | null; portfolioEffDuration: number | null; portfolioEffConvexity: number | null;
  totalOptionCost: number | null; totalBalance: number | null;
}

export default function OASPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<OASPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  // D1: labeled network/500 fallback only — a data_unavailable shell never
  // takes this path.
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        // A data_unavailable shell arrives as a 200-OK (not a thrown error).
        setData(await apiClient.getOASPortfolio(selectedId));
        setIsDemo(false);
      } catch {
        setData(getDemoData());
        setIsDemo(true);
      } finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="OAS Analysis" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return <OASContent data={data} isDemo={isDemo} locale={locale} />;
}

function OASContent({ data, isDemo, locale }: { data: OASPortfolio; isDemo: boolean; locale: string }) {
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const header = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50">
        <Layers className="h-4 w-4 text-indigo-700" />
      </div>
      <div>
        <h1 className="text-lg font-bold text-slate-950">
          {locale === 'es' ? 'Análisis OAS — Spread Ajustado por Opciones' : 'OAS Analysis — Option-Adjusted Spreads'}
        </h1>
        <p className="text-xs text-slate-500">
          {locale === 'es' ? 'Árbol binomial BDT, duración/convexidad efectiva, costo de opcionalidad' : 'BDT binomial tree, effective duration/convexity, optionality cost'}
        </p>
      </div>
    </div>
  );

  // D1: no balance-sheet instruments loaded → honest neutral panel + the
  // CRITICAL gap, never a fabricated OAS portfolio.
  if (isDataUnavailable(data)) {
    return (
      <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
        {header}
        <AlmDataUnavailable
          gaps={data.gaps}
          message={{
            en: 'No balance-sheet instruments are loaded. Load the securities and loan book to compute option-adjusted spreads, effective duration and convexity.',
            es: 'No hay instrumentos del balance cargados. Cargue la cartera de valores y préstamos para calcular el diferencial ajustado por opción (OAS), la duración y la convexidad efectivas.',
          }}
        />
      </div>
    );
  }

  const spreadChart = data.instruments.map(i => ({
    name: i.instrumentName,
    nominal: i.nominalSpread,
    zSpread: i.zSpread,
    oas: i.oas,
    optionCost: i.optionCost,
  }));

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {isDemo ? <AlmSampleDataBanner /> : null}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      {header}

      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label={locale === 'es' ? 'OAS Portfolio' : 'Portfolio OAS'} value={data.portfolioOAS != null ? `${data.portfolioOAS.toFixed(1)} bps` : '—'} accent />
        <KPI label={locale === 'es' ? 'Duración Efectiva' : 'Eff. Duration'} value={data.portfolioEffDuration != null ? `${data.portfolioEffDuration.toFixed(2)} yr` : '—'} />
        <KPI label={locale === 'es' ? 'Convexidad Efectiva' : 'Eff. Convexity'} value={data.portfolioEffConvexity != null ? data.portfolioEffConvexity.toFixed(2) : '—'} warn={(data.portfolioEffConvexity ?? 0) < -1} />
        <KPI label={locale === 'es' ? 'Costo Opcionalidad' : 'Total Option Cost'} value={data.totalOptionCost != null ? `$${data.totalOptionCost.toFixed(2)}M` : '—'} />
        <KPI label={locale === 'es' ? 'Balance Total' : 'Total Balance'} value={data.totalBalance != null ? `$${data.totalBalance.toFixed(1)}M` : '—'} />
      </div>

      {/* Spread Comparison Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Nominal vs. Z-Spread vs. OAS por Instrumento' : 'Nominal vs. Z-Spread vs. OAS by Instrument'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={spreadChart} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11 }} label={{ value: 'bps', position: 'insideRight', style: { fontSize: 10 } }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="nominal" name={locale === 'es' ? 'Nominal' : 'Nominal'} fill="#94a3b8" radius={[0, 4, 4, 0]} />
            <Bar dataKey="zSpread" name="Z-Spread" fill="#6366f1" radius={[0, 4, 4, 0]} />
            <Bar dataKey="oas" name="OAS" fill="#06b6d4" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detail Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {locale === 'es' ? 'Detalle por Instrumento' : 'Instrument Detail'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-50 bg-slate-50/50">
                {[locale === 'es' ? 'Instrumento' : 'Instrument', locale === 'es' ? 'Balance' : 'Balance',
                  'Nominal', 'Z-Spread', 'OAS', locale === 'es' ? 'Costo Opción' : 'Option Cost',
                  locale === 'es' ? 'Dur. Efectiva' : 'Eff. Duration', locale === 'es' ? 'Conv. Efectiva' : 'Eff. Convexity',
                  locale === 'es' ? 'Dur. Modificada' : 'Mod. Duration'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.instruments.map(i => (
                <tr key={i.instrumentId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2.5 font-medium text-slate-700 text-xs">{i.instrumentName}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-slate-600">${i.balance}M</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-slate-500">{i.nominalSpread.toFixed(0)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-indigo-600 font-medium">{i.zSpread.toFixed(0)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-cyan-700 font-bold">{i.oas.toFixed(0)}</td>
                  <td className={`px-3 py-2.5 tabular-nums text-xs font-medium ${i.optionCost > 20 ? 'text-amber-700' : 'text-slate-500'}`}>{i.optionCost.toFixed(0)} bps</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-slate-600">{i.effectiveDuration.toFixed(2)}</td>
                  <td className={`px-3 py-2.5 tabular-nums text-xs ${i.effectiveConvexity < 0 ? 'text-rose-600 font-medium' : 'text-slate-600'}`}>{i.effectiveConvexity.toFixed(2)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-slate-400">{i.modifiedDuration.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Negative Convexity Warning */}
      {data.instruments.some(i => i.effectiveConvexity < -1) && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {locale === 'es' ? 'Convexidad Negativa Detectada' : 'Negative Convexity Detected'}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {locale === 'es'
                ? 'Instrumentos con convexidad negativa (MBS, bonos callable) pierden más valor cuando las tasas suben que lo que ganan cuando bajan. Considere reducir exposición o cubrir con swaptions.'
                : 'Instruments with negative convexity (MBS, callable bonds) lose more value when rates rise than they gain when rates fall. Consider reducing exposure or hedging with swaptions.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'border-rose-200 bg-rose-50' : accent ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-rose-700' : accent ? 'text-indigo-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function getDemoData(): OASPortfolio {
  return {
    instruments: [
      { instrumentId: 'd1', instrumentName: 'FHLB Callable 5Y', category: 'asset', balance: 25, nominalSpread: 45, zSpread: 42, oas: 28, optionCost: 14, effectiveDuration: 3.2, effectiveConvexity: -0.8, modifiedDuration: 4.5 },
      { instrumentId: 'd2', instrumentName: 'FNMA 30Y MBS Pool', category: 'asset', balance: 35, nominalSpread: 120, zSpread: 115, oas: 65, optionCost: 50, effectiveDuration: 4.8, effectiveConvexity: -2.4, modifiedDuration: 8.2 },
      { instrumentId: 'd3', instrumentName: 'UST 10Y Note', category: 'asset', balance: 20, nominalSpread: 0, zSpread: 0, oas: 0, optionCost: 0, effectiveDuration: 8.5, effectiveConvexity: 0.9, modifiedDuration: 8.5 },
      { instrumentId: 'd4', instrumentName: 'FHLMC 15Y MBS', category: 'asset', balance: 15, nominalSpread: 85, zSpread: 80, oas: 52, optionCost: 28, effectiveDuration: 3.1, effectiveConvexity: -1.5, modifiedDuration: 5.8 },
      { instrumentId: 'd5', instrumentName: 'PR Muni GO Bond', category: 'asset', balance: 10, nominalSpread: 250, zSpread: 245, oas: 240, optionCost: 5, effectiveDuration: 6.2, effectiveConvexity: 0.5, modifiedDuration: 6.5 },
    ],
    portfolioOAS: 58.3, portfolioEffDuration: 4.6, portfolioEffConvexity: -1.1, totalOptionCost: 2.85, totalBalance: 105,
    status: 'ok',
  };
}
