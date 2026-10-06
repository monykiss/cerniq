'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Lock, Loader2 } from 'lucide-react';
import DocumentExportButtons from '@/components/exports/DocumentExportButtons';
import { useTranslation } from '@/lib/i18n';
import { getFeature, type SubscriptionTier, type FeatureKey } from '@/lib/features';
import type { PortalWorkflowState, PortalOverviewJob } from '@/lib/portal-overview';

interface Deliverable {
  id: string;
  nameEn: string;
  nameEs: string;
  detailEn: string;
  detailEs: string;
  languages?: string;
  section: 'document' | 'analysis' | 'premium';
  featureKey?: FeatureKey;
}

const DELIVERABLES: Deliverable[] = [
  { id: 'alm_report', nameEn: 'ALM Report (PDF)', nameEs: 'Informe ALM (PDF)', detailEn: '14-page bilingual regulatory analysis', detailEs: 'Análisis regulatorio bilingüe — 14 págs.', languages: 'ES / EN', section: 'document' },
  { id: 'alco_pack', nameEn: 'ALCO Board Pack', nameEs: 'Paquete ALCO', detailEn: '8-page executive summary for board meetings', detailEs: 'Resumen ejecutivo — 8 págs. para junta', languages: 'ES / EN', section: 'document' },
  { id: 'exec_summary', nameEn: 'Executive Summary', nameEs: 'Resumen Ejecutivo', detailEn: 'Key findings · risk scores · action items', detailEs: 'Hallazgos · puntuaciones de riesgo · acciones', section: 'analysis' },
  { id: 'balance_sheet', nameEn: 'Balance Sheet Overview', nameEs: 'Balance General', detailEn: 'Asset/liability composition & profile', detailEs: 'Composición de activos y pasivos', section: 'analysis' },
  { id: 'duration_gap', nameEn: 'Duration Gap Analysis', nameEs: 'Brecha de Duración', detailEn: 'Modified & Macaulay by maturity bucket', detailEs: 'Duración por tramo de vencimiento', section: 'analysis' },
  { id: 'nii', nameEn: 'NII Sensitivity', nameEs: 'Sensibilidad del NII', detailEn: '±100 / 200 / 300bp parallel rate shocks', detailEs: 'Choques paralelos ±100/200/300pb', section: 'analysis' },
  { id: 'eve', nameEn: 'Economic Value of Equity', nameEs: 'Valor Económico del Patrimonio', detailEn: 'PV-based equity impact under rate stress', detailEs: 'Impacto PV patrimonial bajo estrés', section: 'analysis' },
  { id: 'lcr', nameEn: 'Liquidity Coverage Ratio', nameEs: 'Ratio Cobertura de Liquidez', detailEn: 'Basel III LCR — L1 / L2A / L2B HQLA', detailEs: 'LCR Basilea III — HQLA L1/2A/2B', section: 'analysis' },
  { id: 'nsfr', nameEn: 'Net Stable Funding Ratio', nameEs: 'Ratio Financiamiento Estable', detailEn: 'ASF vs RSF funding stability', detailEs: 'Estabilidad ASF vs RSF', section: 'analysis' },
  { id: 'dv01', nameEn: 'Basis Point Value (DV01)', nameEs: 'Valor Punto Base (DV01)', detailEn: 'Per-instrument & net 1bp sensitivity', detailEs: 'Sensibilidad neta por instrumento', section: 'analysis' },
  { id: 'monte_carlo', nameEn: 'Monte Carlo Stress Test', nameEs: 'Prueba Monte Carlo', detailEn: '1,000 Vasicek paths — P5 / P25 / P50 / P75 / P95', detailEs: '1,000 trayectorias Vasicek P5–P95', section: 'analysis' },
  { id: 'cossec', nameEn: 'COSSEC Compliance', nameEs: 'Cumplimiento COSSEC', detailEn: '12 regulatory ratios vs pass / warn / fail', detailEs: '12 ratios regulatorios vs umbrales', section: 'analysis' },
  { id: 'recommendations', nameEn: 'Board Recommendations', nameEs: 'Recomendaciones Junta', detailEn: 'Actionable policy & risk mitigation', detailEs: 'Orientación accionable de políticas', section: 'analysis' },
  { id: 'trends', nameEn: 'Quarterly Trend Monitoring', nameEs: 'Monitoreo Trimestral', detailEn: 'Cross-period KPI intelligence', detailEs: 'Inteligencia de KPIs entre periodos', section: 'premium', featureKey: 'trendCharts' },
  { id: 'board_kit', nameEn: 'Board Delivery Kit', nameEs: 'Kit Presentación Junta', detailEn: 'Presentation-ready exec materials', detailEs: 'Materiales ejecutivos listos', section: 'premium', featureKey: 'boardPresentation' },
  { id: 'api', nameEn: 'API Data Access', nameEs: 'Acceso API', detailEn: 'Programmatic JSON / CSV exports', detailEs: 'Exportaciones JSON/CSV', section: 'premium', featureKey: 'apiAccess' },
];

const SECTIONS: Array<'document' | 'analysis' | 'premium'> = ['document', 'analysis', 'premium'];
const SECTION_LABELS: Record<string, Record<string, string>> = {
  document: { en: 'DOCUMENTS', es: 'DOCUMENTOS' },
  analysis: { en: 'ANALYSIS INCLUDED', es: 'ANÁLISIS INCLUIDO' },
  premium: { en: 'PREMIUM ADD-ONS', es: 'COMPLEMENTOS PREMIUM' },
};

type Tone = 'ready' | 'processing' | 'pending' | 'locked';

function resolveStatus(
  d: Deliverable,
  state: PortalWorkflowState,
  tier: SubscriptionTier,
  locale: string,
): { label: string; tone: Tone } {
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  if (d.section === 'premium') {
    const f = d.featureKey ? getFeature(tier, d.featureKey) : null;
    return f?.enabled
      ? { label: t('Enabled', 'Habilitado'), tone: 'ready' }
      : { label: t('Locked', 'Bloqueado'), tone: 'locked' };
  }

  if (state === 'report_ready')
    return d.section === 'document'
      ? { label: t('Ready', 'Listo'), tone: 'ready' }
      : { label: t('Included', 'Incluido'), tone: 'ready' };
  if (state === 'export_degraded')
    return d.section === 'document'
      ? { label: t('Partial', 'Parcial'), tone: 'processing' }
      : { label: t('Included', 'Incluido'), tone: 'ready' };
  if (state === 'processing')
    return { label: t('Generating', 'Generando'), tone: 'processing' };
  return { label: t('Pending data', 'Datos pendientes'), tone: 'pending' };
}

function StatusIcon({ tone }: { tone: Tone }) {
  switch (tone) {
    case 'ready': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
    case 'processing': return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-600" />;
    case 'locked': return <Lock className="h-3.5 w-3.5 text-slate-400" />;
    default: return <Circle className="h-3.5 w-3.5 text-slate-300" />;
  }
}

const TONE_TEXT: Record<Tone, string> = {
  ready: 'text-emerald-700',
  processing: 'text-cyan-700',
  locked: 'cerniq-dashboard-subtext',
  pending: 'cerniq-dashboard-muted-text',
};

interface ReportSuiteProps {
  workflowState: PortalWorkflowState;
  latestJob: PortalOverviewJob | null;
  tier: SubscriptionTier;
}

export default function ReportSuite({ workflowState, latestJob, tier }: ReportSuiteProps) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);
  const lang = locale === 'en' ? 'en' : 'es';
  const isReady = workflowState === 'report_ready' || workflowState === 'export_degraded';

  return (
    <div className="cerniq-dashboard-surface overflow-hidden rounded-xl">
      <div className="cerniq-dashboard-muted-surface border-b cerniq-dashboard-border px-4 py-2 flex items-center justify-between">
        <span className="cerniq-dashboard-subtext text-[10px] font-semibold uppercase tracking-wider">
          {t('Report Suite', 'Suite de Informes')}
        </span>
        <span className="cerniq-dashboard-muted-text text-[10px]">
          {DELIVERABLES.filter((d) => d.section !== 'premium').length}{' '}
          {t('modules included', 'módulos incluidos')}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label={t('Report deliverables', 'Entregables del informe')}>
          <thead className="cerniq-dashboard-muted-surface sticky top-0">
            <tr>
              <th className="cerniq-dashboard-subtext border-b cerniq-dashboard-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ width: '36%' }}>
                {t('Module', 'Módulo')}
              </th>
              <th className="cerniq-dashboard-subtext border-b cerniq-dashboard-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider hidden sm:table-cell" style={{ width: '32%' }}>
                {t('Detail', 'Detalle')}
              </th>
              <th className="cerniq-dashboard-subtext border-b cerniq-dashboard-border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider" style={{ width: '8%' }}>
                {t('Lang', 'Idioma')}
              </th>
              <th className="cerniq-dashboard-subtext border-b cerniq-dashboard-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ width: '14%' }}>
                {t('Status', 'Estado')}
              </th>
              <th className="cerniq-dashboard-subtext border-b cerniq-dashboard-border px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ width: '10%' }}>
                {t('Action', 'Acción')}
              </th>
            </tr>
          </thead>

          <tbody>
            {SECTIONS.map((section) => {
              const items = DELIVERABLES.filter((d) => d.section === section);
              return (
                <Fragment key={section}>
                  <tr>
                    <td
                      colSpan={5}
                      className="bg-[rgba(247,228,188,0.55)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] cerniq-dashboard-subtext border-b cerniq-dashboard-border"
                    >
                      {SECTION_LABELS[section][lang]}
                    </td>
                  </tr>

                  {items.map((d, i) => {
                    const status = resolveStatus(d, workflowState, tier, locale);
                    return (
                      <tr
                        key={d.id}
                        className={`border-b cerniq-dashboard-border transition-colors ${
                          i % 2 === 0 ? 'bg-[rgba(255,251,239,0.9)]' : 'bg-[rgba(247,228,188,0.32)]'
                        }`}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium cerniq-dashboard-text text-[13px]">
                            {locale === 'en' ? d.nameEn : d.nameEs}
                          </span>
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          <span className="cerniq-dashboard-subtext text-xs">
                            {locale === 'en' ? d.detailEn : d.detailEs}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="cerniq-dashboard-subtext text-[11px] font-mono">
                            {d.languages || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <StatusIcon tone={status.tone} />
                            <span className={`text-[11px] font-medium ${TONE_TEXT[status.tone]}`}>
                              {status.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {d.section === 'document' && isReady && latestJob ? (
                            <DocumentExportButtons
                              manifestPath={`/api/portal/jobs/${latestJob.id}/exports`}
                              kinds={[d.id as 'alm_report' | 'alco_pack']}
                              compact
                            />
                          ) : d.section === 'premium' && status.tone === 'locked' ? (
                            <Link href="/portal/billing" className="text-[11px] font-medium text-cyan-700 hover:underline">
                              {t('Upgrade', 'Mejorar')}
                            </Link>
                          ) : (
                            <span className="text-[10px] cerniq-dashboard-muted-text">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
