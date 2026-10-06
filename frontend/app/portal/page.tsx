'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePortal } from './layout';
import { useTranslation } from '@/lib/i18n';
import {
  Upload,
  Download,
  Eye,
  ArrowRight,
  AlertTriangle,
  Play,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import {
  MetricStrip,
  SkeletonLoader,
  ErrorBanner,
  DataTable,
  type DataTableColumn,
} from '@/components/ui/cerniq';
import type { SubscriptionTier } from '@/lib/features';
import ReportProgressWS from '@/components/portal/ReportProgressWS';
import DocumentExportButtons from '@/components/exports/DocumentExportButtons';
import DemoSeatBanner from '@/components/portal/DemoSeatBanner';
import ReportSuite from '@/components/portal/ReportSuite';
import { rememberPortalUser } from '@/lib/subscription';
import { getPublicApiUrl, getBalanceSheetTemplateUrl } from '@/lib/api-base';
import { unwrapApiData } from '@/lib/api-response';
import { isActiveDemo } from '@/lib/access';
import {
  type PortalOverviewJob,
  type PortalNextAction,
  type PortalWorkflowState,
  isPortalExportDegraded,
  isPortalProcessingStatus,
  isPortalReportReady,
} from '@/lib/portal-overview';
import { usePortalOverview } from '@/hooks/usePortalOverview';

/* ── Tier label ────────────────────────────────────────────── */

function tierLabel(tier: string): string {
  const map: Record<string, string> = {
    free: 'Free', demo: 'Demo', one_time: 'Pilot',
    monthly: 'Monitoring', annual: 'Annual', partner: 'Partner',
  };
  return map[tier] || tier;
}

/* ── Status badge (compact pill) ───────────────────────────── */

function StatusBadge({ status, locale }: { status: string; locale: string }) {
  const t = (en: string, es: string) => (locale === 'en' ? en : es);
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    COMPLETE: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: t('Complete', 'Completado') },
    PROCESSING: { bg: 'bg-cyan-50', text: 'text-cyan-700', label: t('Processing', 'Procesando') },
    GENERATING_PDF: { bg: 'bg-cyan-50', text: 'text-cyan-700', label: t('Generating', 'Generando') },
    UPLOADING: { bg: 'bg-cyan-50', text: 'text-cyan-700', label: t('Uploading', 'Subiendo') },
    QUEUED: { bg: 'bg-amber-50', text: 'text-amber-700', label: t('Queued', 'En cola') },
    VALIDATING: { bg: 'bg-amber-50', text: 'text-amber-700', label: t('Validating', 'Validando') },
    AWAITING_DATA: { bg: 'bg-slate-100', text: 'text-slate-600', label: t('Awaiting data', 'Esperando datos') },
    FAILED: { bg: 'bg-rose-50', text: 'text-rose-700', label: t('Failed', 'Error') },
    VALIDATION_FAILED: { bg: 'bg-rose-50', text: 'text-rose-700', label: t('Fix required', 'Corrección requerida') },
  };
  const c = cfg[status] || { bg: 'bg-slate-100', text: 'text-slate-600', label: status.replace(/_/g, ' ') };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.bg} ${c.text} border-transparent`}>
      {c.label}
    </span>
  );
}

/* ── Workflow state badge ──────────────────────────────────── */

function WorkflowBadge({ state, locale }: { state?: PortalWorkflowState; locale: string }) {
  const t = (en: string, es: string) => (locale === 'en' ? en : es);
  if (!state) return null;
  const cfg: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
    report_ready: { icon: CheckCircle2, color: 'text-emerald-600', label: t('Report ready', 'Informe listo') },
    export_degraded: { icon: AlertTriangle, color: 'text-amber-600', label: t('Export partial', 'Exportación parcial') },
    processing: { icon: Loader2, color: 'text-cyan-600', label: t('Processing', 'Procesando') },
    needs_upload: { icon: Upload, color: 'text-amber-600', label: t('Data required', 'Datos requeridos') },
    validation_failed: { icon: AlertTriangle, color: 'text-rose-600', label: t('Fix required', 'Corrección requerida') },
    needs_report: { icon: Play, color: 'text-slate-500', label: t('Ready to start', 'Listo para iniciar') },
  };
  const c = cfg[state] || cfg.needs_report;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.color}`}>
      <Icon className={`h-3.5 w-3.5 ${state === 'processing' ? 'animate-spin' : ''}`} />
      {c.label}
    </span>
  );
}

/* ── Welcome strip (compact, on ?welcome=1) ────────────────── */

function WelcomeStrip() {
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  useEffect(() => {
    if (isWelcome) rememberPortalUser();
  }, [isWelcome]);

  if (!isWelcome) return null;

  return (
    <div className="cerniq-dashboard-surface flex items-center gap-3 rounded-xl px-4 py-3 border border-emerald-200 bg-emerald-50">
      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
      <span className="text-sm font-medium text-emerald-800">
        {t('Payment confirmed — your workspace is active.', 'Pago confirmado — su portal está activo.')}
      </span>
    </div>
  );
}

/* ── Action bar (single compact row) ───────────────────────── */

function ActionBar({
  workflowState,
  nextAction,
  validationSummary,
  job,
}: {
  workflowState: PortalWorkflowState;
  nextAction: PortalNextAction;
  validationSummary: { errorCount: number; errors: Array<{ message: string }> } | null;
  job: PortalOverviewJob | null;
}) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  return (
    <div className="cerniq-dashboard-surface rounded-xl px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm cerniq-dashboard-text">
          {t(nextAction.explanationEn, nextAction.explanationEs)}
        </p>
        {job && (
          <p className="mt-0.5 text-[11px] cerniq-dashboard-muted-text">
            {job.institutionName} · {job.status.replace(/_/g, ' ')}
          </p>
        )}
        {workflowState === 'validation_failed' && validationSummary && validationSummary.errorCount > 0 && (
          <p className="mt-1 text-[11px] text-rose-600">
            {validationSummary.errorCount} {t('issues found', 'problemas encontrados')}
            {validationSummary.errors[0] && ` — ${validationSummary.errors[0].message}`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {workflowState === 'needs_upload' && (
          <a
            href={getBalanceSheetTemplateUrl('cooperativa')}
            className="inline-flex items-center gap-1.5 rounded-lg border cerniq-dashboard-border bg-[rgba(255,251,239,0.92)] px-3 py-2 text-xs font-medium cerniq-dashboard-subtext hover:bg-[rgba(247,228,188,0.5)]"
          >
            <Download className="h-3.5 w-3.5" />
            {t('Template', 'Plantilla')}
          </a>
        )}
        <Link
          href={nextAction.href}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B3A6B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#15305a] transition-colors"
        >
          {t(nextAction.labelEn, nextAction.labelEs)}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

/* ── Onboarding strip (no jobs yet) ────────────────────────── */

function OnboardingStrip({
  onStart,
  starting,
  tier,
}: {
  onStart: () => void;
  starting: boolean;
  tier: SubscriptionTier;
}) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  return (
    <div className="cerniq-dashboard-surface rounded-xl overflow-hidden">
      <div className="px-4 py-4 sm:px-6 sm:py-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b cerniq-dashboard-border">
        <div>
          <p className="cerniq-dashboard-subtext text-[10px] font-semibold uppercase tracking-wider">
            {t('CERNIQ Report Suite', 'Suite de Informes CERNIQ')}
          </p>
          <h1 className="mt-1 cerniq-dashboard-text text-lg font-semibold">
            {t(
              'Board-ready ALM analysis for your institution',
              'Análisis ALM listo para junta directiva',
            )}
          </h1>
          <p className="mt-1 cerniq-dashboard-subtext text-sm">
            {t(
              'Upload your balance sheet CSV and receive a 14-page bilingual report with regulatory compliance, stress testing, and board recommendations.',
              'Suba su balance en CSV y reciba un informe bilingüe de 14 páginas con cumplimiento regulatorio, pruebas de estrés y recomendaciones.',
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={getBalanceSheetTemplateUrl('cooperativa')}
            className="inline-flex items-center gap-1.5 rounded-lg border cerniq-dashboard-border bg-[rgba(255,251,239,0.92)] px-4 py-2.5 text-xs font-medium cerniq-dashboard-subtext hover:bg-[rgba(247,228,188,0.5)]"
          >
            <Download className="h-3.5 w-3.5" />
            {t('CSV Template', 'Plantilla CSV')}
          </a>
          <button
            onClick={onStart}
            disabled={starting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B3A6B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#15305a] transition-colors disabled:opacity-60"
          >
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {starting
              ? t('Creating...', 'Creando...')
              : t('Start Report Cycle', 'Iniciar Ciclo de Informe')}
          </button>
        </div>
      </div>
      <div className="px-4 py-3 sm:px-6 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] cerniq-dashboard-subtext">
        <span className="font-medium">{t('Plan', 'Plan')}: {tierLabel(tier)}</span>
        <span>13 {t('analysis modules', 'módulos de análisis')}</span>
        <span>{t('Bilingual ES / EN', 'Bilingüe ES / EN')}</span>
        <span>{t('COSSEC · NCUA · FDIC', 'COSSEC · NCUA · FDIC')}</span>
      </div>
    </div>
  );
}

/* ── Institution strip (has jobs) ──────────────────────────── */

function InstitutionStrip({
  job,
  workflowState,
}: {
  job: PortalOverviewJob | null;
  workflowState?: PortalWorkflowState;
}) {
  const { locale } = useTranslation();
  if (!job) return null;

  return (
    <div className="cerniq-dashboard-surface rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="cerniq-dashboard-text text-sm font-semibold">{job.institutionName}</span>
      {job.analysisPeriod && (
        <span className="cerniq-dashboard-subtext text-xs font-mono">{job.analysisPeriod}</span>
      )}
      <WorkflowBadge state={workflowState} locale={locale} />
      {job.completedAt && (
        <span className="cerniq-dashboard-muted-text text-[11px]">
          {new Date(job.completedAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PR', {
            month: 'short', day: 'numeric', year: 'numeric',
          })}
        </span>
      )}
    </div>
  );
}

/* ── Report complete strip ─────────────────────────────────── */

function ReportReadyStrip({ job }: { job: PortalOverviewJob }) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  return (
    <div className="cerniq-dashboard-surface rounded-xl border-l-4 border-l-emerald-500 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium cerniq-dashboard-text">
            {t(
              `ALM report for ${job.institutionName} is ready`,
              `Informe ALM para ${job.institutionName} está listo`,
            )}
          </p>
          <p className="text-[11px] cerniq-dashboard-muted-text">
            {t('Download the report PDF and ALCO board pack below.', 'Descargue el informe PDF y paquete ALCO abajo.')}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/portal/reports/${job.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B3A6B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#15305a]"
        >
          <Eye className="h-3.5 w-3.5" />
          {t('View Report', 'Ver Informe')}
        </Link>
        <DocumentExportButtons
          manifestPath={`/api/portal/jobs/${job.id}/exports`}
          kinds={['alm_report', 'alco_pack']}
          compact
        />
      </div>
    </div>
  );
}

/* ── Export degraded strip ─────────────────────────────────── */

function ExportDegradedStrip({ job }: { job: PortalOverviewJob }) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  return (
    <div className="cerniq-dashboard-surface rounded-xl border-l-4 border-l-amber-500 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
        <div>
          <p className="text-sm font-medium cerniq-dashboard-text">
            {t('Report complete — export package still processing', 'Informe completo — paquete de exportación en proceso')}
          </p>
          {job.exportSummary && (
            <p className="text-[11px] cerniq-dashboard-muted-text">
              {job.exportSummary.readyCount}/{job.exportSummary.totalCount}{' '}
              {t('artifacts ready', 'artefactos listos')}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/portal/reports/${job.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B3A6B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#15305a]"
        >
          <Eye className="h-3.5 w-3.5" />
          {t('Inspect', 'Inspeccionar')}
        </Link>
        {job.exportSummary?.readyCount ? (
          <DocumentExportButtons
            manifestPath={`/api/portal/jobs/${job.id}/exports`}
            kinds={['alm_report', 'alco_pack']}
            compact
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── Report history table ──────────────────────────────────── */

function ReportHistory({ jobs }: { jobs: PortalOverviewJob[] }) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  const columns: DataTableColumn<PortalOverviewJob>[] = [
    {
      key: 'institution',
      header: t('Institution', 'Institución'),
      cell: (row) => <span className="font-medium cerniq-dashboard-text">{row.institutionName}</span>,
      sortValue: (row) => row.institutionName,
    },
    {
      key: 'period',
      header: t('Period', 'Periodo'),
      cell: (row) => <span className="font-mono text-xs">{row.analysisPeriod || '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: t('Status', 'Estado'),
      cell: (row) => <StatusBadge status={row.status} locale={locale} />,
      sortValue: (row) => row.status,
    },
    {
      key: 'date',
      header: t('Date', 'Fecha'),
      cell: (row) => {
        const d = row.completedAt || row.submittedAt || row.createdAt;
        return (
          <span className="font-mono text-xs tabular-nums">
            {new Date(d).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PR', {
              month: 'short', day: 'numeric',
            })}
          </span>
        );
      },
      sortValue: (row) => new Date(row.completedAt || row.submittedAt || row.createdAt).getTime(),
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: t('Actions', 'Acciones'),
      align: 'right',
      cell: (row) => {
        if (row.status === 'COMPLETE') {
          return (
            <div className="flex items-center justify-end gap-2">
              <Link
                href={`/portal/reports/${row.id}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline"
              >
                <Eye className="h-3 w-3" />
                {t('View', 'Ver')}
              </Link>
              <DocumentExportButtons
                manifestPath={`/api/portal/jobs/${row.id}/exports`}
                kinds={['alco_pack']}
                compact
              />
            </div>
          );
        }
        if (row.status === 'AWAITING_DATA' || row.status === 'VALIDATION_FAILED') {
          return (
            <Link
              href={`/portal/submit?jobId=${row.id}`}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline"
            >
              <Upload className="h-3 w-3" />
              {t('Upload', 'Cargar')}
            </Link>
          );
        }
        return <span className="text-[10px] cerniq-dashboard-muted-text">—</span>;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={jobs}
      rowKey={(row) => row.id}
      caption={t('Report History', 'Historial de Informes')}
    />
  );
}

/* ── Main page ─────────────────────────────────────────────── */

export default function PortalHome() {
  const { user, subscription, access } = usePortal();
  const { locale } = useTranslation();
  const t = useCallback((en: string, es: string) => (locale === 'en' ? en : es), [locale]);
  const router = useRouter();
  const { overview, loading, error: fetchError, loadOverview } = usePortalOverview();
  const [starting, setStarting] = useState(false);

  const tier = (subscription?.tier || 'free') as SubscriptionTier;
  const isDemoSeat = isActiveDemo(access) || tier === 'demo';
  const jobs = overview?.jobs || [];
  const latestJob = overview?.latestActionableJob || jobs[0] || null;

  const workflowState = overview?.workflowState || 'needs_report';
  const isProcessing = workflowState === 'processing' && isPortalProcessingStatus(latestJob?.status);
  const isComplete = workflowState === 'report_ready' && isPortalReportReady(latestJob);
  const isDegraded = workflowState === 'export_degraded' && isPortalExportDegraded(latestJob);
  const needsReport = workflowState === 'needs_report';

  const demoContext = overview?.demoSeat || null;
  const demoJob = demoContext?.seat?.reportJobId
    ? jobs.find((j) => j.id === demoContext.seat?.reportJobId) || null
    : null;

  const attentionCount = (overview?.counts?.awaitingData || 0) + (overview?.counts?.validationFailed || 0);

  async function startCycle() {
    setStarting(true);
    try {
      const res = await authFetch(getPublicApiUrl('/api/portal/jobs/open-cycle'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to create report cycle');
      const raw = await res.json();
      const data = unwrapApiData<{ nextHref?: string }>(raw);
      router.push(data?.nextHref || '/portal/submit');
    } catch {
      await loadOverview();
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonLoader variant="table" count={1} />
        <SkeletonLoader variant="table" count={3} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h1 className="sr-only">
        {t(
          `Welcome back${user?.name ? `, ${user.name}` : ''}`,
          `Bienvenido${user?.name ? `, ${user.name}` : ''}`,
        )}
      </h1>

      {/* Welcome strip (only on ?welcome=1) */}
      <Suspense fallback={null}>
        <WelcomeStrip />
      </Suspense>

      {/* Institution strip or onboarding */}
      {needsReport ? (
        <OnboardingStrip onStart={startCycle} starting={starting} tier={tier} />
      ) : (
        <InstitutionStrip job={latestJob} workflowState={workflowState} />
      )}

      {/* Metric strip */}
      <MetricStrip
        items={[
          { label: t('Reports', 'Informes'), value: overview?.counts?.total || 0 },
          { label: t('Active', 'Activos'), value: overview?.counts?.processing || 0 },
          { label: t('Ready', 'Listos'), value: overview?.counts?.complete || 0 },
          {
            label: t('Attention', 'Atención'),
            value: attentionCount,
            delta: attentionCount > 0 ? attentionCount : undefined,
            deltaFormat: 'number',
            tooltip: attentionCount > 0 ? t('Jobs needing data upload or fix', 'Trabajos que necesitan datos o corrección') : undefined,
          },
          { label: t('Plan', 'Plan'), value: tierLabel(tier) },
        ]}
      />

      {/* Demo seat banner */}
      {isDemoSeat && (
        <DemoSeatBanner
          institutionName={demoContext?.seat?.institutionName || latestJob?.institutionName || null}
          publicDataSource={demoContext?.seat?.publicDataSource || null}
          daysRemaining={demoContext?.daysRemaining ?? access?.daysRemaining ?? null}
          expiresAt={demoContext?.expiresAt || demoContext?.seat?.expiresAt || access?.effectivePeriodEnd || null}
          reportJobId={demoContext?.seat?.reportJobId || latestJob?.id || null}
          isProcessing={demoJob ? isPortalProcessingStatus(demoJob.status) : false}
        />
      )}

      {/* Action bar */}
      {overview?.nextAction && !needsReport && (
        <ActionBar
          workflowState={workflowState}
          nextAction={overview.nextAction}
          validationSummary={overview.validationSummary}
          job={latestJob}
        />
      )}

      {/* Report ready strip */}
      {isComplete && latestJob && <ReportReadyStrip job={latestJob} />}

      {/* Export degraded strip */}
      {isDegraded && latestJob && <ExportDegradedStrip job={latestJob} />}

      {/* Processing state — real-time WebSocket */}
      {isProcessing && latestJob && (
        <ReportProgressWS
          jobId={latestJob.id}
          institutionName={latestJob.institutionName}
          initialStatus={latestJob.status}
          onComplete={loadOverview}
        />
      )}

      {/* Report suite */}
      <ReportSuite workflowState={workflowState} latestJob={latestJob} tier={tier} />

      {/* Error banner */}
      {fetchError && (
        <ErrorBanner
          titleEs={locale === 'es' ? fetchError : undefined}
          error={fetchError}
          onRetry={loadOverview}
        />
      )}

      {/* Report history */}
      {jobs.length > 0 && <ReportHistory jobs={jobs} />}
    </div>
  );
}
