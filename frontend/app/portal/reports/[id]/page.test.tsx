import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from "react";
import ReportSuite from "./page";

const { useDocumentExportsMock, analyticsTrackMock, fetchMock } = vi.hoisted(
  () => ({
    useDocumentExportsMock: vi.fn(),
    analyticsTrackMock: vi.fn(),
    fetchMock: vi.fn(),
  }),
);

const reportProgressState = vi.hoisted(() => ({
  lastProps: null as null | {
    jobId: string;
    institutionName: string;
    initialStatus?: string;
    onComplete?: () => void | Promise<void>;
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "job-1" }),
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

vi.mock("@/hooks/useDocumentExports", () => ({
  useDocumentExports: useDocumentExportsMock,
}));

vi.mock("@/hooks/useAnalysisData", () => ({
  useAnalysisData: () => ({ data: null, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/components/portal/ReportProgressWS", () => ({
  default: (props: {
    jobId: string;
    institutionName: string;
    initialStatus?: string;
    onComplete?: () => void | Promise<void>;
  }) => {
    reportProgressState.lastProps = props;
    return (
      <button onClick={() => void props.onComplete?.()}>
        Progress stream {props.jobId} ({props.initialStatus})
      </button>
    );
  },
}));

vi.mock("@/lib/analytics", () => ({
  analytics: {
    track: analyticsTrackMock,
  },
  EVENTS: {
    PORTAL_REPORT_VIEWED: "Portal Report Viewed",
  },
}));

vi.mock("recharts", () => {
  const Noop = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Noop,
    BarChart: Noop,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    PieChart: Noop,
    Pie: Noop,
    Cell: () => null,
  };
});

vi.mock("lucide-react", () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ArrowLeft: Icon,
    Download: Icon,
    Globe: Icon,
    AlertTriangle: Icon,
    FileText: Icon,
    Upload: Icon,
    Eye: Icon,
    Shield: Icon,
    TrendingUp: Icon,
    Activity: Icon,
    Droplets: Icon,
    CheckCircle: Icon,
    XCircle: Icon,
    Minus: Icon,
    BarChart3: Icon,
    PieChart: Icon,
    Clock: Icon,
    Sparkles: Icon,
  };
});

describe("ReportSuite", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    analyticsTrackMock.mockReset();
    useDocumentExportsMock.mockReset();
    reportProgressState.lastProps = null;
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders a completed report with download buttons", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-1",
        institutionId: "inst-1",
        institutionName: "Cooperativa Test",
        status: "COMPLETE",
        analysisPeriod: "Q1-2026",
        submittedAt: "2026-04-08T10:15:00.000Z",
        processingStartedAt: "2026-04-08T10:20:00.000Z",
        completedAt: "2026-04-08T12:00:00.000Z",
        createdAt: "2026-04-08T10:00:00.000Z",
        reportLang: "es",
        triggeredBy: "portal_cycle_bootstrap",
        reportUrl: null,
        reportUrlEn: null,
        errorMessage: null,
      }),
    });

    const downloadMock = vi.fn();
    useDocumentExportsMock.mockReturnValue({
      manifests: [
        {
          id: "alm_report:job-1:es",
          kind: "alm_report",
          language: "es",
          status: "ready",
          filename: "alm-report-cooperativa-test-es.pdf",
          generatedAt: "2026-04-08T12:00:00.000Z",
          expiresAt: null,
          downloadUrl: "/api/portal/jobs/job-1/alm-report?lang=es",
        },
        {
          id: "alco_pack:job-1:es",
          kind: "alco_pack",
          language: "es",
          status: "ready",
          filename: "board-package-cooperativa-test-es.pdf",
          generatedAt: "2026-04-08T12:01:00.000Z",
          expiresAt: null,
          downloadUrl: "/api/portal/jobs/job-1/alco-pack?lang=es",
        },
      ],
      readyManifests: [
        {
          id: "alm_report:job-1:es",
          kind: "alm_report",
          language: "es",
          status: "ready",
          filename: "alm-report-cooperativa-test-es.pdf",
          generatedAt: "2026-04-08T12:00:00.000Z",
          expiresAt: null,
          downloadUrl: "/api/portal/jobs/job-1/alm-report?lang=es",
        },
        {
          id: "alco_pack:job-1:es",
          kind: "alco_pack",
          language: "es",
          status: "ready",
          filename: "board-package-cooperativa-test-es.pdf",
          generatedAt: "2026-04-08T12:01:00.000Z",
          expiresAt: null,
          downloadUrl: "/api/portal/jobs/job-1/alco-pack?lang=es",
        },
      ],
      error: null,
      loading: false,
      downloadingId: null,
      download: downloadMock,
      refresh: vi.fn(),
    });

    render(<ReportSuite />);

    expect(
      await screen.findByRole("button", { name: /download report/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /board pack/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /download report/i }));
    fireEvent.click(screen.getByRole("button", { name: /board pack/i }));

    expect(downloadMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "alm_report" }),
    );
    expect(downloadMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "alco_pack" }),
    );
    expect(analyticsTrackMock).toHaveBeenCalledWith("Portal Report Viewed", {
      jobId: "job-1",
      status: "COMPLETE",
    });
  });

  it("shows processing UI while a report is still running", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-1",
        institutionName: "Cooperativa Test",
        status: "PROCESSING",
        analysisPeriod: "Q1-2026",
        submittedAt: "2026-04-08T10:00:00.000Z",
        completedAt: null,
        createdAt: "2026-04-08T10:00:00.000Z",
        errorMessage: null,
      }),
    });

    useDocumentExportsMock.mockReturnValue({
      manifests: [],
      readyManifests: [],
      error: null,
      loading: false,
      downloadingId: null,
      download: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ReportSuite />);

    expect(
      await screen.findByRole("button", {
        name: /progress stream job-1 \(processing\)/i,
      }),
    ).toBeInTheDocument();
    expect(reportProgressState.lastProps).toMatchObject({
      jobId: "job-1",
      institutionName: "Cooperativa Test",
      initialStatus: "PROCESSING",
    });
  });

  it("reloads the report and refreshes exports when processing completes", async () => {
    const refreshSpy = vi.fn();
    let exportsReady = false;

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "job-1",
          institutionId: "inst-1",
          institutionName: "Cooperativa Test",
          status: "PROCESSING",
          analysisPeriod: "Q1-2026",
          submittedAt: "2026-04-08T10:00:00.000Z",
          completedAt: null,
          createdAt: "2026-04-08T10:00:00.000Z",
          errorMessage: null,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "job-1",
          institutionId: "inst-1",
          institutionName: "Cooperativa Test",
          status: "COMPLETE",
          analysisPeriod: "Q1-2026",
          submittedAt: "2026-04-08T10:15:00.000Z",
          processingStartedAt: "2026-04-08T10:20:00.000Z",
          completedAt: "2026-04-08T12:00:00.000Z",
          createdAt: "2026-04-08T10:00:00.000Z",
          reportLang: "es",
          triggeredBy: "portal_cycle_bootstrap",
          reportUrl: null,
          reportUrlEn: null,
          errorMessage: null,
        }),
      } as Response);

    useDocumentExportsMock.mockImplementation(() => {
      const readyManifests = exportsReady
        ? [
            {
              id: "alm_report:job-1:es",
              kind: "alm_report",
              language: "es",
              status: "ready",
              filename: "alm-report-cooperativa-test-es.pdf",
              generatedAt: "2026-04-08T12:00:00.000Z",
              expiresAt: null,
              downloadUrl: "/api/portal/jobs/job-1/alm-report?lang=es",
            },
          ]
        : [];

      return {
        manifests: readyManifests,
        readyManifests,
        error: null,
        loading: false,
        downloadingId: null,
        download: vi.fn(),
        refresh: vi.fn(async () => {
          exportsReady = true;
          refreshSpy();
        }),
      };
    });

    render(<ReportSuite />);

    await screen.findByRole("button", {
      name: /progress stream job-1 \(processing\)/i,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /progress stream job-1 \(processing\)/i,
      }),
    );

    await waitFor(() => {
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        screen.getByRole("button", { name: /download report/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows failed-state copy and error message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-1",
        institutionName: "Cooperativa Test",
        status: "FAILED",
        completedAt: null,
        createdAt: "2026-04-08T10:00:00.000Z",
        errorMessage: "PDF generation failed",
      }),
    });

    useDocumentExportsMock.mockReturnValue({
      manifests: [],
      readyManifests: [],
      error: null,
      loading: false,
      downloadingId: null,
      download: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ReportSuite />);

    expect(
      await screen.findByRole("heading", { name: /generation failed/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pdf generation failed/i)).toBeInTheDocument();
  });

  it("shows awaiting-data state with upload link", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "job-1",
        institutionName: "Cooperativa Test",
        status: "AWAITING_DATA",
        analysisPeriod: "Q2-2026",
        previousJobId: "job-previous",
        completedAt: null,
        createdAt: "2026-04-08T10:00:00.000Z",
        errorMessage: null,
      }),
    });

    useDocumentExportsMock.mockReturnValue({
      manifests: [],
      readyManifests: [],
      error: null,
      loading: false,
      downloadingId: null,
      download: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ReportSuite />);

    expect(
      await screen.findByRole("heading", { name: /submit balance sheet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /upload data/i }),
    ).toHaveAttribute("href", "/portal/submit?jobId=job-1");
  });

  it("shows not-found state when the portal job cannot be loaded", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => null,
    });

    useDocumentExportsMock.mockReturnValue({
      manifests: [],
      readyManifests: [],
      error: null,
      loading: false,
      downloadingId: null,
      download: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ReportSuite />);

    await waitFor(() => {
      expect(screen.getByText(/report not found/i)).toBeInTheDocument();
    });
  });
});
