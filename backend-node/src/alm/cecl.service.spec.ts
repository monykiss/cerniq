import { CECLService } from './cecl.service';
import { MacroOverlayService } from './macro-overlay.service';
import { PrMacroFeedService } from './pr-macro-feed.service';
import { PR_MACRO_SNAPSHOT } from './data/macro/pr-macro-snapshot';

describe('CECLService', () => {
  let svc: CECLService;

  beforeEach(() => {
    const mockPrisma = {
      loanSegment: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      institution: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    svc = new CECLService(mockPrisma);
  });

  const segments = [
    {
      segmentName: 'Consumer',
      balance: 100_000_000,
      weightedAvgMaturity: 3,
      historicalLossRate: 0.02,
      lgd: 0.5,
      qualitativeAdj: 0.005,
    },
    {
      segmentName: 'Commercial',
      balance: 200_000_000,
      weightedAvgMaturity: 5,
      historicalLossRate: 0.01,
      lgd: 0.4,
      qualitativeAdj: 0.002,
    },
  ];

  it('should return correct WARM output shape', () => {
    const result = svc.calculateWARM(segments);
    expect(result).toHaveProperty('totalBalance');
    expect(result).toHaveProperty('totalAllowance');
    expect(result).toHaveProperty('weightedCoverageRatio');
    expect(result).toHaveProperty('methodology');
    expect(result).toHaveProperty('segments');
    expect(result.methodology).toBe('WARM');
    expect(result.segments.length).toBe(2);
  });

  it('should compute WARM lifetime loss with PV discounting correctly', () => {
    const result = svc.calculateWARM(segments);
    // Consumer: adjRate = 0.02 + 0.005 = 0.025; maturity = 3; discountRate = 0.03 (default)
    // undiscountedLoss = 0.025 * 3 = 0.075
    // pvFactor = (1 - (1.03)^-3) / (0.03 * 3) ≈ 0.9429
    // lifetimeLoss = 0.075 * 0.9429 ≈ 0.07072
    // EL = 100M * 0.07072 ≈ 7,071,712
    const consumer = result.segments.find((s) => s.segmentName === 'Consumer')!;
    expect(consumer.expectedLoss).toBeCloseTo(7_071_712, -4);
  });

  it('should compute totalBalance as sum of segment balances', () => {
    const result = svc.calculateWARM(segments);
    expect(result.totalBalance).toBeCloseTo(300_000_000, 0);
  });

  it('should return correct Vintage output with LGD applied', () => {
    const result = svc.calculateVintage(segments);
    expect(result.methodology).toBe('Vintage');
    // Vintage applies LGD to expected loss, so allowance should be smaller than EL
    for (const seg of result.segments) {
      expect(seg.allowanceRequired).toBeLessThanOrEqual(seg.expectedLoss);
    }
  });

  it('should compute PD x LGD with macro scenario weights', () => {
    const result = svc.calculatePDxLGD(segments);
    expect(result.methodology).toBe('PD×LGD');
    expect(result.macroScenarioBreakdown).toBeDefined();
    // adverse allowance >= baseline
    expect(result.macroScenarioBreakdown!.adverse).toBeGreaterThanOrEqual(
      result.macroScenarioBreakdown!.baseline,
    );
    // severely adverse >= adverse
    expect(
      result.macroScenarioBreakdown!.severelyAdverse,
    ).toBeGreaterThanOrEqual(result.macroScenarioBreakdown!.adverse);
  });

  it('should handle zero balance segments gracefully', () => {
    const zeroSegments = [
      {
        segmentName: 'Empty',
        balance: 0,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ];
    const result = svc.calculateWARM(zeroSegments);
    expect(result.totalBalance).toBe(0);
    expect(result.totalAllowance).toBe(0);
    expect(result.weightedCoverageRatio).toBe(0);
  });

  // ── WARM: zero maturity ────────────────────────────────────
  it('should handle zero maturity (pvFactor = 1)', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'Short',
        balance: 100_000,
        weightedAvgMaturity: 0,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ]);
    const seg = result.segments[0];
    // With maturity 0, undiscountedLoss = 0, lifetimeLoss = 0
    expect(seg.expectedLoss).toBe(0);
    expect(seg.coverageRatio).toBe(0);
  });

  // ── WARM: custom discount rate ─────────────────────────────
  it('should use custom discount rate when provided', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'Custom',
        balance: 100_000,
        weightedAvgMaturity: 5,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0,
        discountRate: 0.05,
      },
    ]);
    expect(result.totalAllowance).toBeGreaterThan(0);
  });

  // ── WARM: negative qualitative adj ─────────────────────────
  it('should allow negative qualitative adjustment', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'Good',
        balance: 100_000,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: -0.01,
      },
    ]);
    const seg = result.segments[0];
    expect(seg.adjustedLossRate).toBe(0.01); // 0.02 - 0.01
    expect(seg.expectedLoss).toBeGreaterThan(0);
  });

  // ── WARM: cap lifetime loss at 100% ────────────────────────
  it('should cap lifetime loss rate at 1 (100%)', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'HighLoss',
        balance: 100_000,
        weightedAvgMaturity: 50,
        historicalLossRate: 0.5,
        lgd: 1.0,
        qualitativeAdj: 0.1,
      },
    ]);
    const seg = result.segments[0];
    expect(seg.expectedLoss).toBeLessThanOrEqual(100_000);
  });

  // ── Vintage: years > emergence pattern length ──────────────
  it('should use flat tail for years beyond emergence pattern', () => {
    const result = svc.calculateVintage([
      {
        segmentName: 'Long',
        balance: 100_000,
        weightedAvgMaturity: 10,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ]);
    const seg = result.segments[0];
    // Years = 10, emergence has 5 entries, 5 remaining years at 5%
    expect(seg.expectedLoss).toBeGreaterThan(0);
    expect(seg.allowanceRequired).toBeGreaterThan(0);
  });

  // ── Vintage: cumulative loss capped at 100% ────────────────
  it('should cap vintage cumulative loss at 100%', () => {
    const result = svc.calculateVintage([
      {
        segmentName: 'Extreme',
        balance: 100_000,
        weightedAvgMaturity: 30,
        historicalLossRate: 0.9,
        lgd: 1.0,
        qualitativeAdj: 0.1,
      },
    ]);
    const seg = result.segments[0];
    expect(seg.expectedLoss).toBeLessThanOrEqual(100_000);
  });

  // ── PD x LGD: scenario ordering ───────────────────────────
  it('PD x LGD scenario totals increase with scenario severity', () => {
    const result = svc.calculatePDxLGD(segments);
    const bd = result.macroScenarioBreakdown!;
    expect(bd.baseline).toBeLessThanOrEqual(bd.adverse);
    expect(bd.adverse).toBeLessThanOrEqual(bd.severelyAdverse);
  });

  // ── PD x LGD: weighted allowance is between baseline and severely adverse
  it('PD x LGD weighted allowance is between baseline and severely adverse', () => {
    const result = svc.calculatePDxLGD(segments);
    const bd = result.macroScenarioBreakdown!;
    expect(bd.weighted).toBeGreaterThanOrEqual(bd.baseline);
    expect(bd.weighted).toBeLessThanOrEqual(bd.severelyAdverse);
  });

  // ── PD x LGD: zero balance ─────────────────────────────────
  it('PD x LGD handles zero balance segments', () => {
    const result = svc.calculatePDxLGD([
      {
        segmentName: 'Empty',
        balance: 0,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ]);
    expect(result.totalBalance).toBe(0);
    expect(result.totalAllowance).toBe(0);
    expect(result.weightedCoverageRatio).toBe(0);
  });

  // ── Validation: clamp NaN and out-of-range values ──────────
  it('should sanitize NaN balance to 0', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'NaN',
        balance: NaN,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ]);
    expect(result.totalBalance).toBe(0);
  });

  it('should sanitize NaN historicalLossRate to 0', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'NaN',
        balance: 100_000,
        weightedAvgMaturity: 3,
        historicalLossRate: NaN,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ]);
    const seg = result.segments[0];
    expect(seg.historicalLossRate).toBe(0);
  });

  it('should clamp maturity to max 50 years', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'Long',
        balance: 100_000,
        weightedAvgMaturity: 100,
        historicalLossRate: 0.01,
        lgd: 0.5,
        qualitativeAdj: 0,
      },
    ]);
    // Should not crash and should use clamped maturity
    expect(result.segments[0].expectedLoss).toBeGreaterThanOrEqual(0);
  });

  it('should clamp qualitative adj to ±10%', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'Over',
        balance: 100_000,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: 0.5, // should be clamped to 0.1
      },
    ]);
    expect(result.segments[0].qualitativeAdj).toBe(0.1);
  });

  it('should clamp negative qualitative adj to -10%', () => {
    const result = svc.calculateWARM([
      {
        segmentName: 'Under',
        balance: 100_000,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
        lgd: 0.5,
        qualitativeAdj: -0.5, // should be clamped to -0.1
      },
    ]);
    expect(result.segments[0].qualitativeAdj).toBe(-0.1);
  });

  it('should default LGD to 0.5 when undefined', () => {
    const result = svc.calculatePDxLGD([
      {
        segmentName: 'NoLGD',
        balance: 100_000,
        weightedAvgMaturity: 3,
        historicalLossRate: 0.02,
      },
    ]);
    // With default LGD=0.5, allowance should be non-zero
    expect(result.totalAllowance).toBeGreaterThan(0);
  });

  // ── calculateIncurredLoss (Reg 8665 §2.12.2.5, Wave 1 W1.1) ─
  describe('calculateIncurredLoss (Reg 8665 §2.12.2.5)', () => {
    it('returns the incurred-loss output shape + methodology label', () => {
      const result = svc.calculateIncurredLoss(segments);
      expect(result.methodology).toBe('Incurred Loss (Reg 8665)');
      expect(result.overallStatus).toBe('computed');
      expect(result.segments.length).toBe(2);
    });

    it('computes allowance = balance × (lossRate + qFactor) × LEP (default 1yr, undiscounted)', () => {
      const result = svc.calculateIncurredLoss(segments);
      // Consumer: (0.02 + 0.005) × 1.0 = 0.025 → 100M × 0.025 = 2,500,000
      // Commercial: (0.01 + 0.002) × 1.0 = 0.012 → 200M × 0.012 = 2,400,000
      const consumer = result.segments.find(
        (s) => s.segmentName === 'Consumer',
      )!;
      const commercial = result.segments.find(
        (s) => s.segmentName === 'Commercial',
      )!;
      expect(consumer.expectedLoss).toBeCloseTo(2_500_000, 0);
      expect(commercial.expectedLoss).toBeCloseTo(2_400_000, 0);
      expect(result.totalAllowance).toBeCloseTo(4_900_000, 0);
      expect(result.weightedCoverageRatio).toBeCloseTo(
        4_900_000 / 300_000_000,
        6,
      );
    });

    it('is STRICTLY LESS than the lifetime CECL/WARM allowance on a multi-year book', () => {
      // The whole point of the dual filing: the 1yr incurred-loss horizon is a
      // smaller number than WARM's remaining-life horizon for maturities > ~1yr.
      const incurred = svc.calculateIncurredLoss(segments);
      const warm = svc.calculateWARM(segments);
      expect(incurred.totalAllowance).toBeLessThan(warm.totalAllowance);
    });

    it('scales LINEARLY with the loss-emergence period (computed, not cached)', () => {
      const oneYear = svc.calculateIncurredLoss(segments, {
        lossEmergencePeriodYears: 1,
      });
      const halfYear = svc.calculateIncurredLoss(segments, {
        lossEmergencePeriodYears: 0.5,
      });
      expect(halfYear.totalAllowance).toBeCloseTo(
        oneYear.totalAllowance / 2,
        0,
      );
    });

    it('ALWAYS discloses the provisional LEP + Reg 8665 basis as a WARNING gap (D1)', () => {
      const result = svc.calculateIncurredLoss(segments);
      expect(result.overallStatus).toBe('computed'); // WARNING does not block
      const gap = result.gaps?.find(
        (g) => g.field === 'cecl.incurredLoss.lossEmergencePeriod',
      );
      expect(gap).toBeDefined();
      expect(gap!.severity).toBe('WARNING');
      expect(gap!.context).toMatchObject({ lossEmergencePeriodYears: 1 });
      // Bilingual, Spanish-first; names the UNVERIFIED reg source.
      expect(gap!.action).toMatch(/8665/);
      expect(gap!.action).toMatch(/PROVISIONAL/);
    });

    it('discloses the incurred-loss (Reg 8665) accounting basis', () => {
      const result = svc.calculateIncurredLoss(segments);
      expect(result.accountingBasis?.framework).toMatch(/8665/);
      expect(result.accountingBasis?.framework).toMatch(/incurred loss/i);
    });

    it('D1: refuses to compute on empty segments — data_unavailable + CRITICAL gap, no phantom zero', () => {
      const result = svc.calculateIncurredLoss([]);
      expect(result.overallStatus).toBe('data_unavailable');
      expect(result.totalAllowance).toBe(0);
      expect(result.segments).toEqual([]);
      expect(result.gaps?.[0]).toMatchObject({ severity: 'CRITICAL' });
    });

    it('D1: all-zero balances are treated as no data, not a $0 allowance', () => {
      const result = svc.calculateIncurredLoss([
        {
          segmentName: 'Empty',
          balance: 0,
          weightedAvgMaturity: 3,
          historicalLossRate: 0.02,
        },
      ]);
      expect(result.overallStatus).toBe('data_unavailable');
    });

    it('falls back to the disclosed 1yr default when LEP is non-positive', () => {
      const result = svc.calculateIncurredLoss(segments, {
        lossEmergencePeriodYears: 0,
      });
      const dflt = svc.calculateIncurredLoss(segments);
      expect(result.totalAllowance).toBeCloseTo(dflt.totalAllowance, 0);
    });

    it('clamps an absurd LEP to 10 years', () => {
      const huge = svc.calculateIncurredLoss(segments, {
        lossEmergencePeriodYears: 1000,
      });
      const tenYear = svc.calculateIncurredLoss(segments, {
        lossEmergencePeriodYears: 10,
      });
      expect(huge.totalAllowance).toBeCloseTo(tenYear.totalAllowance, 0);
    });

    it('caps the per-segment incurred-loss rate at 100% for extreme inputs', () => {
      const result = svc.calculateIncurredLoss([
        {
          segmentName: 'Distressed',
          balance: 10_000_000,
          weightedAvgMaturity: 2,
          historicalLossRate: 1, // 100% annual loss rate
          qualitativeAdj: 0.1,
        },
      ]);
      // (1 + 0.1) × LEP clamps to 1.0 → allowance == balance, never more.
      expect(result.segments[0].coverageRatio).toBeLessThanOrEqual(1);
      expect(result.totalAllowance).toBeCloseTo(10_000_000, 0);
    });
  });

  // ── getCECLAnalysis: routing by methodology ────────────────
  describe('getCECLAnalysis', () => {
    // D1 (2026-04-07): the previous behavior fell back to DEMO segments
    // when an institution had no loan segments configured, producing a
    // real-looking CECL allowance computed against fake demo data — a
    // worse failure than silent zero. New contract: empty segments →
    // data_unavailable shell + CRITICAL gap.
    it('refuses to compute CECL on missing loan segments, returns data_unavailable + CRITICAL gap', async () => {
      const result = await svc.getCECLAnalysis('inst-1');
      expect(result.overallStatus).toBe('data_unavailable');
      expect(result.segments).toEqual([]);
      expect(result.totalAllowance).toBe(0);
      expect(result.gaps).toBeDefined();
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps![0]).toMatchObject({
        field: 'cecl.segments',
        reason: 'EMPTY_BALANCE_SHEET',
        severity: 'CRITICAL',
      });
    });

    it('routes to vintage method when specified', async () => {
      const mockPrisma = {
        loanSegment: {
          findMany: jest.fn().mockResolvedValue([
            {
              segmentName: 'Loans',
              balance: 100_000,
              weightedAvgRate: 0.06,
              weightedAvgMaturity: 5,
              historicalLossRate: 0.02,
              lgd: 0.4,
              qualitativeAdj: 0,
            },
          ]),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      } as any;
      const service = new CECLService(mockPrisma);
      const result = await service.getCECLAnalysis('inst-1', 'vintage');
      expect(result.methodology).toBe('Vintage');
    });

    it('routes to PD x LGD method when specified', async () => {
      const mockPrisma = {
        loanSegment: {
          findMany: jest.fn().mockResolvedValue([
            {
              segmentName: 'Loans',
              balance: 100_000,
              weightedAvgRate: 0.06,
              weightedAvgMaturity: 5,
              historicalLossRate: 0.02,
              lgd: 0.4,
              qualitativeAdj: 0,
            },
          ]),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      } as any;
      const service = new CECLService(mockPrisma);
      const result = await service.getCECLAnalysis('inst-1', 'pdlgd');
      expect(result.methodology).toBe('PD×LGD');
    });

    it('routes to incurred-loss method when specified', async () => {
      const mockPrisma = {
        loanSegment: {
          findMany: jest.fn().mockResolvedValue([
            {
              segmentName: 'Loans',
              balance: 100_000,
              weightedAvgRate: 0.06,
              weightedAvgMaturity: 5,
              historicalLossRate: 0.02,
              lgd: 0.4,
              qualitativeAdj: 0,
            },
          ]),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      } as any;
      const service = new CECLService(mockPrisma);
      const result = await service.getCECLAnalysis('inst-1', 'incurredloss');
      expect(result.methodology).toBe('Incurred Loss (Reg 8665)');
    });

    it('defaults to WARM when methodology is not specified', async () => {
      const result = await svc.getCECLAnalysis('inst-1');
      expect(result.methodology).toBe('WARM');
    });
  });

  // ── getCooperativaCECLAnalysis (Layer 1, PR overlay) ───────
  describe('getCooperativaCECLAnalysis', () => {
    const mkService = (segments: any[]) => {
      const mockPrisma = {
        loanSegment: {
          findMany: jest.fn().mockResolvedValue(segments),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      } as any;
      return new CECLService(mockPrisma);
    };

    const prSegments = [
      {
        segmentName: 'Préstamos personales',
        balance: 80_000_000,
        weightedAvgRate: 0.09,
        weightedAvgMaturity: 3.5,
        historicalLossRate: 0.022,
        lgd: 0.6,
        qualitativeAdj: 0,
      },
      {
        segmentName: 'Hipotecas',
        balance: 120_000_000,
        weightedAvgRate: 0.055,
        weightedAvgMaturity: 18,
        historicalLossRate: 0.008,
        lgd: 0.3,
        qualitativeAdj: 0,
      },
    ];

    it('returns data_unavailable + CRITICAL gap when institution has no segments', async () => {
      const service = mkService([]);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      expect(result.overallStatus).toBe('data_unavailable');
      expect(result.productClassification).toEqual([]);
      expect(result.gaps?.[0].severity).toBe('CRITICAL');
    });

    it('classifies Spanish segment names against the product registry', async () => {
      const service = mkService(prSegments);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      expect(result.overallStatus).toBe('computed');
      const types = result.productClassification.map((c) => c.productType);
      expect(types).toContain('PRESTAMO_PERSONAL');
      expect(types).toContain('HIPOTECA');
    });

    it('applies the PR overlay label to methodology for report provenance', async () => {
      const service = mkService(prSegments);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      expect(result.methodology).toBe('PD×LGD (PR)');
      expect(result.segments[0].methodology).toContain('PR');
    });

    it('discloses the ASC 326 accounting basis + the provisional macro-overlay gap (D1)', async () => {
      const service = mkService(prSegments);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      expect(result.overallStatus).toBe('computed');
      // Measurement-basis disclosure: CECL is ASC 326 (GAAP); COSSEC is CAEL/RAP→GAAP.
      expect(result.accountingBasis?.framework).toMatch(/ASC 326/);
      expect(result.accountingBasis?.regulatoryContext).toMatch(/COSSEC/);
      // The PR macro overlay (2.1x/3.6x, 45/35/20) is always disclosed as provisional.
      expect(result.gaps?.some((g) => g.field === 'cecl.macroOverlay')).toBe(
        true,
      );
    });

    // ── W1.2 Slice 2: data-derived macro overlay wiring ──────
    describe('macro overlay wiring (W1.2 Slice 2)', () => {
      const mkWiredService = (segments: any[]) => {
        const mockPrisma = {
          loanSegment: {
            findMany: jest.fn().mockResolvedValue(segments),
            createMany: jest.fn(),
            deleteMany: jest.fn(),
          },
        } as any;
        const feed = new PrMacroFeedService();
        // Pin the clock one day after the snapshot's verification pass so
        // staleness never fires and the output is deterministic.
        const base = new Date(`${PR_MACRO_SNAPSHOT.compiledAsOf}T00:00:00Z`);
        feed.nowFn = () => new Date(base.getTime() + 86_400_000);
        return new CECLService(mockPrisma, new MacroOverlayService(feed));
      };

      beforeEach(() => {
        delete process.env.CECL_MACRO_OVERLAY_MODE;
        delete process.env.FRED_API_KEY;
        delete process.env.PR_MACRO_STALENESS_DAYS;
      });

      afterEach(() => {
        delete process.env.CECL_MACRO_OVERLAY_MODE;
      });

      it('CONTINUITY: derived-mode numbers are identical to the legacy hard-coded numbers at MSI 0', async () => {
        // The committed snapshot's macro state is benign (at-or-better than
        // reference) → MSI 0 → the derived overlay must reproduce the
        // constants exactly. This is the spec that makes flipping the basis
        // a provenance change, not a number change.
        const legacy =
          await mkService(prSegments).getCooperativaCECLAnalysis('inst-1');
        const derived =
          await mkWiredService(prSegments).getCooperativaCECLAnalysis('inst-1');

        expect(derived.totalAllowance).toBe(legacy.totalAllowance);
        expect(derived.weightedCoverageRatio).toBe(
          legacy.weightedCoverageRatio,
        );
        expect(derived.macroScenarioBreakdown).toEqual(
          legacy.macroScenarioBreakdown,
        );
        expect(derived.segments).toEqual(legacy.segments);
      });

      it('derived mode stamps the macroOverlay provenance block + the DERIVED gap', async () => {
        const result =
          await mkWiredService(prSegments).getCooperativaCECLAnalysis('inst-1');
        expect(result.macroOverlay?.basis).toBe('derived-from-macro');
        expect(result.macroOverlay?.macroStressIndex).toBe(0);
        expect(result.macroOverlay?.inputs?.prUnemploymentPct).toBe(
          PR_MACRO_SNAPSHOT.inputs.prUnemploymentPct,
        );
        expect(result.macroOverlay?.provenance).toContain('pr-macro-snapshot');
        const gap = result.gaps?.find((g) => g.field === 'cecl.macroOverlay');
        expect(gap?.action).toMatch(/DERIVAD/); // derived disclosure…
        expect(gap?.action).not.toMatch(/hard-coded/); // …not the legacy one
      });

      it('CECL_MACRO_OVERLAY_MODE=hardcoded kill switch → legacy path even when wired', async () => {
        process.env.CECL_MACRO_OVERLAY_MODE = 'hardcoded';
        const result =
          await mkWiredService(prSegments).getCooperativaCECLAnalysis('inst-1');
        expect(result.macroOverlay).toBeUndefined();
        const gap = result.gaps?.find((g) => g.field === 'cecl.macroOverlay');
        expect(gap?.action).toMatch(/PROVISIONAL/);
        expect(gap?.action).toMatch(/2\.1x/); // the legacy hard-coded disclosure
      });

      it('no overlay injected (legacy constructors) → no macroOverlay block, legacy gap intact', async () => {
        const result =
          await mkService(prSegments).getCooperativaCECLAnalysis('inst-1');
        expect(result.macroOverlay).toBeUndefined();
        const gap = result.gaps?.find((g) => g.field === 'cecl.macroOverlay');
        expect(gap?.action).toMatch(/calibración PROVISIONAL/);
      });
    });

    it('excludes an unclassified, data-less segment from allowance + coverage and discloses it (D1)', async () => {
      const service = mkService([
        ...prSegments,
        {
          segmentName: 'Derivados exóticos', // matchProductType -> null
          balance: 50_000_000,
          weightedAvgRate: 0.04,
          weightedAvgMaturity: 5,
          historicalLossRate: 0, // no own loss history -> not estimable
          lgd: 0,
          qualitativeAdj: 0,
        },
      ]);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      // Denominator is the 2 classified segments ($200M), NOT $250M — the
      // unclassified data-less balance is excluded, so coverage is not diluted.
      expect(result.totalBalance).toBeCloseTo(200_000_000, -2);
      // Excluded, but disclosed (never silently dropped).
      expect(
        result.gaps?.some(
          (g) =>
            g.field === 'cecl.segments.Derivados exóticos' &&
            /EXCLU/.test(g.action ?? ''),
        ),
      ).toBe(true);
      // Still visible in the classification table (productType null).
      expect(
        result.productClassification.some(
          (c) =>
            c.segmentName === 'Derivados exóticos' && c.productType === null,
        ),
      ).toBe(true);
    });

    it('produces a HIGHER weighted allowance than mainland CCAR overlay (PR multipliers are harsher)', async () => {
      const service = mkService(prSegments);
      const pr = await service.getCooperativaCECLAnalysis('inst-1');
      const mainland = service.calculatePDxLGD(
        prSegments.map((s) => ({
          segmentName: s.segmentName,
          balance: s.balance,
          weightedAvgMaturity: s.weightedAvgMaturity,
          historicalLossRate: s.historicalLossRate,
          lgd: s.lgd,
          qualitativeAdj: s.qualitativeAdj,
        })),
      );
      expect(pr.totalAllowance).toBeGreaterThan(mainland.totalAllowance);
    });

    it('excludes liability-side products (Club de Navidad) from the allowance but classifies them', async () => {
      const service = mkService([
        ...prSegments,
        {
          segmentName: 'Club de Navidad',
          balance: 5_000_000,
          weightedAvgRate: 0.01,
          weightedAvgMaturity: 1,
          historicalLossRate: 0,
          lgd: 0,
          qualitativeAdj: 0,
        },
      ]);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      const club = result.productClassification.find(
        (c) => c.productType === 'CLUB_NAVIDAD',
      );
      expect(club).toBeDefined();
      expect(
        result.segments.find((s) => s.segmentName === 'Club de Navidad'),
      ).toBeUndefined();
      // totalBalance only counts CECL-eligible loans
      expect(result.totalBalance).toBeCloseTo(200_000_000, -2);
    });

    it('fills cold-start PD/LGD from registry defaults and surfaces a WARNING gap (D1 disclosure)', async () => {
      const service = mkService([
        {
          segmentName: 'Préstamos de auto',
          balance: 40_000_000,
          weightedAvgRate: 0.07,
          weightedAvgMaturity: 0, // missing
          historicalLossRate: 0, // missing
          lgd: 0, // missing
          qualitativeAdj: 0,
        },
      ]);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      expect(result.overallStatus).toBe('computed');
      expect(result.totalAllowance).toBeGreaterThan(0);
      const cls = result.productClassification[0];
      expect(cls.productType).toBe('PRESTAMO_AUTO');
      expect(cls.defaultsApplied).toBe(true);
      const warning = result.gaps?.find((g) => g.severity === 'WARNING');
      expect(warning).toBeDefined();
      expect(warning!.action).toContain('calibración provisional');
    });

    it('flags unclassifiable segments with a WARNING gap instead of guessing', async () => {
      const service = mkService([
        ...prSegments,
        {
          segmentName: 'Derivados exóticos',
          balance: 1_000_000,
          weightedAvgRate: 0.05,
          weightedAvgMaturity: 2,
          historicalLossRate: 0.01,
          lgd: 0.5,
          qualitativeAdj: 0,
        },
      ]);
      const result = await service.getCooperativaCECLAnalysis('inst-1');
      const unknown = result.productClassification.find(
        (c) => c.segmentName === 'Derivados exóticos',
      );
      expect(unknown?.productType).toBeNull();
      expect(
        result.gaps?.some((g) => g.field.includes('Derivados exóticos')),
      ).toBe(true);
    });
  });

  // ── getCECLForecast ────────────────────────────────────────
  describe('getCECLForecast', () => {
    it('returns 8 quarterly projections', async () => {
      const result = await svc.getCECLForecast('inst-1');
      expect(result.quarters).toHaveLength(8);
    });

    it('returns totalProvision12M as sum of first 4 quarters', async () => {
      const result = await svc.getCECLForecast('inst-1');
      const sum4 = result.quarters
        .slice(0, 4)
        .reduce((s, q) => s + q.provisionExpense, 0);
      expect(result.totalProvision12M).toBeCloseTo(sum4, 2);
    });

    it('each quarter has positive or zero provisionExpense', async () => {
      const result = await svc.getCECLForecast('inst-1');
      for (const q of result.quarters) {
        expect(q.provisionExpense).toBeGreaterThanOrEqual(0);
      }
    });

    it('each quarter has a label like Q1 YYYY', async () => {
      const result = await svc.getCECLForecast('inst-1');
      for (const q of result.quarters) {
        expect(q.quarter).toMatch(/^Q[1-4] \d{4}$/);
      }
    });
  });

  // ── importLoanSegments ─────────────────────────────────────
  describe('importLoanSegments', () => {
    it('deletes existing segments and creates new ones', async () => {
      const mockPrisma = {
        loanSegment: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;
      const service = new CECLService(mockPrisma);

      const result = await service.importLoanSegments('inst-1', [
        {
          segmentName: 'Auto',
          balance: 50_000,
          weightedAvgRate: 0.06,
          weightedAvgMaturity: 4,
          historicalLossRate: 0.01,
        },
        {
          segmentName: 'Mortgage',
          balance: 100_000,
          weightedAvgRate: 0.05,
          weightedAvgMaturity: 15,
          historicalLossRate: 0.005,
          lgd: 0.3,
          qualitativeAdj: 0.001,
        },
      ]);

      expect(mockPrisma.loanSegment.deleteMany).toHaveBeenCalledWith({
        where: { institutionId: 'inst-1' },
      });
      expect(result.imported).toBe(2);
      expect(result.institutionId).toBe('inst-1');
    });
  });

  describe('getCECLAnalysis default methodology', () => {
    it('uses WARM when methodology is not vintage or pdlgd', async () => {
      const mockPrisma = {
        loanSegment: {
          findMany: jest.fn().mockResolvedValue([
            {
              segmentName: 'Consumer',
              balance: 100000,
              weightedAvgMaturity: 3,
              historicalLossRate: 0.02,
              lgd: 0.5,
              qualitativeAdj: 0.005,
            },
          ]),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
        institution: { findFirst: jest.fn().mockResolvedValue(null) },
      } as any;
      const service = new CECLService(mockPrisma);
      const result = await service.getCECLAnalysis('inst-1', 'unknown_method');
      expect(result).toHaveProperty('totalBalance');
      expect(result).toHaveProperty('totalAllowance');
    });
  });
});
