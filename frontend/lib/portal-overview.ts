export type PortalWorkflowState =
  | "needs_report"
  | "needs_upload"
  | "validation_failed"
  | "processing"
  | "export_degraded"
  | "report_ready";

export type PortalExportStatus =
  | "not_applicable"
  | "ready"
  | "partial"
  | "missing";

export interface PortalExportSummary {
  manifestPath: string;
  status: PortalExportStatus;
  readyCount: number;
  totalCount: number;
  readyReportLanguages: Array<"en" | "es">;
  missingReportLanguages: Array<"en" | "es">;
  readyBoardPackLanguages: Array<"en" | "es">;
  missingBoardPackLanguages: Array<"en" | "es">;
}

export const PORTAL_PROCESSING_STATUSES = [
  "VALIDATING",
  "QUEUED",
  "PROCESSING",
  "GENERATING_PDF",
  "UPLOADING",
] as const;

export interface PortalOverviewJob {
  id: string;
  institutionId?: string | null;
  institutionName: string;
  status: string;
  analysisPeriod: string | null;
  previousJobId: string | null;
  submittedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  reportUrl: string | null;
  reportUrlEn: string | null;
  reportLang: string;
  errorMessage: string | null;
  userId: string;
  triggeredBy: string;
  exportSummary?: PortalExportSummary | null;
}

export interface PortalValidationIssue {
  row?: number | null;
  field?: string | null;
  message: string;
}

export interface PortalValidationSummary {
  sourceFilename: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  importedCount: number;
  warningCount: number;
  errorCount: number;
  warnings: string[];
  errors: PortalValidationIssue[];
}

export interface PortalNextAction {
  labelEn: string;
  labelEs: string;
  href: string;
  jobId: string | null;
  explanationEn: string;
  explanationEs: string;
}

export interface PortalDemoSeatContext {
  isDemo: boolean;
  daysRemaining?: number | null;
  expiresAt?: string | null;
  seat: {
    prospectId: string;
    institutionName: string;
    publicDataSource: string | null;
    provisionedAt: string | null;
    expiresAt: string | null;
    reportJobId: string | null;
  } | null;
}

export interface PortalOverview {
  jobs: PortalOverviewJob[];
  latestActionableJob: PortalOverviewJob | null;
  workflowState: PortalWorkflowState;
  counts: {
    total: number;
    awaitingData: number;
    validationFailed: number;
    processing: number;
    complete: number;
  };
  demoSeat: PortalDemoSeatContext;
  nextAction: PortalNextAction;
  validationSummary: PortalValidationSummary | null;
}

export function isPortalProcessingStatus(status?: string | null): boolean {
  return Boolean(
    status &&
    PORTAL_PROCESSING_STATUSES.includes(
      status as (typeof PORTAL_PROCESSING_STATUSES)[number],
    ),
  );
}

export function isPortalActionRequiredStatus(status?: string | null): boolean {
  return status === "AWAITING_DATA" || status === "VALIDATION_FAILED";
}

export function isPortalReportReady(job?: PortalOverviewJob | null): boolean {
  return Boolean(
    job?.status === "COMPLETE" && job.exportSummary?.status === "ready",
  );
}

export function isPortalExportDegraded(
  job?: PortalOverviewJob | null,
): boolean {
  return Boolean(
    job?.status === "COMPLETE" &&
    job.exportSummary &&
    job.exportSummary.status !== "ready" &&
    job.exportSummary.status !== "not_applicable",
  );
}
