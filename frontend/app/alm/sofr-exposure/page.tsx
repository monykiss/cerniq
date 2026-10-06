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
import { RefreshCw, Check, Clock, Circle } from 'lucide-react';

interface LIBORExposure {
  instrumentId: string; name: string; subcategory: string; balance: number;
  referenceRate: string; currentRate: number; sofrEquivalent: number;
  spreadAdjustment: number; valueTransfer: number; maturityYears: number;
}

interface SOFRResult extends AlmDataShell {
  exposures: LIBORExposure[];
  // D1 (never silent zeros): null when no balance sheet is loaded — there is
  // nothing to measure. A real ZERO (institution has a balance sheet but no
  // LIBOR instruments) is a number, not null: `null` means "no data," `0`
  // means "measured zero exposure." The backend sofr-monitor.service emits a
  // data_unavailable shell (these four null + a CRITICAL gap) rather than a
  // fabricated demo.
  totalLIBORExposure: number | null;
  totalSOFRExposure: number | null;
  totalValueTransfer: number | null;
  pctPortfolioExposed: number | null;
  transitionChecklist: Array<{ item: string; itemEs: string; status: 'complete' | 'in_progress' | 'pending' }>;
}

const STATUS_ICONS = { complete: Check, in_progress: Clock, pending: Circle };
const STATUS_STYLES = {
  complete: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  in_progress: 'text-amber-600 bg-amber-50 border-amber-200',
  pending: 'text-slate-400 bg-slate-50 border-slate-200',
};

export default function SOFRExposurePage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<SOFRResult | null>(null);
  const [loading, setLoading] = useState(true);
  // D1: the demo sample is a LABELED network/500 fallback only — never the
  // path a data_unavailable shell takes.
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setLoading(true);
      try {
        // A data_unavailable shell arrives as a 200-OK (not a thrown error),
        // so it flows here — not into the catch — and is handled honestly below.
        setData(await apiClient.getSOFRExposure(selectedId));
        setIsDemo(false);
      } catch {
        setData(getDemoData());
        setIsDemo(true);
      } finally { setLoading(false); }
    })();
  }, [selectedId]);

  if (!selectedId) return <AlmSelectionRequired moduleLabel="SOFR Exposure" />;
  if (loading || !data) return <div className="flex-1 flex items-center justify-center p-6"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" /></div>;

  return <SOFRContent data={data} isDemo={isDemo} locale={locale} />;
}

function SOFRContent({ data, isDemo, locale }: { data: SOFRResult; isDemo: boolean; locale: string }) {
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const header = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50">
        <RefreshCw className="h-4 w-4 text-sky-700" />
      </div>
      <div>
        <h1 className="text-lg font-bold text-slate-950">
          {locale === 'es' ? 'Monitor de Transición SOFR' : 'SOFR Transition Monitor'}
        </h1>
        <p className="text-xs text-slate-500">
          {locale === 'es' ? 'Inventario exposición LIBOR, ajustes ISDA, lista de verificación OCIF' : 'LIBOR exposure inventory, ISDA adjustments, OCIF transition checklist'}
        </p>
      </div>
    </div>
  );

  // D1: no balance sheet loaded → honest neutral panel + the CRITICAL gap,
  // never a fabricated LIBOR-exposure sample.
  if (isDataUnavailable(data)) {
    return (
      <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
        {header}
        <AlmDataUnavailable
          gaps={data.gaps}
          message={{
            en: 'No balance sheet is loaded. Load it to inventory LIBOR-referenced instruments and compute the ISDA spread adjustments and SOFR transition.',
            es: 'No hay balance de situación cargado. Cárguelo para inventariar los instrumentos referenciados a LIBOR y calcular los ajustes de spread ISDA y la transición a SOFR.',
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {isDemo ? <AlmSampleDataBanner /> : null}
      {/* D1: any WARNING/partial gaps on a live result render alongside the
          numbers rather than papering over them. */}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      {header}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label={locale === 'es' ? 'Exposición LIBOR' : 'LIBOR Exposure'} value={fmtM(data.totalLIBORExposure)} warn={(data.totalLIBORExposure ?? 0) > 0} />
        <KPI label={locale === 'es' ? 'Exposición SOFR' : 'SOFR Exposure'} value={fmtM(data.totalSOFRExposure)} />
        <KPI label={locale === 'es' ? 'Transferencia Valor' : 'Value Transfer'} value={fmtM(data.totalValueTransfer, 2)} />
        <KPI label={locale === 'es' ? '% Portafolio Expuesto' : '% Portfolio Exposed'} value={data.pctPortfolioExposed != null ? `${data.pctPortfolioExposed.toFixed(1)}%` : '—'} warn={(data.pctPortfolioExposed ?? 0) > 5} />
      </div>

      {/* Exposure Table */}
      {data.exposures.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {locale === 'es' ? 'Inventario de Exposición LIBOR' : 'LIBOR Exposure Inventory'}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-50 bg-slate-50/50">
                {[locale === 'es' ? 'Instrumento' : 'Instrument', locale === 'es' ? 'Balance' : 'Balance',
                  locale === 'es' ? 'Tasa Ref.' : 'Ref. Rate', locale === 'es' ? 'Tasa Actual' : 'Current Rate',
                  locale === 'es' ? 'Equiv. SOFR' : 'SOFR Equiv.', locale === 'es' ? 'Ajuste ISDA' : 'ISDA Adj.',
                  locale === 'es' ? 'Transfer. Valor' : 'Value Transfer', locale === 'es' ? 'Vencimiento' : 'Maturity'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.exposures.map(e => (
                <tr key={e.instrumentId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2.5 font-medium text-slate-700 text-xs">{e.name}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">${e.balance}M</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{e.referenceRate}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{(e.currentRate * 100).toFixed(2)}%</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-sky-700 font-medium">{(e.sofrEquivalent * 100).toFixed(2)}%</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-amber-700">{(e.spreadAdjustment * 10000).toFixed(1)} bps</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs font-medium">${e.valueTransfer.toFixed(2)}M</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-slate-500">{e.maturityYears.toFixed(1)} yr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transition Checklist */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-4">
          {locale === 'es' ? 'Lista de Verificación — Transición OCIF' : 'Transition Checklist — OCIF Compliance'}
        </p>
        <div className="space-y-2">
          {data.transitionChecklist.map((item, i) => {
            const Icon = STATUS_ICONS[item.status];
            const cls = STATUS_STYLES[item.status];
            return (
              <div key={i} className={`flex items-center gap-3 rounded-lg border p-3 ${cls}`}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium flex-1">{locale === 'es' ? item.itemEs : item.item}</span>
                <span className="text-[10px] font-bold uppercase">{item.status.replace('_', ' ')}</span>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 mt-3">
          {locale === 'es' ? 'Referencia: Guía OCIF 2023 para transición LIBOR en instituciones supervisadas' : 'Reference: OCIF 2023 guidance for LIBOR transition in supervised institutions'}
        </p>
      </div>
    </div>
  );
}

// D1: format a `$X.YM` figure that is null-safe — `—` for a missing input,
// never a fabricated `$0.0M`.
function fmtM(n: number | null, dp = 1): string {
  return n != null ? `$${n.toFixed(dp)}M` : '—';
}

function KPI({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${warn ? 'text-amber-700' : 'text-slate-950'}`}>{value}</p>
    </div>
  );
}

function getDemoData(): SOFRResult {
  return {
    exposures: [
      { instrumentId: 'd1', name: 'Variable Rate Mortgages (LIBOR)', subcategory: 'residential_mortgage', balance: 18.5, referenceRate: '3M LIBOR', currentRate: 0.068, sofrEquivalent: 0.0654, spreadAdjustment: 0.00262, valueTransfer: 0.36, maturityYears: 7.5 },
      { instrumentId: 'd2', name: 'C&I Floating (LIBOR)', subcategory: 'commercial_loans', balance: 12.0, referenceRate: '1M LIBOR', currentRate: 0.072, sofrEquivalent: 0.0709, spreadAdjustment: 0.00114, valueTransfer: 0.07, maturityYears: 5.0 },
      { instrumentId: 'd3', name: 'CRE Variable (LIBOR)', subcategory: 'commercial_re', balance: 8.2, referenceRate: '3M LIBOR', currentRate: 0.062, sofrEquivalent: 0.0594, spreadAdjustment: 0.00262, valueTransfer: 0.16, maturityYears: 7.0 },
    ],
    totalLIBORExposure: 38.7, totalSOFRExposure: 85.3, totalValueTransfer: 0.59, pctPortfolioExposed: 8.7,
    status: 'ok',
    transitionChecklist: [
      { item: 'Inventory all LIBOR-referenced instruments', itemEs: 'Inventariar instrumentos referenciados a LIBOR', status: 'complete' },
      { item: 'Review fallback language in loan documents', itemEs: 'Revisar cláusulas de respaldo en documentos', status: 'in_progress' },
      { item: 'Calculate ISDA spread adjustments', itemEs: 'Calcular ajustes de spread ISDA', status: 'complete' },
      { item: 'Notify affected borrowers', itemEs: 'Notificar a prestatarios afectados', status: 'pending' },
      { item: 'Update core banking rate indices', itemEs: 'Actualizar índices en sistema core', status: 'pending' },
      { item: 'File OCIF SOFR transition attestation', itemEs: 'Presentar atestación SOFR a OCIF', status: 'pending' },
      { item: 'Board resolution approving transition', itemEs: 'Resolución de junta aprobando transición', status: 'in_progress' },
    ],
  };
}
