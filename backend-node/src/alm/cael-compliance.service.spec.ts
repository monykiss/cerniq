import {
  CaelComplianceService,
  type CaelComplianceInput,
} from './cael-compliance.service';

describe('CaelComplianceService — CAEL compute layer (W1.1 Slice 2)', () => {
  let svc: CaelComplianceService;

  beforeEach(() => {
    svc = new CaelComplianceService();
  });

  // A healthy coop: 18.6% RWA capital, no NPL data, 0.6% ROA, 12% liquidity.
  const HEALTHY_7790: CaelComplianceInput = {
    variant: 'reg7790',
    capitalRatioRwaPct: 18.6,
    netEquityRatioPct: 10,
    delinquencyPct: null,
    roaPct: 0.6,
    liquidityRatioPct: 12,
    allowance: {
      basis: 'incurred-loss',
      totalAllowance: 2.6,
      totalLoans: 200,
      coveragePct: 1.3,
      methodology: 'Incurred Loss (Reg 8665)',
    },
  };

  describe('framework wiring + shape', () => {
    it('evaluates the four CAEL legs for the 7790 variant', () => {
      const r = svc.evaluateCaelCompliance(HEALTHY_7790);
      expect(r.frameworkId).toBe('cael-pr-7790');
      expect(r.lossBasis).toBe('incurred-loss');
      expect(r.ratios.map((x) => x.category)).toEqual([
        'capital',
        'asset_quality',
        'earnings',
        'liquidity',
      ]);
    });

    it('carries the bilingual provenance from the framework', () => {
      const r = svc.evaluateCaelCompliance(HEALTHY_7790);
      expect(r.provenance).toMatch(/Reglamento 7790/);
      expect(r.provenance).toContain('/'); // ES / EN
    });

    it('is deterministic — identical inputs produce identical output', () => {
      const a = svc.evaluateCaelCompliance(HEALTHY_7790);
      const b = svc.evaluateCaelCompliance(HEALTHY_7790);
      expect(a).toEqual(b);
    });
  });

  describe('capital leg — variant-specific basis', () => {
    it('7790/CECL use the indivisible-capital-over-RWA ratio (≥8%)', () => {
      const cap = svc
        .evaluateCaelCompliance(HEALTHY_7790)
        .ratios.find((x) => x.category === 'capital')!;
      expect(cap.value).toBe(18.6);
      expect(cap.threshold).toBe('>= 8%');
      expect(cap.status).toBe('pass');
      expect(cap.provisional).toBe(false); // Ley 255 — statutory
    });

    it('a sub-8% RWA capital ratio FAILS the statutory leg', () => {
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        capitalRatioRwaPct: 6,
      });
      expect(r.ratios.find((x) => x.category === 'capital')!.status).toBe(
        'fail',
      );
    });

    it('Piloto uses the Net-Equity ratio (≥4%), and its band is provisional', () => {
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        variant: 'piloto',
        netEquityRatioPct: 10,
        allowance: null,
      });
      const cap = r.ratios.find((x) => x.category === 'capital')!;
      expect(cap.value).toBe(10);
      expect(cap.threshold).toBe('>= 4%');
      expect(cap.status).toBe('pass');
      expect(cap.provisional).toBe(true); // 4% phase-in — UNVERIFIED
    });

    it('Piloto reads the Net-Equity input, NOT the RWA input', () => {
      // RWA is healthy (18.6) but net-equity is below the 4% floor → fail.
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        variant: 'piloto',
        capitalRatioRwaPct: 18.6,
        netEquityRatioPct: 3,
        allowance: null,
      });
      expect(r.ratios.find((x) => x.category === 'capital')!.status).toBe(
        'fail',
      );
    });
  });

  describe('asset-quality leg — delinquency is data_unavailable by default', () => {
    it('null delinquency → data_unavailable + a WARNING gap (never a phantom pass)', () => {
      const r = svc.evaluateCaelCompliance(HEALTHY_7790);
      const aq = r.ratios.find((x) => x.category === 'asset_quality')!;
      expect(aq.status).toBe('data_unavailable');
      expect(aq.value).toBeNull();
      expect(
        r.gaps.some(
          (g) => g.field === 'cael.asset_quality' && g.severity === 'WARNING',
        ),
      ).toBe(true);
    });

    it('evaluates the ≤3% delinquency threshold when NPL data IS supplied', () => {
      const pass = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        delinquencyPct: 2,
      });
      const fail = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        delinquencyPct: 5,
      });
      expect(
        pass.ratios.find((x) => x.category === 'asset_quality')!.status,
      ).toBe('pass');
      expect(
        fail.ratios.find((x) => x.category === 'asset_quality')!.status,
      ).toBe('fail');
    });
  });

  describe('earnings + liquidity legs', () => {
    it('earnings (ROA ≥0.5%) passes at 0.6% and fails at 0.2%', () => {
      expect(
        svc
          .evaluateCaelCompliance({ ...HEALTHY_7790, roaPct: 0.6 })
          .ratios.find((x) => x.category === 'earnings')!.status,
      ).toBe('pass');
      expect(
        svc
          .evaluateCaelCompliance({ ...HEALTHY_7790, roaPct: 0.2 })
          .ratios.find((x) => x.category === 'earnings')!.status,
      ).toBe('fail');
    });

    it('liquidity (≥5%, CC-2021-02 statutory) is NOT provisional', () => {
      const liq = svc
        .evaluateCaelCompliance(HEALTHY_7790)
        .ratios.find((x) => x.category === 'liquidity')!;
      expect(liq.status).toBe('pass');
      expect(liq.provisional).toBe(false);
    });
  });

  describe('provisional-band disclosure (D1)', () => {
    it('raises a WARNING gap when a PROVISIONAL band contributes to the composite', () => {
      // earnings (provisional) passes → contributes → provisional gap required.
      const r = svc.evaluateCaelCompliance(HEALTHY_7790);
      expect(r.composite.provisional).toBe(true);
      expect(r.gaps.some((g) => g.field === 'cael.bands.provisional')).toBe(
        true,
      );
    });

    it('no provisional gap when only statutory bands contribute', () => {
      // Strip earnings to data_unavailable so only capital + liquidity (both
      // statutory) contribute.
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        roaPct: null,
      });
      expect(r.composite.provisional).toBe(false);
      expect(r.gaps.some((g) => g.field === 'cael.bands.provisional')).toBe(
        false,
      );
    });
  });

  describe('composite + overall status', () => {
    it('weights the pass-rate over legs with a definitive verdict only', () => {
      // capital(30,pass) + earnings(20,pass) + liquidity(20,pass) contribute;
      // asset_quality is data_unavailable → excluded. All pass → 100.
      const r = svc.evaluateCaelCompliance(HEALTHY_7790);
      expect(r.composite.computableWeight).toBe(70);
      expect(r.composite.examReadinessScore).toBe(100);
    });

    it('a data_unavailable leg makes an otherwise-passing coop "conditional"', () => {
      expect(svc.evaluateCaelCompliance(HEALTHY_7790).overallStatus).toBe(
        'conditional',
      );
    });

    it('a STATUTORY leg failing makes the coop "non-compliant"', () => {
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        capitalRatioRwaPct: 6, // statutory capital fail
      });
      expect(r.overallStatus).toBe('non-compliant');
    });

    it('a PROVISIONAL leg failing is only "conditional", not non-compliant', () => {
      // Piloto capital (provisional) fails; nothing statutory fails.
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        variant: 'piloto',
        netEquityRatioPct: 3,
        delinquencyPct: 1, // make asset-quality pass so it's the only fail
        allowance: null,
      });
      expect(r.overallStatus).toBe('conditional');
    });

    it('all-passing with full data → "compliant"', () => {
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        delinquencyPct: 1,
      });
      expect(r.overallStatus).toBe('compliant');
      expect(r.composite.computableWeight).toBe(100);
      expect(r.composite.examReadinessScore).toBe(100);
    });
  });

  describe('D1 — refuses to fabricate on empty inputs', () => {
    it('all-null inputs → every leg data_unavailable, overall data_unavailable', () => {
      const r = svc.evaluateCaelCompliance({
        variant: 'reg7790',
        capitalRatioRwaPct: null,
        netEquityRatioPct: null,
        delinquencyPct: null,
        roaPct: null,
        liquidityRatioPct: null,
        allowance: null,
      });
      expect(r.overallStatus).toBe('data_unavailable');
      expect(r.composite.examReadinessScore).toBeNull();
      expect(r.ratios.every((x) => x.status === 'data_unavailable')).toBe(true);
    });
  });

  describe('allowance leg — the dual-filing differentiator', () => {
    it('passes the variant allowance through (incurred-loss for 7790)', () => {
      const r = svc.evaluateCaelCompliance(HEALTHY_7790);
      expect(r.allowance.basis).toBe('incurred-loss');
      expect(r.allowance.coveragePct).toBe(1.3);
    });

    it('Piloto carries an n/a allowance basis (no allowance leg)', () => {
      const r = svc.evaluateCaelCompliance({
        ...HEALTHY_7790,
        variant: 'piloto',
        allowance: null,
      });
      expect(r.allowance.basis).toBe('n/a');
      expect(r.allowance.coveragePct).toBeNull();
    });
  });

  describe('caelInputsFromEngines — engine adapter', () => {
    const SUMMARY = {
      equity: 25,
      totalAssets: 250,
      capitalRatioRWA: 18.6,
      liquidityRatio: 12,
      interestIncome: 10,
      interestExpense: 4,
    };

    it('derives net-equity, ROA, and RWA capital from a COSSEC summary', () => {
      const input = svc.caelInputsFromEngines('reg7790', SUMMARY, {
        totalAllowance: 2.6,
        totalBalance: 200,
        methodology: 'Incurred Loss (Reg 8665)',
        overallStatus: 'computed',
      });
      expect(input.netEquityRatioPct).toBe(10); // 25/250
      expect(input.roaPct).toBe(2.4); // (10-4)/250
      expect(input.capitalRatioRwaPct).toBe(18.6);
      expect(input.liquidityRatioPct).toBe(12);
      expect(input.delinquencyPct).toBeNull();
      expect(input.allowance).toEqual({
        basis: 'incurred-loss',
        totalAllowance: 2.6,
        totalLoans: 200,
        coveragePct: 1.3, // 2.6/200
        methodology: 'Incurred Loss (Reg 8665)',
      });
    });

    it('Piloto maps with a null allowance (no loss basis)', () => {
      const input = svc.caelInputsFromEngines('piloto', SUMMARY, null);
      expect(input.allowance).toBeNull();
      expect(input.netEquityRatioPct).toBe(10);
    });

    it('a data_unavailable allowance summary → null allowance figures (D1)', () => {
      const input = svc.caelInputsFromEngines('reg7790', SUMMARY, {
        totalAllowance: 0,
        totalBalance: 0,
        methodology: 'Incurred Loss (Reg 8665)',
        overallStatus: 'data_unavailable',
      });
      expect(input.allowance!.totalAllowance).toBeNull();
      expect(input.allowance!.coveragePct).toBeNull();
    });

    it('round-trips through the evaluator into a computed verdict', () => {
      const input = svc.caelInputsFromEngines('reg7790', SUMMARY, {
        totalAllowance: 2.6,
        totalBalance: 200,
        methodology: 'Incurred Loss (Reg 8665)',
        overallStatus: 'computed',
      });
      const r = svc.evaluateCaelCompliance(input);
      expect(r.ratios.find((x) => x.category === 'capital')!.status).toBe(
        'pass',
      );
      expect(r.overallStatus).toBe('conditional'); // asset-quality data_unavailable
    });
  });
});
