import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from "react";
import type { PortalOverview } from "@/lib/portal-overview";
import PortalHome from "./page";

const searchParams = new URLSearchParams();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ locale: "en" }),
}));

vi.mock("@/lib/features", () => ({
  useFeature: () => ({ enabled: true }),
  getFeature: () => ({ enabled: true }),
}));

vi.mock("./layout", () => ({
  usePortal: () => ({
    user: { id: "user-1", name: "Maria" },
    subscription: { tier: "monthly", status: "active" },
    access: { platformAccessAllowed: true, isDemo: false },
  }),
}));

vi.mock("@/lib/subscription", () => ({
  rememberPortalUser: vi.fn(),
}));

vi.mock("@/lib/access", () => ({
  isActiveDemo: () => false,
}));

vi.mock("@/components/portal/ReportProgressWS", () => ({
  default: () => <div>Report progress</div>,
}));

vi.mock("@/components/exports/DocumentExportButtons", () => ({
  default: () => <div>Export buttons</div>,
}));

vi.mock("@/components/portal/DemoSeatBanner", () => ({
  default: () => <div>Demo banner</div>,
}));

vi.mock("@/components/portal/ReportSuite", () => ({
  default: () => <div data-testid="report-suite">Report suite</div>,
}));

vi.mock("@/components/ui/cerniq", () => ({
  MetricStrip: ({ items }: { items: Array<{ label: string; value: unknown }> }) => (
    <div data-testid="metric-strip">
      {items.map((item) => (
        <span key={item.label}>
          {item.label}: {String(item.value)}
        </span>
      ))}
    </div>
  ),
  SkeletonLoader: () => <div>Loading...</div>,
  ErrorBanner: ({ error }: { error: string }) => <div>{error}</div>,
  DataTable: ({
    rows,
    caption,
  }: {
    rows: Array<{ id: string; institutionName: string }>;
    caption: string;
    columns: unknown[];
    rowKey: (row: unknown) => string;
  }) => (
    <table aria-label={caption}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.institutionName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const baseJob = {
  id: "job-awaiting",
  institutionId: null as string | null,
  institutionName: "Coop San Juan",
  status: "AWAITING_DATA",
  analysisPeriod: null as string | null,
  previousJobId: null as string | null,
  submittedAt: null as string | null,
  processingStartedAt: null as string | null,
  completedAt: null as string | null,
  createdAt: "2026-04-08T10:00:00.000Z",
  reportUrl: null as string | null,
  reportUrlEn: null as string | null,
  reportLang: "es",
  errorMessage: null as string | null,
  userId: "user-1",
  triggeredBy: "portal_submit_seed",
};

const overviewState = {
  overview: {
    jobs: [baseJob],
    latestActionableJob: baseJob,
    workflowState: "needs_upload" as PortalOverview["workflowState"],
    counts: {
      total: 1,
      awaitingData: 1,
      validationFailed: 0,
      processing: 0,
      complete: 0,
    },
    demoSeat: { isDemo: false, seat: null },
    nextAction: {
      labelEn: "Upload balance-sheet data",
      labelEs: "Cargar datos del balance",
      href: "/portal/submit?jobId=job-awaiting",
      jobId: "job-awaiting",
      explanationEn:
        "Your report cycle is waiting for the CSV needed to start validation and analysis.",
      explanationEs:
        "El ciclo de informe esta esperando el CSV para comenzar la validacion y el analisis.",
    },
    validationSummary: null,
  } satisfies PortalOverview,
  loading: false,
  error: null as string | null,
  loadOverview: vi.fn(),
  setOverview: vi.fn(),
};

vi.mock("@/hooks/usePortalOverview", () => ({
  usePortalOverview: () => overviewState,
}));

vi.mock("lucide-react", () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    Upload: Icon,
    Download: Icon,
    Eye: Icon,
    ArrowRight: Icon,
    AlertTriangle: Icon,
    Play: Icon,
    CheckCircle2: Icon,
    Loader2: Icon,
    Lock: Icon,
    Circle: Icon,
  };
});

describe("PortalHome", () => {
  beforeEach(() => {
    searchParams.delete("welcome");
    pushMock.mockReset();
  });

  it("shows action bar with upload prompt when latest job is awaiting data", () => {
    render(<PortalHome />);

    expect(
      screen.getByText(/waiting for the CSV/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /Upload balance-sheet data/i })[0],
    ).toHaveAttribute("href", "/portal/submit?jobId=job-awaiting");
  });

  it("shows report ready strip when a completed job exists", () => {
    const completedJob = {
      ...baseJob,
      id: "job-complete",
      institutionId: "inst-1",
      institutionName: "Coop Export",
      status: "COMPLETE",
      analysisPeriod: "Q1-2026",
      submittedAt: "2026-04-08T10:00:00.000Z",
      processingStartedAt: "2026-04-08T10:05:00.000Z",
      completedAt: "2026-04-08T10:10:00.000Z",
      triggeredBy: "portal_submit",
      exportSummary: {
        manifestPath: "/api/portal/jobs/job-complete/exports",
        status: "ready" as const,
        readyCount: 4,
        totalCount: 4,
        readyReportLanguages: ["es" as const, "en" as const],
        missingReportLanguages: [] as Array<"en" | "es">,
        readyBoardPackLanguages: ["es" as const, "en" as const],
        missingBoardPackLanguages: [] as Array<"en" | "es">,
      },
    };

    overviewState.overview = {
      ...overviewState.overview,
      jobs: [completedJob],
      latestActionableJob: completedJob,
      workflowState: "report_ready",
      counts: {
        total: 1,
        awaitingData: 0,
        validationFailed: 0,
        processing: 0,
        complete: 1,
      },
      nextAction: {
        labelEn: "View report",
        labelEs: "Ver informe",
        href: "/portal/reports/job-complete",
        jobId: "job-complete",
        explanationEn: "Your report is ready.",
        explanationEs: "Su informe esta listo.",
      },
    } satisfies PortalOverview;

    render(<PortalHome />);

    expect(
      screen.getByText(/ALM report for Coop Export is ready/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /View Report/i })[0],
    ).toHaveAttribute("href", "/portal/reports/job-complete");
  });

  it("renders the report suite component", () => {
    render(<PortalHome />);
    expect(screen.getByTestId("report-suite")).toBeInTheDocument();
  });

  it("renders metric strip with counts", () => {
    render(<PortalHome />);
    expect(screen.getByTestId("metric-strip")).toBeInTheDocument();
    expect(screen.getByText(/Reports: 1/)).toBeInTheDocument();
  });
});
