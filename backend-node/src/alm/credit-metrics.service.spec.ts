import { CreditMetricsService } from './credit-metrics.service';

describe('CreditMetricsService', () => {
  const mk = (segments: unknown[]) =>
    new CreditMetricsService({
      loanSegment: { findMany: jest.fn().mockResolvedValue(segments) },
    } as any);

  // ── D1: honest empty-data shell (never the $18.5M demo) ────────

  describe('no loan segments (data_unavailable)', () => {
    let svc: CreditMetricsService;
    beforeEach(() => {
      svc = mk([]);
    });

    it('returns a data_unavailable shell with null risk metrics + CRITICAL gap', async () => {
      const result = await svc.computePortfolioVaR('inst-1');
      expect(result.status).toBe('data_unavailable');
      expect(result.portfolioVaR99).toBeNull();
      expect(result.portfolioES99).toBeNull();
      expect(result.expectedLoss).toBeNull();
      expect(result.unexpectedLoss).toBeNull();
      expect(result.economicCapital).toBeNull();
      expect(result.perSegmentContribution).toEqual([]);

      const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
      expect(critical).toBeDefined();
      expect(critical!.reason).toBe('NO_LOAN_SEGMENTS');
      expect(critical!.field).toBe('creditMetrics.loanSegments');
    });

    it('echoes the requested path count even in the empty shell', async () => {
      const result = await svc.computePortfolioVaR('inst-1', 2000);
      expect(result.paths).toBe(2000);
    });

    it('still returns the standard CreditMetrics migration matrix (reference data, not fabricated)', async () => {
      const result = await svc.computePortfolioVaR('inst-1');
      expect(result.migrationMatrix).toHaveProperty('AAA');
      expect(result.migrationMatrix).toHaveProperty('BBB');
      expect(result.migrationMatrix).toHaveProperty('CCC');
      for (const transitions of Object.values(result.migrationMatrix)) {
        const sum = Object.values(transitions).reduce((s, v) => s + v, 0);
        expect(sum).toBeGreaterThan(0);
        expect(sum).toBeLessThanOrEqual(1.01);
      }
    });
  });

  // ── D1: real-data Monte Carlo computation ──────────────────────

  describe('with real loan segments', () => {
    let svcReal: CreditMetricsService;

    beforeEach(() => {
      svcReal = mk([
        { segmentName: 'Consumer', balance: 5000, weightedAvgMaturity: 3 },
        { segmentName: 'Commercial', balance: 8000, weightedAvgMaturity: 5 },
        { segmentName: 'Mortgage', balance: 12000, weightedAvgMaturity: 15 },
      ]);
    });

    it('computes positive VaR99 with status ok and no gaps', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 5000);
      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      expect(result.portfolioVaR99!).toBeGreaterThan(0);
    });

    it('ES99 exceeds VaR99 with real data', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 5000);
      expect(result.portfolioES99!).toBeGreaterThanOrEqual(
        result.portfolioVaR99!,
      );
    });

    it('economic capital includes 1.06x multiplier on unexpected loss', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 5000);
      expect(result.economicCapital!).toBeCloseTo(
        result.unexpectedLoss! * 1.06,
        0,
      );
    });

    it('non-negative expected and unexpected loss', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 5000);
      expect(result.expectedLoss!).toBeGreaterThanOrEqual(0);
      expect(result.unexpectedLoss!).toBeGreaterThanOrEqual(0);
    });

    it('per-segment contributions sum to approximately 100%', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 5000);
      const totalPct = result.perSegmentContribution.reduce(
        (s, seg) => s + seg.pctOfTotal,
        0,
      );
      expect(totalPct).toBeCloseTo(100, 0);
    });

    it('per-segment contributions are positive and count matches segments', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 3000);
      expect(result.perSegmentContribution).toHaveLength(3);
      for (const seg of result.perSegmentContribution) {
        expect(seg.marginalVaR).toBeGreaterThan(0);
        expect(seg.pctOfTotal).toBeGreaterThan(0);
      }
    });

    it('reports the requested number of paths', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 2000);
      expect(result.paths).toBe(2000);
    });

    it('expected loss is less than total portfolio balance', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 5000);
      expect(result.expectedLoss!).toBeLessThan(5000 + 8000 + 12000);
    });

    it('uses seeded RNG for deterministic results across calls', async () => {
      const r1 = await svcReal.computePortfolioVaR('inst-1', 3000);
      const r2 = await svcReal.computePortfolioVaR('inst-1', 3000);
      expect(r1.portfolioVaR99).toBe(r2.portfolioVaR99);
    });

    it('accepts custom correlation parameter', async () => {
      const result = await svcReal.computePortfolioVaR('inst-1', 3000, 0.3);
      expect(result.portfolioVaR99!).toBeGreaterThan(0);
    });
  });
});
