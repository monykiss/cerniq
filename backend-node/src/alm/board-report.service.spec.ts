import { BoardReportService } from './board-report.service';

describe('BoardReportService', () => {
  let service: BoardReportService;
  let prisma: any;
  let almEnterprise: any;
  let advisorV2: any;
  let camelScorer: any;

  beforeEach(() => {
    prisma = {
      institution: { findUnique: jest.fn() },
      boardReport: { create: jest.fn() },
    };
    almEnterprise = {
      getALMSummary: jest.fn().mockResolvedValue(null),
    };
    advisorV2 = {
      computeHealthScore: jest
        .fn()
        .mockResolvedValue({ overall: 78, label: 'Good' }),
      rankAlerts: jest.fn().mockResolvedValue([]),
    };
    camelScorer = {
      scoreInstitution: jest.fn().mockResolvedValue({ composite: 2 }),
    };
    service = new BoardReportService(
      prisma,
      almEnterprise,
      advisorV2,
      camelScorer,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generates board report with all required sections', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      name: 'Test CU',
      totalAssets: 400,
    });
    prisma.boardReport.create.mockResolvedValue({});

    const result = await service.generateBoardReportData('inst_1');

    expect(result.institutionName).toBe('Test CU');
    expect(result.camelComposite).toBe(2);
    expect(result.sections.length).toBeGreaterThanOrEqual(5);
    expect(result.kpis).toHaveProperty('nim');
    expect(result.kpis).toHaveProperty('lcr');
    expect(result.kpis).toHaveProperty('nwr');
    // D1 (2026-04-07): top risks and recommendations now come from
    // ALMSummary when present, fall back to a single explicit
    // "data unavailable" line when ALMSummary is null. We assert at least
    // one entry exists in each — the previous "must be exactly 5" check
    // codified the hardcoded recommendations array.
    expect(result.topRisks.length).toBeGreaterThan(0);
    expect(result.topRisksEs.length).toBe(result.topRisks.length);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendationsEs.length).toBe(result.recommendations.length);
    expect(result.regPulse.length).toBeGreaterThan(0);
  });

  it('report sections have bilingual titles', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      name: 'CU',
      totalAssets: 200,
    });
    prisma.boardReport.create.mockResolvedValue({});

    const result = await service.generateBoardReportData('inst_1');

    for (const section of result.sections) {
      expect(typeof section.title).toBe('string');
      expect(typeof section.titleEs).toBe('string');
      expect(section.pageRange).toBeDefined();
    }
  });

  // D1 (2026-04-07): the previous expectation was that ALM failure would
  // silently fall back to `kpis.nim === 3.5`. That literal 3.5 was the
  // worst silent-fallback in the codebase — a board director reading the
  // PDF saw "NIM: 3.5%" and assumed it reflected their cooperativa.
  // It reflected nothing. New contract: ALM failure → null KPIs + CRITICAL
  // gap pointing to `board.almSummary`. Renderer shows DATA UNAVAILABLE.
  it('returns null KPIs and CRITICAL gap when ALM summary call fails', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      name: 'CU',
      totalAssets: 300,
    });
    prisma.boardReport.create.mockResolvedValue({});
    almEnterprise.getALMSummary.mockRejectedValue(new Error('DB down'));

    const result = await service.generateBoardReportData('inst_1');

    // Numeric KPIs are null — never silent fallback to a hardcoded literal.
    expect(result.kpis.nim).toBeNull();
    expect(result.kpis.lcr).toBeNull();
    expect(result.kpis.nsfr).toBeNull();
    expect(result.kpis.nwr).toBeNull();
    expect(result.kpis.eveSensitivity).toBeNull();
    expect(result.kpis.nplRatio).toBeNull();
    expect(result.kpis.ceclCoverage).toBeNull();
    expect(result.kpis.roa).toBeNull();

    // Top-level gaps array carries the canonical statement.
    expect(result.gaps).toBeDefined();
    const summaryGap = result.gaps!.find((g) => g.field === 'board.almSummary');
    expect(summaryGap).toBeDefined();
    expect(summaryGap!.severity).toBe('CRITICAL');
    expect(summaryGap!.reason).toBe('DEPENDENCY_REJECTED');
    expect(summaryGap!.context).toMatchObject({
      institutionId: 'inst_1',
      error: 'DB down',
    });
  });

  it('always carries WARNING gaps for KPIs not yet wired to real sources', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      name: 'CU',
      totalAssets: 300,
    });
    prisma.boardReport.create.mockResolvedValue({});
    // Provide a working ALM summary so the CRITICAL gaps don't fire.
    almEnterprise.getALMSummary.mockResolvedValue({
      niiSensitivity: { baseNII: 5.5 },
      liquidity: { lcr: 118, status: 'compliant', gaps: undefined },
      fullAnalysis: { summary: { equity: 27 } },
      durationGap: { durationGap: 1.2, riskProfile: 'neutral' },
      topRisks: ['Test risk 1', 'Test risk 2'],
      recommendations: ['Test rec 1'],
      gaps: undefined,
    });

    const result = await service.generateBoardReportData('inst_1');

    // KPIs that ARE wired in resolve to real values.
    expect(result.kpis.nim).not.toBeNull();
    expect(result.kpis.lcr).toBe(118);
    expect(result.kpis.nwr).not.toBeNull();

    // KPIs not yet wired remain null + carry WARNING gaps.
    expect(result.kpis.nsfr).toBeNull();
    expect(result.kpis.eveSensitivity).toBeNull();
    expect(result.kpis.nplRatio).toBeNull();

    expect(result.gaps).toBeDefined();
    const warningFields = result
      .gaps!.filter((g) => g.severity === 'WARNING')
      .map((g) => g.field);
    expect(warningFields).toEqual(
      expect.arrayContaining([
        'board.kpis.nsfr',
        'board.kpis.eveSensitivity',
        'board.kpis.nplRatio',
        'board.kpis.ceclCoverage',
        'board.kpis.roa',
        'board.regPulse',
      ]),
    );
  });

  it('handles boardReport persist failure silently', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      name: 'CU',
      totalAssets: 200,
    });
    prisma.boardReport.create.mockRejectedValue(new Error('write fail'));

    const result = await service.generateBoardReportData('inst_1');
    expect(result).toBeDefined(); // should not throw
  });

  it('reportMonth matches current year-month format', async () => {
    prisma.institution.findUnique.mockResolvedValue({
      name: 'CU',
      totalAssets: 200,
    });
    prisma.boardReport.create.mockResolvedValue({});

    const result = await service.generateBoardReportData('inst_1');
    expect(result.reportMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
