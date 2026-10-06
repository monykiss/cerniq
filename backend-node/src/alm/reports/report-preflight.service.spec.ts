/**
 * ReportPreflight contract tests.
 *
 * The contract:
 *   1. `check()` runs all sub-calls in parallel and aggregates their gaps.
 *   2. `ready === true` IFF there are zero CRITICAL gaps.
 *   3. WARNING gaps do NOT block `ready` — they're surfaced for review.
 *   4. A sub-call that THROWS is converted into a CRITICAL gap (preflight
 *      never propagates an unstructured failure).
 *   5. The full sub-call results are returned alongside the gap manifest
 *      so callers don't need to re-fetch.
 */
import { ReportPreflightService } from './report-preflight.service';
import { dataGap } from './data-gap';

describe('ReportPreflightService', () => {
  let almEnterprise: {
    getALMSummary: jest.Mock;
    getCOSSECCompliance: jest.Mock;
  };
  let stressTesting: { runRegulatoryStress: jest.Mock };
  let service: ReportPreflightService;

  // Minimal "happy path" sub-results: no gaps, status fields populated.
  const goodSummary = (): any => ({
    institution: { id: 'inst-1', name: 'Test', type: 'cooperativa' },
    durationGap: { durationGap: 1.2, riskProfile: 'neutral' },
    niiSensitivity: { baseNII: 5.5, scenarios: [], riskRating: 'low' },
    liquidity: { lcr: 118, status: 'compliant' },
    topRisks: [],
    recommendations: [],
    riskScore: 78,
    fullAnalysis: {},
    // No `gaps` field — the orchestrator omits it when empty.
  });

  const goodCossec = (): any => ({
    institutionName: 'Test',
    institutionType: 'cooperativa',
    reportingDate: '2026-01-31',
    checks: [],
    ratios: [],
    examReadinessScore: 95,
    overallStatus: 'compliant',
    summary: { totalAssets: 250 },
  });

  const goodStress = (): any => ({
    scenarios: [],
    overallRating: 'resilient',
  });

  beforeEach(() => {
    almEnterprise = {
      getALMSummary: jest.fn().mockResolvedValue(goodSummary()),
      getCOSSECCompliance: jest.fn().mockResolvedValue(goodCossec()),
    };
    stressTesting = {
      runRegulatoryStress: jest.fn().mockResolvedValue(goodStress()),
    };
    service = new ReportPreflightService(
      almEnterprise as any,
      stressTesting as any,
    );
  });

  it('reports ready=true when no gaps anywhere', async () => {
    const result = await service.check('inst-1');

    expect(result.ready).toBe(true);
    expect(result.criticalCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.gaps).toEqual([]);
    expect(result.institutionId).toBe('inst-1');
    expect(result.snapshotAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.results.summary).toBeDefined();
    expect(result.results.cossec).toBeDefined();
    expect(result.results.regulatoryStress).toBeDefined();
  });

  it('aggregates gaps from every sub-call into the top-level array', async () => {
    almEnterprise.getALMSummary.mockResolvedValue({
      ...goodSummary(),
      gaps: [
        dataGap('liquidity.lcr', 'NO_LIQUIDITY_POSITION', {
          severity: 'CRITICAL',
        }),
      ],
    });
    almEnterprise.getCOSSECCompliance.mockResolvedValue({
      ...goodCossec(),
      gaps: [
        dataGap('cossec.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
        }),
      ],
    });
    stressTesting.runRegulatoryStress.mockResolvedValue({
      ...goodStress(),
      gaps: [
        dataGap('stress.regulatory.baseLCR', 'NO_LIQUIDITY_POSITION', {
          severity: 'CRITICAL',
        }),
      ],
    });

    const result = await service.check('inst-1');

    expect(result.gaps).toHaveLength(3);
    expect(result.gaps.map((g) => g.field)).toEqual([
      'liquidity.lcr',
      'cossec.balanceSheet',
      'stress.regulatory.baseLCR',
    ]);
    expect(result.criticalCount).toBe(3);
    expect(result.warningCount).toBe(0);
    expect(result.ready).toBe(false);
  });

  it('ready=true when only WARNING gaps are present (D4: warnings do not block)', async () => {
    almEnterprise.getCOSSECCompliance.mockResolvedValue({
      ...goodCossec(),
      gaps: [
        dataGap('cossec.placeholder', 'CALCULATION_FAILED', {
          severity: 'WARNING',
        }),
        dataGap('cossec.placeholder2', 'CALCULATION_FAILED', {
          severity: 'WARNING',
        }),
      ],
    });

    const result = await service.check('inst-1');

    expect(result.ready).toBe(true);
    expect(result.criticalCount).toBe(0);
    expect(result.warningCount).toBe(2);
    expect(result.gaps).toHaveLength(2);
  });

  it('counts mixed CRITICAL + WARNING gaps correctly', async () => {
    almEnterprise.getALMSummary.mockResolvedValue({
      ...goodSummary(),
      gaps: [
        dataGap('a', 'NO_LIQUIDITY_POSITION', { severity: 'CRITICAL' }),
        dataGap('b', 'STALE_SNAPSHOT', { severity: 'WARNING' }),
      ],
    });
    almEnterprise.getCOSSECCompliance.mockResolvedValue({
      ...goodCossec(),
      gaps: [
        dataGap('c', 'EMPTY_BALANCE_SHEET', { severity: 'CRITICAL' }),
        dataGap('d', 'CALCULATION_FAILED', { severity: 'WARNING' }),
        dataGap('e', 'CALCULATION_FAILED', { severity: 'WARNING' }),
      ],
    });

    const result = await service.check('inst-1');

    expect(result.gaps).toHaveLength(5);
    expect(result.criticalCount).toBe(2);
    expect(result.warningCount).toBe(3);
    expect(result.ready).toBe(false);
  });

  it('converts a sub-call THROW into a CRITICAL gap (never propagates unstructured failure)', async () => {
    almEnterprise.getALMSummary.mockRejectedValue(
      new Error('connection refused'),
    );
    // The other two sub-calls still resolve.

    const result = await service.check('inst-1');

    expect(result.ready).toBe(false);
    expect(result.criticalCount).toBeGreaterThanOrEqual(1);
    const thrownGap = result.gaps.find(
      (g) => g.field === 'preflight.almSummary',
    );
    expect(thrownGap).toBeDefined();
    expect(thrownGap!.severity).toBe('CRITICAL');
    expect(thrownGap!.reason).toBe('DEPENDENCY_REJECTED');
    expect(thrownGap!.context).toMatchObject({
      institutionId: 'inst-1',
      error: 'connection refused',
    });
  });

  it('runs all three sub-calls in parallel (single Promise.all)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const trackParallelism = async <T>(value: T): Promise<T> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return value;
    };
    almEnterprise.getALMSummary.mockImplementation(() =>
      trackParallelism(goodSummary()),
    );
    almEnterprise.getCOSSECCompliance.mockImplementation(() =>
      trackParallelism(goodCossec()),
    );
    stressTesting.runRegulatoryStress.mockImplementation(() =>
      trackParallelism(goodStress()),
    );

    await service.check('inst-1');

    expect(maxInFlight).toBe(3);
  });

  it('returns empty modelLineage when no registry is injected (graceful degradation)', async () => {
    const result = await service.check('inst-1');
    expect(result.modelLineage).toEqual([]);
  });

  it('populates modelLineage when registry is available', async () => {
    const mockRegistry = {
      getByKey: jest.fn().mockImplementation((key: string) => {
        if (key === 'alm.duration-gap') {
          return Promise.resolve({
            modelKey: 'alm.duration-gap',
            version: '1.0.0',
            status: 'APPROVED',
            approvedAt: new Date('2026-04-12'),
            approvedBy: 'system-seed',
          });
        }
        if (key === 'alm.lcr') {
          return Promise.resolve({
            modelKey: 'alm.lcr',
            version: '1.1.0',
            status: 'APPROVED',
            approvedAt: new Date('2026-04-12'),
            approvedBy: 'system-seed',
          });
        }
        return Promise.reject(new Error('not found'));
      }),
    };
    const serviceWithRegistry = new ReportPreflightService(
      almEnterprise as any,
      stressTesting as any,
      mockRegistry as any,
    );
    const result = await serviceWithRegistry.check('inst-1');

    expect(result.modelLineage.length).toBeGreaterThanOrEqual(2);
    const dg = result.modelLineage.find(
      (m) => m.modelKey === 'alm.duration-gap',
    );
    expect(dg).toBeDefined();
    expect(dg!.version).toBe('1.0.0');
    expect(dg!.status).toBe('APPROVED');
    expect(dg!.approvedBy).toBe('system-seed');

    const lcr = result.modelLineage.find((m) => m.modelKey === 'alm.lcr');
    expect(lcr).toBeDefined();
    expect(lcr!.version).toBe('1.1.0');
  });

  it('returns the full sub-call results for caller use', async () => {
    const summary = goodSummary();
    const cossec = goodCossec();
    const stress = goodStress();
    almEnterprise.getALMSummary.mockResolvedValue(summary);
    almEnterprise.getCOSSECCompliance.mockResolvedValue(cossec);
    stressTesting.runRegulatoryStress.mockResolvedValue(stress);

    const result = await service.check('inst-1');

    expect(result.results.summary).toBe(summary);
    expect(result.results.cossec).toBe(cossec);
    expect(result.results.regulatoryStress).toBe(stress);
  });
});
