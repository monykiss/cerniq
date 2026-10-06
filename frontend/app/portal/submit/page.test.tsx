import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {
  AnchorHTMLAttributes,
  ReactNode,
  SVGProps,
} from 'react';
import PortalSubmit from './page';

const {
  searchParams,
  trackMock,
  loadOverviewMock,
  openPortalReportCycleMock,
  hookState,
} = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  trackMock: vi.fn(),
  loadOverviewMock: vi.fn(),
  openPortalReportCycleMock: vi.fn(),
  hookState: {
    overview: null as unknown,
    loading: false,
    error: null as string | null,
    loadOverview: vi.fn(),
    setOverview: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { track: trackMock },
  EVENTS: {
    PORTAL_DATA_SUBMITTED: 'PORTAL_DATA_SUBMITTED',
    PORTAL_DATA_VALIDATION_FAILED: 'PORTAL_DATA_VALIDATION_FAILED',
  },
}));

vi.mock('@/components/portal/ProgressTracker', () => ({
  default: ({ currentStep }: { currentStep: number }) => (
    <div>Progress step {currentStep}</div>
  ),
}));

vi.mock('@/components/ui/cerniq', () => ({
  SkeletonLoader: () => <div>Loading skeleton</div>,
  EmptyState: ({
    title,
    description,
    actionLabel,
    onAction,
  }: {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {actionLabel ? <button onClick={onAction}>{actionLabel}</button> : null}
    </div>
  ),
  ErrorBanner: ({
    error,
    onRetry,
  }: {
    error: string;
    onRetry?: () => void;
  }) => (
    <div>
      <div>{error}</div>
      {onRetry ? <button onClick={onRetry}>Try again / Intente de nuevo</button> : null}
    </div>
  ),
}));

vi.mock('@/components/portal/ReportProgressWS', () => ({
  default: ({ jobId }: { jobId: string }) => <div>Progress stream {jobId}</div>,
}));

vi.mock('@/components/exports/DocumentExportButtons', () => ({
  default: () => <div>Export buttons</div>,
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    openPortalReportCycle: openPortalReportCycleMock,
  },
  // `authFetch` reads the bearer token from here before every request; omitting
  // it made the mocked module shape diverge from the real one.
  getAccessToken: () => 'test-access-token',
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    Upload: Icon,
    Download: Icon,
    FileText: Icon,
    CheckCircle: Icon,
    ArrowRight: Icon,
    HelpCircle: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    ClipboardList: Icon,
    Clock3: Icon,
    Sparkles: Icon,
    AlertTriangle: Icon,
    Eye: Icon,
  };
});

const overviewMock = {
  jobs: [
    {
      id: 'job-awaiting',
      institutionName: 'Coop San Juan',
      status: 'AWAITING_DATA',
      analysisPeriod: null,
      previousJobId: null,
      submittedAt: null,
      processingStartedAt: null,
      completedAt: null,
      createdAt: '2026-04-08T10:00:00.000Z',
      reportUrl: null,
      reportUrlEn: null,
      reportLang: 'es',
      errorMessage: null,
      userId: 'user-1',
      triggeredBy: 'portal_submit_seed',
    },
  ],
  latestActionableJob: {
    id: 'job-awaiting',
    institutionName: 'Coop San Juan',
    status: 'AWAITING_DATA',
    analysisPeriod: null,
    previousJobId: null,
    submittedAt: null,
    processingStartedAt: null,
    completedAt: null,
    createdAt: '2026-04-08T10:00:00.000Z',
    reportUrl: null,
    reportUrlEn: null,
    reportLang: 'es',
    errorMessage: null,
    userId: 'user-1',
    triggeredBy: 'portal_submit_seed',
  },
  workflowState: 'needs_upload',
  counts: {
    total: 1,
    awaitingData: 1,
    validationFailed: 0,
    processing: 0,
    complete: 0,
  },
  demoSeat: { isDemo: false, seat: null },
  nextAction: {
    labelEn: 'Upload balance-sheet data',
    labelEs: 'Cargar datos del balance',
    href: '/portal/submit?jobId=job-awaiting',
    jobId: 'job-awaiting',
    explanationEn: 'Upload now.',
    explanationEs: 'Cargue ahora.',
  },
  validationSummary: null,
};

vi.mock('@/hooks/usePortalOverview', () => ({
  usePortalOverview: () => hookState,
}));

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((event: { target: { result: string } }) => void) | null = null;

  readAsText() {
    this.result =
      'category,subcategory,name,balance,rate,duration,rateType,repriceDate,maturityDate\nasset,residential_mortgages,Pool A,7.5,5.75,12.0,fixed,,2038-03-01';
    this.onload?.({ target: { result: this.result as string } });
  }
}

describe('PortalSubmit', () => {
  beforeEach(() => {
    searchParams.delete('jobId');
    searchParams.delete('createCycle');
    trackMock.mockReset();
    loadOverviewMock.mockReset();
    openPortalReportCycleMock.mockReset();
    hookState.overview = overviewMock;
    hookState.loading = false;
    hookState.error = null;
    hookState.loadOverview = loadOverviewMock;
    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the seeded San Juan job instead of an empty state', () => {
    render(<PortalSubmit />);

    expect(screen.getByText('Coop San Juan')).toBeInTheDocument();
    expect(
      screen.queryByText('No report cycle is currently open'),
    ).not.toBeInTheDocument();
  });

  it('transitions into processing after a successful upload', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          valid: true,
          status: 'QUEUED',
          jobId: 'job-awaiting',
          institutionId: 'inst-1',
          institutionName: 'Coop San Juan',
          itemsImported: 40,
          warningCount: 2,
          nextHref: '/portal/reports/job-awaiting',
        },
      }),
    } as Response);

    const { container } = render(<PortalSubmit />);
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['csv'], 'balance.csv', { type: 'text/csv' });

    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Data' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Submission received. CERNIQ is processing your report now.',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Progress stream job-awaiting')).toBeInTheDocument();
    expect(loadOverviewMock).toHaveBeenCalled();
  });

  // Regression: a job stuck in VALIDATION_FAILED rendered its STORED error in
  // alarming red indefinitely. A user who had already selected a good file
  // still saw "CSV must have a header row and at least one data row" and
  // concluded the upload was broken. The stored result must be presented as
  // history, not as a verdict on the file currently staged.
  it('labels a stored validation failure as a previous attempt, not a fresh verdict', () => {
    hookState.overview = {
      ...overviewMock,
      // The rendered state derives from the SELECTED job, so the jobs array and
      // latestActionableJob must both reflect the failure.
      jobs: overviewMock.jobs.map((job) => ({
        ...job,
        status: 'VALIDATION_FAILED',
      })),
      workflowState: 'validation_failed',
      latestActionableJob: {
        ...overviewMock.latestActionableJob,
        status: 'VALIDATION_FAILED',
      },
      validationSummary: {
        sourceFilename: 'cerniq-balance-sheet-v1(1).csv',
        status: 'FAILED',
        totalRows: 0,
        validRows: 0,
        errorRows: 1,
        importedCount: 0,
        warningCount: 0,
        errorCount: 1,
        warnings: [],
        errors: [
          { message: 'CSV must have a header row and at least one data row' },
        ],
      },
    } as unknown as typeof overviewMock;

    render(<PortalSubmit />);

    expect(
      screen.getByText(/Result of your previous attempt/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Validation needs attention/i),
    ).not.toBeInTheDocument();
    // The row accounting is shown so the scan is inspectable, not just a message.
    expect(
      screen.getByText('cerniq-balance-sheet-v1(1).csv'),
    ).toBeInTheDocument();
  });

  it('documents the real CSV schema in the help rail', () => {
    render(<PortalSubmit />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'What format should the CSV file be?',
      }),
    );

    expect(
      screen.getByText(/category, subcategory, name, balance, rate, duration/i),
    ).toBeInTheDocument();
  });

  it('bootstraps a report cycle when createCycle=1 and no actionable job exists', async () => {
    searchParams.set('createCycle', '1');
    hookState.overview = {
      ...overviewMock,
      jobs: [],
      latestActionableJob: null,
      workflowState: 'needs_report',
      counts: {
        total: 0,
        awaitingData: 0,
        validationFailed: 0,
        processing: 0,
        complete: 0,
      },
    };
    openPortalReportCycleMock.mockResolvedValue({
      jobId: 'job-created',
      institutionId: 'inst-1',
      institutionName: 'Coop Created',
      status: 'AWAITING_DATA',
      nextHref: '/portal/submit?jobId=job-created',
    });

    render(<PortalSubmit />);

    await waitFor(() => {
      expect(openPortalReportCycleMock).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces a retryable error when report-cycle bootstrap fails', async () => {
    searchParams.set('createCycle', '1');
    hookState.overview = {
      ...overviewMock,
      jobs: [],
      latestActionableJob: null,
      workflowState: 'needs_report',
      counts: {
        total: 0,
        awaitingData: 0,
        validationFailed: 0,
        processing: 0,
        complete: 0,
      },
    };
    openPortalReportCycleMock.mockRejectedValueOnce(
      new Error('Timed out while creating a report cycle.'),
    );

    render(<PortalSubmit />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not open a report cycle right now. Please try again.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('retries report-cycle bootstrap after a bootstrap error', async () => {
    searchParams.set('createCycle', '1');
    hookState.overview = {
      ...overviewMock,
      jobs: [],
      latestActionableJob: null,
      workflowState: 'needs_report',
      counts: {
        total: 0,
        awaitingData: 0,
        validationFailed: 0,
        processing: 0,
        complete: 0,
      },
    };
    openPortalReportCycleMock
      .mockRejectedValueOnce(
        new Error('Timed out while creating a report cycle.'),
      )
      .mockResolvedValueOnce({
        jobId: 'job-created',
        institutionId: 'inst-1',
        institutionName: 'Coop Created',
        status: 'AWAITING_DATA',
        nextHref: '/portal/submit?jobId=job-created',
      });

    render(<PortalSubmit />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Try again / Intente de nuevo' }),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Try again / Intente de nuevo' }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openPortalReportCycleMock.mock.calls.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(loadOverviewMock).toHaveBeenCalled();
  });

  it('shows degraded export delivery state for completed jobs without a full manifest package', () => {
    hookState.overview = {
      ...overviewMock,
      jobs: [
        {
          id: 'job-complete',
          institutionId: 'inst-1',
          institutionName: 'Coop Export',
          status: 'COMPLETE',
          analysisPeriod: 'Q1-2026',
          previousJobId: null,
          submittedAt: '2026-04-08T10:00:00.000Z',
          processingStartedAt: '2026-04-08T10:05:00.000Z',
          completedAt: '2026-04-08T10:10:00.000Z',
          createdAt: '2026-04-08T09:00:00.000Z',
          reportUrl: null,
          reportUrlEn: null,
          reportLang: 'es',
          errorMessage: null,
          userId: 'user-1',
          triggeredBy: 'portal_submit',
          exportSummary: {
            manifestPath: '/api/portal/jobs/job-complete/exports',
            status: 'partial',
            readyCount: 2,
            totalCount: 4,
            readyReportLanguages: ['es', 'en'],
            missingReportLanguages: [],
            readyBoardPackLanguages: [],
            missingBoardPackLanguages: ['es', 'en'],
          },
        },
      ],
      latestActionableJob: {
        id: 'job-complete',
        institutionId: 'inst-1',
        institutionName: 'Coop Export',
        status: 'COMPLETE',
        analysisPeriod: 'Q1-2026',
        previousJobId: null,
        submittedAt: '2026-04-08T10:00:00.000Z',
        processingStartedAt: '2026-04-08T10:05:00.000Z',
        completedAt: '2026-04-08T10:10:00.000Z',
        createdAt: '2026-04-08T09:00:00.000Z',
        reportUrl: null,
        reportUrlEn: null,
        reportLang: 'es',
        errorMessage: null,
        userId: 'user-1',
        triggeredBy: 'portal_submit',
        exportSummary: {
          manifestPath: '/api/portal/jobs/job-complete/exports',
          status: 'partial',
          readyCount: 2,
          totalCount: 4,
          readyReportLanguages: ['es', 'en'],
          missingReportLanguages: [],
          readyBoardPackLanguages: [],
          missingBoardPackLanguages: ['es', 'en'],
        },
      },
      workflowState: 'export_degraded',
      counts: {
        total: 1,
        awaitingData: 0,
        validationFailed: 0,
        processing: 0,
        complete: 1,
      },
      nextAction: {
        labelEn: 'Review export availability',
        labelEs: 'Revisar disponibilidad de exportacion',
        href: '/portal/reports/job-complete',
        jobId: 'job-complete',
        explanationEn:
          'The report job finished, but one or more export files still need recovery before delivery is fully complete.',
        explanationEs:
          'El trabajo del informe termino, pero uno o mas archivos de exportacion todavia necesitan recuperarse antes de completar la entrega.',
      },
      validationSummary: null,
    };

    render(<PortalSubmit />);

    expect(
      screen.getByText(
        'The report finished, but export delivery still needs recovery.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 4 export artifacts are ready/i)).toBeInTheDocument();
  });
});
