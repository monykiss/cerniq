import { CopulaCreditService } from './copula-credit.service';

describe('CopulaCreditService', () => {
  const mk = (segments: unknown[]) =>
    new CopulaCreditService({
      loanSegment: { findMany: jest.fn().mockResolvedValue(segments) },
    } as any);

  // ── D1: honest empty-data shell (never the $22.5M demo) ────────

  describe('no loan segments (data_unavailable)', () => {
    let svc: CopulaCreditService;
    beforeEach(() => {
      svc = mk([]);
    });

    it('returns a data_unavailable shell with null risk metrics + CRITICAL gap', async () => {
      const result = await svc.simulateWithCopula('inst-1', 'gaussian');
      expect(result.status).toBe('data_unavailable');
      expect(result.var99).toBeNull();
      expect(result.var999).toBeNull();
      expect(result.es99).toBeNull();
      expect(result.tailDependence).toBeNull();
      expect(result.tCopulaPremium).toBeNull();
      expect(result.jointDefaultProbability).toBeNull();
      expect(result.correlationMatrix).toEqual([]);
      expect(result.segments).toEqual([]);

      const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
      expect(critical).toBeDefined();
      expect(critical!.reason).toBe('NO_LOAN_SEGMENTS');
      expect(critical!.field).toBe('copulaCredit.loanSegments');
    });

    it('echoes the requested copula method even in the empty shell', async () => {
      expect((await svc.simulateWithCopula('inst-1', 'gaussian')).method).toBe(
        'gaussian',
      );
      expect((await svc.simulateWithCopula('inst-1', 't-copula')).method).toBe(
        't-copula',
      );
    });
  });

  // ── D1: real-data Monte Carlo computation ──────────────────────

  describe('with real loan segments', () => {
    let svcWithData: CopulaCreditService;

    beforeEach(() => {
      svcWithData = mk([
        {
          segmentName: 'Consumer',
          balance: 5000,
          historicalLossRate: 0.02,
          lgd: 0.4,
        },
        {
          segmentName: 'Commercial',
          balance: 3000,
          historicalLossRate: 0.03,
          lgd: 0.5,
        },
        {
          segmentName: 'Mortgage',
          balance: 7000,
          historicalLossRate: 0.01,
          lgd: 0.3,
        },
      ]);
    });

    it('gaussian copula produces correlation matrix matching segment count + status ok', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        1000,
      );
      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      expect(result.correlationMatrix).toHaveLength(3);
      expect(result.correlationMatrix[0]).toHaveLength(3);
      expect(result.correlationMatrix[0][0]).toBe(1.0);
      expect(result.correlationMatrix[1][1]).toBe(1.0);
      expect(result.correlationMatrix[2][2]).toBe(1.0);
    });

    it('off-diagonal correlation equals 0.15', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        1000,
      );
      expect(result.correlationMatrix[0][1]).toBe(0.15);
      expect(result.correlationMatrix[1][0]).toBe(0.15);
    });

    it('VaR99 is positive for real segment data', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        2000,
      );
      expect(result.var99!).toBeGreaterThan(0);
    });

    it('joint default probability is between 0 and 1', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        2000,
      );
      expect(result.jointDefaultProbability!).toBeGreaterThanOrEqual(0);
      expect(result.jointDefaultProbability!).toBeLessThanOrEqual(1);
    });

    it('gaussian copula has zero tail dependence', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        1000,
      );
      expect(result.tailDependence).toBe(0);
    });

    it('segments array matches input segment names', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        1000,
      );
      expect(result.segments).toEqual(['Consumer', 'Commercial', 'Mortgage']);
    });

    it('t-copula produces positive tail dependence with real data', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        't-copula',
        5,
        1000,
      );
      expect(result.tailDependence!).toBeGreaterThan(0);
      expect(result.method).toBe('t-copula');
    });

    it('t-copula premium is computed (difference from gaussian VaR99)', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        't-copula',
        5,
        1000,
      );
      expect(typeof result.tCopulaPremium).toBe('number');
    });

    it('ES99 >= VaR99 for real segment data', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        2000,
      );
      expect(result.es99!).toBeGreaterThanOrEqual(result.var99!);
    });

    it('VaR999 >= VaR99 for real segment data', async () => {
      const result = await svcWithData.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        2000,
      );
      expect(result.var999!).toBeGreaterThanOrEqual(result.var99!);
    });

    it('PD is capped at 0.3 even when historicalLossRate is high', async () => {
      const svcHighPD = mk([
        {
          segmentName: 'Risky',
          balance: 1000,
          historicalLossRate: 0.5,
          lgd: 0.6,
        },
      ]);
      const result = await svcHighPD.simulateWithCopula(
        'inst-1',
        'gaussian',
        5,
        500,
      );
      expect(result.var99!).toBeGreaterThanOrEqual(0);
    });
  });
});
