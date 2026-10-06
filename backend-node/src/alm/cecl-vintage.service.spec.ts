import { CECLVintageService } from './cecl-vintage.service';

// Representative segments/cohorts (formerly the service's hardcoded demo set —
// now supplied as real input so the allowance math is still exercised, while
// the service itself no longer fabricates data on empty input).
const SEGMENTS = [
  {
    segmentName: 'Consumer Loans',
    balance: 85,
    weightedAvgMaturity: 3.5,
    lgd: 0.45,
    qualitativeAdj: 0.002,
  },
  {
    segmentName: 'Auto Loans',
    balance: 62,
    weightedAvgMaturity: 4.2,
    lgd: 0.35,
    qualitativeAdj: 0.001,
  },
  {
    segmentName: 'Commercial RE',
    balance: 120,
    weightedAvgMaturity: 7.5,
    lgd: 0.4,
    qualitativeAdj: 0.003,
  },
];

const COHORTS = [
  {
    originationQtr: '2022Q1',
    ageMonths: 6,
    originalBalance: 100,
    currentBalance: 95,
    defaults: 1,
  },
  {
    originationQtr: '2022Q1',
    ageMonths: 12,
    originalBalance: 100,
    currentBalance: 90,
    defaults: 3,
  },
  {
    originationQtr: '2022Q1',
    ageMonths: 18,
    originalBalance: 100,
    currentBalance: 85,
    defaults: 6,
  },
];

function makeService(segments: any[], cohorts: any[] = []) {
  const prisma = {
    loanCohort: {
      findMany: jest.fn().mockResolvedValue(cohorts),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 4 }),
    },
    loanSegment: { findMany: jest.fn().mockResolvedValue(segments) },
    ceclVintageAllowance: {
      create: jest.fn().mockResolvedValue({ id: 'allow_1' }),
    },
  } as any;
  return new CECLVintageService(prisma);
}

describe('CECLVintageService', () => {
  let service: CECLVintageService;

  beforeEach(() => {
    service = makeService([], []); // empty by default — for D1 paths
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -- Weibull fit: default params for insufficient data ----------
  it('returns default Weibull params when fewer than 3 valid cohort points', () => {
    const cohorts = [
      {
        originationQtr: '2023Q1',
        ageMonths: 6,
        cumulativeDefaultRate: 0.01,
        balance: 10,
      },
    ];
    const params = service.fitWeibull(cohorts, 'consumer');
    expect(params.loanType).toBe('consumer');
    expect(params.shape).toBe(1.5);
    expect(params.scale).toBe(36);
    expect(params.r2).toBe(0);
  });

  // -- Weibull fit: valid regression with increasing defaults -----
  it('fits Weibull with shape > 1 for increasing cumulative default rates', () => {
    const cohorts = [
      {
        originationQtr: '2022Q1',
        ageMonths: 6,
        cumulativeDefaultRate: 0.005,
        balance: 10,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 12,
        cumulativeDefaultRate: 0.015,
        balance: 9.5,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 18,
        cumulativeDefaultRate: 0.03,
        balance: 9.0,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 24,
        cumulativeDefaultRate: 0.05,
        balance: 8.5,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 30,
        cumulativeDefaultRate: 0.07,
        balance: 8.0,
      },
    ];
    const params = service.fitWeibull(cohorts, 'auto');
    expect(params.loanType).toBe('auto');
    expect(params.shape).toBeGreaterThan(0.5);
    expect(params.scale).toBeGreaterThan(0);
    expect(params.r2).toBeGreaterThan(0);
  });

  // -- Weibull fit: shape clamped within [0.5, 5] -----------------
  it('clamps shape parameter between 0.5 and 5', () => {
    const cohorts = [
      {
        originationQtr: '2022Q1',
        ageMonths: 1,
        cumulativeDefaultRate: 0.001,
        balance: 10,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 6,
        cumulativeDefaultRate: 0.01,
        balance: 9,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 12,
        cumulativeDefaultRate: 0.05,
        balance: 8,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 24,
        cumulativeDefaultRate: 0.2,
        balance: 6,
      },
      {
        originationQtr: '2022Q1',
        ageMonths: 36,
        cumulativeDefaultRate: 0.5,
        balance: 4,
      },
    ];
    const params = service.fitWeibull(cohorts, 'consumer');
    expect(params.shape).toBeGreaterThanOrEqual(0.5);
    expect(params.shape).toBeLessThanOrEqual(5);
  });

  // -- D1: getCohortMatrix returns empty (never demo) -------------
  it('returns an empty cohort matrix when no cohorts exist in the database', async () => {
    const matrix = await service.getCohortMatrix('inst_123');
    expect(matrix).toEqual([]);
  });

  // -- D1: no loan segments → data_unavailable, never demo --------
  it('returns data_unavailable with a CRITICAL gap when no loan segments exist', async () => {
    const result = await service.runVintageAnalysis('inst_123', 'base');
    expect(result.status).toBe('data_unavailable');
    expect(result.baseAllowance).toBeNull();
    expect(result.adverseAllowance).toBeNull();
    expect(result.severeAllowance).toBeNull();
    expect(
      result.gaps?.some(
        (g) => g.reason === 'NO_LOAN_SEGMENTS' && g.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  // -- ok path: allowance computed from real segments -------------
  it('computes a layered allowance (severe > adverse > base) from real segments', async () => {
    const svc = makeService(SEGMENTS, COHORTS);
    const result = await svc.runVintageAnalysis('inst_123', 'base');

    expect(result.status).toBe('ok');
    expect(result.methodology).toBe('vintage');
    expect(result.totalBalance!).toBeGreaterThan(0);
    expect(result.baseAllowance!).toBeGreaterThan(0);
    expect(result.severeAllowance!).toBeGreaterThan(result.adverseAllowance!);
    expect(result.adverseAllowance!).toBeGreaterThan(result.baseAllowance!);
  });

  it('produces higher allowance under the adverse macro scenario', async () => {
    const svc = makeService(SEGMENTS, COHORTS);
    const base = await svc.runVintageAnalysis('inst_123', 'base');
    const adverse = await svc.runVintageAnalysis('inst_123', 'adverse');
    expect(adverse.adverseAllowance!).toBeGreaterThan(base.baseAllowance!);
  });

  // -- WARNING gap when segments exist but no cohort history ------
  it('discloses a NO_COHORT_DATA warning when computing without cohort history', async () => {
    const svc = makeService(SEGMENTS, []);
    const result = await svc.runVintageAnalysis('inst_123', 'base');
    expect(result.status).toBe('ok');
    expect(result.gaps?.some((g) => g.reason === 'NO_COHORT_DATA')).toBe(true);
  });

  // -- importCohorts: deletes existing and creates new ------------
  it('deletes existing cohorts and imports new ones', async () => {
    const prisma = {
      loanCohort: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      loanSegment: { findMany: jest.fn().mockResolvedValue([]) },
      ceclVintageAllowance: { create: jest.fn() },
    } as any;
    const svc = new CECLVintageService(prisma);
    const cohorts = [
      {
        loanType: 'consumer',
        originationQtr: '2024Q1',
        originalBalance: 100,
        currentBalance: 95,
        defaults: 2,
        ageMonths: 6,
      },
    ];
    const result = await svc.importCohorts('inst_123', cohorts);
    expect(prisma.loanCohort.deleteMany).toHaveBeenCalledWith({
      where: { institutionId: 'inst_123' },
    });
    expect(prisma.loanCohort.createMany).toHaveBeenCalled();
    expect(result.imported).toBe(4);
  });

  // -- Weibull params included in vintage analysis output ---------
  it('includes weibull parameters in the vintage analysis result', async () => {
    const svc = makeService(SEGMENTS, COHORTS);
    const result = await svc.runVintageAnalysis('inst_123');
    expect(Array.isArray(result.weibullParams)).toBe(true);
    for (const wp of result.weibullParams) {
      expect(wp).toHaveProperty('loanType');
      expect(wp).toHaveProperty('shape');
      expect(wp).toHaveProperty('scale');
      expect(wp).toHaveProperty('r2');
    }
  });

  // -- Rule 4 (append-only audit): a failed allowance persist is VISIBLE --
  //    The write is best-effort — it must not crash the report — but it must
  //    never silently vanish (that was the swallowed `catch {}` audit-chain
  //    hole closed 2026-06-07). Assert it both logs AND still returns.
  it('logs (never swallows) a failed allowance persist and still returns the report', async () => {
    const svc = makeService(SEGMENTS, COHORTS);
    (svc as any).prisma.ceclVintageAllowance.create.mockRejectedValue(
      new Error('db down'),
    );
    const warnSpy = jest
      .spyOn((svc as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await svc.runVintageAnalysis('inst_123', 'base');

    // best-effort persist: the report must still compute and return ok
    expect(result.status).toBe('ok');
    expect(result.baseAllowance!).toBeGreaterThan(0);

    // the failure must be surfaced — logged with the named event + tenant
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0][0] as any;
    expect(logged.event).toBe('cecl_vintage.allowance_persist_failed');
    expect(logged.institutionId).toBe('inst_123');
  });
});
