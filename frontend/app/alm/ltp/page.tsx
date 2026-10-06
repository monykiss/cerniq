'use client';

import { useState, useEffect } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import AlmSelectionRequired from '@/components/alm/AlmSelectionRequired';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { AlmSampleDataBanner } from '@/components/alm/AlmSampleDataBanner';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';
import { useTranslation } from '@/lib/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Banknote } from 'lucide-react';

interface LTPSegment {
  segment: string;
  category: 'asset' | 'liability';
  balance: number;
  matchedBucket: string;
  liquidityPremium: number;
  liquidityCharge: number;
  beforeLTP_NIM: number;
  afterLTP_NIM: number;
  isLiquidityConsumer: boolean;
}

interface FundingCurveBucket {
  bucket: string;
  fundingCost: number;
  riskFreeRate: number;
  liquidityPremium: number;
}

interface LiquidityTransferPricingData extends AlmDataShell {
  segments: LTPSegment[];
  internalFundingCurve: FundingCurveBucket[];
  // D1 (never silent zeros): null when no balance sheet is loaded — the backend
  // liquidity-transfer-pricing.service emits a data_unavailable shell (these
  // three null + a CRITICAL gap) rather than a fabricated $0M transfer.
  totalLiquidityCharge: number | null;
  totalLiquidityCredit: number | null;
  netLTPTransfer: number | null;
  topConsumers: string[];
  topProviders: string[];
}

export default function LTPPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<LiquidityTransferPricingData | null>(null);
  const [loading, setLoading] = useState(true);
  // D1: labeled network/500 fallback only — a data_unavailable shell never
  // takes this path.
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        const NODE_API_URL = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE_API_URL}/api/alm/${selectedId}/ltp`);
        // A data_unavailable shell is a 200-OK with null numerics — keep it and
        // render the honest gap. Only a non-OK (5xx/4xx) is a genuine error.
        if (res.ok) { setData(await res.json() as LiquidityTransferPricingData); setIsDemo(false); }
        else { setData(getDemoData()); setIsDemo(true); }
      } catch { setData(getDemoData()); setIsDemo(true); }
      finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="Liquidity Transfer Pricing" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return <LTPContent data={data} isDemo={isDemo} locale={locale} />;
}

function LTPContent({ data, isDemo, locale }: { data: LiquidityTransferPricingData; isDemo: boolean; locale: string }) {
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const header = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50">
        <Banknote className="h-4 w-4 text-blue-700" />
      </div>
      <div>
        <h1 className="text-lg font-bold text-slate-950">{locale === 'es' ? 'Precios de Transferencia de Liquidez (LTP)' : 'Liquidity Transfer Pricing (LTP)'}</h1>
        <p className="text-xs text-slate-500">{locale === 'es' ? 'Curva de fondeo interno, prima de liquidez por segmento' : 'Internal funding curve, liquidity premium by segment'}</p>
      </div>
    </div>
  );

  // D1: no balance sheet loaded → honest neutral panel + the CRITICAL gap.
  if (isDataUnavailable(data)) {
    return (
      <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
        {header}
        <AlmDataUnavailable
          gaps={data.gaps}
          message={{
            en: 'No balance sheet is loaded. Load the assets and liabilities to build the internal funding curve and compute liquidity transfer pricing.',
            es: 'No hay balance de situación cargado. Cargue los activos y pasivos para construir la curva de fondeo interno y calcular el precio de transferencia de liquidez (LTP).',
          }}
        />
      </div>
    );
  }

  const chartData = data.segments.map((segment) => ({ name: segment.segment, charge: segment.liquidityCharge }));

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {isDemo ? <AlmSampleDataBanner /> : null}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      {header}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-[10px] font-medium uppercase text-rose-500">{locale === 'es' ? 'Cargo Total' : 'Total Charge'}</p><p className="text-xl font-bold tabular-nums text-rose-700">{fmtM(data.totalLiquidityCharge)}</p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-medium uppercase text-emerald-500">{locale === 'es' ? 'Crédito Total' : 'Total Credit'}</p><p className="text-xl font-bold tabular-nums text-emerald-700">{fmtM(data.totalLiquidityCredit)}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-medium uppercase text-slate-400">{locale === 'es' ? 'Transferencia Neta' : 'Net Transfer'}</p><p className="text-xl font-bold tabular-nums text-slate-950">{fmtM(data.netLTPTransfer)}</p></div>
      </div>

      {/* Internal Funding Curve */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">{locale === 'es' ? 'Curva de Fondeo Interno' : 'Internal Funding Curve'}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-100">{[locale === 'es' ? 'Segmento' : 'Bucket', locale === 'es' ? 'Costo Fondeo' : 'Funding Cost', locale === 'es' ? 'Tasa Libre' : 'Risk-Free', locale === 'es' ? 'Prima Liquidez' : 'Liq. Premium'].map(h => <th key={h} className="px-3 py-1.5 text-left text-[10px] text-slate-500">{h}</th>)}</tr></thead>
            <tbody>{data.internalFundingCurve.map((bucket) => (
              <tr key={bucket.bucket} className="border-b border-slate-50"><td className="px-3 py-1.5 font-medium">{bucket.bucket}</td><td className="px-3 py-1.5 tabular-nums">{(bucket.fundingCost * 100).toFixed(2)}%</td><td className="px-3 py-1.5 tabular-nums">{(bucket.riskFreeRate * 100).toFixed(2)}%</td><td className="px-3 py-1.5 tabular-nums font-medium text-blue-700">{(bucket.liquidityPremium * 10000).toFixed(0)} bps</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">{locale === 'es' ? 'Cargo/Crédito por Segmento' : 'Charge/Credit by Segment'}</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
              <YAxis tickFormatter={v => `$${v}M`} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#94a3b8" />
              <Bar dataKey="charge" radius={[4, 4, 0, 0]}>{chartData.map((entry, i) => <Cell key={i} fill={entry.charge >= 0 ? '#ef4444' : '#10b981'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <p className="text-[10px] font-semibold uppercase text-rose-600 mb-2">{locale === 'es' ? 'Mayores Consumidores de Liquidez' : 'Top Liquidity Consumers'}</p>
          {data.topConsumers.map((c: string) => <p key={c} className="text-xs text-rose-800 capitalize">• {c}</p>)}
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="text-[10px] font-semibold uppercase text-emerald-600 mb-2">{locale === 'es' ? 'Mayores Proveedores de Liquidez' : 'Top Liquidity Providers'}</p>
          {data.topProviders.map((p: string) => <p key={p} className="text-xs text-emerald-800 capitalize">• {p}</p>)}
        </div>
      </div>
    </div>
  );
}

// D1: null-safe `$X.YM` — `—` for a missing input, never a fabricated `$0M`.
function fmtM(n: number | null): string {
  return n != null ? `$${n}M` : '—';
}

function getDemoData(): LiquidityTransferPricingData {
  return {
    segments: [
      { segment: 'commercial re', category: 'asset', balance: 120, matchedBucket: '5-10Y', liquidityPremium: 60, liquidityCharge: 0.72, beforeLTP_NIM: 5.80, afterLTP_NIM: 5.20, isLiquidityConsumer: true },
      { segment: 'residential mortgage', category: 'asset', balance: 95, matchedBucket: '5-10Y', liquidityPremium: 60, liquidityCharge: 0.57, beforeLTP_NIM: 5.50, afterLTP_NIM: 4.90, isLiquidityConsumer: true },
      { segment: 'consumer loans', category: 'asset', balance: 85, matchedBucket: '1-3Y', liquidityPremium: 40, liquidityCharge: 0.34, beforeLTP_NIM: 7.20, afterLTP_NIM: 6.80, isLiquidityConsumer: true },
      { segment: 'demand deposits', category: 'liability', balance: 180, matchedBucket: '0-3M', liquidityPremium: 20, liquidityCharge: -0.36, beforeLTP_NIM: 0.50, afterLTP_NIM: 0.70, isLiquidityConsumer: false },
      { segment: 'time deposits', category: 'liability', balance: 75, matchedBucket: '1-3Y', liquidityPremium: 40, liquidityCharge: -0.30, beforeLTP_NIM: 4.00, afterLTP_NIM: 4.40, isLiquidityConsumer: false },
    ],
    internalFundingCurve: [
      { bucket: '0-3M', fundingCost: 0.050, riskFreeRate: 0.048, liquidityPremium: 0.002 },
      { bucket: '3-12M', fundingCost: 0.047, riskFreeRate: 0.044, liquidityPremium: 0.003 },
      { bucket: '1-3Y', fundingCost: 0.045, riskFreeRate: 0.041, liquidityPremium: 0.004 },
      { bucket: '3-5Y', fundingCost: 0.046, riskFreeRate: 0.0405, liquidityPremium: 0.0055 },
      { bucket: '5-10Y', fundingCost: 0.048, riskFreeRate: 0.042, liquidityPremium: 0.006 },
      { bucket: '>10Y', fundingCost: 0.052, riskFreeRate: 0.046, liquidityPremium: 0.006 },
    ],
    totalLiquidityCharge: 2.05, totalLiquidityCredit: 1.38, netLTPTransfer: 0.67,
    status: 'ok',
    topConsumers: ['commercial re', 'residential mortgage', 'consumer loans'],
    topProviders: ['demand deposits', 'time deposits'],
  };
}
