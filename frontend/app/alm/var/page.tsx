'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Check, AlertTriangle, X } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { label } from '@/lib/alm/labels';
import { AlmPage } from '@/components/alm/AlmPage';
import { AlmDataUnavailable } from '@/components/alm/AlmDataUnavailable';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { DataTable, type DataTableColumn } from '@/components/density/DataTable';
import { DataGapBanner } from '@/components/ui/cerniq';
import { useReportDataGaps } from '@/hooks/useReportDataGaps';
import { isDataUnavailable, type AlmDataShell } from '@/lib/alm/data-shell';

/**
 * VaR Suite — flagship reference using the AlmPage shell.
 *
 * Module identity, header, loading/error/success states, demo banner,
 * and retry wiring are all handled by <AlmPage>. The only module-specific
 * concerns here are:
 *
 *   - Domain types + runtime shape guard (validate)
 *   - Demo factory (opt-in fallback — network/500 ONLY, per the quant-page policy)
 *   - The content render prop (MetricStrip + DataTable + chart + Kupiec)
 *   - Controls (confidence + horizon selects)
 *
 * D1 (never silent zeros, SESSION_HANDOFF §1): the backend
 * `PortfolioVaRService.computeVaRSuite` returns honest *shells* on thin input,
 * NOT fabricated numbers, and they arrive as a 200-OK so `validate` must accept
 * them (never throw on a null numeric — that would mis-route the honest gap into
 * the demo fallback and resurrect the phantom $445M book at the UI layer):
 *
 *   • Empty balance sheet → `status:'data_unavailable'`, every numeric null, a
 *     CRITICAL gap. The content area swaps to <AlmDataUnavailable>.
 *   • No empirical MarketDataSnapshot history (the common case) → `status:'ok'`
 *     with the REAL parametric VaR rendered, the historical + Monte Carlo methods
 *     and the Kupiec backtest withheld (null), and WARNING gaps. The content
 *     renders the live parametric figures, `—` for the withheld methods, and a
 *     <DataGapBanner> disclosing what is missing.
 *   • ≥1y of empirical history → all three methods + an out-of-sample backtest,
 *     no gaps.
 *
 * The labeled <AlmPage> "Sample data" demo survives ONLY as the genuine
 * network/500 fallback (var is a `quant` registry category, not regulatory).
 *
 * To migrate another module, copy this file, swap slug + types + demo, and
 * adjust the content renderer. Total migration is usually <150 LoC.
 */

// ─── Domain types ────────────────────────────────────────────────────────────
// Numerics are `number | null`: the backend nulls each field whose input is
// unavailable (D1), never a synthetic 0. Mirrors portfolio-var.service.ts.

interface VaRResult {
  readonly method: 'historical' | 'parametric' | 'montecarlo';
  readonly confidenceLevel: number;
  readonly horizon: number;
  readonly var: number | null;
  readonly cvar: number | null;
  readonly varPct: number | null;
  readonly portfolioValue: number | null;
  readonly status?: 'ok' | 'data_unavailable';
}

interface BacktestResult {
  readonly testDays: number;
  readonly exceptions: number | null;
  readonly exceptionRate: number | null;
  readonly expectedExceptions: number | null;
  readonly kupiecLR: number | null;
  readonly kupiecPValue: number | null;
  readonly trafficLight: 'GREEN' | 'AMBER' | 'RED' | null;
  readonly status?: 'ok' | 'data_unavailable';
}

interface VaRSuite extends AlmDataShell {
  readonly historical: VaRResult;
  readonly parametric: VaRResult;
  readonly montecarlo: VaRResult;
  readonly backtestResult: BacktestResult;
}

// ─── Static constants ────────────────────────────────────────────────────────

const METHOD_COLORS: Record<VaRResult['method'], string> = {
  historical: '#06b6d4',
  parametric: '#f59e0b',
  montecarlo: '#8b5cf6',
};

const TRAFFIC_STYLES = {
  GREEN: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', Icon: Check },
  AMBER: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   Icon: AlertTriangle },
  RED:   { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    Icon: X },
} as const;

// ─── Runtime validation + demo factory ──────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/**
 * STRUCTURAL-only validation (D1). The data_unavailable / partial-ok shells are
 * valid 200-OK responses with null numerics — we MUST accept them and let the
 * content area render <AlmDataUnavailable> / the gap banner. Throw only when the
 * envelope itself is malformed (not an object, or a method/backtest slot that
 * isn't an object), never on a null numeric — throwing would mis-route the
 * honest gap into the demo fallback and resurrect a fabricated $445M book.
 */
function validateVaRSuite(raw: unknown): VaRSuite {
  if (!isObject(raw)) throw new Error('VaR response must be an object');
  if (!isObject(raw.historical) || !isObject(raw.parametric) || !isObject(raw.montecarlo)) {
    throw new Error('VaR response missing one of historical/parametric/montecarlo');
  }
  if (!isObject(raw.backtestResult)) {
    throw new Error('VaR response missing backtestResult');
  }
  return raw as unknown as VaRSuite;
}

function makeDemoData(conf: 95 | 99, hor: 1 | 10): VaRSuite {
  const scale = hor === 10 ? 3.16 : 1;
  const cScale = conf === 99 ? 1.4 : 1;
  const round = (n: number) => +n.toFixed(2);
  return {
    historical: { method: 'historical', confidenceLevel: conf / 100, horizon: hor, var: round(9.3 * scale * cScale), cvar: round(12.1 * scale * cScale), varPct: 2.09, portfolioValue: 445, status: 'ok' },
    parametric: { method: 'parametric', confidenceLevel: conf / 100, horizon: hor, var: round(8.7 * scale * cScale), cvar: round(10.8 * scale * cScale), varPct: 1.96, portfolioValue: 445, status: 'ok' },
    montecarlo: { method: 'montecarlo', confidenceLevel: conf / 100, horizon: hor, var: round(9.5 * scale * cScale), cvar: round(12.8 * scale * cScale), varPct: 2.13, portfolioValue: 445, status: 'ok' },
    backtestResult: { testDays: 250, exceptions: 3, exceptionRate: 0.012, expectedExceptions: conf === 99 ? 2.5 : 12.5, kupiecLR: 1.85, kupiecPValue: 0.10, trafficLight: 'GREEN', status: 'ok' },
    status: 'ok',
  };
}

// ─── Content component (calls hooks on derived data) ───────────────────────

interface ContentProps {
  readonly data: VaRSuite;
  readonly confidence: 95 | 99;
}

interface MethodRow {
  readonly id: VaRResult['method'];
  readonly label: string;
  readonly result: VaRResult;
}

function VaRContent({ data, confidence }: ContentProps) {
  const { locale } = useTranslation();
  const { gaps, criticalCount, warningCount } = useReportDataGaps(data.gaps);

  const methodRows = useMemo<readonly MethodRow[]>(
    () => [
      { id: 'historical', label: locale === 'es' ? 'Simulación Histórica' : 'Historical Simulation',     result: data.historical },
      { id: 'parametric', label: locale === 'es' ? 'Delta-Normal'          : 'Parametric (Delta-Normal)', result: data.parametric },
      { id: 'montecarlo', label: 'Monte Carlo',                                                          result: data.montecarlo },
    ],
    [data, locale],
  );

  const stripItems = useMemo<readonly MetricStripItem[]>(() => {
    // D1 null-safety: a withheld method's `var`/`cvar` is `null`, never 0. Filter
    // before Math.max — `Math.max(null, 8.7)` coerces null→0 and would silently
    // report a fabricated figure as the max. With every method withheld the max
    // is `null` and the strip renders `—`.
    const present = (xs: readonly (number | null)[]) =>
      xs.filter((x): x is number => x != null);
    const vars  = present([data.historical.var,  data.parametric.var,  data.montecarlo.var]);
    const cvars = present([data.historical.cvar, data.parametric.cvar, data.montecarlo.cvar]);
    const winnerVar  = vars.length  ? Math.max(...vars)  : null;
    const winnerCvar = cvars.length ? Math.max(...cvars) : null;
    // Portfolio value is identical across whichever methods ran; take the first
    // non-null (parametric survives the no-history path).
    const portfolioValue =
      data.historical.portfolioValue ??
      data.parametric.portfolioValue ??
      data.montecarlo.portfolioValue;
    return [
      { key: 'portfolio_value',     label: locale === 'es' ? 'Valor Portafolio' : 'Portfolio Value', unit: 'USD_M', value: portfolioValue },
      { key: 'var',                 label: `${label('var',  locale)} (max)`, value: winnerVar,  unit: 'USD_M' },
      { key: 'cvar',                label: `${label('cvar', locale)} (max)`, value: winnerCvar, unit: 'USD_M' },
      { key: 'exceptions',          value: data.backtestResult.exceptions,         unit: 'count' },
      { key: 'expected_exceptions', value: data.backtestResult.expectedExceptions, unit: 'count' },
      { key: 'kupiec_lr',           value: data.backtestResult.kupiecLR,           unit: 'x' },
      { key: 'kupiec_p_value',      value: data.backtestResult.kupiecPValue,       unit: 'x' },
    ];
  }, [data, locale]);

  const methodColumns = useMemo<readonly DataTableColumn<MethodRow>[]>(() => [
    {
      id: 'method',
      header: locale === 'es' ? 'Método' : 'Method',
      kind: 'custom',
      accessor: (r) => r.label,
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: METHOD_COLORS[r.id] }} aria-hidden />
          {r.label}
        </span>
      ),
    },
    { id: 'var',  headerKey: 'var',  kind: 'number', accessor: (r) => r.result.var,  unit: 'USD_M' },
    { id: 'cvar', headerKey: 'cvar', kind: 'number', accessor: (r) => r.result.cvar, unit: 'USD_M' },
    { id: 'pct',  header: locale === 'es' ? '% Portafolio' : '% Portfolio', kind: 'number', accessor: (r) => r.result.varPct, unit: '%' },
    { id: 'horizon', header: locale === 'es' ? 'Horizonte' : 'Horizon',     kind: 'custom',
      accessor: (r) => r.result.horizon,
      render: (r) => <span className="text-xs text-slate-600">{r.result.horizon}d</span>,
    },
  ], [locale]);

  const compChart = useMemo(
    () => methodRows.map((r) => ({
      method: r.label,
      var: r.result.var,
      cvar: r.result.cvar,
      color: METHOD_COLORS[r.id],
    })),
    [methodRows],
  );

  // D1: empty balance sheet → the backend returned a data_unavailable shell
  // (every numeric null + a CRITICAL gap). Swap the whole content area for the
  // neutral panel + gap manifest. NEVER fall through to the fabricated $445M
  // demo — that path is reserved for genuine network/500 errors (handled by
  // <AlmPage>'s getDemo, not here).
  if (isDataUnavailable(data)) {
    return (
      <AlmDataUnavailable
        gaps={data.gaps}
        message={{
          en: 'No asset balance sheet is loaded. Upload the institution’s assets (balances + durations) to compute Value-at-Risk across the historical, parametric, and Monte Carlo methods.',
          es: 'No hay balance de activos cargado. Cargue los activos de la institución (saldos + duraciones) para calcular el Valor en Riesgo por los métodos histórico, paramétrico y Monte Carlo.',
        }}
      />
    );
  }

  const bt = data.backtestResult;
  // The Kupiec traffic light only exists when the out-of-sample backtest ran
  // (≥500 daily observations). On the common no-history path it is `null` and
  // `TRAFFIC_STYLES[null]` is undefined — render a neutral "withheld" card
  // instead of crashing or showing a fabricated GREEN.
  const tl = bt.trafficLight ? TRAFFIC_STYLES[bt.trafficLight] : null;

  return (
    <>
      {/* D1 partial-ok: real parametric VaR rendered with `—` for the withheld
          historical/Monte Carlo methods; this banner discloses what is missing
          (STALE_SNAPSHOT / INDICATOR_NOT_WIRED WARNING gaps). */}
      {gaps.length > 0 ? (
        <DataGapBanner gaps={gaps} criticalCount={criticalCount} warningCount={warningCount} />
      ) : null}

      <MetricStrip items={stripItems} locale={locale} density="compact" />

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {locale === 'es' ? 'Comparación de Métodos' : 'Method Comparison'}
          {' '}
          <span className="text-slate-300">— VaR {confidence}%</span>
        </p>
        <DataTable rows={methodRows} columns={methodColumns} locale={locale} rowKey={(r) => r.id} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          VaR vs. CVaR — {locale === 'es' ? 'Comparación de Métodos' : 'Method Comparison'}
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={compChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="method" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => `$${v}M`} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
              formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}M`, '']}
            />
            <Bar dataKey="var" name={`VaR ${confidence}%`} radius={[4, 4, 0, 0]}>
              {compChart.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Bar>
            <Bar dataKey="cvar" name="CVaR / ES" fill="#ef4444" radius={[4, 4, 0, 0]} opacity={0.6} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {tl ? (
        <section className={`rounded-xl border p-4 ${tl.bg} ${tl.border}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-950">
                {locale === 'es' ? 'Backtest Kupiec — Semáforo Basel' : 'Kupiec Backtest — Basel Traffic Light'}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {bt.exceptions ?? '—'} {locale === 'es' ? 'excepciones en' : 'exceptions in'} {bt.testDays} {locale === 'es' ? 'días' : 'days'}
                {' '}({locale === 'es' ? 'esperado' : 'expected'}: {bt.expectedExceptions != null ? bt.expectedExceptions.toFixed(1) : '—'})
                {' | '}LR: {bt.kupiecLR != null ? bt.kupiecLR.toFixed(2) : '—'}
                {' | '}p: {bt.kupiecPValue ?? '—'}
              </p>
            </div>
            <div className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${tl.bg} ${tl.text} ${tl.border}`}>
              <tl.Icon className="h-4 w-4" />
              {bt.trafficLight}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4" role="status" aria-live="polite">
          <p className="text-sm font-bold text-slate-700">
            {locale === 'es' ? 'Backtest Kupiec — Semáforo Basel' : 'Kupiec Backtest — Basel Traffic Light'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {locale === 'es'
              ? 'Backtest retenido — historial de mercado insuficiente para una prueba fuera de muestra. Vea las brechas de datos arriba.'
              : 'Backtest withheld — insufficient market history for an out-of-sample test. See the data gaps above.'}
          </p>
        </section>
      )}
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VaRPage() {
  const { locale } = useTranslation();
  const [confidence, setConfidence] = useState<95 | 99>(95);
  const [horizon, setHorizon] = useState<1 | 10>(1);

  return (
    <AlmPage<VaRSuite>
      slug="var"
      iconTint="purple"
      validate={validateVaRSuite}
      queryParams={{ confidence, horizon }}
      deps={[confidence, horizon]}
      getDemo={() => makeDemoData(confidence, horizon)}
      controls={
        <>
          <label className="sr-only" htmlFor="var-confidence">
            {locale === 'es' ? 'Nivel de confianza' : 'Confidence level'}
          </label>
          <select
            id="var-confidence"
            value={confidence}
            onChange={(e) => setConfidence(+e.target.value as 95 | 99)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          >
            <option value={95}>95%</option>
            <option value={99}>99%</option>
          </select>
          <label className="sr-only" htmlFor="var-horizon">
            {locale === 'es' ? 'Horizonte temporal' : 'Time horizon'}
          </label>
          <select
            id="var-horizon"
            value={horizon}
            onChange={(e) => setHorizon(+e.target.value as 1 | 10)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          >
            <option value={1}>1-{locale === 'es' ? 'Día' : 'Day'}</option>
            <option value={10}>10-{locale === 'es' ? 'Días' : 'Day'}</option>
          </select>
        </>
      }
    >
      {(data) => <VaRContent data={data} confidence={confidence} />}
    </AlmPage>
  );
}
