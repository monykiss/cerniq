import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

const mockAxiosInstance = {
  delete: vi.fn(),
  get: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  post: vi.fn(),
  put: vi.fn(),
  request: vi.fn(),
};

// Mock axios before importing apiClient
vi.mock('axios', async () => {
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      post: vi.fn(),
    },
  };
});

const isSupabaseAuthEnabledMock = vi.fn(() => false);
const signInWithSupabasePasswordMock = vi.fn();
const signOutSupabaseMock = vi.fn();

vi.mock('./supabase/client', () => ({
  isSupabaseAuthEnabled: () => isSupabaseAuthEnabledMock(),
  getSupabaseBrowserClient: () => null,
}));

vi.mock('./supabase/session', () => ({
  signInWithSupabasePassword: (...args: unknown[]) =>
    signInWithSupabasePasswordMock(...args),
  signOutSupabase: (...args: unknown[]) => signOutSupabaseMock(...args),
  getSupabaseAccessToken: vi.fn().mockResolvedValue(''),
  syncSupabaseAccessTokenToStorage: vi.fn().mockResolvedValue(''),
}));

const getStoredOrganizationIdMock = vi.fn(() => '');

vi.mock('./org-context', () => ({
  getStoredOrganizationId: () => getStoredOrganizationIdMock(),
}));

describe('APIClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    isSupabaseAuthEnabledMock.mockReturnValue(false);
    signInWithSupabasePasswordMock.mockReset();
    signOutSupabaseMock.mockReset();
    getStoredOrganizationIdMock.mockReset();
    getStoredOrganizationIdMock.mockReturnValue('');
    mockAxiosInstance.delete.mockReset();
    mockAxiosInstance.get.mockReset();
    mockAxiosInstance.interceptors.request.use.mockReset();
    mockAxiosInstance.interceptors.response.use.mockReset();
    mockAxiosInstance.post.mockReset();
    mockAxiosInstance.put.mockReset();
    mockAxiosInstance.request.mockReset();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('creates an axios instance with correct baseURL config', async () => {
    // Re-import to trigger constructor
    await import('./api');

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      })
    );
  });

  it('sets up request and response interceptors', async () => {
    await import('./api');

    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockInstance.interceptors.request.use).toHaveBeenCalled();
    expect(mockInstance.interceptors.response.use).toHaveBeenCalled();
  });

  it('request interceptor attaches x-organization-id when org is stored', async () => {
    getStoredOrganizationIdMock.mockReturnValue('org-abc');
    await import('./api');

    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    const [handler] = mockInstance.interceptors.request.use.mock.calls[0];
    const cfg = handler({ headers: {} });
    expect(cfg.headers['x-organization-id']).toBe('org-abc');
  });

  it('exports apiClient with expected methods', async () => {
    const { apiClient } = await import('./api');

    // Core authentication methods
    expect(typeof apiClient.register).toBe('function');
    expect(typeof apiClient.login).toBe('function');
    expect(typeof apiClient.logout).toBe('function');
    expect(typeof apiClient.getCurrentUser).toBe('function');
    expect(typeof apiClient.requestPasswordReset).toBe('function');
    expect(typeof apiClient.confirmPasswordReset).toBe('function');

    // Admin methods
    expect(typeof apiClient.getDemoRequests).toBe('function');
    expect(typeof apiClient.getAdminStats).toBe('function');
    expect(typeof apiClient.getAdminOps).toBe('function');
    expect(typeof apiClient.getAdminPipeline).toBe('function');
    expect(typeof apiClient.runAdminPipelineAction).toBe('function');
    expect(typeof apiClient.getAdminAuditLogs).toBe('function');
  });

  it('preserves dashboard return URLs in the magic-link login flow', async () => {
    const { buildLoginRedirectUrl } = await import('./api');

    expect(buildLoginRedirectUrl('/dashboard')).toBe(
      '/login?returnUrl=%2Fdashboard&mode=magic-link',
    );
    expect(buildLoginRedirectUrl('/dashboard/report/job-1')).toBe(
      '/login?returnUrl=%2Fdashboard%2Freport%2Fjob-1&mode=magic-link',
    );
  });

  it('marks passive profile checks to skip auth redirects', async () => {
    const { apiClient } = await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockInstance.get.mockResolvedValueOnce({ data: { id: 'u_1', email: 'test@cerniq.io' } });

    await apiClient.getCurrentUser();

    expect(mockInstance.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/profile'),
      expect.objectContaining({ skipAuthRedirect: true })
    );
  });

  it('unwraps enveloped profile responses', async () => {
    const { apiClient } = await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockInstance.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: 'u_1', email: 'test@cerniq.io' },
      },
    });

    await expect(apiClient.getCurrentUser()).resolves.toEqual({
      id: 'u_1',
      email: 'test@cerniq.io',
    });
  });

  it('loads the canonical portal overview envelope', async () => {
    const { apiClient } = await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockInstance.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
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
          demoSeat: null,
          nextAction: {
            labelEn: 'Create report',
            labelEs: 'Crear informe',
            href: '/portal',
            jobId: null,
            explanationEn: 'Start a report cycle.',
            explanationEs: 'Inicia un ciclo.',
          },
          validationSummary: null,
        },
      },
    });

    await expect(apiClient.getPortalOverview()).resolves.toMatchObject({
      workflowState: 'needs_report',
      jobs: [],
    });
    expect(mockInstance.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/portal/overview'),
    );
  });

  it('returns normalized metadata from demo request submissions', async () => {
    const { apiClient } = await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockInstance.post.mockResolvedValueOnce({
      data: {
        id: 'demo-123',
        message: 'Demo request received',
      },
    });

    await expect(
      apiClient.submitDemoRequest({
        email: 'maria@example.coop',
        name: 'Maria',
        institutionName: 'Example Coop',
        institutionType: 'cooperativa',
        totalAssets: '$42,000,000',
      }),
    ).resolves.toEqual({
      leadId: null,
      demoRequestId: 'demo-123',
      institutionName: 'Example Coop',
      institutionType: 'cooperativa',
      message: 'Demo request received',
      duplicateLead: false,
    });
    expect(mockInstance.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/demo-request'),
      expect.any(Object),
    );
  });

  it('loads portal job detail through the canonical report endpoint', async () => {
    const { apiClient } = await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockInstance.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 'job-1',
          institutionId: 'inst-1',
          institutionName: 'CoopAhorro',
          status: 'COMPLETE',
          analysisPeriod: 'Q1-2026',
          previousJobId: null,
          submittedAt: null,
          processingStartedAt: null,
          completedAt: '2026-04-18T00:00:00.000Z',
          createdAt: '2026-04-18T00:00:00.000Z',
          reportUrl: null,
          reportUrlEn: null,
          reportLang: 'es',
          errorMessage: null,
          userId: 'u_1',
          triggeredBy: 'portal_cycle_bootstrap',
          exportSummary: {
            manifestPath: '/api/portal/jobs/job-1/exports',
            status: 'ready',
            readyCount: 4,
            totalCount: 4,
            readyReportLanguages: ['es', 'en'],
            missingReportLanguages: [],
            readyBoardPackLanguages: ['es', 'en'],
            missingBoardPackLanguages: [],
          },
        },
      },
    });

    await expect(apiClient.getPortalJob('job-1')).resolves.toMatchObject({
      id: 'job-1',
      exportSummary: expect.objectContaining({ status: 'ready' }),
    });
    expect(mockInstance.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/portal/jobs/job-1'),
    );
  });

  it('loads portal export manifests through the canonical exports endpoint', async () => {
    const { apiClient } = await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockInstance.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: 'alm_report-job-1-es',
            kind: 'alm_report',
            language: 'es',
            status: 'ready',
            downloadUrl: '/api/portal/jobs/job-1/alm-report?lang=es',
          },
        ],
      },
    });

    await expect(apiClient.getPortalJobExports('job-1')).resolves.toEqual([
      expect.objectContaining({
        kind: 'alm_report',
        language: 'es',
      }),
    ]);
    expect(mockInstance.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/portal/jobs/job-1/exports'),
    );
  });

  it('does not attempt token refresh for skipAuthRedirect requests', async () => {
    await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    const [, handleRejected] = mockInstance.interceptors.response.use.mock.calls[0];
    const error = {
      response: { status: 401 },
      config: { skipAuthRedirect: true },
    };

    await expect(handleRejected(error)).rejects.toBe(error);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('retries strict-auth requests after a successful silent refresh', async () => {
    await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    const [, handleRejected] = mockInstance.interceptors.response.use.mock.calls[0];

    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { accessToken: 'fresh-token' },
    });
    mockInstance.request.mockResolvedValueOnce({ data: { items: [] } });

    await expect(
      handleRejected({
        response: { status: 401 },
        config: { headers: {}, url: '/api/alm/institutions' },
      })
    ).resolves.toEqual({ data: { items: [] } });

    expect(axios.post).toHaveBeenCalledWith(
      '/api/auth/refresh',
      {},
      expect.objectContaining({ withCredentials: true })
    );
    expect(mockInstance.request).toHaveBeenCalledWith(
      expect.objectContaining({
        _retry401: true,
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      })
    );
  });

  it('redirects strict-auth requests to login when refresh fails', async () => {
    const originalLocation = window.location;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/alm',
        search: '?id=inst-1',
      },
    });

    await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    const [, handleRejected] = mockInstance.interceptors.response.use.mock.calls[0];

    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 404,
      data: { message: 'Not found' },
    });

    const error = {
      response: { status: 401 },
      config: { headers: {}, url: '/api/alm/institutions' },
    };

    await expect(handleRejected(error)).rejects.toBe(error);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cerniq:navigate',
        detail: {
          href: '/login?returnUrl=%2Falm%3Fid%3Dinst-1',
          replace: true,
        },
      }),
    );

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('exports apiClient as a singleton', async () => {
    const mod1 = await import('./api');
    const mod2 = await import('./api');

    expect(mod1.apiClient).toBe(mod2.apiClient);
  });

  describe('seedDemoInstitution (Phase 1 complete — all types through fixtures)', () => {
    const fixtureResponse = (seedKey: string, name: string) => ({
      data: {
        institutionId: `inst-${seedKey}`,
        seedKey,
        delta: {
          institution: 'created',
          balanceSheetItems: { before: 0, after: 10, replaced: true },
          liquidityPosition: 'created',
        },
        fixture: { seedKey, name, itemCount: 10 },
      },
    });

    it('routes cooperativa through the idempotent fixture endpoint', async () => {
      const { apiClient } = await import('./api');
      mockAxiosInstance.post.mockResolvedValueOnce(
        fixtureResponse('pr-cooperativa-demo', 'CoopAhorro San Juan'),
      );

      const result = await apiClient.seedDemoInstitution('ws-1', 'cooperativa');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/alm/institutions/seed'),
        { workspaceId: 'ws-1', fixture: 'pr-cooperativa-demo' },
      );
      expect(result.institutionId).toBe('inst-pr-cooperativa-demo');
      expect(result.institution.seedKey).toBe('pr-cooperativa-demo');
      expect(result.delta.institution).toBe('created');
    });

    it.each([
      ['bank', 'pr-bank-demo', 'Banco Comunidad PR'],
      ['credit_union', 'pr-credit-union-demo', 'CoopAhorro PR'],
      ['family_office', 'pr-family-office-demo', 'Caribbean Family Capital'],
    ] as const)(
      'routes %s through the fixture endpoint (not legacy seed-demo)',
      async (type, fixture, name) => {
        const { apiClient } = await import('./api');
        mockAxiosInstance.post.mockResolvedValueOnce(
          fixtureResponse(fixture, name),
        );

        const result = await apiClient.seedDemoInstitution('ws-1', type);

        // Every institution type — including legacy ones — now uses the
        // idempotent fixture endpoint. The deprecated /api/alm/seed-demo
        // path must never be hit from the frontend.
        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          expect.stringContaining('/api/alm/institutions/seed'),
          { workspaceId: 'ws-1', fixture },
        );
        expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
          expect.stringContaining('/api/alm/seed-demo'),
          expect.anything(),
        );
        expect(result.institution.type).toBe(type);
        expect(result.institution.seedKey).toBe(fixture);
      },
    );

    it('propagates errors instead of returning a phantom demo-bank-id (D1)', async () => {
      const { apiClient } = await import('./api');
      const boom = new Error('backend unavailable');
      mockAxiosInstance.post.mockRejectedValueOnce(boom);

      await expect(
        apiClient.seedDemoInstitution('ws-1', 'cooperativa'),
      ).rejects.toBe(boom);
    });

    it('is idempotent across repeated calls for the same fixture', async () => {
      const { apiClient } = await import('./api');
      const first = {
        data: {
          institutionId: 'inst-coop-1',
          seedKey: 'pr-cooperativa-demo',
          delta: {
            institution: 'created',
            balanceSheetItems: { before: 0, after: 10, replaced: true },
            liquidityPosition: 'created',
          },
          fixture: { seedKey: 'pr-cooperativa-demo', name: 'CoopAhorro San Juan', itemCount: 10 },
        },
      };
      const second = {
        data: {
          ...first.data,
          delta: {
            institution: 'unchanged',
            balanceSheetItems: { before: 10, after: 10, replaced: false },
            liquidityPosition: 'unchanged',
          },
        },
      };
      mockAxiosInstance.post.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      const a = await apiClient.seedDemoInstitution('ws-1', 'cooperativa');
      const b = await apiClient.seedDemoInstitution('ws-1', 'cooperativa');

      expect(a.institutionId).toBe(b.institutionId);
      expect(b.delta.institution).toBe('unchanged');
    });
  });

  it('routes email/password login through Supabase when public env is set', async () => {
    isSupabaseAuthEnabledMock.mockReturnValue(true);
    signInWithSupabasePasswordMock.mockResolvedValue({
      accessToken: 'supabase-access-token',
      userId: 'user-1',
      email: 'analyst@example.com',
    });
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { id: 'user-1', email: 'analyst@example.com' },
    });
    const { apiClient } = await import('./api');

    const result = await apiClient.login('analyst@example.com', 'UltraSecret123!');

    expect(signInWithSupabasePasswordMock).toHaveBeenCalled();
    expect(result.user?.id).toBe('user-1');
    expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login'),
      expect.anything(),
    );
  });

  it('routes email/password login through Nest when Supabase env is unset', async () => {
    isSupabaseAuthEnabledMock.mockReturnValue(false);
    const { apiClient } = await import('./api');
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'analyst@example.com' } },
    });

    await apiClient.login('analyst@example.com', 'UltraSecret123!');

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login'),
      expect.objectContaining({ email: 'analyst@example.com' }),
    );
  });

  it('routes email/password signup through the backend even when Supabase envs are set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { apiClient } = await import('./api');
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { user: { id: 'user-2', email: 'newuser@example.com' } },
    });

    await apiClient.register('newuser@example.com', 'UltraSecret123!', 'New User');

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/register'),
      expect.objectContaining({
        email: 'newuser@example.com',
        name: 'New User',
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes password reset requests through the backend', async () => {
    const { apiClient } = await import('./api');
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { message: 'If that email exists, a reset link has been sent' },
    });

    await apiClient.requestPasswordReset('USER@Example.com');

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/password-reset'),
      { email: 'user@example.com' },
    );
  });

  it('routes platform access failures through the client navigation event', async () => {
    const originalLocation = window.location;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/alm',
        search: '',
      },
    });

    await import('./api');
    const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    const [, handleRejected] = mockInstance.interceptors.response.use.mock.calls[0];

    const error = {
      response: {
        status: 403,
        data: { code: 'PLATFORM_ACCESS_REQUIRED' },
      },
      config: { headers: {}, url: '/api/alm/institutions' },
    };

    await expect(handleRejected(error)).rejects.toBe(error);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cerniq:navigate',
        detail: {
          href: '/access-required',
          replace: true,
        },
      }),
    );

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  // ── Blob download family (examiner-facing artifacts) ──────────────────────
  // Reusable scaffold for the api.ts authenticated blob downloads. Locks the
  // contract of each regulator-facing artifact: route + responseType:'blob',
  // the Blob MIME (pdf vs the legacy XML-SpreadsheetML application/vnd.ms-excel
  // — NOT OOXML .xlsx), Content-Disposition filename precedence, the hardcoded
  // fallback name, lang handling, and the create→href→append→click→remove→
  // revoke lifecycle. jsdom implements none of URL.createObjectURL /
  // revokeObjectURL, so a single installCapture() stubs them (plus the
  // synthesized <a>) once for every method. A regression here is a broken,
  // empty, or mistyped download of a regulator-facing artifact.
  describe('blob download family (examiner artifacts)', () => {
    type ApiClient = typeof import('./api').apiClient;
    type DownloadCapture = {
      anchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };
      click: ReturnType<typeof vi.fn>;
      appendChild: ReturnType<typeof vi.spyOn>;
      removeChild: ReturnType<typeof vi.spyOn>;
    };

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    let cap: DownloadCapture;

    function installCapture(): DownloadCapture {
      const click = vi.fn();
      const anchor = { href: '', download: '', click };
      vi.spyOn(document, 'createElement').mockReturnValue(
        anchor as unknown as HTMLAnchorElement,
      );
      const appendChild = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation((node) => node);
      const removeChild = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation((node) => node);
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();
      return { anchor, click, appendChild, removeChild };
    }

    async function loadClient() {
      const { apiClient } = await import('./api');
      const mockInstance = (axios.create as ReturnType<typeof vi.fn>).mock
        .results[0].value;
      return { apiClient, mockInstance };
    }

    // Shared assertion: a successful download wrapped `mime` and saved as
    // `filename`, and ran the complete object-URL lifecycle exactly once.
    function expectDownloaded(mime: string, filename: string) {
      const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Blob;
      expect(blobArg.type).toBe(mime);
      expect(cap.anchor.href).toBe('blob:mock-url');
      expect(cap.anchor.download).toBe(filename);
      expect(cap.appendChild).toHaveBeenCalledWith(cap.anchor);
      expect(cap.click).toHaveBeenCalledTimes(1);
      expect(cap.removeChild).toHaveBeenCalledWith(cap.anchor);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    }

    beforeEach(() => {
      cap = installCapture();
    });

    afterEach(() => {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    });

    // One row per regulator-facing artifact. `mime`/`fallback` are the
    // per-method invariants the scaffold guards across the family.
    const FAMILY = [
      {
        label: 'downloadALMReport (full ALM PDF)',
        urlPart: '/api/alm/inst-1/report?lang=',
        mime: 'application/pdf',
        cdName: 'alm-2025q4.pdf',
        fallback: 'alm-report-inst-1.pdf',
        invoke: (c: ApiClient, lang?: string) =>
          c.downloadALMReport('inst-1', lang),
      },
      {
        label: 'downloadCossecReport (COSSEC PDF)',
        urlPart: '/api/alm/inst-1/cossec-report/pdf?lang=',
        mime: 'application/pdf',
        cdName: 'cossec-2025q4.pdf',
        fallback: 'cossec-report-inst-1.pdf',
        invoke: (c: ApiClient, lang?: string) =>
          c.downloadCossecReport('inst-1', lang),
      },
      {
        label: 'downloadAlmExcel (COSSEC workbook .xls)',
        urlPart: '/api/alm/inst-1/export/excel?lang=',
        mime: 'application/vnd.ms-excel',
        cdName: 'cerniq-alm-report-abcd1234.xls',
        fallback: 'cossec-workbook-inst-1.xls',
        invoke: (c: ApiClient, lang?: string) =>
          c.downloadAlmExcel('inst-1', lang),
      },
    ];

    describe.each(FAMILY)(
      '$label',
      ({ urlPart, mime, cdName, fallback, invoke }) => {
        it('streams a blob with the right MIME, honors Content-Disposition, runs the anchor lifecycle', async () => {
          const { apiClient, mockInstance } = await loadClient();
          mockInstance.get.mockResolvedValueOnce({
            data: new Blob(['payload'], { type: mime }),
            headers: {
              'content-disposition': `attachment; filename="${cdName}"`,
            },
          });

          await invoke(apiClient, 'es');

          expect(mockInstance.get).toHaveBeenCalledWith(
            expect.stringContaining(urlPart),
            expect.objectContaining({ responseType: 'blob' }),
          );
          expectDownloaded(mime, cdName);
        });

        it('falls back to the hardcoded filename when no Content-Disposition is present', async () => {
          const { apiClient, mockInstance } = await loadClient();
          mockInstance.get.mockResolvedValueOnce({
            data: new Blob(['payload'], { type: mime }),
            headers: {},
          });

          await invoke(apiClient, 'es');

          expect(cap.anchor.download).toBe(fallback);
        });

        it('propagates request failures with no phantom download (D1 no-silent-fallback)', async () => {
          const { apiClient, mockInstance } = await loadClient();
          mockInstance.get.mockRejectedValueOnce(new Error('export failed'));

          await expect(invoke(apiClient, 'es')).rejects.toThrow(
            'export failed',
          );
          expect(URL.createObjectURL).not.toHaveBeenCalled();
          expect(cap.click).not.toHaveBeenCalled();
        });
      },
    );

    // Language handling diverges by method — assert it explicitly.
    it('coerces lang Spanish-first for the COSSEC artifacts (en stays en, any other → es)', async () => {
      const { apiClient, mockInstance } = await loadClient();
      mockInstance.get.mockResolvedValue({ data: new Blob(['x']), headers: {} });

      await apiClient.downloadAlmExcel('i', 'en');
      expect(mockInstance.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/export/excel?lang=en'),
        expect.objectContaining({ responseType: 'blob' }),
      );

      await apiClient.downloadAlmExcel('i', 'fr');
      expect(mockInstance.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/export/excel?lang=es'),
        expect.objectContaining({ responseType: 'blob' }),
      );

      await apiClient.downloadCossecReport('i', 'fr');
      expect(mockInstance.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/cossec-report/pdf?lang=es'),
        expect.objectContaining({ responseType: 'blob' }),
      );
    });

    it('applies the right default language per artifact (Excel/COSSEC → es, full ALM report → en)', async () => {
      const { apiClient, mockInstance } = await loadClient();
      mockInstance.get.mockResolvedValue({ data: new Blob(['x']), headers: {} });

      await apiClient.downloadAlmExcel('i');
      expect(mockInstance.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/export/excel?lang=es'),
        expect.objectContaining({ responseType: 'blob' }),
      );

      await apiClient.downloadALMReport('i');
      expect(mockInstance.get).toHaveBeenLastCalledWith(
        expect.stringContaining('/report?lang=en'),
        expect.objectContaining({ responseType: 'blob' }),
      );
    });
  });
});
