"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Download,
  Globe,
  AlertTriangle,
  FileText,
  Upload,
  Eye,
  Shield,
  Sparkles,
  Activity,
  Droplets,
  CheckCircle,
  XCircle,
  Minus,
  BarChart3,
  PieChart as PieChartIcon,
} from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { analytics, EVENTS } from "@/lib/analytics";
import { getPublicApiUrl } from "@/lib/api-base";
import { unwrapApiData } from "@/lib/api-response";
import { useDocumentExports } from "@/hooks/useDocumentExports";
import { useAnalysisData, type AnalysisData, type ComplianceRatio } from "@/hooks/useAnalysisData";
import { useReportDataGaps } from "@/hooks/useReportDataGaps";
import { DataGapBanner } from "@/components/ui/cerniq/DataGapBanner";
import { useTranslation } from "@/lib/i18n";
import ReportProgressWS from "@/components/portal/ReportProgressWS";
import { MetricStrip } from "@/components/ui/cerniq/MetricStrip";
import type { PortalExportSummary } from "@/lib/portal-overview";

const AnalystPanel = dynamic(() => import("@/components/portal/AnalystPanel"), {
  ssr: false,
  loading: () => null,
});

/* ───── types ───── */

interface JobDetail {
  id: string;
  institutionName: string;
  institutionId?: string | null;
  status: string;
  analysisPeriod?: string | null;
  previousJobId?: string | null;
  submittedAt?: string | null;
  processingStartedAt?: string | null;
  completedAt: string | null;
  createdAt: string;
  reportUrl?: string | null;
  reportUrlEn?: string | null;
  reportLang?: string;
  triggeredBy?: string | null;
  errorMessage: string | null;
  exportSummary?: PortalExportSummary | null;
}

type ReportTab =
  | "overview"
  | "balance-sheet"
  | "interest-rate"
  | "liquidity"
  | "compliance"
  | "full-report";

/* ───── constants ───── */

const REPORT_VIEWER_TIMEOUT_MS = 10000;

const PROCESSING_STATUSES = [
  "QUEUED",
  "PROCESSING",
  "GENERATING_PDF",
  "UPLOADING",
  "VALIDATING",
];

const PIE_COLORS = [
  "#1B3A6B",
  "#E8A020",
  "#1ABFFF",
  "#18C87A",
  "#7C3AED",
  "#F43F5E",
  "#0EA5E9",
  "#D97706",
];

/* ───── helpers ───── */

/** Format a value or return gap em-dash with tooltip. */
function gapOr(
  gapForField: (f: string) => import("@/hooks/useReportDataGaps").DataGap | undefined,
  field: string,
  value: number | null | undefined,
  formatter: (v: number) => string,
): { value: string; tooltip?: string } {
  const gap = gapForField(field);
  if (gap) return { value: "—", tooltip: `${gap.severity}: ${gap.reason}` };
  if (value === null || value === undefined) return { value: "—" };
  return { value: formatter(value) };
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtYears(value: number): string {
  return `${value.toFixed(2)}`;
}

function fmtCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function fmtBps(value: number): string {
  return value >= 0 ? `+${value}bps` : `${value}bps`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

/* ───── Tab navigation ───── */

function TabNav({
  active,
  onChange,
  hasAnalysis,
  hasPdf,
  locale,
}: {
  active: ReportTab;
  onChange: (tab: ReportTab) => void;
  hasAnalysis: boolean;
  hasPdf: boolean;
  locale: string;
}) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  const tabs: Array<{
    id: ReportTab;
    label: string;
    icon: React.ElementType;
    enabled: boolean;
  }> = [
    {
      id: "overview",
      label: t("Overview", "Resumen"),
      icon: Eye,
      enabled: true,
    },
    {
      id: "balance-sheet",
      label: t("Balance Sheet", "Balance General"),
      icon: PieChartIcon,
      enabled: hasAnalysis,
    },
    {
      id: "interest-rate",
      label: t("Interest Rate Risk", "Riesgo de Tasa"),
      icon: Activity,
      enabled: hasAnalysis,
    },
    {
      id: "liquidity",
      label: t("Liquidity", "Liquidez"),
      icon: Droplets,
      enabled: hasAnalysis,
    },
    {
      id: "compliance",
      label: t("COSSEC Compliance", "Cumplimiento COSSEC"),
      icon: Shield,
      enabled: hasAnalysis,
    },
    {
      id: "full-report",
      label: t("Full Report PDF", "Informe PDF"),
      icon: FileText,
      enabled: hasPdf,
    },
  ];

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-6"
      aria-label="Report sections"
    >
      {tabs
        .filter((tab) => tab.enabled)
        .map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
              active === id
                ? "border-[#1B3A6B] text-[#1B3A6B]"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
            aria-current={active === id ? "page" : undefined}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
    </nav>
  );
}

/* ───── Overview Tab ───── */

function OverviewTab({
  job,
  analysis,
  locale,
  gapForField,
}: {
  job: JobDetail;
  analysis: AnalysisData | null;
  locale: string;
  gapForField: (field: string) => import("@/hooks/useReportDataGaps").DataGap | undefined;
}) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  const inst = analysis?.institution;
  const bs = analysis?.balanceSheet;
  const irr = analysis?.interestRateRisk;
  const liq = analysis?.liquidity;
  const comp = analysis?.compliance;

  return (
    <div className="space-y-8 p-6 sm:p-8">
      {/* Institution header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-3xl font-bold text-slate-900">
            {job.institutionName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {inst?.type && (
              <span className="capitalize">{inst.type.replace(/_/g, " ")}</span>
            )}
            {inst?.totalAssets ? ` · ${fmtCurrency(inst.totalAssets)} ${t("total assets", "activos totales")}` : ""}
            {job.analysisPeriod ? ` · ${job.analysisPeriod}` : ""}
          </p>
        </div>
        {job.completedAt && (
          <span className="text-xs text-slate-400">
            {t("Generated", "Generado")} {formatDate(job.completedAt)}
          </span>
        )}
      </div>

      {/* Key metrics — Bloomberg-density strip, gap-aware (D1) */}
      {bs && (
        <MetricStrip
          density="comfortable"
          items={[
            { label: t("Total Assets", "Activos Totales"), value: fmtCurrency(bs.totalAssets) },
            {
              label: t("Duration Gap", "Brecha Duración"),
              ...gapOr(gapForField, "duration.gap", irr?.durationGap, (v) => `${fmtYears(v)}y`),
              tooltip: gapForField("duration.gap")?.reason ?? t("Target: -1 to +3y", "Objetivo: -1 a +3a"),
            },
            {
              label: t("NIM", "Margen NII"),
              ...gapOr(gapForField, "interestRateRisk.nim", irr?.nim, fmtPct),
              delta: !gapForField("interestRateRisk.nim") && irr && irr.nim != null ? (irr.nim - 0.029) * 100 : undefined,
              deltaFormat: "percent" as const,
              tooltip: gapForField("interestRateRisk.nim")?.reason ?? t("vs sector median 2.9%", "vs mediana sector 2.9%"),
            },
            {
              label: t("Capital Ratio", "Ratio Capital"),
              value: bs.totalAssets > 0 ? fmtPct(bs.totalEquity / bs.totalAssets) : "—",
              tooltip: t("COSSEC threshold: 8%", "Umbral COSSEC: 8%"),
            },
            {
              label: "LCR",
              ...gapOr(gapForField, "liquidity.lcr", liq?.lcr, fmtPct),
              tooltip: gapForField("liquidity.lcr")?.reason ?? t("Required: 100%", "Requerido: 100%"),
            },
            ...(liq
              ? [
                  {
                    label: "HQLA",
                    ...gapOr(gapForField, "liquidity.hqlaTotal", liq.hqlaTotal, fmtCurrency),
                  },
                  {
                    label: t("Loan/Deposit", "Prést./Dep."),
                    value: fmtPct(liq.loanToDeposit),
                    tooltip: t("Target: <80%", "Objetivo: <80%"),
                  },
                ]
              : []),
          ]}
        />
      )}

      {/* NII Sensitivity chart */}
      {irr && irr.scenarios.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
            {t("NII Sensitivity by Rate Scenario", "Sensibilidad NII por Escenario de Tasa")}
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={irr.scenarios.map((s) => ({
                name: fmtBps(s.shiftBps),
                nii: s.niImpact,
                eve: s.mveImpact,
              }))}
              margin={{ top: 8, right: 16, bottom: 0, left: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: "#64748b" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                tickFormatter={(v) => fmtCurrency(v)}
              />
              <Tooltip
                formatter={(value) => fmtCurrency(Number(value ?? 0))}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 13,
                }}
              />
              <Bar
                dataKey="nii"
                name={t("NII Impact", "Impacto NII")}
                fill="#1B3A6B"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="eve"
                name={t("EVE Impact", "Impacto EVE")}
                fill="#E8A020"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* COSSEC Compliance summary */}
      {comp && comp.ratios.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            {t("COSSEC Compliance Summary", "Resumen de Cumplimiento COSSEC")}
          </h3>
          <ComplianceGrid ratios={comp.ratios} locale={locale} />
        </div>
      )}

      {/* No analysis data fallback */}
      {!bs && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 py-12 text-center">
          <BarChart3 className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">
            {t(
              "Structured analysis data is not yet available for this report.",
              "Los datos de análisis estructurado aún no están disponibles para este informe.",
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t(
              "Switch to the Full Report PDF tab to view the generated report.",
              "Cambie a la pestaña PDF del Informe Completo para ver el informe generado.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* ───── Balance Sheet Tab ───── */

function BalanceSheetTab({ analysis, locale }: { analysis: AnalysisData | null; locale: string }) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const bs = analysis?.balanceSheet;

  if (!bs) return null;

  const subcategoryLabels: Record<string, string> = {
    loans: t("Loans", "Préstamos"),
    securities: t("Securities", "Valores"),
    cash: t("Cash & Equivalents", "Efectivo"),
    deposits: t("Deposits", "Depósitos"),
    borrowings: t("Borrowings", "Préstamos Obtenidos"),
    equity: t("Equity", "Capital"),
  };

  const assetPieData = bs.assetBreakdown.map((g, i) => ({
    name: subcategoryLabels[g.subcategory] || g.subcategory,
    value: g.total,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const liabilityPieData = bs.liabilityBreakdown.map((g, i) => ({
    name: subcategoryLabels[g.subcategory] || g.subcategory,
    value: g.total,
    fill: PIE_COLORS[(i + 3) % PIE_COLORS.length],
  }));

  return (
    <div className="space-y-8 p-6 sm:p-8">
      {/* Balance sheet summary — dense strip */}
      <MetricStrip
        density="comfortable"
        items={[
          { label: t("Total Assets", "Activos Totales"), value: fmtCurrency(bs.totalAssets) },
          { label: t("Total Liabilities", "Pasivos Totales"), value: fmtCurrency(bs.totalLiabilities) },
          {
            label: t("Total Equity", "Capital Total"),
            value: fmtCurrency(bs.totalEquity),
            delta: bs.totalAssets > 0 ? (bs.totalEquity / bs.totalAssets) * 100 : undefined,
            deltaFormat: "percent",
            tooltip: t("Equity / Assets", "Capital / Activos"),
          },
        ]}
      />

      {/* Composition charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {assetPieData.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              {t("Asset Composition", "Composición de Activos")}
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={assetPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {assetPieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtCurrency(Number(v ?? 0))} />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {liabilityPieData.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              {t("Liability Composition", "Composición de Pasivos")}
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={liabilityPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {liabilityPieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtCurrency(Number(v ?? 0))} />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Line items table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-700">
            {t("Balance Sheet Detail", "Detalle del Balance General")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/60 text-left">
                <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Item", "Partida")}
                </th>
                <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Category", "Categoría")}
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Balance", "Saldo")}
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Rate", "Tasa")}
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Duration", "Duración")}
                </th>
                <th className="px-6 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Type", "Tipo")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bs.items.map((item, i) => (
                <tr key={`${item.name}-${i}`} className="hover:bg-slate-50/50">
                  <td className="px-6 py-3 font-medium text-slate-900">
                    {item.name}
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 capitalize">
                      {item.subcategory}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-slate-700">
                    {fmtCurrency(item.balance)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-slate-700">
                    {fmtPct(item.rate)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-slate-700">
                    {fmtYears(item.duration)}y
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.rateType === "fixed"
                          ? "bg-blue-50 text-blue-700"
                          : item.rateType === "variable"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {item.rateType}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ───── Interest Rate Risk Tab ───── */

function InterestRateTab({ analysis, locale, gapForField }: { analysis: AnalysisData | null; locale: string; gapForField: (field: string) => import("@/hooks/useReportDataGaps").DataGap | undefined }) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const irr = analysis?.interestRateRisk;

  if (!irr) return null;

  return (
    <div className="space-y-8 p-6 sm:p-8">
      {/* Duration analysis — dense strip, gap-aware (D1) */}
      <MetricStrip
        density="comfortable"
        items={[
          { label: t("Asset Duration", "Duración Activos"), ...gapOr(gapForField, "duration.assetDuration", irr.assetDuration, (v) => `${fmtYears(v)}y`) },
          { label: t("Liability Duration", "Duración Pasivos"), ...gapOr(gapForField, "duration.liabilityDuration", irr.liabilityDuration, (v) => `${fmtYears(v)}y`) },
          {
            label: t("Duration Gap", "Brecha Duración"),
            ...gapOr(gapForField, "duration.gap", irr.durationGap, (v) => `${fmtYears(v)}y`),
            tooltip: gapForField("duration.gap")?.reason ?? t("Target: -1 to +3y", "Objetivo: -1 a +3a"),
          },
          {
            label: t("Earning Yield", "Rendimiento"),
            value: fmtPct(irr.earningAssetYield),
            delta: irr.earningAssetYield ? (irr.earningAssetYield - 0.048) * 100 : undefined,
            deltaFormat: "percent" as const,
            tooltip: t("vs sector 4.8%", "vs sector 4.8%"),
          },
          {
            label: t("Cost of Funds", "Costo Fondos"),
            value: fmtPct(irr.costOfFunds),
            tooltip: t("Sector median: 1.9%", "Mediana: 1.9%"),
          },
          {
            label: "NIM",
            ...gapOr(gapForField, "interestRateRisk.nim", irr.nim, fmtPct),
            delta: !gapForField("interestRateRisk.nim") && irr.nim ? (irr.nim - 0.025) * 100 : undefined,
            deltaFormat: "percent" as const,
            tooltip: gapForField("interestRateRisk.nim")?.reason ?? t("Threshold: 2.5%+", "Umbral: 2.5%+"),
          },
        ]}
      />

      {/* Scenario analysis chart */}
      {irr.scenarios.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            {t(
              "NII & EVE Sensitivity — 7 Rate Scenarios",
              "Sensibilidad NII y EVE — 7 Escenarios de Tasa",
            )}
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            {t(
              "Impact on Net Interest Income and Economic Value of Equity under parallel rate shocks",
              "Impacto en Ingreso Neto por Intereses y Valor Económico del Capital bajo choques paralelos de tasa",
            )}
          </p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={irr.scenarios.map((s) => ({
                scenario: fmtBps(s.shiftBps),
                nii: s.niImpact,
                eve: s.mveImpact,
              }))}
              margin={{ top: 8, right: 16, bottom: 0, left: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="scenario"
                tick={{ fontSize: 12, fill: "#64748b" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                tickFormatter={(v) => fmtCurrency(v)}
              />
              <Tooltip
                formatter={(value, name) => [
                  fmtCurrency(Number(value ?? 0)),
                  String(name),
                ]}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 13,
                }}
              />
              <Legend />
              <Bar
                dataKey="nii"
                name={t("NII Impact ($)", "Impacto NII ($)")}
                fill="#1B3A6B"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="eve"
                name={t("EVE Impact ($)", "Impacto EVE ($)")}
                fill="#E8A020"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Scenario detail table */}
      {irr.scenarios.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-sm font-semibold text-slate-700">
              {t("Scenario Detail", "Detalle de Escenarios")}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 text-left">
                  <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("Scenario", "Escenario")}
                  </th>
                  <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("Rate Shift", "Cambio de Tasa")}
                  </th>
                  <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("NII Impact", "Impacto NII")}
                  </th>
                  <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {t("EVE Impact", "Impacto EVE")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {irr.scenarios.map((s) => (
                  <tr key={s.shiftBps} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {s.name}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums text-slate-700">
                      {fmtBps(s.shiftBps)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right tabular-nums ${
                        s.niImpact >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {fmtCurrency(s.niImpact)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right tabular-nums ${
                        s.mveImpact >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {fmtCurrency(s.mveImpact)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───── Liquidity Tab ───── */

function LiquidityTab({ analysis, locale, gapForField }: { analysis: AnalysisData | null; locale: string; gapForField: (field: string) => import("@/hooks/useReportDataGaps").DataGap | undefined }) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const liq = analysis?.liquidity;

  if (!liq) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        {t(
          "Liquidity data is not available for this report.",
          "Los datos de liquidez no están disponibles para este informe.",
        )}
      </div>
    );
  }

  const flowData = [
    {
      name: t("HQLA L1", "HQLA N1"),
      value: liq.hqlaLevel1,
      fill: "#1B3A6B",
    },
    {
      name: t("HQLA L2", "HQLA N2"),
      value: liq.hqlaLevel2,
      fill: "#1ABFFF",
    },
    {
      name: t("Cash Outflows", "Flujos de Salida"),
      value: liq.cashOutflows,
      fill: "#F43F5E",
    },
    {
      name: t("Cash Inflows", "Flujos de Entrada"),
      value: liq.cashInflows,
      fill: "#18C87A",
    },
  ];

  return (
    <div className="space-y-8 p-6 sm:p-8">
      {/* Key liquidity metrics — dense strip, gap-aware (D1) */}
      <MetricStrip
        density="comfortable"
        items={[
          {
            label: "LCR",
            ...gapOr(gapForField, "liquidity.lcr", liq.lcr, fmtPct),
            tooltip: gapForField("liquidity.lcr")?.reason ?? t("Required: 100%", "Requerido: 100%"),
          },
          {
            label: "NSFR",
            ...gapOr(gapForField, "liquidity.nsfr", liq.nsfr, fmtPct),
            tooltip: gapForField("liquidity.nsfr")?.reason ?? t("Required: 100%", "Requerido: 100%"),
          },
          { label: "HQLA", ...gapOr(gapForField, "liquidity.hqlaTotal", liq.hqlaTotal, fmtCurrency) },
          {
            label: t("Loan/Deposit", "Prést./Dep."),
            value: fmtPct(liq.loanToDeposit),
            tooltip: t("Target: <80%", "Objetivo: <80%"),
          },
        ]}
      />

      {/* Cash flow composition */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
          {t("Liquidity Composition", "Composición de Liquidez")}
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={flowData}
            margin={{ top: 8, right: 16, bottom: 0, left: 16 }}
            layout="vertical"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: "#64748b" }}
              tickFormatter={(v) => fmtCurrency(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12, fill: "#64748b" }}
              width={120}
            />
            <Tooltip
              formatter={(v) => fmtCurrency(Number(v ?? 0))}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                fontSize: 13,
              }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {flowData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ───── Compliance Tab ───── */

function ComplianceTab({ analysis, locale }: { analysis: AnalysisData | null; locale: string }) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const comp = analysis?.compliance;

  if (!comp || comp.ratios.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        {t(
          "Compliance data is not available for this report.",
          "Los datos de cumplimiento no están disponibles.",
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6 sm:p-8">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900">
          {t("COSSEC Regulatory Compliance", "Cumplimiento Regulatorio COSSEC")}
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          {t(
            "Key regulatory ratios compared against COSSEC thresholds and sector medians for 91 active cooperativas.",
            "Razones regulatorias clave comparadas con umbrales de COSSEC y medianas del sector de 91 cooperativas activas.",
          )}
        </p>
      </div>

      <ComplianceGrid ratios={comp.ratios} locale={locale} detailed />
    </div>
  );
}

/* ───── Compliance grid (reused in overview + compliance tab) ───── */

function ComplianceGrid({
  ratios,
  locale,
  detailed,
}: {
  ratios: ComplianceRatio[];
  locale: string;
  detailed?: boolean;
}) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  function getStatus(ratio: ComplianceRatio): "pass" | "warning" | "fail" | "unavailable" {
    if (ratio.status === "data_unavailable" || ratio.value === null) return "unavailable";
    if (ratio.thresholdLow !== undefined && ratio.thresholdHigh !== undefined) {
      if (ratio.value >= ratio.thresholdLow && ratio.value <= ratio.thresholdHigh) return "pass";
      return Math.abs(ratio.value - ratio.sectorMedian) < Math.abs(ratio.sectorMedian * 0.3) ? "warning" : "fail";
    }
    if (ratio.invertThreshold) {
      return ratio.value <= (ratio.threshold || 0) ? "pass" : ratio.value <= (ratio.threshold || 0) * 1.3 ? "warning" : "fail";
    }
    return ratio.value >= (ratio.threshold || 0) ? "pass" : ratio.value >= (ratio.threshold || 0) * 0.8 ? "warning" : "fail";
  }

  function formatValue(ratio: ComplianceRatio): string {
    if (ratio.value === null) return "—";
    if (ratio.format === "years") return `${ratio.value.toFixed(2)}y`;
    return fmtPct(ratio.value);
  }

  const statusIcon = {
    pass: <CheckCircle className="h-5 w-5 text-emerald-500" />,
    warning: <Minus className="h-5 w-5 text-amber-500" />,
    fail: <XCircle className="h-5 w-5 text-rose-500" />,
    unavailable: <Minus className="h-5 w-5 text-slate-300" />,
  };

  if (detailed) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/60">
                <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Status", "Estado")}
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Ratio", "Razón")}
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Value", "Valor")}
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Threshold", "Umbral")}
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("Sector Median", "Mediana Sector")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ratios.map((ratio) => {
                const status = getStatus(ratio);
                return (
                  <tr key={ratio.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4">{statusIcon[status]}</td>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {locale === "en" ? ratio.nameEn : ratio.nameEs}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums font-semibold text-slate-900">
                      {formatValue(ratio)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-500">
                      {ratio.thresholdLow !== undefined
                        ? `${ratio.thresholdLow}–${ratio.thresholdHigh}${ratio.format === "years" ? "y" : ""}`
                        : ratio.threshold !== undefined
                          ? ratio.format === "years"
                            ? `${ratio.threshold}y`
                            : fmtPct(ratio.threshold)
                          : "—"}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-500">
                      {ratio.format === "years"
                        ? `${ratio.sectorMedian}y`
                        : fmtPct(ratio.sectorMedian)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50/60 border-b border-slate-200">
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("Ratio", "Razón")}
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("Value", "Valor")}
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("Threshold", "Umbral")}
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("Peer", "Sector")}
            </th>
          </tr>
        </thead>
        <tbody>
          {ratios.map((ratio) => {
            const status = getStatus(ratio);
            return (
              <tr key={ratio.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="px-3 py-2 text-center">{statusIcon[status]}</td>
                <td className="px-3 py-2 text-xs font-medium text-slate-700 truncate max-w-[200px]">
                  {locale === "en" ? ratio.nameEn : ratio.nameEs}
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {formatValue(ratio)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-500 tabular-nums">
                  {ratio.threshold != null ? (ratio.format === "years" ? `${ratio.threshold.toFixed(1)}y` : fmtPct(ratio.threshold)) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-500 tabular-nums">
                  {ratio.sectorMedian != null ? (ratio.format === "years" ? `${ratio.sectorMedian.toFixed(1)}y` : fmtPct(ratio.sectorMedian)) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───── Full Report PDF Tab ───── */

function FullReportTab({
  pdfUrl,
  locale,
}: {
  pdfUrl: string | null;
  locale: string;
}) {
  const t = (en: string, es: string) => (locale === "en" ? en : es);

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        {t("PDF report is not available yet.", "El PDF del informe aún no está disponible.")}
      </div>
    );
  }

  return (
    <iframe
      src={pdfUrl}
      className="w-full h-full min-h-[800px]"
      title="ALM Report PDF"
    />
  );
}

/* ═══════════════════════════════════════════════════
   MAIN REPORT SUITE PAGE
   ═══════════════════════════════════════════════════ */

export default function ReportSuite() {
  const params = useParams();
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === "en" ? en : es);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");
  const [pdfLang, setPdfLang] = useState<"es" | "en">("es");
  const [analystOpen, setAnalystOpen] = useState(false);

  const jobId =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : undefined;

  const {
    readyManifests,
    error: exportError,
    downloadingId,
    download,
    refresh,
  } = useDocumentExports(
    jobId ? `/api/portal/jobs/${jobId}/exports` : undefined,
    { enabled: Boolean(jobId) },
  );

  const {
    data: analysisData,
    loading: analysisLoading,
  } = useAnalysisData(job?.status === "COMPLETE" ? jobId : undefined);

  const gapSummary = useReportDataGaps(analysisData?.gaps);

  const loadJob = useCallback(
    async (trackView = false) => {
      if (!jobId) {
        setJob(null);
        setLoading(false);
        return null;
      }

      setLoading(true);
      setLoadError(null);
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          REPORT_VIEWER_TIMEOUT_MS,
        );
        const res = await authFetch(getPublicApiUrl(`/api/portal/jobs/${jobId}`), {
          credentials: "include",
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        if (!res.ok) {
          setLoadError(
            res.status === 404
              ? "Report not found."
              : "Could not load this report right now.",
          );
          setJob(null);
          return null;
        }

        const data = unwrapApiData<JobDetail | null>(
          await res.json().catch(() => null),
        );
        if (!data) {
          setLoadError("Could not load this report right now.");
          setJob(null);
          return null;
        }

        setJob(data);
        if (trackView) {
          analytics.track(EVENTS.PORTAL_REPORT_VIEWED, {
            jobId: data.id,
            status: data.status,
          });
        }
        return data;
      } catch {
        setLoadError("Could not load this report right now.");
        setJob(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [jobId],
  );

  const handleComplete = useCallback(async () => {
    await refresh();
    await loadJob();
  }, [loadJob, refresh]);

  useEffect(() => {
    void loadJob(true);
  }, [loadJob]);

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="w-8 h-8 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ── Error / not found ── */
  if (!job) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 mb-4">{loadError || "Report not found."}</p>
        <div className="flex items-center justify-center gap-3">
          {jobId && (
            <button
              onClick={() => void loadJob(true)}
              className="text-sm text-[#1B3A6B] hover:underline"
            >
              Retry
            </button>
          )}
          <Link href="/portal" className="text-sm text-[#1B3A6B] hover:underline">
            {t("Back to dashboard", "Volver al panel")}
          </Link>
        </div>
      </div>
    );
  }

  /* ── Processing state ── */
  const isProcessing = PROCESSING_STATUSES.includes(job.status);
  if (isProcessing) {
    return (
      <div className="h-full flex flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <Link href="/portal" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              {job.institutionName}
            </h1>
            <p className="text-xs text-slate-400">
              {t("Processing...", "Procesando...")}
            </p>
          </div>
        </header>
        <div className="flex-1 p-6">
          <ReportProgressWS
            jobId={job.id}
            institutionName={job.institutionName}
            initialStatus={job.status}
            onComplete={handleComplete}
          />
        </div>
      </div>
    );
  }

  /* ── Awaiting data ── */
  if (job.status === "AWAITING_DATA" || job.status === "VALIDATION_FAILED") {
    return (
      <div className="h-full flex flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <Link href="/portal" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              {job.institutionName}
            </h1>
            <p className="text-xs text-slate-400">
              {t("Awaiting data submission", "Esperando envío de datos")}
            </p>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <Upload className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {job.status === "VALIDATION_FAILED"
                ? t("Fix Validation Errors", "Corregir Errores")
                : t("Submit Balance Sheet", "Enviar Balance")}
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              {t(
                "Upload your balance sheet CSV to generate this report.",
                "Suba su CSV de balance para generar este informe.",
              )}
            </p>
            <Link
              href={`/portal/submit?jobId=${job.id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E8A020] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d19218]"
            >
              <Upload className="h-4 w-4" />
              {t("Upload Data", "Subir Datos")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ── Failed state ── */
  if (job.status === "FAILED") {
    return (
      <div className="h-full flex flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <Link href="/portal" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              {job.institutionName}
            </h1>
            <p className="text-xs text-rose-500">{t("Failed", "Error")}</p>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <AlertTriangle className="h-12 w-12 text-rose-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {t("Generation Failed", "Error de Generación")}
            </h2>
            <p className="text-sm text-slate-500 mb-2">
              {t(
                "There was an issue generating this report. Our team has been notified.",
                "Hubo un problema generando este informe. Nuestro equipo ha sido notificado.",
              )}
            </p>
            {job.errorMessage && (
              <p className="text-xs text-rose-500 bg-rose-50 p-3 rounded-lg">
                {job.errorMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Complete state: Full report suite ── */

  const reportManifests = readyManifests.filter(
    (m) => m.kind === "alm_report",
  );
  const currentManifest =
    reportManifests.find((m) => m.language === pdfLang) ||
    reportManifests[0] ||
    null;
  const boardPackManifest =
    readyManifests.find(
      (m) => m.kind === "alco_pack" && m.language === pdfLang,
    ) ||
    readyManifests.find((m) => m.kind === "alco_pack") ||
    null;
  const currentPdfUrl = currentManifest?.downloadUrl || null;
  const hasAnalysis = Boolean(analysisData?.balanceSheet) || analysisLoading;

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/portal" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              {job.institutionName}
            </h1>
            <p className="text-xs text-slate-400">
              {job.analysisPeriod || ""}{" "}
              {job.completedAt &&
                `· ${t("Generated", "Generado")} ${formatDate(job.completedAt)}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Language toggle */}
          {reportManifests.length > 1 && (
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setPdfLang("es")}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${pdfLang === "es" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}
              >
                <Globe className="h-3 w-3" /> ES
              </button>
              <button
                onClick={() => setPdfLang("en")}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${pdfLang === "en" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}
              >
                <Globe className="h-3 w-3" /> EN
              </button>
            </div>
          )}
          {currentManifest && (
            <button
              onClick={() => void download(currentManifest)}
              disabled={downloadingId === currentManifest.id || gapSummary.hasCritical}
              title={gapSummary.hasCritical
                ? t(
                    `Download blocked: ${gapSummary.criticalCount} critical data gap(s) must be resolved before sharing this report.`,
                    `Descarga bloqueada: ${gapSummary.criticalCount} brecha(s) de datos critica(s) deben resolverse antes de compartir este informe.`,
                  )
                : undefined}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1B3A6B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#15305a] disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloadingId === currentManifest.id
                ? t("Preparing...", "Preparando...")
                : gapSummary.hasCritical
                  ? t("Gaps must be resolved", "Resolver brechas primero")
                  : t("Download Report", "Descargar Informe")}
            </button>
          )}
          {boardPackManifest && (
            <button
              onClick={() => void download(boardPackManifest)}
              disabled={downloadingId === boardPackManifest.id}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloadingId === boardPackManifest.id
                ? t("Preparing...", "Preparando...")
                : t("Board Pack", "Pack Junta")}
            </button>
          )}
        </div>
      </header>

      {exportError && (
        <div className="border-b border-rose-100 bg-rose-50 px-6 py-2 text-xs text-rose-700">
          {exportError}
        </div>
      )}

      {/* ── Data gap warning (D1 contract) ── */}
      {gapSummary.hasGaps && (
        <DataGapBanner
          gaps={gapSummary.gaps}
          criticalCount={gapSummary.criticalCount}
          warningCount={gapSummary.warningCount}
          className="mx-6 mt-3"
        />
      )}

      {/* ── Tab navigation ── */}
      <TabNav
        active={activeTab}
        onChange={setActiveTab}
        hasAnalysis={hasAnalysis}
        hasPdf={Boolean(currentPdfUrl)}
        locale={locale}
      />

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto bg-slate-50/30">
        {analysisLoading && activeTab !== "full-report" && activeTab !== "overview" ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#1B3A6B]" />
          </div>
        ) : (
          <>
            {activeTab === "overview" && (
              <OverviewTab job={job} analysis={analysisData} locale={locale} gapForField={gapSummary.gapForField} />
            )}
            {activeTab === "balance-sheet" && (
              <BalanceSheetTab analysis={analysisData} locale={locale} />
            )}
            {activeTab === "interest-rate" && (
              <InterestRateTab analysis={analysisData} locale={locale} gapForField={gapSummary.gapForField} />
            )}
            {activeTab === "liquidity" && (
              <LiquidityTab analysis={analysisData} locale={locale} gapForField={gapSummary.gapForField} />
            )}
            {activeTab === "compliance" && (
              <ComplianceTab analysis={analysisData} locale={locale} />
            )}
            {activeTab === "full-report" && (
              <FullReportTab pdfUrl={currentPdfUrl} locale={locale} />
            )}
          </>
        )}
      </div>

      {/* ── CERNIQ Analyst floating trigger ── */}
      {!analystOpen && job.institutionId && (
        <button
          onClick={() => setAnalystOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-[#1B3A6B] px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#15305a] hover:-translate-y-0.5"
          aria-label={t("Open CERNIQ Analyst", "Abrir CERNIQ Analyst")}
        >
          <Sparkles className="h-4 w-4 text-amber-300" />
          {t("Ask Analyst", "Preguntar al Analista")}
        </button>
      )}

      {/* ── CERNIQ Analyst slide-out panel ── */}
      {analystOpen && job.institutionId && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md shadow-2xl">
          <AnalystPanel
            institutionId={job.institutionId}
            institutionName={job.institutionName}
            onClose={() => setAnalystOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
