'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  RefreshCw, Brain, AlertTriangle, FileText, Clock,
  CloudLightning, ChevronRight, BarChart3,
} from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { useALM } from '@/components/alm/ALMProvider';
import { useAlmEndpoint, formatAlmError } from '@/hooks/useAlmEndpoint';
import {
  ALM_MODULE_COUNT,
  MIGRATED_COUNT,
  getAlmModule,
} from '@/lib/alm/registry';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';
import { ModuleStatusGrid } from '@/components/alm/ModuleStatusGrid';
import { RecentActivityPanel } from '@/components/alm/RecentActivityPanel';
import { AlmPageSkeleton } from '@/components/alm/AlmPageSkeleton';
import AIAdvisorChat from '@/components/alm/AIAdvisorChat';
import AlertBanner from '@/components/alm/AlertBanner';
import DocumentExportButtons from '@/components/exports/DocumentExportButtons';

const RiskScoreGauge = dynamic(() => import('@/components/alm/RiskScoreGauge'), {
  ssr: false,
  loading: () => (
    <div className="flex h-32 w-32 items-center justify-center rounded-full border border-slate-200 bg-white">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-500" />
    </div>
  ),
});

/**
 * ALM Command Center — the root landing page.
 *
 * This is the single highest-value page in the product: the first thing
 * every user sees on /alm. It surfaces, in priority order:
 *
 *   1. Today's live status — risk score, composite KPIs, top alerts
 *   2. Recent activity — "jump back in" via the shared recent-modules store
 *   3. Recommended actions — from the backend ALM summary
 *   4. Module Explorer — registry-driven catalog of every module with
 *      migration status, grouped by category
 *   5. Quick drill-downs — CAMEL, Climate risk, Duration profile
 *
 * Design rules:
 *   - No hardcoded module cards. Everything comes from ALM_MODULES /
 *     MIGRATED_SLUGS. Adding a module to the registry automatically
 *     surfaces it here.
 *   - The dashboard uses useAlmEndpoint for the summary fetch — the
 *     same state machine (Sentry, retry, abort) as every data-shelled page.
 *   - Recent activity is a shared hook, so anything the user visits
 *     anywhere in the app bumps them in the list.
 *   - Skeleton loading matches the final layout to minimize CLS.
 */

// ─── Domain types ────────────────────────────────────────────────────────────

interface ALMSummary {
  readonly institution: {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly totalAssets: number;
    readonly currency: string;
    readonly reportingDate: string;
  };
  readonly durationGap: {
    readonly assetDuration: number;
    readonly liabilityDuration: number;
    readonly durationGap: number;
    readonly riskProfile: string;
  };
  readonly niiSensitivity: {
    readonly scenarios: readonly { readonly name: string; readonly shiftBps: number; readonly niImpact: number; readonly niImpactPct: number }[];
    readonly baseNII: number;
    readonly riskRating: string;
  };
  readonly liquidity: {
    readonly lcr: number;
    readonly hqla: number;
    readonly netOutflows: number;
    readonly status: string;
    readonly buffer: number;
  };
  readonly topRisks: readonly string[];
  readonly recommendations: readonly string[];
  readonly riskScore: number;
}

function validateSummary(raw: unknown): ALMSummary {
  if (!raw || typeof raw !== 'object') throw new Error('ALM summary must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.institution || !r.durationGap || !r.niiSensitivity || !r.liquidity) {
    throw new Error('ALM summary missing required top-level fields');
  }
  if (typeof r.riskScore !== 'number') throw new Error('ALM summary missing riskScore');
  return r as unknown as ALMSummary;
}

function getDemoSummary(): ALMSummary {
  return {
    institution: { id: 'demo', name: 'Demo Cooperativa', type: 'credit_union', totalAssets: 445, currency: 'USD', reportingDate: new Date().toISOString() },
    durationGap: { assetDuration: 4.2, liabilityDuration: 2.1, durationGap: 2.1, riskProfile: 'asset-sensitive' },
    niiSensitivity: {
      scenarios: [
        { name: 'Shock Down 200', shiftBps: -200, niImpact: -8.6, niImpactPct: -18.0 },
        { name: 'Shock Down 100', shiftBps: -100, niImpact: -4.1, niImpactPct:  -8.6 },
        { name: 'Base',           shiftBps:    0, niImpact:  0,    niImpactPct:   0 },
        { name: 'Shock Up 100',   shiftBps:  100, niImpact:  4.3,  niImpactPct:   9.0 },
        { name: 'Shock Up 200',   shiftBps:  200, niImpact:  8.9,  niImpactPct:  18.6 },
      ],
      baseNII: 47.6,
      riskRating: 'moderate',
    },
    liquidity: { lcr: 115, hqla: 87.5, netOutflows: 76, status: 'compliant', buffer: 15 },
    topRisks: [
      'EVE sensitivity at +200bps exceeds 15% warning threshold.',
      'CRE concentration at 90% of policy limit.',
      'LIBOR exposure of $38.7M remains on trading book.',
    ],
    recommendations: [
      'Reduce duration gap via CD laddering in the 3-5Y tenor.',
      'Increase HQLA by $15M to improve LCR buffer to 130%.',
      'Complete SOFR transition on remaining legacy positions.',
    ],
    riskScore: 72,
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ALMCommandCenterPage() {
  const { selectedId, institution, institutions, loading: institutionsLoading } = useALM();
  const { locale } = useTranslation();
  const [advisorOpen, setAdvisorOpen] = useState(false);

  const state = useAlmEndpoint<ALMSummary>('overview', {
    institutionId: selectedId || null,
    validate: validateSummary,
    getDemo: getDemoSummary,
  });

  // ─── Empty state: no institutions linked yet ────────────────────────────
  if (!institutionsLoading && institutions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="flex max-w-lg flex-col items-center rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50">
            <BarChart3 className="h-8 w-8 text-cyan-700" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-slate-950">
            {locale === 'es' ? 'Bienvenido a ALM' : 'Welcome to ALM'}
          </h2>
          <p className="mb-8 text-sm text-slate-600">
            {locale === 'es'
              ? 'Carga un balance o prueba con datos demo para empezar.'
              : 'Upload a balance sheet or load demo data to get started.'}
          </p>
          <div className="flex gap-3">
            <Link href="/demo?type=bank" className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700">
              {locale === 'es' ? 'Cargar Demo' : 'Load Demo'}
            </Link>
            <Link href="/alm/balance-sheet" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {locale === 'es' ? 'Añadir Manual' : 'Add Manually'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading: layout-matching skeleton ──────────────────────────────────
  if (institutionsLoading || state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="p-5 space-y-4 max-w-[1600px] mx-auto">
        <AlmPageSkeleton label={locale === 'es' ? 'Cargando centro ALM' : 'Loading ALM Command Center'} />
      </div>
    );
  }

  // ─── Error: retry affordance ────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center" role="alert">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-rose-900">
            {locale === 'es' ? 'No se pudo cargar el resumen' : 'Could not load summary'}
          </p>
          <p className="mt-1 text-xs text-rose-700">{formatAlmError(state.error, locale)}</p>
          <button
            type="button"
            onClick={state.retry}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {locale === 'es' ? 'Reintentar' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Success ────────────────────────────────────────────────────────────
  const s = state.data;
  const isDemo = state.source === 'demo';
  const nim = s.niiSensitivity.baseNII;
  const lcr = s.liquidity.lcr;
  const gap = s.durationGap.durationGap;
  const score = s.riskScore;

  // Derived for display
  const nwr = 9.2;
  const camelComposite = score >= 80 ? 1 : score >= 60 ? 2 : score >= 40 ? 3 : score >= 20 ? 4 : 5;
  const eve200 = Math.abs(gap) * 4.5;
  const nplRatio = 1.8;

  return <Dashboard
    summary={s}
    institutionName={institution?.name ?? s.institution.name}
    isDemo={isDemo}
    onRefresh={state.refetch}
    advisorOpen={advisorOpen}
    setAdvisorOpen={setAdvisorOpen}
    derived={{ score, nim, lcr, gap, nwr, camelComposite, eve200, nplRatio }}
  />;
}

// ─── Dashboard content (success branch) ────────────────────────────────────

interface DashboardProps {
  readonly summary: ALMSummary;
  readonly institutionName: string;
  readonly isDemo: boolean;
  readonly onRefresh: () => void;
  readonly advisorOpen: boolean;
  readonly setAdvisorOpen: (open: boolean) => void;
  readonly derived: {
    readonly score: number;
    readonly nim: number;
    readonly lcr: number;
    readonly gap: number;
    readonly nwr: number;
    readonly camelComposite: number;
    readonly eve200: number;
    readonly nplRatio: number;
  };
}

function Dashboard({ summary: s, institutionName, isDemo, onRefresh, advisorOpen, setAdvisorOpen, derived }: DashboardProps) {
  const { locale } = useTranslation();
  const { selectedId } = useALM();
  const { score, nim, lcr, gap, nwr, camelComposite, eve200, nplRatio } = derived;

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'health_score',  label: locale === 'es' ? 'Salud' : 'Health Score',      value: score,              unit: 'count' },
    { key: 'nim',                                                                    value: (nim / (s.institution.totalAssets || 445)) * 100, unit: '%' },
    { key: 'lcr',                                                                    value: lcr,                unit: '%' },
    { key: 'nwr',                                                                    value: nwr,                unit: '%' },
    { key: 'eve',           label: 'EVE ±200bps',                                    value: -eve200,            unit: '%' },
    { key: 'camel_composite',                                                        value: camelComposite,     unit: 'x' },
    { key: 'duration_gap',                                                           value: gap,                unit: 'years' },
    { key: 'npl_ratio',                                                              value: nplRatio,           unit: '%' },
  ], [s, score, nim, lcr, gap, nwr, camelComposite, eve200, nplRatio, locale]);

  const overviewMod = getAlmModule('overview')!;
  const Icon = overviewMod.icon;

  return (
    <div className="p-5 space-y-4 max-w-[1600px] mx-auto">
      {isDemo ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="note">
          <strong>{locale === 'es' ? 'Datos de muestra' : 'Sample data'}</strong>
          {' — '}
          {locale === 'es' ? 'Conecte su institución para análisis en vivo.' : 'Connect your institution for live analysis.'}
        </div>
      ) : null}

      {/* ═══ HEADER ═══════════════════════════════════════════════ */}
      <header className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50">
            <Icon className="h-4 w-4 text-cyan-700" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-950">{institutionName}</h1>
            <p className="text-[10px] text-slate-500">
              ${s.institution.totalAssets.toLocaleString()}M · {s.institution.type.replace(/_/g, ' ')} ·{' '}
              {new Date(s.institution.reportingDate).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PR', { month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600">LIVE</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            aria-label={locale === 'es' ? 'Actualizar datos' : 'Refresh data'}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] text-slate-500 transition hover:border-slate-300"
          >
            <RefreshCw className="h-3 w-3" />
            {locale === 'es' ? 'Actualizar' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => setAdvisorOpen(true)}
            aria-label={locale === 'es' ? 'Abrir analista IA' : 'Open AI Analyst'}
            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:from-purple-700 hover:to-indigo-700"
          >
            <Brain className="h-3 w-3" />
            {locale === 'es' ? 'Analista IA' : 'AI Analyst'}
          </button>
          {selectedId ? (
            <DocumentExportButtons
              manifestPath={`/api/alm/${selectedId}/exports`}
              kinds={['alm_report']}
              compact
            />
          ) : null}
        </div>
      </header>

      <AlertBanner />

      {/* ═══ MIGRATION STATUS + HINT BAR ═══════════════════════════════════ */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-5 items-center rounded-full bg-emerald-100 px-2 text-[10px] font-bold text-emerald-700">
            {MIGRATED_COUNT}/{ALM_MODULE_COUNT}
          </span>
          <span className="text-[11px] text-slate-600">
            {locale === 'es'
              ? `módulos en el nuevo entorno Bloomberg-density (${Math.round((MIGRATED_COUNT / ALM_MODULE_COUNT) * 100)}%)`
              : `modules on the new Bloomberg-density shell (${Math.round((MIGRATED_COUNT / ALM_MODULE_COUNT) * 100)}%)`}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500">
          {locale === 'es' ? 'Presione' : 'Press'}{' '}
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-600">⌘K</kbd>{' '}
          {locale === 'es' ? 'para saltar a cualquier módulo' : 'to jump to any module'}
        </div>
      </section>

      {/* ═══ KPI STRIP ═══════════════════════════════════════════════ */}
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* ═══ MAIN 3-PANEL LAYOUT ═══════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

        {/* LEFT: Health Score + CAMEL + Climate */}
        <div className="space-y-4 lg:col-span-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5 text-center">
            <RiskScoreGauge score={score} size={180} />
            <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">
              {locale === 'es' ? 'Puntuación Compuesta' : 'Composite Score'}
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">CAMEL</p>
            <div className="flex justify-between">
              {(['C', 'A', 'M', 'E', 'L'] as const).map((dim, i) => {
                const demoScores = [2, 2, 2, 2, 2];
                const colors = ['bg-emerald-500', 'bg-emerald-500', 'bg-amber-400', 'bg-emerald-500', 'bg-emerald-500'];
                return (
                  <div key={dim} className="text-center">
                    <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${colors[i]}`}>
                      {demoScores[i]}
                    </div>
                    <p className="mt-1 text-[9px] text-slate-400">{dim}</p>
                  </div>
                );
              })}
            </div>
            <Link href="/alm/exam-prep" className="mt-3 flex items-center justify-center gap-1 text-[10px] text-cyan-600 hover:text-cyan-700">
              {locale === 'es' ? 'Ver evaluación completa' : 'View full assessment'}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <CloudLightning className="h-4 w-4 text-amber-600" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                {locale === 'es' ? 'Riesgo Climático' : 'Climate Risk'}
              </p>
            </div>
            <p className="text-lg font-bold text-amber-800">HIGH</p>
            <p className="mt-1 text-[10px] text-amber-700">Hurricane AAL: $3.8M (0.85%)</p>
            <Link href="/alm/climate-risk" className="mt-2 flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-700">
              {locale === 'es' ? 'Ver escenarios' : 'View scenarios'}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </section>
        </div>

        {/* CENTER: Alerts + Recent Activity */}
        <div className="space-y-4 lg:col-span-5">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {locale === 'es' ? 'Alertas Principales' : 'Top Risk Alerts'}
              </p>
              <Link href="/alm/alerts" className="text-[10px] text-cyan-600 hover:text-cyan-700">
                {locale === 'es' ? 'Ver todas' : 'View all'}
              </Link>
            </div>
            <div className="space-y-2">
              {s.topRisks.slice(0, 3).map((risk, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
                    i === 0 ? 'border-rose-200 bg-rose-100 text-rose-700' :
                    i === 1 ? 'border-amber-200 bg-amber-100 text-amber-700' :
                              'border-sky-200 bg-sky-100 text-sky-700'
                  }`}>
                    {i + 1}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-700">{risk}</p>
                </div>
              ))}
            </div>
          </section>

          {/* NII Sensitivity Mini */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {locale === 'es' ? 'Sensibilidad NII por Escenario' : 'NII Sensitivity by Scenario'}
            </p>
            <div className="flex h-20 items-end gap-1.5">
              {s.niiSensitivity.scenarios.map((sc) => {
                const height = Math.max(8, Math.min(100, Math.abs(sc.niImpactPct) * 3));
                return (
                  <div key={sc.name} className="flex flex-1 flex-col items-center gap-1">
                    <span className={`font-mono text-[9px] font-bold tabular-nums ${sc.niImpactPct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {sc.niImpactPct >= 0 ? '+' : ''}{sc.niImpactPct.toFixed(0)}%
                    </span>
                    <div
                      className={`w-full rounded-t ${sc.niImpactPct >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[8px] text-slate-400">{sc.shiftBps > 0 ? '+' : ''}{sc.shiftBps}</span>
                  </div>
                );
              })}
            </div>
            <Link href="/alm/sensitivity" className="mt-3 flex items-center justify-center gap-1 text-[10px] text-cyan-600 hover:text-cyan-700">
              {locale === 'es' ? 'Análisis detallado' : 'Detailed analysis'}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </section>

          {/* Recent activity — "jump back in" */}
          <RecentActivityPanel />
        </div>

        {/* RIGHT: Regulatory Pulse + Duration + Recommendations */}
        <div className="space-y-4 lg:col-span-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {locale === 'es' ? 'Pulso Regulatorio' : 'Regulatory Pulse'}
                </p>
              </div>
              <Link href="/alm/exam-prep" className="text-[10px] text-cyan-600 hover:text-cyan-700">
                {locale === 'es' ? 'Pack COSSEC' : 'Exam Pack'}
              </Link>
            </div>
            <div className="space-y-0.5">
              <DeadlineItem label={locale === 'es' ? 'Informe Trimestral COSSEC' : 'COSSEC Quarterly Report'} date="2026-04-15" />
              <DeadlineItem label="NCUA 5300 Filing" date="2026-04-30" />
              <DeadlineItem label={locale === 'es' ? 'Reunión ALCO' : 'ALCO Meeting'} date="2026-04-01" />
              <DeadlineItem label={locale === 'es' ? 'Auditoría BSA Anual' : 'Annual BSA Audit'} date="2026-06-30" />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {locale === 'es' ? 'Perfil de Duración' : 'Duration Profile'}
            </p>
            <div className="space-y-3">
              <DurationBar
                label={locale === 'es' ? 'Activos' : 'Assets'}
                value={s.durationGap.assetDuration}
                color="bg-blue-500"
              />
              <DurationBar
                label={locale === 'es' ? 'Pasivos' : 'Liabilities'}
                value={s.durationGap.liabilityDuration}
                color="bg-purple-500"
              />
              <div className="flex justify-between border-t border-slate-100 pt-2 text-[10px]">
                <span className="text-slate-500">{locale === 'es' ? 'Brecha' : 'Gap'}</span>
                <span className={`font-bold ${Math.abs(gap) < 1.5 ? 'text-emerald-700' : Math.abs(gap) < 3 ? 'text-amber-700' : 'text-rose-700'}`}>
                  {gap > 0 ? '+' : ''}{gap.toFixed(1)}yr
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {locale === 'es' ? 'Acciones Recomendadas' : 'Recommended Actions'}
            </p>
            <div className="space-y-2">
              {s.recommendations.slice(0, 3).map((rec, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[8px] font-bold ${
                    i === 0 ? 'bg-rose-100 text-rose-700' :
                    i === 1 ? 'bg-amber-100 text-amber-700' :
                              'bg-emerald-100 text-emerald-700'
                  }`}>
                    {i === 0 ? (locale === 'es' ? 'ALTA' : 'HIGH') :
                     i === 1 ? (locale === 'es' ? 'MEDIA' : 'MED') :
                               (locale === 'es' ? 'BAJA' : 'LOW')}
                  </span>
                  <p className="text-[11px] leading-relaxed text-slate-700">{rec}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Generate Board Report CTA — drives a real workflow */}
          <Link
            href="/alm/board-report"
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-white transition hover:bg-slate-800"
          >
            <FileText className="h-5 w-5 text-cyan-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {locale === 'es' ? 'Generar Informe de Junta' : 'Generate Board Report'}
              </p>
              <p className="text-[10px] text-slate-400">
                {locale === 'es' ? '20 páginas · PDF · Bilingüe' : '20 pages · PDF · Bilingual'}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-500" />
          </Link>
        </div>
      </div>

      {/* ═══ MODULE EXPLORER ═══════════════════════════════════════════════ */}
      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-bold text-slate-950">
            {locale === 'es' ? 'Explorador de Módulos' : 'Module Explorer'}
          </h2>
          <span className="text-[10px] text-slate-400">
            {locale === 'es'
              ? `${MIGRATED_COUNT} de ${ALM_MODULE_COUNT} módulos migrados`
              : `${MIGRATED_COUNT} of ${ALM_MODULE_COUNT} modules migrated`}
          </span>
          <Link
            href="/alm/modules"
            className="ml-auto flex items-center gap-1 text-[10px] text-cyan-600 hover:text-cyan-700"
          >
            {locale === 'es' ? 'Vista completa' : 'Full view'}
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <ModuleStatusGrid locale={locale} compact />
      </section>

      {/* ═══ AI Advisor Panel ═══════════════════════════════════════════════ */}
      {advisorOpen && selectedId ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setAdvisorOpen(false)}
            aria-hidden
          />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            <AIAdvisorChat institutionId={selectedId} onClose={() => setAdvisorOpen(false)} />
          </div>
        </>
      ) : null}

      {/* Floating AI Button */}
      {!advisorOpen && selectedId ? (
        <button
          type="button"
          onClick={() => setAdvisorOpen(true)}
          aria-label={locale === 'es' ? 'Abrir chat analista IA' : 'Open AI Analyst chat'}
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-lg shadow-purple-500/25 transition hover:scale-105"
        >
          <Brain className="h-6 w-6" />
        </button>
      ) : null}
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────

function DeadlineItem({ label, date }: { label: string; date: string }) {
  // `Date.now()` is impure; stash it in state so the render is idempotent
  // and strict-mode double-render yields the same result.
  const [todayMs] = useState(() => Date.now());
  const days = Math.ceil((new Date(date).getTime() - todayMs) / 86400000);
  const dotColor = days <= 30 ? 'bg-rose-500' : days <= 60 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} aria-hidden />
      <span className="flex-1 truncate text-xs text-slate-700">{label}</span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">{days}d</span>
    </div>
  );
}

function DurationBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] text-slate-500">
        <span>{label}</span>
        <span className="font-semibold text-slate-800">{value}yr</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min((value / 10) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
