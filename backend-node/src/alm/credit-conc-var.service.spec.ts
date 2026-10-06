import { CreditConcentrationVaRService } from './credit-conc-var.service';

describe('CreditConcentrationVaRService', () => {
  const mk = (segments: unknown[]) =>
    new CreditConcentrationVaRService({
      loanSegment: { findMany: jest.fn().mockResolvedValue(segments) },
    } as any);

  // ── D1: honest empty-data shell (never the HHI 18.5% demo) ─────

  describe('no loan segments (data_unavailable)', () => {
    let svc: CreditConcentrationVaRService;
    beforeEach(() => {
      svc = mk([]);
    });

    it('returns a data_unavailable shell with null metrics + CRITICAL gap', async () => {
      const result = await svc.compute('inst-1');
      expect(result.status).toBe('data_unavailable');
      expect(result.herfindahlIndex).toBeNull();
      expect(result.granularityAdjustment).toBeNull();
      expect(result.diversifiedVaR).toBeNull();
      expect(result.concentrationVaR).toBeNull();
      expect(result.concentrationPremium).toBeNull();
      expect(result.concentrationPremiumPct).toBeNull();
      expect(result.topConcentrations).toEqual([]);
      expect(result.narrativeEs).toBeNull();
      expect(result.narrativeEn).toBeNull();

      const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
      expect(critical).toBeDefined();
      expect(critical!.reason).toBe('NO_LOAN_SEGMENTS');
      expect(critical!.field).toBe('creditConcVaR.loanSegments');
    });

    it('returns data_unavailable when all segments have zero balance', async () => {
      const svcZero = mk([
        { segmentName: 'Empty', balance: 0, historicalLossRate: 0, lgd: 0 },
      ]);
      const result = await svcZero.compute('inst-1');
      expect(result.status).toBe('data_unavailable');
      expect(result.herfindahlIndex).toBeNull();
    });
  });

  // ── D1: real-data concentration computation ────────────────────

  describe('with real loan segments', () => {
    let svcReal: CreditConcentrationVaRService;

    beforeEach(() => {
      svcReal = mk([
        {
          segmentName: 'Commercial RE',
          balance: 5000,
          historicalLossRate: 0.03,
          lgd: 0.45,
        },
        {
          segmentName: 'Consumer',
          balance: 3000,
          historicalLossRate: 0.04,
          lgd: 0.5,
        },
        {
          segmentName: 'Mortgage',
          balance: 2000,
          historicalLossRate: 0.01,
          lgd: 0.35,
        },
      ]);
    });

    it('computes HHI reflecting real segment concentration with status ok', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.status).toBe('ok');
      expect(result.gaps).toBeUndefined();
      // HHI = 0.5^2 + 0.3^2 + 0.2^2 = 0.25 + 0.09 + 0.04 = 0.38
      expect(result.herfindahlIndex!).toBeCloseTo(0.38, 1);
      expect(result.herfindahlIndex!).toBeGreaterThan(0.15); // concentrated
    });

    it('granularity adjustment is positive for concentrated portfolio', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.granularityAdjustment!).toBeGreaterThan(0);
    });

    it('concentration premium percentage is positive', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.concentrationPremiumPct!).toBeGreaterThan(0);
    });

    it('narrativeEn mentions elevated concentration for HHI > 0.15', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.narrativeEn).toContain('Elevated concentration risk');
    });

    it('returns exactly the 3 input segments as top concentrations', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.topConcentrations.length).toBeLessThanOrEqual(5);
      expect(result.topConcentrations).toHaveLength(3);
    });

    it('top concentration shares sum to 1.0', async () => {
      const result = await svcReal.compute('inst-1');
      const totalShare = result.topConcentrations.reduce(
        (s, c) => s + c.shareOfPortfolio,
        0,
      );
      expect(totalShare).toBeCloseTo(1.0, 1);
    });

    it('each segment has positive expected loss (EL) and unexpected loss (UL)', async () => {
      const result = await svcReal.compute('inst-1');
      for (const conc of result.topConcentrations) {
        expect(conc.el).toBeGreaterThan(0);
        expect(conc.ul).toBeGreaterThan(0);
      }
    });

    it('diversified VaR is positive', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.diversifiedVaR!).toBeGreaterThan(0);
    });

    it('concentration VaR exceeds diversified VaR by the granularity adjustment', async () => {
      const result = await svcReal.compute('inst-1');
      expect(result.concentrationVaR!).toBeCloseTo(
        result.diversifiedVaR! + result.granularityAdjustment!,
        1,
      );
    });
  });

  // ── Well-diversified portfolio ─────────────────────────────────

  describe('with well-diversified portfolio', () => {
    it('reports low HHI for many equal-sized segments', async () => {
      const svcDiversified = mk(
        Array.from({ length: 10 }, (_, i) => ({
          segmentName: `Segment${i}`,
          balance: 1000,
          historicalLossRate: 0.02,
          lgd: 0.4,
        })),
      );
      const result = await svcDiversified.compute('inst-1');
      // HHI for 10 equal segments = 10 * (0.1)^2 = 0.1
      expect(result.herfindahlIndex!).toBeCloseTo(0.1, 1);
      expect(result.narrativeEn).toContain('Well-diversified');
    });
  });
});
