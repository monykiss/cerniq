"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertTriangle,
  Eye,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { useTranslation } from "@/lib/i18n";
import { unwrapApiData } from "@/lib/api-response";
import { getAccessToken } from "@/lib/api";
import DocumentExportButtons from "@/components/exports/DocumentExportButtons";

const NODE_API_URL = (process.env.NEXT_PUBLIC_NODE_API_URL || "")
  .trim()
  .replace(/\/+$/, "");

/* ---------- Types ---------- */
interface ProgressEvent {
  jobId: string;
  step: string;
  stepNumber: number;
  totalSteps: number;
  percentComplete: number;
  message: string;
  messageEs: string;
  timestamp: string;
}

interface CompleteEvent {
  jobId: string;
  reportUrl?: string | null;
  reportUrlEn?: string | null;
  manifestPath: string;
  timestamp: string;
}

interface ErrorEvent {
  jobId: string;
  error: string;
  timestamp: string;
}

interface ReportProgressWSProps {
  jobId: string;
  institutionName: string;
  initialStatus?: string;
  onComplete?: () => void;
  onStatusChange?: (status: string) => void;
}

const PROGRESS_POLL_INTERVAL_MS = 8000;
const PROGRESS_STALE_THRESHOLD_MS = 15000;

function mapJobStatusToStep(status?: string): string {
  switch (status) {
    case "QUEUED":
    case "PROCESSING":
    case "VALIDATING":
      return "VALIDATING";
    case "GENERATING_PDF":
      return "PDF_GENERATION";
    case "UPLOADING":
      return "UPLOADING";
    case "COMPLETE":
      return "COMPLETE";
    case "FAILED":
      return "FAILED";
    default:
      return "VALIDATING";
  }
}

function mapJobStatusToPercent(status?: string): number {
  switch (status) {
    case "QUEUED":
      return 5;
    case "PROCESSING":
    case "VALIDATING":
      return 30;
    case "GENERATING_PDF":
      return 80;
    case "UPLOADING":
      return 95;
    case "COMPLETE":
      return 100;
    default:
      return 0;
  }
}

function stepRank(step: string): number {
  return PIPELINE_STEPS.findIndex((item) => item.key === step);
}

/* ---------- Pipeline steps definition ---------- */
const PIPELINE_STEPS = [
  { key: "VALIDATING", labelEn: "Validating data", labelEs: "Validando datos" },
  { key: "COSSEC_CALC", labelEn: "COSSEC ratios", labelEs: "Ratios COSSEC" },
  {
    key: "MONTE_CARLO",
    labelEn: "Monte Carlo simulation",
    labelEs: "Simulacion Monte Carlo",
  },
  {
    key: "STRESS_TEST",
    labelEn: "Stress testing",
    labelEs: "Pruebas de estres",
  },
  {
    key: "PDF_GENERATION",
    labelEn: "Generating PDF",
    labelEs: "Generando PDF",
  },
  {
    key: "UPLOADING",
    labelEn: "Uploading report",
    labelEs: "Subiendo informe",
  },
  { key: "COMPLETE", labelEn: "Complete", labelEs: "Completado" },
];

/* ---------- Elapsed timer ---------- */
function useElapsedTime() {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return { elapsed, formatted, stop };
}

/* ---------- Polling fallback ---------- */
function usePollFallback(
  jobId: string,
  enabled: boolean,
  onStatusChange: (status: string) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      try {
        const token = getAccessToken() || null;
        const res = await authFetch(`${NODE_API_URL}/api/portal/jobs/${jobId}`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = unwrapApiData<{ status?: string }>(
            await res.json().catch(() => ({})),
          );
          if (data?.status) {
            onStatusChange(data.status);
          }
        }
      } catch {
        // Silently retry on next interval
      }
    }, PROGRESS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [jobId, enabled, onStatusChange]);
}

/* ---------- Main Component ---------- */
export default function ReportProgressWS({
  jobId,
  institutionName,
  initialStatus,
  onComplete,
  onStatusChange,
}: ReportProgressWSProps) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  const [connected, setConnected] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>(
    mapJobStatusToStep(initialStatus),
  );
  const [percentComplete, setPercentComplete] = useState(
    mapJobStatusToPercent(initialStatus),
  );
  const [currentMessage, setCurrentMessage] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [wsFailedOver, setWsFailedOver] = useState(false);
  const [completionManifestPath, setCompletionManifestPath] = useState(
    `/api/portal/jobs/${jobId}/exports`,
  );
  // Lazy initializers keep Date.now() out of the render body
  // (react-hooks/purity). `nowMs` is advanced via an interval ticker below.
  const [lastStatusSyncAt, setLastStatusSyncAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const socketRef = useRef<Socket | null>(null);
  const { formatted: elapsedFormatted, stop: stopTimer } = useElapsedTime();

  // 5s ticker drives the staleness check without polluting the render body.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Polling fallback when WebSocket is not connected
  const handlePollStatus = useCallback(
    (status: string) => {
      setLastStatusSyncAt(Date.now());
      const step = mapJobStatusToStep(status);
      if (status === "COMPLETE") {
        setIsComplete(true);
        setCurrentStep("COMPLETE");
        setPercentComplete(100);
        stopTimer();
        onStatusChange?.("COMPLETE");
        onComplete?.();
      } else if (status === "FAILED") {
        setIsError(true);
        setErrorMessage("Report generation failed");
        stopTimer();
        onStatusChange?.("FAILED");
      } else {
        setCurrentStep((previous) =>
          stepRank(step) > stepRank(previous) ? step : previous,
        );
        setPercentComplete((previous) =>
          Math.max(previous, mapJobStatusToPercent(status) || 10),
        );
        onStatusChange?.(status);
      }
    },
    [onComplete, onStatusChange, stopTimer],
  );

  usePollFallback(
    jobId,
    !isComplete && !isError,
    handlePollStatus,
  );

  // WebSocket connection
  useEffect(() => {
    const socketUrl = NODE_API_URL ? `${NODE_API_URL}/pipeline` : "/pipeline";

    const socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setWsFailedOver(false);
      setLastStatusSyncAt(Date.now());
      // Join the job room
      socket.emit("join", jobId);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", () => {
      setConnected(false);
      // After failing to connect, fallback to polling
      setWsFailedOver(true);
    });

    socket.on("pipeline:progress", (data: ProgressEvent) => {
      if (data.jobId !== jobId) return;
      setLastStatusSyncAt(Date.now());
      setCurrentStep(data.step);
      setPercentComplete(data.percentComplete);
      setCurrentMessage(locale === "en" ? data.message : data.messageEs);
      onStatusChange?.(data.step === "COMPLETE" ? "COMPLETE" : data.step);
    });

    socket.on("pipeline:complete", (data: CompleteEvent) => {
      if (data.jobId !== jobId) return;
      setLastStatusSyncAt(Date.now());
      setCompletionManifestPath(
        data.manifestPath || `/api/portal/jobs/${jobId}/exports`,
      );
      setIsComplete(true);
      setCurrentStep("COMPLETE");
      setPercentComplete(100);
      stopTimer();
      onStatusChange?.("COMPLETE");
      onComplete?.();
    });

    socket.on("pipeline:error", (data: ErrorEvent) => {
      if (data.jobId !== jobId) return;
      setLastStatusSyncAt(Date.now());
      setIsError(true);
      setErrorMessage(data.error);
      stopTimer();
      onStatusChange?.("FAILED");
    });

    return () => {
      socket.emit("leave", jobId);
      socket.close();
      socketRef.current = null;
    };
     
  }, [jobId, locale, onComplete, onStatusChange, stopTimer]);

  // Find the current step index
  const currentStepIndex = PIPELINE_STEPS.findIndex(
    (s) => s.key === currentStep,
  );
  const isProgressStale =
    !isComplete &&
    !isError &&
    nowMs - lastStatusSyncAt > PROGRESS_STALE_THRESHOLD_MS;

  /* ---------- Completion celebration state ---------- */
  if (isComplete) {
    return (
      <div className="cerniq-panel p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#18C87A]/10">
            <CheckCircle className="h-8 w-8 text-[#18C87A]" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">
            {t("Report is Ready!", "El Informe esta Listo!")}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {t(
              `Your ALM report for ${institutionName} is ready for download.`,
              `Su informe ALM para ${institutionName} esta listo para descargar.`,
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("Completed in", "Completado en")} {elapsedFormatted}
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href={`/portal/reports/${jobId}`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E8A020] px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#d19218] transition-colors"
            >
              <Eye className="h-4 w-4" />
              {t("View report", "Ver informe")}
            </Link>
            <DocumentExportButtons
              manifestPath={completionManifestPath}
              kinds={["alm_report"]}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ---------- Error state ---------- */
  if (isError) {
    return (
      <div className="cerniq-panel p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
            <AlertTriangle className="h-8 w-8 text-rose-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">
            {t("Processing Error", "Error de Procesamiento")}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {t(
              "An error occurred while generating your report. Our team has been notified.",
              "Ocurrio un error al generar su informe. Nuestro equipo ha sido notificado.",
            )}
          </p>
          {errorMessage && (
            <p className="mt-2 rounded-lg bg-rose-50 px-4 py-2 text-xs text-rose-600 font-mono">
              {errorMessage}
            </p>
          )}
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            {t("Refresh", "Actualizar")}
          </button>
        </div>
      </div>
    );
  }

  /* ---------- Progress state ---------- */
  return (
    <div className="cerniq-panel p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("Processing your ALM analysis", "Procesando su analisis ALM")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{institutionName}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-[#18C87A]" />
            ) : wsFailedOver || isProgressStale ? (
              <WifiOff className="h-3.5 w-3.5 text-[#E8A020]" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-slate-300" />
            )}
            <span className="text-[10px] text-slate-400">
              {connected
                ? t("Live", "En vivo")
                : wsFailedOver || isProgressStale
                  ? t("Polling", "Consultando")
                  : t("Connecting...", "Conectando...")}
            </span>
          </div>
          {/* Elapsed timer */}
          <div className="rounded-lg bg-slate-100 px-3 py-1.5">
            <span className="text-xs font-mono text-slate-600">
              {elapsedFormatted}
            </span>
          </div>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#1ABFFF]">
            {(isProgressStale
              ? t(
                  "Still processing, refreshing status...",
                  "Todavia procesando, actualizando estado...",
                )
              : currentMessage) ||
              (locale === "en"
                ? PIPELINE_STEPS[Math.max(0, currentStepIndex)]?.labelEn ||
                  "Processing..."
                : PIPELINE_STEPS[Math.max(0, currentStepIndex)]?.labelEs ||
                  "Procesando...")}
          </span>
          <span className="text-xs font-semibold text-slate-600">
            {percentComplete}%
          </span>
        </div>
        <div className="cerniq-progress-track">
          <div
            className="cerniq-progress-bar"
            style={{
              width: `${percentComplete}%`,
              transition: "width 0.8s ease-in-out",
            }}
          />
        </div>
      </div>

      {/* Step list */}
      <div className="space-y-3">
        {PIPELINE_STEPS.map((step, idx) => {
          const isDone =
            idx < currentStepIndex || (isComplete && idx <= currentStepIndex);
          const isCurrent = idx === currentStepIndex;

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-300 ${
                isCurrent
                  ? "bg-[#1ABFFF]/5 border border-[#1ABFFF]/20"
                  : isDone
                    ? "bg-[#18C87A]/5"
                    : "bg-slate-50"
              }`}
            >
              {/* Step icon */}
              <div className="flex-shrink-0">
                {isDone ? (
                  <CheckCircle className="h-5 w-5 text-[#18C87A]" />
                ) : isCurrent ? (
                  <Loader2 className="h-5 w-5 text-[#1ABFFF] animate-spin" />
                ) : (
                  <Circle className="h-5 w-5 text-slate-300" />
                )}
              </div>

              {/* Step label */}
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    isDone
                      ? "text-[#18C87A]"
                      : isCurrent
                        ? "text-[#1ABFFF]"
                        : "text-slate-400"
                  }`}
                >
                  {locale === "en" ? step.labelEn : step.labelEs}
                </p>
              </div>

              {/* Step number */}
              <span
                className={`text-xs ${
                  isDone
                    ? "text-[#18C87A]"
                    : isCurrent
                      ? "text-[#1ABFFF]"
                      : "text-slate-300"
                }`}
              >
                {idx + 1}/{PIPELINE_STEPS.length}
              </span>
            </div>
          );
        })}
      </div>

      {/* Estimated time */}
      <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 p-4 text-center">
        <p className="text-xs text-slate-500">
          <strong className="text-slate-700">
            {t("Estimated time", "Tiempo estimado")}:
          </strong>{" "}
          {t("30-60 minutes", "30-60 minutos")}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          {t(
            "We will email you when it is ready. You can close this page safely.",
            "Le enviaremos un email cuando este listo. Puede cerrar esta pagina de forma segura.",
          )}
        </p>
      </div>
    </div>
  );
}
