'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, X, Clock, FileText,
  Download, ChevronDown, ChevronUp, BookOpen, Lightbulb,
} from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { AlmPage } from '@/components/alm/AlmPage';
import { MetricStrip, type MetricStripItem } from '@/components/density/MetricStrip';

/**
 * COSSEC/NCUA Exam Prep Dashboard — migrated to AlmPage shell.
 *
 * Keeps bespoke CAMEL / readiness gauges and findings/actions/checklist
 * sections; only the outer chrome (header, loading, error, demo banner)
 * and the top KPI strip are replaced. Further density passes can migrate
 * the findings table to <DataTable> when time permits.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface CAMELComponent {
  readonly component: string;
  readonly componentEs: string;
  readonly score: number;
  readonly rating: string;
  readonly ratingEs: string;
  readonly detail: string;
  readonly detailEs: string;
}

interface CriticalFinding {
  readonly id: string;
  readonly severity: 'critical' | 'high' | 'medium';
  readonly finding: string;
  readonly findingEs: string;
  readonly examinerNote: string;
  readonly examinerNoteEs: string;
  readonly status: 'open' | 'in_progress' | 'closed';
  readonly targetDate: string;
}

interface RecommendedAction {
  readonly id: string;
  readonly priority: number;
  readonly action: string;
  readonly actionEs: string;
  readonly impact: string;
  readonly impactEs: string;
  readonly deadline: string;
  readonly responsible: string;
}

interface DocumentItem {
  readonly id: string;
  readonly document: string;
  readonly documentEs: string;
  readonly category: string;
  readonly ready: boolean;
  readonly lastUpdated: string | null;
}

interface ExamPrepData {
  readonly camel: {
    readonly components: readonly CAMELComponent[];
    readonly composite: number;
    readonly compositeRating: string;
    readonly compositeRatingEs: string;
    readonly examReadiness: string;
  };
  readonly readinessScore: number;
  readonly criticalFindings: readonly CriticalFinding[];
  readonly recommendedActions: readonly RecommendedAction[];
  readonly documentChecklist: readonly DocumentItem[];
}

// ─── Styling ────────────────────────────────────────────────────────────────

const CAMEL_COLORS: Record<number, { bg: string; text: string; border: string; gradient: string }> = {
  1: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300', gradient: '#10b981' },
  2: { bg: 'bg-cyan-100',    text: 'text-cyan-700',    border: 'border-cyan-300',    gradient: '#06b6d4' },
  3: { bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-amber-300',   gradient: '#f59e0b' },
  4: { bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-orange-300',  gradient: '#f97316' },
  5: { bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-rose-300',    gradient: '#ef4444' },
};

const SEVERITY_STYLES: Record<CriticalFinding['severity'], { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200' },
  high:     { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  medium:   { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
};

// ─── Validation + demo ─────────────────────────────────────────────────────

function validateExamPrep(raw: unknown): ExamPrepData {
  if (!raw || typeof raw !== 'object') throw new Error('Exam-prep response must be an object');
  const r = raw as Record<string, unknown>;
  if (!r.camel || typeof r.camel !== 'object') throw new Error('Exam-prep: missing camel');
  if (typeof r.readinessScore !== 'number') throw new Error('Exam-prep: missing readinessScore');
  if (!Array.isArray(r.criticalFindings)) throw new Error('Exam-prep: criticalFindings must be array');
  return r as unknown as ExamPrepData;
}

function getDemo(): ExamPrepData {
  return {
    camel: {
      components: [
        { component: 'Capital',       componentEs: 'Capital',             score: 2, rating: 'Satisfactory', ratingEs: 'Satisfactorio', detail: 'NWR 9.2% — Adequately capitalized.', detailEs: 'NWR 9.2% — Adecuadamente capitalizada.' },
        { component: 'Asset Quality', componentEs: 'Calidad de Activos',  score: 2, rating: 'Satisfactory', ratingEs: 'Satisfactorio', detail: 'NPL: 1.8%, Classified: 3.6%.',         detailEs: 'NPL: 1.8%, Clasificados: 3.6%.' },
        { component: 'Management',    componentEs: 'Administración',      score: 3, rating: 'Fair',         ratingEs: 'Regular',       detail: 'Governance: 18/24 items complete.',    detailEs: 'Gobernanza: 18/24 ítems completos.' },
        { component: 'Earnings',      componentEs: 'Rentabilidad',        score: 2, rating: 'Satisfactory', ratingEs: 'Satisfactorio', detail: 'ROA: 0.82%, Expense: 78%.',            detailEs: 'ROA: 0.82%, Gastos: 78%.' },
        { component: 'Liquidity',     componentEs: 'Liquidez',            score: 2, rating: 'Satisfactory', ratingEs: 'Satisfactorio', detail: 'LCR: 115%, NSFR: 108%.',               detailEs: 'LCR: 115%, NSFR: 108%.' },
      ],
      composite: 2,
      compositeRating: 'Satisfactory',
      compositeRatingEs: 'Satisfactorio',
      examReadiness: 'NEEDS_WORK',
    },
    readinessScore: 72,
    criticalFindings: [
      { id: 'cf1', severity: 'critical', finding: 'CRE concentration exceeds 300% of capital without board-approved limits', findingEs: 'Concentración CRE excede 300% del capital sin límites aprobados por junta',
        examinerNote: 'NCUA Letter 10-CU-13 requires documented concentration limits.', examinerNoteEs: 'Carta NCUA 10-CU-13 requiere límites de concentración documentados.',
        status: 'open', targetDate: '2026-04-30' },
      { id: 'cf2', severity: 'critical', finding: 'IRR model validation overdue by 14 months', findingEs: 'Validación del modelo IRR vencida por 14 meses',
        examinerNote: 'NCUA §741.3(b)(5) — Independent validation required annually.', examinerNoteEs: 'NCUA §741.3(b)(5) — Validación independiente anual requerida.',
        status: 'in_progress', targetDate: '2026-05-15' },
      { id: 'cf3', severity: 'high', finding: 'BSA/AML training records incomplete for 4 employees', findingEs: 'Registros de capacitación BSA/AML incompletos para 4 empleados',
        examinerNote: 'BSA requires documented training for all applicable staff.', examinerNoteEs: 'BSA requiere capacitación documentada.',
        status: 'open', targetDate: '2026-04-15' },
      { id: 'cf4', severity: 'high', finding: 'CECL methodology documentation lacks vintage analysis support', findingEs: 'Documentación CECL carece de soporte de análisis vintage',
        examinerNote: 'ASU 2016-13 requires well-documented methodology.', examinerNoteEs: 'ASU 2016-13 requiere metodología bien documentada.',
        status: 'in_progress', targetDate: '2026-06-30' },
      { id: 'cf5', severity: 'medium', finding: 'Board minutes do not reflect ALM report discussion', findingEs: 'Actas de junta no reflejan discusión de informe ALM',
        examinerNote: 'Board oversight of IRR is a key Management rating driver.', examinerNoteEs: 'Supervisión junta sobre IRR es factor clave.',
        status: 'open', targetDate: '2026-05-30' },
      { id: 'cf6', severity: 'medium', finding: 'Contingency Funding Plan not tested in past 12 months', findingEs: 'PCL no probado en los últimos 12 meses',
        examinerNote: 'Liquidity risk management requires periodic CFP testing.', examinerNoteEs: 'Gestión liquidez requiere pruebas periódicas.',
        status: 'closed', targetDate: '2026-03-31' },
    ],
    recommendedActions: [
      { id: 'ra1', priority: 1, action: 'Document and get board approval for CRE concentration limits', actionEs: 'Documentar límites concentración CRE', impact: 'Resolves critical finding', impactEs: 'Resuelve hallazgo crítico', deadline: '2026-04-30', responsible: 'CFO' },
      { id: 'ra2', priority: 2, action: 'Engage independent firm for IRR model validation',             actionEs: 'Contratar firma para validación IRR', impact: 'Addresses 14-month overdue validation', impactEs: 'Aborda validación vencida',          deadline: '2026-05-15', responsible: 'ALM Analyst' },
      { id: 'ra3', priority: 3, action: 'Complete BSA training for remaining 4 staff members',          actionEs: 'Completar capacitación BSA',          impact: 'Eliminates BSA gap before exam',      impactEs: 'Elimina brecha BSA',                deadline: '2026-04-15', responsible: 'Compliance Officer' },
      { id: 'ra4', priority: 4, action: 'Update CECL documentation with vintage analysis methodology',  actionEs: 'Actualizar documentación CECL',       impact: 'Strengthens credit loss documentation', impactEs: 'Fortalece documentación',          deadline: '2026-06-30', responsible: 'Credit Risk Manager' },
      { id: 'ra5', priority: 5, action: 'Add ALM discussion as standing agenda for board meetings',     actionEs: 'Añadir ALM a agenda permanente',      impact: 'Demonstrates active board oversight', impactEs: 'Demuestra supervisión activa',       deadline: '2026-05-30', responsible: 'Board Secretary' },
    ],
    documentChecklist: [
      { id: 'd1',  document: 'ALM Policy',                         documentEs: 'Política ALM',                          category: 'Policy',     ready: true,  lastUpdated: '2026-01-15' },
      { id: 'd2',  document: 'IRR Policy',                         documentEs: 'Política IRR',                          category: 'Policy',     ready: true,  lastUpdated: '2026-02-01' },
      { id: 'd3',  document: 'Investment Policy',                  documentEs: 'Política de Inversiones',               category: 'Policy',     ready: true,  lastUpdated: '2025-11-20' },
      { id: 'd4',  document: 'Loan Policy',                        documentEs: 'Política de Préstamos',                 category: 'Policy',     ready: true,  lastUpdated: '2025-12-10' },
      { id: 'd5',  document: 'BSA/AML Policy',                     documentEs: 'Política BSA/AML',                      category: 'Compliance', ready: true,  lastUpdated: '2026-01-05' },
      { id: 'd6',  document: 'Contingency Funding Plan',           documentEs: 'Plan Contingencia Liquidez',            category: 'Liquidity',  ready: true,  lastUpdated: '2026-03-01' },
      { id: 'd7',  document: 'CECL Methodology Documentation',     documentEs: 'Documentación Metodología CECL',        category: 'Credit',     ready: false, lastUpdated: null },
      { id: 'd8',  document: 'Board Minutes (12 months)',          documentEs: 'Actas Junta (12 meses)',                category: 'Governance', ready: true,  lastUpdated: '2026-03-15' },
      { id: 'd9',  document: 'ALM Committee Minutes',              documentEs: 'Actas Comité ALM',                      category: 'Governance', ready: true,  lastUpdated: '2026-03-10' },
      { id: 'd10', document: 'Independent ALM Audit Report',       documentEs: 'Informe Auditoría ALM Independiente',   category: 'Audit',      ready: true,  lastUpdated: '2025-09-30' },
      { id: 'd11', document: 'IRR Model Validation Report',        documentEs: 'Informe Validación Modelo IRR',         category: 'Audit',      ready: false, lastUpdated: null },
      { id: 'd12', document: 'Stress Test Results',                documentEs: 'Resultados Pruebas Estrés',             category: 'Risk',       ready: true,  lastUpdated: '2026-03-20' },
      { id: 'd13', document: 'Capital Plan with Triggers',         documentEs: 'Plan Capital con Disparadores',         category: 'Capital',    ready: true,  lastUpdated: '2026-01-20' },
      { id: 'd14', document: 'CRE Concentration Limit Docs',       documentEs: 'Documentación Límites CRE',             category: 'Credit',     ready: false, lastUpdated: null },
      { id: 'd15', document: 'BSA Training Records (all staff)',   documentEs: 'Registros Capacitación BSA',            category: 'Compliance', ready: false, lastUpdated: null },
    ],
  };
}

// ─── Gauge subcomponents ─────────────────────────────────────────────────────

function CAMELGauge({ score, label, size = 76 }: { score: number; label: string; size?: number }) {
  const color = CAMEL_COLORS[score] ?? CAMEL_COLORS[3]!;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = ((6 - score) / 5) * 100;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={6} />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color.gradient} strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-2xl font-black ${color.text}`}>{score}</span>
        </div>
      </div>
      <span className="max-w-[80px] text-center text-[10px] font-bold uppercase tracking-wider leading-tight text-slate-500">
        {label}
      </span>
    </div>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

function ExamPrepContent({ data }: { data: ExamPrepData }) {
  const { locale } = useTranslation();
  const [expandedFindings, setExpandedFindings] = useState(false);
  const [docFilter, setDocFilter] = useState<'all' | 'ready' | 'missing'>('all');
  const t = useCallback((en: string, es: string) => (locale === 'en' ? en : es), [locale]);

  const readyDocs = data.documentChecklist.filter((d) => d.ready).length;
  const totalDocs = data.documentChecklist.length;
  const openFindings = data.criticalFindings.filter((f) => f.status !== 'closed').length;

  const filteredDocs = useMemo(() => {
    if (docFilter === 'ready')   return data.documentChecklist.filter((d) => d.ready);
    if (docFilter === 'missing') return data.documentChecklist.filter((d) => !d.ready);
    return data.documentChecklist;
  }, [data, docFilter]);

  const stripItems = useMemo<readonly MetricStripItem[]>(() => [
    { key: 'readiness_score', label: t('Exam Readiness', 'Preparación'),    value: data.readinessScore,     unit: '%' },
    { key: 'camel_composite', label: t('CAMEL Composite', 'CAMEL Compuesto'), value: data.camel.composite,   unit: 'x' },
    { key: 'open_findings',   label: t('Open Findings',  'Hallazgos Abiertos'), value: openFindings,          unit: 'count' },
    { key: 'total_findings',  label: t('Total Findings', 'Hallazgos Totales'), value: data.criticalFindings.length, unit: 'count' },
    { key: 'ready_docs',      label: t('Documents Ready','Docs Listos'),     value: readyDocs,               unit: 'count' },
    { key: 'missing_docs',    label: t('Documents Missing','Docs Faltantes'),value: totalDocs - readyDocs,   unit: 'count' },
  ], [data, readyDocs, totalDocs, openFindings, t]);

  return (
    <>
      <MetricStrip items={stripItems} locale={locale} density="compact" />

      {/* CAMEL breakdown */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('CAMEL Score Breakdown', 'Desglose CAMEL')}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{t('Composite', 'Compuesto')}:</span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-black ${CAMEL_COLORS[data.camel.composite]?.bg ?? 'bg-slate-100'} ${CAMEL_COLORS[data.camel.composite]?.text ?? 'text-slate-700'}`}>
              {data.camel.composite}
            </span>
            <span className="text-xs font-semibold text-slate-700">
              {locale === 'es' ? data.camel.compositeRatingEs : data.camel.compositeRating}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-around">
          {data.camel.components.map((c) => (
            <CAMELGauge
              key={c.component}
              score={c.score}
              label={locale === 'es' ? c.componentEs : c.component}
            />
          ))}
        </div>

        <div className="mt-5 grid grid-cols-5 gap-2">
          {data.camel.components.map((c) => {
            const color = CAMEL_COLORS[c.score] ?? CAMEL_COLORS[3]!;
            return (
              <div key={`${c.component}-detail`} className={`rounded-lg border p-2.5 ${color.bg} ${color.border}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wider opacity-70 ${color.text}`}>
                  {locale === 'es' ? c.ratingEs : c.rating}
                </p>
                <p className="mt-1 text-[10px] leading-tight text-slate-600">
                  {locale === 'es' ? c.detailEs : c.detail}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Critical findings */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t('Critical Findings', 'Hallazgos Críticos')}
            </p>
            {openFindings > 0 ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                {openFindings} {t('open', 'abiertos')}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setExpandedFindings((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-700"
            aria-expanded={expandedFindings}
          >
            {expandedFindings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expandedFindings ? t('Collapse', 'Colapsar') : t('Expand', 'Expandir')}
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {[t('Severity', 'Severidad'), t('Finding', 'Hallazgo'), t('Target', 'Límite'), t('Status', 'Estado')].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(expandedFindings ? data.criticalFindings : data.criticalFindings.slice(0, 4)).map((f) => {
              const sev = SEVERITY_STYLES[f.severity];
              return (
                <tr key={f.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${sev.bg} ${sev.text} ${sev.border}`}>
                      {f.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-700">{locale === 'es' ? f.findingEs : f.finding}</td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-500">{f.targetDate}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      f.status === 'closed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                      f.status === 'in_progress' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                      'border-rose-200 bg-rose-50 text-rose-700'
                    }`}>
                      {f.status === 'closed' ? <Check className="h-2.5 w-2.5" /> :
                       f.status === 'in_progress' ? <Clock className="h-2.5 w-2.5" /> :
                       <AlertTriangle className="h-2.5 w-2.5" />}
                      {f.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Recommended actions */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('Recommended Actions', 'Acciones Recomendadas')}
          </p>
        </div>
        <div className="space-y-2">
          {data.recommendedActions.map((a, idx) => (
            <div key={a.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/40 p-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-black text-blue-700">
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800">{locale === 'es' ? a.actionEs : a.action}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t('Impact', 'Impacto')}: {locale === 'es' ? a.impactEs : a.impact}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-medium text-slate-500">{a.deadline}</p>
                <p className="text-[10px] text-slate-400">{a.responsible}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Document checklist */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-slate-500" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t('Document Checklist', 'Lista de Documentos')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">{readyDocs}/{totalDocs}</span>
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              {(['all', 'ready', 'missing'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setDocFilter(f)}
                  className={`px-2.5 py-1 text-[10px] font-semibold transition ${
                    docFilter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {f === 'all' ? t('All', 'Todos') : f === 'ready' ? t('Ready', 'Listos') : t('Missing', 'Faltan')}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocs.map((d) => (
            <div
              key={d.id}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                d.ready ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/50'
              }`}
            >
              {d.ready
                ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                : <X     className="h-3.5 w-3.5 shrink-0 text-rose-500" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-slate-700">{locale === 'es' ? d.documentEs : d.document}</p>
                <p className="text-[10px] text-slate-400">{d.category}{d.lastUpdated ? ` · ${d.lastUpdated}` : ''}</p>
              </div>
              <FileText className="h-3 w-3 shrink-0 text-slate-300" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default function ExamPrepPage() {
  const { locale } = useTranslation();

  return (
    <AlmPage<ExamPrepData>
      slug="exam-prep"
      iconTint="blue"
      validate={validateExamPrep}
      getDemo={getDemo}
      controls={
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
        >
          <Download className="h-3.5 w-3.5" />
          {locale === 'es' ? 'Pack Examen' : 'Exam Pack'}
        </button>
      }
    >
      {(data) => <ExamPrepContent data={data} />}
    </AlmPage>
  );
}
