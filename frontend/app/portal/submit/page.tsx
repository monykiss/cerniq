"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Sparkles,
  AlertTriangle,
  Eye,
} from "lucide-react";
import {
  SkeletonLoader,
  EmptyState,
  ErrorBanner,
} from "@/components/ui/cerniq";
import { analytics, EVENTS } from "@/lib/analytics";
import { useTranslation } from "@/lib/i18n";
import ProgressTracker from "@/components/portal/ProgressTracker";
import ReportProgressWS from "@/components/portal/ReportProgressWS";
import DocumentExportButtons from "@/components/exports/DocumentExportButtons";
import {
  getBalanceSheetTemplateUrl,
  getDirectApiUrl,
  getPublicApiUrl,
} from "@/lib/api-base";
import { apiClient } from "@/lib/api";
import { authFetch } from "@/lib/auth-fetch";
import { asRecord, unwrapApiData } from "@/lib/api-response";
import {
  type PortalExportSummary,
  type PortalOverviewJob,
  type PortalValidationSummary,
  isPortalExportDegraded,
  isPortalActionRequiredStatus,
  isPortalProcessingStatus,
  isPortalReportReady,
} from "@/lib/portal-overview";
import { usePortalOverview } from "@/hooks/usePortalOverview";

/**
 * A question the importer asks when it cannot read a file confidently.
 * `deferrable: false` means the import genuinely cannot proceed without an
 * answer — the backend refuses to invent a value (a fabricated 0% rate would
 * silently distort NII and EVE).
 */
interface ImportQuestion {
  id: string;
  field: string;
  kind: "map_column" | "provide_default" | "confirm";
  prompt: string;
  promptEs: string;
  options: string[];
  deferrable: boolean;
  suggestion: string | null;
}

interface ImportInference {
  delimiter: string;
  headerRowIndex: number;
  skippedPreambleRows: number;
  sourceHeaders: string[];
  dataRowCount: number;
  sampleRows: string[][];
  notes: string[];
}

interface SubmitResponse {
  valid: boolean;
  status: string;
  questions?: ImportQuestion[];
  inference?: ImportInference;
  /** Assumptions applied by schema inference, surfaced so they are disclosed. */
  importNotes?: string[];
  autoMapped?: boolean;
  errors?: Array<{
    row?: number | null;
    field?: string | null;
    message: string;
  }>;
  warnings?: string[];
  itemsImported?: number;
  warningCount?: number;
  jobId?: string;
  institutionId?: string | null;
  institutionName?: string | null;
  nextHref?: string;
}

const REPORT_CYCLE_BOOTSTRAP_TIMEOUT_MS = 10000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

function FAQItem({
  questionEn,
  questionEs,
  answerEn,
  answerEs,
}: {
  questionEn: string;
  questionEs: string;
  answerEn: string;
  answerEs: string;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 py-3 text-left"
      >
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#1ABFFF]" />
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-700">
            {t(questionEn, questionEs)}
          </p>
        </div>
        {open ? (
          <ChevronUp className="mt-0.5 h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400" />
        )}
      </button>
      {open ? (
        <div className="pb-3 pl-6 text-sm text-slate-600">
          <p>{t(answerEn, answerEs)}</p>
        </div>
      ) : null}
    </div>
  );
}

function CSVPreview({ file }: { file: File }) {
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      const lines = text.split("\n").filter((line) => line.trim());
      if (lines.length === 0) return;
      const parsed = lines.map((line) =>
        line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")),
      );
      setHeaders(parsed[0] || []);
      setRows(parsed.slice(1, 6));
    };
    reader.readAsText(file);
  }, [file]);

  if (headers.length === 0) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
        <p className="text-xs font-medium text-slate-500">
          {t("Preview (first 5 rows)", "Vista previa (primeras 5 filas)")}
        </p>
      </div>
      {/* `w-full` pins the table to the container width, so `whitespace-nowrap`
          cells get clipped instead of scrolling and the right-hand columns
          (rateType, repriceDate, maturityDate) are unreachable. `w-max` lets the
          table grow to its natural width so the scroll container actually
          engages; `min-w-full` keeps it flush when the file is narrow. */}
      <div className="overflow-x-auto">
        <table className="w-max min-w-full text-xs">
          <thead>
            <tr className="bg-slate-50/60">
              {headers.map((header) => (
                <th
                  key={header}
                  className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-500"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-slate-50/50">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${rowIndex}-${cellIndex}`}
                    className="whitespace-nowrap px-3 py-2 text-slate-600"
                  >
                    {cell || "--"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 5 ? (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-[10px] text-slate-400">
          {t("... and more rows", "... y mas filas")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Rendered when the importer read the file but needs answers before it will
 * import. Deliberately shows what it DID work out (delimiter, header row,
 * detected columns, row count) so the file feels understood rather than
 * rejected, then asks only for what it refuses to guess.
 */
function ImportQuestionsCard({
  response,
  answers,
  onAnswer,
  onRetry,
  retrying,
}: {
  response: SubmitResponse;
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const questions = response.questions || [];
  const inference = response.inference;

  const blocking = questions.filter((question) => !question.deferrable);
  const answered = blocking.filter((question) =>
    (answers[question.id] || "").trim(),
  );
  const ready = answered.length === blocking.length;

  return (
    <div className="cerniq-panel border-amber-200 bg-amber-50/40 p-6">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-900">
            {t(
              "We read your file — a few details are missing",
              "Leimos su archivo — faltan algunos detalles",
            )}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t(
              "CERNIQ will not invent values it cannot find. Answer the questions below and re-submit the same file.",
              "CERNIQ no inventara valores que no encuentra. Responda las preguntas y vuelva a enviar el mismo archivo.",
            )}
          </p>

          {inference ? (
            <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-amber-200 bg-white/70 p-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-slate-400">{t("Separator", "Separador")}</dt>
                <dd className="mt-0.5 font-medium text-slate-700">
                  {inference.delimiter}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">
                  {t("Header row", "Fila de encabezado")}
                </dt>
                <dd className="mt-0.5 font-medium text-slate-700">
                  {inference.headerRowIndex + 1}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">
                  {t("Data rows", "Filas de datos")}
                </dt>
                <dd className="mt-0.5 font-medium text-slate-700">
                  {inference.dataRowCount}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">
                  {t("Columns found", "Columnas encontradas")}
                </dt>
                <dd className="mt-0.5 font-medium text-slate-700">
                  {inference.sourceHeaders.length}
                </dd>
              </div>
            </dl>
          ) : null}

          <div className="mt-4 space-y-4">
            {questions.map((question) => (
              <div
                key={question.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <p className="text-sm text-slate-700">
                  {locale === "en" ? question.prompt : question.promptEs}
                  {question.deferrable ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                      {t("optional", "opcional")}
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-600">
                      {t("required", "requerido")}
                    </span>
                  )}
                </p>

                {question.kind === "map_column" ? (
                  <select
                    value={answers[question.id] || ""}
                    onChange={(event) =>
                      onAnswer(question.id, event.target.value)
                    }
                    className="mt-2 w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#1ABFFF] focus:outline-none"
                  >
                    <option value="">
                      {t("Select a column...", "Seleccione una columna...")}
                    </option>
                    {question.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={answers[question.id] || ""}
                      placeholder={
                        question.suggestion ||
                        t("Enter a value", "Ingrese un valor")
                      }
                      onChange={(event) =>
                        onAnswer(question.id, event.target.value)
                      }
                      className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#1ABFFF] focus:outline-none"
                    />
                    {question.options.length > 0 ? (
                      <select
                        value=""
                        onChange={(event) =>
                          event.target.value &&
                          onAnswer(question.id, event.target.value)
                        }
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 focus:border-[#1ABFFF] focus:outline-none"
                      >
                        <option value="">
                          {t("or map a column...", "o asigne una columna...")}
                        </option>
                        {question.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={onRetry}
            disabled={!ready || retrying}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#1B3A6B] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#163258] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {retrying
              ? t("Importing...", "Importando...")
              : t("Import with these answers", "Importar con estas respuestas")}
          </button>
          {!ready ? (
            <p className="mt-2 text-xs text-slate-500">
              {t(
                `${answered.length} of ${blocking.length} required answers provided.`,
                `${answered.length} de ${blocking.length} respuestas requeridas.`,
              )}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getCurrentQuarter(): string {
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${quarter}-${now.getFullYear()}`;
}

const PERIOD_OPTIONS = (() => {
  const year = new Date().getFullYear();
  return [
    `Q1-${year}`,
    `Q2-${year}`,
    `Q3-${year}`,
    `Q4-${year}`,
    `Annual-${year}`,
  ];
})();

function trackerForState(state: string) {
  switch (state) {
    case "needs_report":
      return { currentStep: 2, completedSteps: [1] };
    case "processing":
      return { currentStep: 4, completedSteps: [1, 2, 3] };
    case "export_degraded":
    case "report_ready":
      return { currentStep: 5, completedSteps: [1, 2, 3, 4, 5] };
    case "needs_upload":
    case "validation_failed":
    default:
      return { currentStep: 3, completedSteps: [1, 2] };
  }
}

/**
 * Shows the outcome of a CSV scan.
 *
 * Two distinct cases, which the previous version conflated — and that
 * conflation is what made the portal look broken: a job left in
 * VALIDATION_FAILED kept rendering its *stored* error in alarming red forever,
 * so a user who had already picked a good file still saw
 * "CSV must have a header row and at least one data row" and reasonably
 * concluded the upload was failing again.
 *
 *   current  — errors from the upload just attempted (`uploadErrors`)
 *   prior    — the persisted result of an EARLIER attempt (`summary`)
 *
 * The prior case is kept rather than hidden, because the scan history is the
 * audit trail. It is just clearly labelled as history and styled as such.
 * Either way the counts are shown, so the scan is inspectable instead of a
 * bare message: rows read, rows valid, rows rejected, rows imported.
 */
function ValidationSummaryCard({
  summary,
  uploadErrors,
  hasStagedFile,
}: {
  summary: PortalValidationSummary | null;
  uploadErrors: SubmitResponse["errors"];
  hasStagedFile?: boolean;
}) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  const isCurrent = Boolean(uploadErrors && uploadErrors.length > 0);
  const errors = isCurrent ? uploadErrors || [] : summary?.errors || [];
  const warnings = isCurrent ? [] : summary?.warnings || [];

  if (errors.length === 0 && warnings.length === 0) {
    return null;
  }

  const tone = isCurrent
    ? {
        wrap: "border-rose-200 bg-rose-50",
        icon: "text-rose-600",
        title: "text-rose-700",
        body: "text-rose-700",
      }
    : {
        wrap: "border-amber-200 bg-amber-50/70",
        icon: "text-amber-600",
        title: "text-amber-800",
        body: "text-amber-800",
      };

  const heading = isCurrent
    ? t("Validation needs attention", "La validacion necesita atencion")
    : t("Result of your previous attempt", "Resultado de su intento anterior");

  const scanned = summary && !isCurrent ? summary : null;

  return (
    <div className={`mt-4 rounded-2xl border p-4 ${tone.wrap}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${tone.icon}`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${tone.title}`}>{heading}</p>

          {!isCurrent ? (
            <p className={`mt-1 text-xs ${tone.body}`}>
              {hasStagedFile
                ? t(
                    "This is history, not a check of the file you just selected. Submit to run a fresh scan.",
                    "Esto es historial, no una revision del archivo que acaba de seleccionar. Envie para ejecutar un nuevo escaneo.",
                  )
                : t(
                    "Select a file below and submit to run a fresh scan.",
                    "Seleccione un archivo abajo y envie para ejecutar un nuevo escaneo.",
                  )}
            </p>
          ) : null}

          {scanned ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              {[
                [t("File", "Archivo"), scanned.sourceFilename || "--"],
                [t("Rows read", "Filas leidas"), String(scanned.totalRows)],
                [t("Valid", "Validas"), String(scanned.validRows)],
                [t("Rejected", "Rechazadas"), String(scanned.errorRows)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] uppercase tracking-wide opacity-70">
                    {label}
                  </dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <ul className={`mt-3 space-y-1 text-xs leading-5 ${tone.body}`}>
            {errors.slice(0, 4).map((error, index) => (
              <li key={`${error.message}-${index}`}>
                •{" "}
                {error.row && error.field
                  ? `row ${error.row}, ${error.field}: ${error.message}`
                  : error.message}
              </li>
            ))}
          </ul>
          {errors.length > 4 ? (
            <p className={`mt-1 text-[11px] ${tone.body} opacity-80`}>
              {t(
                `+${errors.length - 4} more issue(s)`,
                `+${errors.length - 4} problema(s) mas`,
              )}
            </p>
          ) : null}
          {warnings.length > 0 ? (
            <p className="mt-3 text-xs text-amber-700">
              {t(
                `${warnings.length} warning(s) were also detected. You can still retry with a corrected file.`,
                `Tambien se detectaron ${warnings.length} advertencia(s). Puede reenviar con un archivo corregido.`,
              )}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}


/** One row of the ingestion audit trail, as returned by the API. */
interface ScanAttempt {
  id: string;
  sourceFilename: string | null;
  status: string;
  totalRows: number | null;
  validRows: number | null;
  errorRows: number | null;
  importedCount: number | null;
  createdAt: string;
}

/**
 * Every scan this job has ever run, newest first.
 *
 * `GET /api/portal/jobs/:jobId/ingestion-logs` has existed the whole time and
 * nothing consumed it, so a failed upload left the user staring at a single red
 * sentence with no way to see what the scanner actually read. This makes the
 * process inspectable and repeatable: each attempt shows its file, when it ran,
 * and the row accounting (read / valid / rejected / imported), so two attempts
 * can be compared instead of guessed at.
 *
 * Fails quiet: the audit trail is diagnostic, and a history that cannot load is
 * never a reason to block the upload UI behind an error.
 */
function ScanHistory({ jobId, refreshKey }: { jobId: string; refreshKey: number }) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const [attempts, setAttempts] = useState<ScanAttempt[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await authFetch(
          getDirectApiUrl(`/api/portal/jobs/${jobId}/ingestion-logs`),
        );
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}));
        const rows = unwrapApiData<ScanAttempt[]>(body);
        if (!cancelled && Array.isArray(rows)) setAttempts(rows);
      } catch {
        // Diagnostic only — never surface as a blocking error.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);

  if (!loading && attempts.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-semibold text-slate-700">
          {t("Scan history", "Historial de escaneos")}
          <span className="ml-2 font-normal text-slate-400">
            {attempts.length}
          </span>
        </span>
        <span className="text-xs text-slate-400">{open ? "\u2212" : "+"}</span>
      </button>

      {open ? (
        <div className="max-h-72 overflow-y-auto border-t border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50/70 text-slate-500">
                  {[
                    t("When", "Cuando"),
                    t("File", "Archivo"),
                    t("Result", "Resultado"),
                    t("Read", "Leidas"),
                    t("Valid", "Validas"),
                    t("Rejected", "Rechazadas"),
                    t("Imported", "Importadas"),
                  ].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-3 py-2 text-left font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attempts.map((a) => {
                  const failed = a.status !== "IMPORTED";
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {a.sourceFilename || "--"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={
                            failed
                              ? "rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
                              : "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                          }
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {a.totalRows ?? "--"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {a.validRows ?? "--"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {a.errorRows ?? "--"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {a.importedCount ?? "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProcessingCard({
  job,
  itemsImported,
  warningCount,
  onComplete,
  onStatusChange,
}: {
  job: PortalOverviewJob;
  itemsImported?: number;
  warningCount?: number;
  onComplete: () => void;
  onStatusChange: (status: string) => void;
}) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#1ABFFF]/20 bg-[#1ABFFF]/5 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1ABFFF]/10">
            <Sparkles className="h-5 w-5 text-[#1ABFFF]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">
              {t(
                "Submission received. CERNIQ is processing your report now.",
                "Carga recibida. CERNIQ esta procesando su informe ahora.",
              )}
            </p>
            <p className="mt-1 text-sm text-slate-600">{job.institutionName}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
              {typeof itemsImported === "number" ? (
                <span>
                  {t(
                    `${itemsImported} items imported`,
                    `${itemsImported} elementos importados`,
                  )}
                </span>
              ) : null}
              {typeof warningCount === "number" ? (
                <span>
                  {t(
                    `${warningCount} warnings`,
                    `${warningCount} advertencias`,
                  )}
                </span>
              ) : null}
              {job.analysisPeriod ? <span>{job.analysisPeriod}</span> : null}
            </div>
          </div>
        </div>
      </div>
      <ReportProgressWS
        jobId={job.id}
        institutionName={job.institutionName}
        initialStatus={job.status}
        onStatusChange={onStatusChange}
        onComplete={onComplete}
      />
    </div>
  );
}

function ReportReadyCard({ job }: { job: PortalOverviewJob }) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  return (
    <div className="rounded-2xl border border-[#18C87A]/20 bg-[#18C87A]/5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#18C87A]/10">
          <CheckCircle className="h-5 w-5 text-[#18C87A]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {t(
              "Your report is ready for review and export.",
              "Su informe esta listo para revisar y exportar.",
            )}
          </p>
          <p className="mt-1 text-sm text-slate-600">{job.institutionName}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/portal/reports/${job.id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E8A020] px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#d19218]"
            >
              <Eye className="h-4 w-4" />
              {t("Open report", "Abrir informe")}
            </Link>
            <DocumentExportButtons
              manifestPath={`/api/portal/jobs/${job.id}/exports`}
              kinds={["alm_report", "alco_pack"]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportDegradedCard({
  job,
  exportSummary,
}: {
  job: PortalOverviewJob;
  exportSummary: PortalExportSummary | null | undefined;
}) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  return (
    <div className="rounded-2xl border border-[#E8A020]/20 bg-[#E8A020]/5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E8A020]/10">
          <AlertTriangle className="h-5 w-5 text-[#E8A020]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {t(
              "The report finished, but export delivery still needs recovery.",
              "El informe termino, pero la entrega de exportacion todavia necesita recuperacion.",
            )}
          </p>
          <p className="mt-1 text-sm text-slate-600">{job.institutionName}</p>
          {exportSummary ? (
            <p className="mt-2 text-xs text-slate-500">
              {t(
                `${exportSummary.readyCount} of ${exportSummary.totalCount} export artifacts are ready.`,
                `${exportSummary.readyCount} de ${exportSummary.totalCount} artefactos de exportacion estan listos.`,
              )}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/portal/reports/${job.id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E8A020] px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#d19218]"
            >
              <Eye className="h-4 w-4" />
              {t("Inspect delivery state", "Inspeccionar entrega")}
            </Link>
            {exportSummary?.readyCount ? (
              <DocumentExportButtons
                manifestPath={`/api/portal/jobs/${job.id}/exports`}
                kinds={["alm_report", "alco_pack"]}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PortalSubmit() {
  const { locale } = useTranslation();
  const t = useCallback(
    (en: string, es: string) => (locale === "en" ? en : es),
    [locale],
  );
  const searchParams = useSearchParams();
  const {
    overview,
    loading,
    error: fetchError,
    loadOverview,
  } = usePortalOverview();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Bumped after every submit so the scan history refetches and the user
  // sees the attempt they just made without reloading the page.
  const [scanRefreshKey, setScanRefreshKey] = useState(0);
  const [analysisPeriod, setAnalysisPeriod] =
    useState<string>(getCurrentQuarter());
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [submittedState, setSubmittedState] = useState<SubmitResponse | null>(
    null,
  );
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** question.id -> the user's answer, for a NEEDS_INPUT round. */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const autoBootstrapAttemptedRef = useRef(false);

  const jobs = useMemo(() => overview?.jobs || [], [overview?.jobs]);
  const selectedJobFromQuery = searchParams.get("jobId");
  const shouldCreateCycle = searchParams.get("createCycle") === "1";
  const [bootstrappingCycle, setBootstrappingCycle] = useState(false);

  const startReportCycleBootstrap = useCallback(async () => {
    if (bootstrappingCycle) {
      return;
    }

    setBootstrappingCycle(true);
    setBootstrapError(null);

    try {
      const cycle = await withTimeout(
        apiClient.openPortalReportCycle(),
        REPORT_CYCLE_BOOTSTRAP_TIMEOUT_MS,
        "Timed out while creating a report cycle.",
      );
      setSelectedJobId(cycle.jobId);
      await loadOverview();
    } catch {
      setBootstrapError(
        t(
          "We could not open a report cycle right now. Please try again.",
          "No pudimos abrir un ciclo de informe ahora mismo. Intente de nuevo.",
        ),
      );
    } finally {
      setBootstrappingCycle(false);
    }
  }, [bootstrappingCycle, loadOverview, t]);

  useEffect(() => {
    if (!overview) return;

    if (
      selectedJobFromQuery &&
      jobs.some((job) => job.id === selectedJobFromQuery)
    ) {
      setSelectedJobId(selectedJobFromQuery);
      return;
    }

    if (
      overview.latestActionableJob &&
      isPortalActionRequiredStatus(overview.latestActionableJob.status)
    ) {
      setSelectedJobId(overview.latestActionableJob.id);
      return;
    }

    if (!selectedJobId && overview.latestActionableJob) {
      setSelectedJobId(overview.latestActionableJob.id);
    }
  }, [jobs, overview, selectedJobFromQuery, selectedJobId]);

  useEffect(() => {
    if (!shouldCreateCycle) {
      autoBootstrapAttemptedRef.current = false;
      return;
    }

    if (
      !overview ||
      !shouldCreateCycle ||
      bootstrappingCycle ||
      bootstrapError
    ) {
      return;
    }

    const hasActionableJob = jobs.some((job) =>
      isPortalActionRequiredStatus(job.status),
    );
    if (hasActionableJob) {
      return;
    }

    if (autoBootstrapAttemptedRef.current) {
      return;
    }
    autoBootstrapAttemptedRef.current = true;

    let cancelled = false;
    const bootstrapCycle = async () => {
      await startReportCycleBootstrap();
      if (cancelled) {
        return;
      }
    };

    void bootstrapCycle();
    return () => {
      cancelled = true;
    };
  }, [
    bootstrapError,
    bootstrappingCycle,
    jobs,
    overview,
    shouldCreateCycle,
    startReportCycleBootstrap,
  ]);

  const selectedJob =
    jobs.find((job) => job.id === selectedJobId) ||
    overview?.latestActionableJob ||
    null;

  useEffect(() => {
    if (selectedJob?.analysisPeriod) {
      setAnalysisPeriod(selectedJob.analysisPeriod);
    }
  }, [selectedJob?.analysisPeriod]);

  const localSubmittedStatus = submittedState?.valid ? submittedState.status : null;

  const displayJob =
    submittedState?.valid && submittedState.jobId
      ? {
          ...(selectedJob ||
            (selectedJobId &&
            selectedJobId === submittedState.jobId
              ? {
                  id: submittedState.jobId,
                  institutionId: submittedState.institutionId || null,
                  institutionName:
                    submittedState.institutionName || "CERNIQ",
                  status: submittedState.status,
                  analysisPeriod,
                  previousJobId: null,
                  submittedAt: new Date().toISOString(),
                  processingStartedAt: null,
                  completedAt:
                    submittedState.status === "COMPLETE"
                      ? new Date().toISOString()
                      : null,
                  createdAt: new Date().toISOString(),
                  reportUrl: null,
                  reportUrlEn: null,
                  reportLang: "es",
                  errorMessage: null,
                  userId: "",
                  triggeredBy: "portal_submit",
                  exportSummary: null,
                }
              : null) ||
            overview?.latestActionableJob || {
              id: submittedState.jobId,
              institutionId: submittedState.institutionId || null,
              institutionName: submittedState.institutionName || "CERNIQ",
              status: submittedState.status,
              analysisPeriod,
              previousJobId: null,
              submittedAt: new Date().toISOString(),
              processingStartedAt: null,
              completedAt: null,
              createdAt: new Date().toISOString(),
              reportUrl: null,
              reportUrlEn: null,
              reportLang: "es",
              errorMessage: null,
              userId: "",
              triggeredBy: "portal_submit",
              exportSummary: null,
            }),
          status: submittedState.status,
          institutionName:
            submittedState.institutionName ||
            selectedJob?.institutionName ||
            "CERNIQ",
          analysisPeriod,
        }
      : selectedJob;

  const displayWorkflowState =
    localSubmittedStatus && displayJob
      ? localSubmittedStatus === "COMPLETE"
        ? "report_ready"
        : localSubmittedStatus === "FAILED"
          ? "export_degraded"
          : "processing"
      : displayJob?.status === "VALIDATION_FAILED"
        ? "validation_failed"
        : displayJob?.status === "AWAITING_DATA"
          ? "needs_upload"
          : displayJob && isPortalProcessingStatus(displayJob.status)
            ? "processing"
            : isPortalReportReady(displayJob)
              ? "report_ready"
              : isPortalExportDegraded(displayJob)
                ? "export_degraded"
                : overview?.workflowState || "needs_report";

  const actionableJobs = jobs.filter((job) =>
    isPortalActionRequiredStatus(job.status),
  );
  const activeValidationSummary =
    result?.valid === false
      ? null
      : displayJob?.id === overview?.latestActionableJob?.id
        ? overview?.validationSummary || null
        : null;
  const tracker = trackerForState(displayWorkflowState);

  const validateFile = (candidate: File): string | null => {
    if (!candidate.name.endsWith(".csv")) {
      return t(
        "Only CSV files are accepted.",
        "Solo archivos CSV son aceptados.",
      );
    }
    if (candidate.size > 2 * 1024 * 1024) {
      return t("File exceeds 2MB limit.", "El archivo excede 2MB.");
    }
    if (candidate.size === 0) {
      return t("File is empty.", "El archivo esta vacio.");
    }
    return null;
  };

  const handleFileSelect = (candidate: File | null) => {
    setResult(null);
    if (!candidate) {
      setFile(null);
      return;
    }
    const validationError = validateFile(candidate);
    if (validationError) {
      setResult({
        valid: false,
        status: "VALIDATION_ERROR",
        errors: [{ message: validationError }],
      });
      setFile(null);
      return;
    }
    setFile(candidate);
  };

  const handleUpload = async () => {
    // Never return silently. A dead Submit button with no explanation is
    // indistinguishable from a broken platform — which is exactly how this was
    // reported. Name the missing precondition instead.
    if (!displayJob?.id || !file) {
      setResult({
        valid: false,
        status: "ERROR",
        errors: [
          {
            message: !displayJob?.id
              ? t(
                  "No report cycle is selected. Pick a cycle in step 2, then submit.",
                  "No hay ciclo de informe seleccionado. Elija un ciclo en el paso 2 y envie.",
                )
              : t(
                  "No file is attached. Choose a CSV in step 4, then submit.",
                  "No hay archivo adjunto. Elija un CSV en el paso 4 y envie.",
                ),
          },
        ],
      });
      return;
    }

    setUploading(true);
    setSubmittedState(null);

    // Answers to a previous NEEDS_INPUT round travel back with the file.
    // Multipart fields are strings, so the resolution is JSON-encoded.
    const pendingQuestions = result?.questions || [];
    const sourceHeaders = result?.inference?.sourceHeaders || [];
    const columnOverrides: Record<string, number> = {};
    const defaults: Record<string, string> = {};

    for (const question of pendingQuestions) {
      const answer = (answers[question.id] || "").trim();
      if (!answer) continue;

      if (question.kind === "map_column") {
        const index = sourceHeaders.indexOf(answer);
        if (index >= 0) {
          columnOverrides[question.field] = index;
        }
      } else {
        defaults[question.field] = answer;
      }
    }

    const hasResolution =
      Object.keys(columnOverrides).length > 0 ||
      Object.keys(defaults).length > 0;

    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (analysisPeriod) {
        formData.append("analysisPeriod", analysisPeriod);
      }
      if (hasResolution) {
        formData.append(
          "importMapping",
          JSON.stringify({ columnOverrides, defaults }),
        );
      }

      // Direct at the API origin, NOT through the same-origin rewrite: the
      // proxy hop delivered a 0-byte body to multer, so a perfectly valid CSV
      // came back as "must have a header row and at least one data row".
      const res = await authFetch(
        getDirectApiUrl(`/api/portal/jobs/${displayJob.id}/submit`),
        {
          method: "POST",
          body: formData,
        },
      );

      const body = await res.json().catch(() => ({}));

      // A non-2xx response carries the API error envelope, which has no `valid`
      // field. Unwrapping it straight into SubmitResponse made `valid` undefined
      // — falsy, so the UI silently fell into the validation-failed branch with
      // zero error rows and the upload appeared to do nothing. Surface the real
      // reason instead.
      if (!res.ok) {
        const envelope = asRecord(body);
        const apiError = asRecord(envelope?.error);
        const serverMessage =
          typeof apiError?.message === "string" ? apiError.message : null;

        setResult({
          valid: false,
          status: "ERROR",
          errors: [
            {
              message:
                res.status === 401
                  ? t(
                      "Your session expired. Sign in again, then re-upload.",
                      "Su sesion expiro. Inicie sesion de nuevo y vuelva a cargar.",
                    )
                  : serverMessage ||
                    t(
                      "The server rejected this upload. Please try again.",
                      "El servidor rechazo esta carga. Intente de nuevo.",
                    ),
            },
          ],
        });
        analytics.track(EVENTS.PORTAL_DATA_VALIDATION_FAILED, {
          jobId: displayJob.id,
        });
        setScanRefreshKey((k) => k + 1);
        return;
      }

      const payload = unwrapApiData<SubmitResponse>(body);
      setResult(payload);
      setScanRefreshKey((k) => k + 1);

      if (payload.valid) {
        analytics.track(EVENTS.PORTAL_DATA_SUBMITTED, {
          jobId: displayJob.id,
          items: payload.itemsImported,
        });
        setSubmittedState(payload);
        setFile(null);
        void loadOverview();
      } else {
        analytics.track(EVENTS.PORTAL_DATA_VALIDATION_FAILED, {
          jobId: displayJob.id,
        });
      }
    } catch (err) {
      // A bare `catch {}` here reported "Network error" for every transport
      // failure, discarding the only evidence of what went wrong. Keep the
      // friendly headline, append the actual reason.
      const detail =
        err instanceof Error && err.message ? ` (${err.message})` : "";
      setResult({
        valid: false,
        status: "ERROR",
        errors: [
          {
            message:
              t(
                "Could not reach the CERNIQ API. Please try again.",
                "No se pudo contactar la API de CERNIQ. Intente de nuevo.",
              ) + detail,
          },
        ],
      });
      setScanRefreshKey((k) => k + 1);
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    handleFileSelect(event.dataTransfer.files?.[0] || null);
  };

  return (
    <div className="space-y-6">
      <section className="cerniq-shell p-6 sm:p-8">
        <div className="cerniq-data-wave" />
        <div className="relative z-10">
          <span className="cerniq-kicker mb-5">
            {t("Submit Data", "Enviar Datos")}
          </span>
          <h1 className="font-display text-3xl text-slate-950 sm:text-5xl">
            {t("Upload Your Balance-Sheet Data", "Cargue Sus Datos de Balance")}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {t(
              "Move from onboarding into a report-ready workflow with one clean upload.",
              "Pase del onboarding a un flujo listo para informe con una sola carga limpia.",
            )}
          </p>
        </div>
      </section>

      <div className="cerniq-panel p-6">
        <ProgressTracker
          currentStep={tracker.currentStep}
          completedSteps={tracker.completedSteps}
        />
      </div>

      {result?.status === "NEEDS_INPUT" ? (
        <ImportQuestionsCard
          response={result}
          answers={answers}
          onAnswer={(id, value) =>
            setAnswers((previous) => ({ ...previous, [id]: value }))
          }
          onRetry={() => void handleUpload()}
          retrying={uploading}
        />
      ) : null}

      {/* An auto-mapped import must never look identical to one that matched the
          canonical template exactly — the assumptions are disclosed up front. */}
      {submittedState?.autoMapped && submittedState.importNotes?.length ? (
        <div className="cerniq-panel border-cyan-200 bg-cyan-50/40 p-6">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {t(
                  "Imported with automatic mapping",
                  "Importado con mapeo automatico",
                )}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t(
                  "Your file did not match the CERNIQ template, so it was read and mapped automatically. These assumptions were applied:",
                  "Su archivo no coincidia con la plantilla CERNIQ, asi que fue leido y mapeado automaticamente. Se aplicaron estas suposiciones:",
                )}
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                {submittedState.importNotes.map((note) => (
                  <li key={note} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-500" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="cerniq-panel p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1B3A6B] text-sm font-bold text-white">
                1
              </div>
              <div className="flex-1">
                <h2 className="mb-1 text-sm font-semibold text-slate-900">
                  {t("Download Template", "Descargar Plantilla")}
                </h2>
                <p className="mb-3 text-sm text-slate-500">
                  {t(
                    "Use the official CERNIQ template so upload validation, period linking, and report generation all line up correctly.",
                    "Use la plantilla oficial de CERNIQ para que la validacion, el periodo y la generacion del informe queden alineados.",
                  )}
                </p>
                <a
                  href={getBalanceSheetTemplateUrl("cooperativa")}
                  className="cerniq-button-secondary px-4 py-2 text-sm"
                >
                  <Download className="h-4 w-4" />{" "}
                  {t("Download template", "Descargar plantilla")}
                </a>
              </div>
            </div>
          </div>

          <div className="cerniq-panel p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1B3A6B] text-sm font-bold text-white">
                2
              </div>
              <div className="flex-1">
                <h2 className="mb-1 text-sm font-semibold text-slate-900">
                  {displayWorkflowState === "processing"
                    ? t("Processing Status", "Estado del procesamiento")
                    : displayWorkflowState === "report_ready"
                      ? t("Latest Delivered Report", "Ultimo informe entregado")
                      : displayWorkflowState === "export_degraded"
                        ? t(
                            "Export Delivery Needs Attention",
                            "La entrega de exportacion necesita atencion",
                          )
                        : t("Select Report", "Seleccionar Informe")}
                </h2>

                {fetchError ? (
                  <ErrorBanner error={fetchError} onRetry={loadOverview} />
                ) : loading ? (
                  <SkeletonLoader variant="card" count={2} />
                ) : bootstrappingCycle ? (
                  <SkeletonLoader variant="card" count={1} />
                ) : bootstrapError ? (
                  <ErrorBanner
                    error={bootstrapError}
                    onRetry={() => {
                      void startReportCycleBootstrap();
                    }}
                    onDismiss={() => setBootstrapError(null)}
                  />
                ) : displayWorkflowState === "needs_report" ? (
                  <EmptyState
                    icon={ClipboardList}
                    title={t(
                      "No report cycle is currently open",
                      "No hay un ciclo de informe abierto",
                    )}
                    description={t(
                      "Your account is active, but there is no report cycle awaiting data yet. Open the portal workspace to review next steps.",
                      "Su cuenta esta activa, pero todavia no hay un ciclo de informe esperando datos. Abra el portal para revisar los siguientes pasos.",
                    )}
                    actionLabel={t(
                      "Open report cycle",
                      "Abrir ciclo de informe",
                    )}
                    onAction={() => {
                      void startReportCycleBootstrap();
                    }}
                  />
                ) : displayWorkflowState === "processing" && displayJob ? (
                  <ProcessingCard
                    job={displayJob}
                    itemsImported={submittedState?.itemsImported}
                    warningCount={submittedState?.warningCount}
                    onStatusChange={(status) => {
                      setSubmittedState((current) =>
                        current?.valid
                          ? {
                              ...current,
                              status,
                            }
                          : current,
                      );
                    }}
                    onComplete={() => {
                      setSubmittedState((current) =>
                        current?.valid
                          ? {
                              ...current,
                              status: "COMPLETE",
                            }
                          : current,
                      );
                      void loadOverview();
                    }}
                  />
                ) : displayWorkflowState === "export_degraded" && displayJob ? (
                  <ExportDegradedCard
                    job={displayJob}
                    exportSummary={displayJob.exportSummary}
                  />
                ) : displayWorkflowState === "report_ready" && displayJob ? (
                  <ReportReadyCard job={displayJob} />
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-500">
                      {t(
                        "Choose the report cycle you want to complete with this upload.",
                        "Elija el ciclo de informe que quiere completar con esta carga.",
                      )}
                    </p>
                    <div className="space-y-2">
                      {actionableJobs.map((job) => (
                        <button
                          key={job.id}
                          onClick={() => {
                            setSelectedJobId(job.id);
                            setResult(null);
                            setSubmittedState(null);
                          }}
                          className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${
                            displayJob?.id === job.id
                              ? "border-[#1ABFFF]/40 bg-[#1ABFFF]/5 text-[#1B3A6B]"
                              : "border-slate-200 text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          <span className="font-medium">
                            {job.institutionName}
                          </span>
                          {job.status === "VALIDATION_FAILED" ? (
                            <span className="ml-2 text-xs text-rose-600">
                              {t(
                                "Validation failed — retry",
                                "Validacion fallida — reintentar",
                              )}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {job.status.replace(/_/g, " ")} •{" "}
                            {new Date(job.createdAt).toLocaleDateString()}
                          </span>
                        </button>
                      ))}
                    </div>
                    {displayWorkflowState === "validation_failed" ? (
                      <ValidationSummaryCard
                        summary={activeValidationSummary}
                        uploadErrors={result?.errors}
                        hasStagedFile={Boolean(file)}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          {(displayWorkflowState === "needs_upload" ||
            displayWorkflowState === "validation_failed") &&
          displayJob ? (
            <>
              <div className="cerniq-panel p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1B3A6B] text-sm font-bold text-white">
                    3
                  </div>
                  <div className="flex-1">
                    <h2 className="mb-1 text-sm font-semibold text-slate-900">
                      {t("Select Period", "Seleccionar Periodo")}
                    </h2>
                    <p className="mb-3 text-sm text-slate-500">
                      {t(
                        "Tag the upload to the right reporting period so CERNIQ can link trends across jobs and timelines.",
                        "Etiquete la carga al periodo correcto para que CERNIQ pueda enlazar tendencias y cronologias.",
                      )}
                    </p>
                    <select
                      value={analysisPeriod}
                      onChange={(event) =>
                        setAnalysisPeriod(event.target.value)
                      }
                      className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-[#1ABFFF] focus:outline-none focus:ring-1 focus:ring-[#1ABFFF]/30"
                    >
                      {PERIOD_OPTIONS.map((period) => (
                        <option key={period} value={period}>
                          {period}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="cerniq-panel p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1B3A6B] text-sm font-bold text-white">
                    4
                  </div>
                  <div className="flex-1">
                    <h2 className="mb-1 text-sm font-semibold text-slate-900">
                      {t("Upload Your Data", "Cargar Sus Datos")}
                    </h2>
                    <p className="mb-3 text-sm text-slate-500">
                      {t(
                        "Upload the completed CSV file. Max file size: 2MB.",
                        "Cargue el archivo CSV completado. Tamano maximo: 2MB.",
                      )}
                    </p>
                    <p className="mb-3 text-xs text-slate-400">
                      {displayJob.institutionName} • {analysisPeriod}
                    </p>

                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(event) =>
                        handleFileSelect(event.target.files?.[0] || null)
                      }
                    />

                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
                        dragOver
                          ? "border-[#1ABFFF] bg-[#1ABFFF]/5 scale-[1.01]"
                          : file
                            ? "border-[#18C87A]/40 bg-[#18C87A]/5"
                            : "border-[#1B3A6B]/20 hover:border-[#1ABFFF]/40 hover:bg-[#1ABFFF]/[0.02]"
                      }`}
                    >
                      {file ? (
                        <div className="flex items-center justify-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#18C87A]/10">
                            <FileText className="h-5 w-5 text-[#18C87A]" />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-medium text-slate-700">
                              {file.name}
                            </p>
                            <p className="text-xs text-slate-400">
                              {(file.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setFile(null);
                              setResult(null);
                            }}
                            className="ml-3 text-xs text-slate-400 underline hover:text-rose-500"
                          >
                            {t("Change", "Cambiar")}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <Upload className="mx-auto mb-3 h-10 w-10 text-[#1B3A6B]/20" />
                          <p className="text-sm font-medium text-slate-600">
                            {t(
                              "Drag and drop your CSV file here or click to select",
                              "Arrastre su archivo CSV aqui o haga clic para seleccionar",
                            )}
                          </p>
                        </div>
                      )}
                    </div>

                    {file && !result ? <CSVPreview file={file} /> : null}

                    {result?.valid === false ? (
                      result.status === "ERROR" ? (
                        <div className="mt-4">
                          <ErrorBanner
                            error={t(
                              "Network error. Please try again.",
                              "Error de conexion. Intente de nuevo.",
                            )}
                            onRetry={handleUpload}
                            onDismiss={() => setResult(null)}
                          />
                        </div>
                      ) : (
                        <div className="mt-4">
                          <ErrorBanner
                            error={t(
                              `Validation failed${
                                result.errors?.length
                                  ? `: ${result.errors
                                      .map((error) => error.message)
                                      .join("; ")}`
                                  : ""
                              }`,
                              `Validacion fallida${
                                result.errors?.length
                                  ? `: ${result.errors
                                      .map((error) => error.message)
                                      .join("; ")}`
                                  : ""
                              }`,
                            )}
                            onRetry={() => {
                              setResult(null);
                              setFile(null);
                            }}
                            onDismiss={() => setResult(null)}
                          />
                        </div>
                      )
                    ) : null}

                    <button
                      onClick={handleUpload}
                      disabled={!displayJob.id || !file || uploading}
                      aria-describedby="submit-blocked-reason"
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#E8A020] px-6 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#d19218] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {uploading ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          {t(
                            "Uploading & Validating...",
                            "Cargando y validando...",
                          )}
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          {t("Submit Data", "Enviar Datos")}
                        </>
                      )}
                    </button>

                    {!uploading && (!displayJob.id || !file) ? (
                      <p
                        id="submit-blocked-reason"
                        className="mt-2 text-center text-xs text-slate-500"
                      >
                        {!displayJob.id
                          ? t(
                              "Select a report cycle in step 2 to enable Submit.",
                              "Seleccione un ciclo de informe en el paso 2 para habilitar Enviar.",
                            )
                          : t(
                              "Attach a CSV in step 4 to enable Submit.",
                              "Adjunte un CSV en el paso 4 para habilitar Enviar.",
                            )}
                      </p>
                    ) : null}

                    <ScanHistory
                      jobId={displayJob.id}
                      refreshKey={scanRefreshKey}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-6 cerniq-panel p-5">
            <div className="mb-4 flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-[#1ABFFF]" />
              <h3 className="text-sm font-semibold text-slate-900">
                {t("Need help?", "Necesita ayuda?")}
              </h3>
            </div>

            <FAQItem
              questionEn="What format should the CSV file be?"
              questionEs="Que formato debe tener el archivo CSV?"
              answerEn="Use the CERNIQ balance-sheet schema exactly: category, subcategory, name, balance, rate, duration, rateType, repriceDate, maturityDate."
              answerEs="Use exactamente el esquema de CERNIQ: category, subcategory, name, balance, rate, duration, rateType, repriceDate, maturityDate."
            />

            <FAQItem
              questionEn="What data do I need to include?"
              questionEs="Que datos necesito incluir?"
              answerEn="Include the institution's asset and liability rows with rates, durations, and reprice or maturity dates wherever they apply."
              answerEs="Incluya las filas de activos y pasivos de la institucion con tasas, duraciones y fechas de reprecio o vencimiento cuando correspondan."
            />

            <FAQItem
              questionEn="What happens after I submit?"
              questionEs="Que pasa despues de enviar?"
              answerEn="CERNIQ validates the file, imports the balance sheet, links the reporting period, and moves the report into processing. The portal will update as soon as the report is ready."
              answerEs="CERNIQ valida el archivo, importa el balance, enlaza el periodo y mueve el informe a procesamiento. El portal se actualizara cuando el informe este listo."
            />

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500">
                {t("Issues?", "Problemas?")}
              </p>
              <a
                href="mailto:soporte@cerniq.io"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#1ABFFF] hover:underline"
              >
                {t("Contact support", "Contactar soporte")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
