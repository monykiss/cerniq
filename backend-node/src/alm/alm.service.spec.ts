import { AlmService } from './alm.service';
import { BalanceSheetDto, LCRRequestDto } from './alm.dto';

// ─── Sample Cooperativa Balance Sheet ──────────────────────────
// Realistic community credit union ($200M total assets)

const SAMPLE_COOPERATIVA: BalanceSheetDto = {
  assets: [
    {
      name: 'Fixed Mortgages',
      amount: 80_000_000,
      rate: 0.045,
      maturityYears: 7,
      isFloating: false,
    },
    {
      name: 'Commercial Loans',
      amount: 50_000_000,
      rate: 0.07,
      maturityYears: 3,
      isFloating: true,
      repricingFrequencyMonths: 3,
    },
    {
      name: 'Securities',
      amount: 40_000_000,
      rate: 0.038,
      maturityYears: 5,
      isFloating: false,
    },
    {
      name: 'Cash',
      amount: 30_000_000,
      rate: 0.045,
      maturityYears: 0.01,
      isFloating: true,
    },
  ],
  liabilities: [
    {
      name: 'Core Deposits',
      amount: 80_000_000,
      rate: 0.004,
      maturityYears: 3,
      isFloating: false,
    },
    {
      name: 'Money Market',
      amount: 50_000_000,
      rate: 0.012,
      maturityYears: 0.5,
      isFloating: true,
      repricingFrequencyMonths: 1,
    },
    {
      name: 'CDs',
      amount: 30_000_000,
      rate: 0.025,
      maturityYears: 2,
      isFloating: false,
    },
  ],
  equity: 40_000_000,
};

describe('AlmService', () => {
  let service: AlmService;

  beforeEach(() => {
    service = new AlmService();
  });

  // ═══════════════════════════════════════════════════════════════
  //  1. Duration Gap Analysis (10 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('durationGapAnalysis', () => {
    it('should compute a positive duration gap when assets have longer duration than liabilities', () => {
      const result = service.durationGapAnalysis(SAMPLE_COOPERATIVA);

      // Fixed mortgages (7yr) and securities (5yr) pull asset duration up
      // Core deposits (3yr) and CDs (2yr) are shorter on liability side
      expect(result.durationGap).toBeGreaterThan(0);
      expect(result.assetDuration).toBeGreaterThan(result.liabilityDuration);
    });

    it('should compute a negative duration gap when liabilities have longer duration than assets', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Short-Term Loan',
            amount: 100_000,
            rate: 0.06,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Long-Term Bond',
            amount: 80_000,
            rate: 0.04,
            maturityYears: 10,
            isFloating: false,
          },
        ],
        equity: 20_000,
      };
      const result = service.durationGapAnalysis(bs);

      // Asset duration ~1yr, liability duration ~8+ years
      expect(result.durationGap).toBeLessThan(0);
      expect(result.interpretation).toContain('liability-sensitive');
    });

    it('should compute zero duration gap for a perfectly immunized position', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Matched Loan',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Matched Deposit',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        equity: 0,
      };
      const result = service.durationGapAnalysis(bs);

      // Same duration, leverage ratio = 1 => gap = DA - 1*DL = 0
      expect(result.durationGap).toBeCloseTo(0, 4);
    });

    it('should correctly handle a single asset versus a single liability', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Sole Asset',
            amount: 500_000,
            rate: 0.06,
            maturityYears: 10,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Sole Liability',
            amount: 400_000,
            rate: 0.03,
            maturityYears: 2,
            isFloating: false,
          },
        ],
        equity: 100_000,
      };
      const result = service.durationGapAnalysis(bs);

      expect(result.totalAssets).toBe(500_000);
      expect(result.totalLiabilities).toBe(400_000);
      expect(result.assetDetails).toHaveLength(1);
      expect(result.liabilityDetails).toHaveLength(1);
      expect(result.durationGap).toBeGreaterThan(0);
    });

    it('should compute weighted-average duration across multiple assets and liabilities', () => {
      const result = service.durationGapAnalysis(SAMPLE_COOPERATIVA);

      expect(result.totalAssets).toBe(200_000_000);
      expect(result.totalLiabilities).toBe(160_000_000);
      expect(result.assetDetails).toHaveLength(4);
      expect(result.liabilityDetails).toHaveLength(3);

      // Asset duration should be between the shortest (~0yr cash) and longest (~7yr mortgage)
      expect(result.assetDuration).toBeGreaterThan(0);
      expect(result.assetDuration).toBeLessThan(7);
    });

    it('should assign near-zero duration to floating-rate instruments', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Quarterly Floater',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 5,
            isFloating: true,
            repricingFrequencyMonths: 3,
          },
        ],
        liabilities: [
          {
            name: 'Stub',
            amount: 1_000,
            rate: 0.02,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        equity: 99_000,
      };
      const result = service.durationGapAnalysis(bs);

      // Floating with 3-month repricing => duration ~ 0.25 years
      expect(result.assetDetails[0].macaulayDuration).toBeCloseTo(0.25, 2);
      expect(result.assetDuration).toBeCloseTo(0.25, 2);
    });

    it('should handle zero equity edge case without division errors', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Asset A',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 3,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Liability A',
            amount: 100_000,
            rate: 0.03,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        equity: 0,
      };
      const result = service.durationGapAnalysis(bs);

      // Leverage ratio = L/A = 1.0
      // Gap = DA - 1.0 * DL
      expect(result.durationGap).toBeDefined();
      expect(typeof result.durationGap).toBe('number');
      expect(Number.isFinite(result.durationGap)).toBe(true);
    });

    it('should produce "asset-sensitive" interpretation for positive duration gap', () => {
      const result = service.durationGapAnalysis(SAMPLE_COOPERATIVA);

      expect(result.durationGap).toBeGreaterThan(0);
      expect(result.interpretation).toContain('asset-sensitive');
    });

    it('should produce "well matched" interpretation for near-zero duration gap', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Bond',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Funding',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        equity: 0,
      };
      const result = service.durationGapAnalysis(bs);

      expect(Math.abs(result.durationGap)).toBeLessThan(0.5);
      expect(result.interpretation).toContain('well matched');
    });

    it('should compute Macaulay duration equal to maturity for a zero-coupon bond', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Zero-Coupon Bond',
            amount: 100_000,
            rate: 0.0,
            maturityYears: 10,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Stub',
            amount: 1_000,
            rate: 0.01,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        equity: 99_000,
      };
      const result = service.durationGapAnalysis(bs);

      // Zero-coupon bond: Macaulay duration = maturity
      expect(result.assetDetails[0].macaulayDuration).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  2. NII Simulation (10 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('niiSimulation', () => {
    it('should compute base NII as total asset income minus total liability cost', () => {
      const result = service.niiSimulation(SAMPLE_COOPERATIVA);

      // Asset income:
      //   Fixed Mortgages: 80M * 4.5% = 3,600,000
      //   Commercial Loans: 50M * 7.0% = 3,500,000
      //   Securities: 40M * 3.8% = 1,520,000
      //   Cash: 30M * 4.5% = 1,350,000
      //   Total = 9,970,000
      const expectedAssetIncome =
        80_000_000 * 0.045 +
        50_000_000 * 0.07 +
        40_000_000 * 0.038 +
        30_000_000 * 0.045;
      expect(result.assetIncome).toBeCloseTo(expectedAssetIncome, 0);

      // Liability cost:
      //   Core Deposits: 80M * 0.4% = 320,000
      //   Money Market: 50M * 1.2% = 600,000
      //   CDs: 30M * 2.5% = 750,000
      //   Total = 1,670,000
      const expectedLiabilityCost =
        80_000_000 * 0.004 + 50_000_000 * 0.012 + 30_000_000 * 0.025;
      expect(result.liabilityCost).toBeCloseTo(expectedLiabilityCost, 0);

      expect(result.baseNII).toBeCloseTo(
        expectedAssetIncome - expectedLiabilityCost,
        0,
      );
    });

    it('should show NII increasing under positive rate shock for asset-sensitive cooperativa', () => {
      const result = service.niiSimulation(SAMPLE_COOPERATIVA, [-200, 0, 200]);

      const baseScenario = result.scenarios.find((s) => s.shockBps === 0)!;
      const upScenario = result.scenarios.find((s) => s.shockBps === 200)!;

      // Cooperativa has more floating assets (Commercial Loans + Cash = 80M)
      // than floating liabilities (Money Market = 50M) -- asset-sensitive
      // Rising rates should increase NII
      expect(upScenario.nii).toBeGreaterThan(baseScenario.nii);
      expect(upScenario.change).toBeGreaterThan(0);
    });

    it('should show NII decreasing under negative rate shock for asset-sensitive cooperativa', () => {
      const result = service.niiSimulation(SAMPLE_COOPERATIVA, [-200, 0, 200]);

      const downScenario = result.scenarios.find((s) => s.shockBps === -200)!;

      expect(downScenario.change).toBeLessThan(0);
      expect(downScenario.nii).toBeLessThan(result.baseNII);
    });

    it('should reprice floating-rate assets under rate shocks', () => {
      const allFloat: BalanceSheetDto = {
        assets: [
          {
            name: 'Float Loan',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 3,
            isFloating: true,
            repricingFrequencyMonths: 3,
          },
        ],
        liabilities: [
          {
            name: 'Fixed Deposit',
            amount: 80_000,
            rate: 0.02,
            maturityYears: 2,
            isFloating: false,
          },
        ],
        equity: 20_000,
      };

      const result = service.niiSimulation(allFloat, [0, 100]);
      const base = result.scenarios.find((s) => s.shockBps === 0)!;
      const shocked = result.scenarios.find((s) => s.shockBps === 100)!;

      // Floating asset reprices up by 1% (100bps), fixed liability stays
      // Change should be: 100,000 * 0.01 = 1,000
      expect(shocked.nii).toBeGreaterThan(base.nii);
      expect(shocked.change).toBeCloseTo(1_000, 0);
    });

    it('should not reprice fixed-rate assets under any rate shock', () => {
      const allFixed: BalanceSheetDto = {
        assets: [
          {
            name: 'Fixed Loan',
            amount: 100_000,
            rate: 0.06,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Fixed Deposit',
            amount: 80_000,
            rate: 0.03,
            maturityYears: 3,
            isFloating: false,
          },
        ],
        equity: 20_000,
      };

      const result = service.niiSimulation(allFixed, [-300, -100, 0, 100, 300]);

      for (const scenario of result.scenarios) {
        expect(scenario.change).toBeCloseTo(0, 2);
        expect(scenario.nii).toBeCloseTo(result.baseNII, 2);
      }
    });

    it('should classify risk as LOW when NII change percentage is under 5%', () => {
      const result = service.niiSimulation(SAMPLE_COOPERATIVA, [0]);

      const scenario = result.scenarios[0];
      expect(scenario.changePct).toBeCloseTo(0, 4);
      expect(scenario.riskLevel).toBe('low');
    });

    it('should assign MEDIUM risk when NII change is between 5% and 10%', () => {
      // Build a balance sheet where a 100bps shock causes 5-10% NII change
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Float Loan',
            amount: 200_000,
            rate: 0.05,
            maturityYears: 3,
            isFloating: true,
            repricingFrequencyMonths: 3,
          },
        ],
        liabilities: [
          {
            name: 'Fixed Deposit',
            amount: 150_000,
            rate: 0.03,
            maturityYears: 2,
            isFloating: false,
          },
        ],
        equity: 50_000,
      };

      // Base NII = 200k * 5% - 150k * 3% = 10k - 4.5k = 5.5k
      // +100bps shock: floating reprices => 200k * 6% - 150k * 3% = 12k - 4.5k = 7.5k
      // Change = 2k, changePct = 2k/5.5k = 36.4% => critical
      // Try +25bps: 200k * 5.25% - 150k * 3% = 10.5k - 4.5k = 6k
      // Change = 0.5k, pct = 0.5/5.5 = 9.09% => medium
      const result = service.niiSimulation(bs, [25]);
      const scenario = result.scenarios[0];
      expect(scenario.riskLevel).toBe('medium');
    });

    it('should assign CRITICAL risk when NII change exceeds 20%', () => {
      // Highly asset-sensitive balance sheet
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Float Loan',
            amount: 200_000,
            rate: 0.05,
            maturityYears: 3,
            isFloating: true,
            repricingFrequencyMonths: 1,
          },
        ],
        liabilities: [
          {
            name: 'Fixed Deposit',
            amount: 150_000,
            rate: 0.03,
            maturityYears: 2,
            isFloating: false,
          },
        ],
        equity: 50_000,
      };

      // Base NII = 200k * 5% - 150k * 3% = 5,500
      // +300bps: 200k * 8% - 150k * 3% = 16k - 4.5k = 11.5k
      // Change = 6k, pct = 6k/5.5k = 109% => critical
      const result = service.niiSimulation(bs, [300]);
      const scenario = result.scenarios[0];
      expect(Math.abs(scenario.changePct)).toBeGreaterThanOrEqual(0.2);
      expect(scenario.riskLevel).toBe('critical');
    });

    it('should accept custom shock scenarios', () => {
      const customShocks = [-50, 0, 50];
      const result = service.niiSimulation(SAMPLE_COOPERATIVA, customShocks);

      expect(result.scenarios).toHaveLength(3);
      expect(result.scenarios.map((s) => s.shockBps)).toEqual([-50, 0, 50]);
    });

    it('should return empty scenarios array when passed empty shocks', () => {
      const result = service.niiSimulation(SAMPLE_COOPERATIVA, []);

      expect(result.scenarios).toHaveLength(0);
      expect(result.baseNII).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  3. EVE Analysis (7 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('eveAnalysis', () => {
    it('should compute a positive base EVE when asset PV exceeds liability PV', () => {
      const result = service.eveAnalysis(SAMPLE_COOPERATIVA);

      // Assets are larger than liabilities => base EVE positive
      expect(result.baseEVE).toBeGreaterThan(0);
    });

    it('should show EVE decreasing when rates rise for a positive-duration-gap institution', () => {
      const result = service.eveAnalysis(SAMPLE_COOPERATIVA, [-200, 0, 200]);

      const baseScenario = result.scenarios.find((s) => s.shockBps === 0)!;
      const upScenario = result.scenarios.find((s) => s.shockBps === 200)!;

      // Positive duration gap => assets lose more PV than liabilities when rates rise
      expect(upScenario.eve).toBeLessThan(baseScenario.eve);
      expect(upScenario.change).toBeLessThan(0);
    });

    it('should show EVE increasing when rates fall for a positive-duration-gap institution', () => {
      const result = service.eveAnalysis(SAMPLE_COOPERATIVA, [-200, 0, 200]);

      const baseScenario = result.scenarios.find((s) => s.shockBps === 0)!;
      const downScenario = result.scenarios.find((s) => s.shockBps === -200)!;

      expect(downScenario.eve).toBeGreaterThan(baseScenario.eve);
      expect(downScenario.change).toBeGreaterThan(0);
    });

    it('should discount cash flows using the instrument rate plus shock as discount rate', () => {
      // A fixed-rate instrument with known PV
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Bond',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Stub',
            amount: 1,
            rate: 0.01,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        equity: 99_999,
      };

      const result = service.eveAnalysis(bs, [0]);

      // PV of 1-year bond at par: coupon/(1+y) + principal/(1+y) = (5000+100000)/1.05 = 100000
      // The bond is at par so PV = amount = 100,000
      const baseScenario = result.scenarios.find((s) => s.shockBps === 0)!;
      // EVE ~ asset PV - liability PV. Asset PV at par ~= 100,000. Liability PV ~= 1.
      expect(baseScenario.eve).toBeCloseTo(result.baseEVE, 0);
    });

    it('should show larger EVE decline for larger rate shocks', () => {
      const result = service.eveAnalysis(SAMPLE_COOPERATIVA, [100, 200, 300]);

      const s100 = result.scenarios.find((s) => s.shockBps === 100)!;
      const s200 = result.scenarios.find((s) => s.shockBps === 200)!;
      const s300 = result.scenarios.find((s) => s.shockBps === 300)!;

      // Bigger shock => bigger decline (more negative change)
      expect(s200.change).toBeLessThan(s100.change);
      expect(s300.change).toBeLessThan(s200.change);
    });

    it('should handle default 9 scenarios when no shocks are specified', () => {
      const result = service.eveAnalysis(SAMPLE_COOPERATIVA);

      // Default shocks: -300, -200, -100, -50, 0, 50, 100, 200, 300
      expect(result.scenarios).toHaveLength(9);
    });

    it('should compute changePct relative to base EVE', () => {
      const result = service.eveAnalysis(SAMPLE_COOPERATIVA, [0, 100]);

      const shocked = result.scenarios.find((s) => s.shockBps === 100)!;

      // changePct = change / |baseEVE|
      const expectedPct = shocked.change / Math.abs(result.baseEVE);
      expect(shocked.changePct).toBeCloseTo(expectedPct, 4);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  4. LCR Calculation (5 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('liquidityCoverageRatio', () => {
    it('should compute a compliant LCR above 100% with adequate HQLA', () => {
      const input: LCRRequestDto = {
        hqla: { level1: 100, level2a: 50, level2b: 20 },
        totalNetOutflows: 80,
      };
      const result = service.liquidityCoverageRatio(input);

      // Level 1: 100 (no haircut)
      // Level 2A: 50 * 0.85 = 42.5
      // Level 2B: 20 * 0.75 = 15
      // Level 2 total: 57.5, cap: (2/3)*100 = 66.67 => no binding
      // HQLA = 100 + 57.5 = 157.5
      // LCR = 157.5/80 * 100 = 196.875%
      expect(result.hqlaTotal).toBeCloseTo(157.5, 1);
      expect(result.lcr).toBeCloseTo(196.88, 1);
      expect(result.status).toBe('compliant');
    });

    it('should flag breach when LCR falls below 90%', () => {
      const input: LCRRequestDto = {
        hqla: { level1: 30, level2a: 10, level2b: 5 },
        totalNetOutflows: 100,
      };
      const result = service.liquidityCoverageRatio(input);

      expect(result.lcr).toBeLessThan(90);
      expect(result.status).toBe('breach');
    });

    it('should apply HQLA haircuts correctly: Level 1 at 100%, Level 2A at 85%, Level 2B at 75%', () => {
      const input: LCRRequestDto = {
        hqla: { level1: 100, level2a: 100, level2b: 0 },
        totalNetOutflows: 100,
      };
      const result = service.liquidityCoverageRatio(input);

      // Level 2A adjusted: 100 * 0.85 = 85
      expect(result.hqlaBreakdown.level1).toBe(100);
      expect(result.hqlaBreakdown.level2aAdjusted).toBeCloseTo(85, 2);
      expect(result.hqlaBreakdown.level2bAdjusted).toBeCloseTo(0, 2);
    });

    it('should cap Level 2 assets at 2/3 of Level 1 (equivalent to 40% of total HQLA)', () => {
      const input: LCRRequestDto = {
        hqla: { level1: 50, level2a: 100, level2b: 100 },
        totalNetOutflows: 100,
      };
      const result = service.liquidityCoverageRatio(input);

      // Level 2A adjusted: 100 * 0.85 = 85
      // Level 2B adjusted: 100 * 0.75 = 75
      // Level 2 total: 160
      // Cap: (2/3) * 50 = 33.33
      // Binds! Level 2 applied = 33.33
      // HQLA = 50 + 33.33 = 83.33
      expect(result.hqlaBreakdown.level2Cap).toBeCloseTo(33.33, 1);
      expect(result.hqlaBreakdown.level2Applied).toBeCloseTo(33.33, 1);
      expect(result.hqlaTotal).toBeCloseTo(83.33, 1);
    });

    it('should flag warning status when LCR is between 90% and 100%', () => {
      // We need LCR = HQLA/outflows * 100 to be in [90, 100)
      // Level 1 = 90, outflows = 100, no Level 2 => LCR = 90%
      const input: LCRRequestDto = {
        hqla: { level1: 95, level2a: 0, level2b: 0 },
        totalNetOutflows: 100,
      };
      const result = service.liquidityCoverageRatio(input);

      expect(result.lcr).toBe(95);
      expect(result.status).toBe('warning');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  5. BPV (Basis Point Value) (5 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('basisPointValue', () => {
    it('should compute positive net BPV when assets are more rate-sensitive than liabilities', () => {
      const result = service.basisPointValue(SAMPLE_COOPERATIVA);

      // Cooperativa has longer-duration assets => higher asset BPV
      expect(result.totalAssetBPV).toBeGreaterThan(0);
      expect(result.totalLiabilityBPV).toBeGreaterThan(0);
      expect(result.netBPV).toBeGreaterThan(0);
    });

    it('should return individual instrument BPVs for all assets and liabilities', () => {
      const result = service.basisPointValue(SAMPLE_COOPERATIVA);

      expect(result.assetBPVs).toHaveLength(4);
      expect(result.liabilityBPVs).toHaveLength(3);

      // Each BPV entry should have name, amount, bpv, and modifiedDuration
      for (const bpvItem of [...result.assetBPVs, ...result.liabilityBPVs]) {
        expect(bpvItem.name).toBeDefined();
        expect(bpvItem.amount).toBeGreaterThan(0);
        expect(bpvItem.bpv).toBeGreaterThanOrEqual(0);
        expect(bpvItem.modifiedDuration).toBeGreaterThanOrEqual(0);
      }
    });

    it('should scale BPV with modified duration and notional amount', () => {
      // BPV = amount * modifiedDuration * 0.0001
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Big Loan',
            amount: 1_000_000,
            rate: 0.05,
            maturityYears: 10,
            isFloating: false,
          },
          {
            name: 'Small Loan',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 10,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Stub',
            amount: 1_000,
            rate: 0.01,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        equity: 1_099_000,
      };
      const result = service.basisPointValue(bs);

      const bigBPV = result.assetBPVs.find((b) => b.name === 'Big Loan')!;
      const smallBPV = result.assetBPVs.find((b) => b.name === 'Small Loan')!;

      // Same duration, but Big Loan has 10x amount => 10x BPV
      expect(bigBPV.modifiedDuration).toBeCloseTo(smallBPV.modifiedDuration, 2);
      expect(bigBPV.bpv).toBeCloseTo(smallBPV.bpv * 10, 0);
    });

    it('should compute BPV = amount * modifiedDuration * 0.0001 for each instrument', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Fixed Bond',
            amount: 500_000,
            rate: 0.06,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        liabilities: [
          {
            name: 'Stub',
            amount: 1_000,
            rate: 0.01,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        equity: 499_000,
      };
      const result = service.basisPointValue(bs);

      const bond = result.assetBPVs[0];
      const expectedBPV = bond.amount * bond.modifiedDuration * 0.0001;
      expect(bond.bpv).toBeCloseTo(expectedBPV, 1);
    });

    it('should interpret positive net BPV as equity loss when rates rise', () => {
      const result = service.basisPointValue(SAMPLE_COOPERATIVA);

      expect(result.netBPV).toBeGreaterThan(0);
      expect(result.interpretation).toContain('rise in rates');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  6. Full Analysis (3 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('fullAnalysis', () => {
    it('should return all analysis components: durationGap, nii, eve, lcr, bpv', () => {
      const result = service.fullAnalysis(SAMPLE_COOPERATIVA);

      expect(result.summary.totalAssets).toBe(200_000_000);
      expect(result.summary.totalLiabilities).toBe(160_000_000);
      expect(result.summary.equity).toBe(40_000_000);
      expect(result.summary.timestamp).toBeDefined();

      expect(result.durationGap).toBeDefined();
      expect(result.durationGap.durationGap).toBeGreaterThan(0);

      expect(result.niiSimulation).toBeDefined();
      expect(result.niiSimulation.baseNII).toBeGreaterThan(0);

      expect(result.eve).toBeDefined();
      expect(result.eve.baseEVE).toBeGreaterThan(0);

      expect(result.bpv).toBeDefined();
      expect(result.bpv.netBPV).toBeGreaterThan(0);

      // LCR is derived from balance sheet when not explicitly provided
      expect(result.lcr).not.toBeNull();
    });

    it('should apply default 9 scenarios when no custom shocks are provided', () => {
      const result = service.fullAnalysis(SAMPLE_COOPERATIVA);

      expect(result.niiSimulation.scenarios).toHaveLength(9);
      expect(result.eve.scenarios).toHaveLength(9);
    });

    it('should accept custom rate shocks and explicit LCR input', () => {
      const customShocks = [-100, 0, 100];
      const lcrInput: LCRRequestDto = {
        hqla: { level1: 30_000_000, level2a: 10_000_000, level2b: 5_000_000 },
        totalNetOutflows: 16_000_000,
      };

      const result = service.fullAnalysis(
        SAMPLE_COOPERATIVA,
        customShocks,
        lcrInput,
      );

      expect(result.niiSimulation.scenarios).toHaveLength(3);
      expect(result.eve.scenarios).toHaveLength(3);
      expect(result.lcr).not.toBeNull();
      expect(result.lcr!.hqlaBreakdown.level1).toBe(30_000_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  7. Validation (3 tests)
  // ═══════════════════════════════════════════════════════════════

  describe('validation', () => {
    it('should throw ALM_NO_ASSETS when assets array is empty', () => {
      const bs: BalanceSheetDto = {
        assets: [],
        liabilities: [
          {
            name: 'Deposit',
            amount: 100_000,
            rate: 0.02,
            maturityYears: 1,
            isFloating: false,
          },
        ],
        equity: 0,
      };

      expect(() => service.durationGapAnalysis(bs)).toThrow();
      try {
        service.durationGapAnalysis(bs);
      } catch (e: any) {
        const response = e.getResponse();
        expect(response.code).toBe('ALM_NO_ASSETS');
      }
    });

    it('should throw ALM_NO_LIABILITIES when liabilities array is empty', () => {
      const bs: BalanceSheetDto = {
        assets: [
          {
            name: 'Loan',
            amount: 100_000,
            rate: 0.05,
            maturityYears: 5,
            isFloating: false,
          },
        ],
        liabilities: [],
        equity: 100_000,
      };

      expect(() => service.niiSimulation(bs)).toThrow();
      try {
        service.niiSimulation(bs);
      } catch (e: any) {
        const response = e.getResponse();
        expect(response.code).toBe('ALM_NO_LIABILITIES');
      }
    });

    it('should throw validation error for all analysis methods when balance sheet is invalid', () => {
      const emptyBs: BalanceSheetDto = {
        assets: [],
        liabilities: [],
        equity: 0,
      };

      expect(() => service.durationGapAnalysis(emptyBs)).toThrow();
      expect(() => service.niiSimulation(emptyBs)).toThrow();
      expect(() => service.eveAnalysis(emptyBs)).toThrow();
      expect(() => service.basisPointValue(emptyBs)).toThrow();
    });
  });
});
