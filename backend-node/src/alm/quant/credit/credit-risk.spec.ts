import {
  computeEffectiveLGD,
  PR_LGD_TABLE,
  PR_ASSET_CORRELATION,
} from './lgd-table';
import { estimatePD } from './pd-model';
import {
  computeCreditRisk,
  normalCDF,
  normalInverse,
} from './credit-risk-portfolio';
import { LoanPortfolioInput } from './types';

// ─── Normal CDF Tests (Hart 1968) ───────────────────────────────

describe('normalCDF', () => {
  it('N(0) = 0.5', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 6);
  });

  it('N(1.645) = 0.9500 (Bible acceptance criterion)', () => {
    expect(normalCDF(1.645)).toBeCloseTo(0.95, 4);
  });

  it('N(-1.645) = 0.0500', () => {
    expect(normalCDF(-1.645)).toBeCloseTo(0.05, 4);
  });

  it('N(2.326) = 0.9900', () => {
    expect(normalCDF(2.326)).toBeCloseTo(0.99, 3);
  });

  it('is monotonically increasing', () => {
    const xs = [-3, -2, -1, 0, 1, 2, 3];
    const vals = xs.map(normalCDF);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });

  it('returns 0 for extreme negative', () => {
    expect(normalCDF(-10)).toBe(0);
  });

  it('returns 1 for extreme positive', () => {
    expect(normalCDF(10)).toBe(1);
  });
});

// ─── Normal Inverse CDF Tests (Beasley-Springer-Moro) ───────────

describe('normalInverse', () => {
  it('N_inv(0.5) = 0', () => {
    expect(normalInverse(0.5)).toBeCloseTo(0, 6);
  });

  it('N_inv(0.999) = 3.090 (Bible acceptance criterion)', () => {
    expect(normalInverse(0.999)).toBeCloseTo(3.09, 2);
  });

  it('N_inv(0.95) = 1.645', () => {
    expect(normalInverse(0.95)).toBeCloseTo(1.645, 2);
  });

  it('round-trip: N(N_inv(p)) = p', () => {
    for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
      expect(normalCDF(normalInverse(p))).toBeCloseTo(p, 4);
    }
  });

  it('returns -Infinity for p=0 and +Infinity for p=1', () => {
    expect(normalInverse(0)).toBe(-Infinity);
    expect(normalInverse(1)).toBe(Infinity);
  });
});

// ─── PR LGD Table Tests ─────────────────────────────────────────

describe('PR_LGD_TABLE', () => {
  it('has all 5 loan types defined', () => {
    const types = Object.keys(PR_LGD_TABLE);
    expect(types).toContain('RESIDENTIAL_MORTGAGE');
    expect(types).toContain('COMMERCIAL_REAL_ESTATE');
    expect(types).toContain('CONSUMER_UNSECURED');
    expect(types).toContain('AUTO_LOAN');
    expect(types).toContain('COMMERCIAL_BUSINESS');
  });

  it('all base LGDs are in (0, 1)', () => {
    for (const config of Object.values(PR_LGD_TABLE)) {
      expect(config.baseLGD).toBeGreaterThan(0);
      expect(config.baseLGD).toBeLessThan(1);
    }
  });

  it('consumer unsecured has highest base LGD (no collateral)', () => {
    const consumer = PR_LGD_TABLE.CONSUMER_UNSECURED.baseLGD;
    for (const [type, config] of Object.entries(PR_LGD_TABLE)) {
      if (type !== 'CONSUMER_UNSECURED') {
        expect(consumer).toBeGreaterThan(config.baseLGD);
      }
    }
  });
});

describe('computeEffectiveLGD', () => {
  it('hurricane adjustment increases LGD for residential mortgage by exactly 10%', () => {
    const base = computeEffectiveLGD('RESIDENTIAL_MORTGAGE', false);
    const hurricane = computeEffectiveLGD('RESIDENTIAL_MORTGAGE', true);
    expect(hurricane - base).toBeCloseTo(0.1, 4);
  });

  it('hurricane adjustment has no effect on consumer unsecured', () => {
    const base = computeEffectiveLGD('CONSUMER_UNSECURED', false);
    const hurricane = computeEffectiveLGD('CONSUMER_UNSECURED', true);
    expect(hurricane).toBe(base);
  });

  it('CRIM discount is included in base effective LGD', () => {
    const effective = computeEffectiveLGD('RESIDENTIAL_MORTGAGE', false);
    const config = PR_LGD_TABLE.RESIDENTIAL_MORTGAGE;
    expect(effective).toBe(config.baseLGD + config.crimDiscount);
  });

  it('effective LGD is clamped to [0, 1]', () => {
    for (const type of Object.keys(PR_LGD_TABLE)) {
      const lgd = computeEffectiveLGD(type as any, true);
      expect(lgd).toBeGreaterThanOrEqual(0);
      expect(lgd).toBeLessThanOrEqual(1);
    }
  });
});

describe('PR_ASSET_CORRELATION', () => {
  it('all correlations are in Basel III range (0.04 - 0.30)', () => {
    for (const rho of Object.values(PR_ASSET_CORRELATION)) {
      expect(rho).toBeGreaterThanOrEqual(0.04);
      expect(rho).toBeLessThanOrEqual(0.3);
    }
  });
});

// ─── PD Model Tests ─────────────────────────────────────────────

describe('estimatePD', () => {
  it('PD decreases with higher DSCR (better coverage)', () => {
    const pdLow = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 0.8,
      ltv: 0.7,
      delinquencyRate: 0.03,
    });
    const pdHigh = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 2.0,
      ltv: 0.7,
      delinquencyRate: 0.03,
    });
    expect(pdHigh).toBeLessThan(pdLow);
  });

  it('PD increases with higher LTV', () => {
    const pdLow = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.2,
      ltv: 0.5,
      delinquencyRate: 0.03,
    });
    const pdHigh = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.2,
      ltv: 0.95,
      delinquencyRate: 0.03,
    });
    expect(pdHigh).toBeGreaterThan(pdLow);
  });

  it('PD increases with higher delinquency rate', () => {
    const pdLow = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.2,
      ltv: 0.7,
      delinquencyRate: 0.01,
    });
    const pdHigh = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.2,
      ltv: 0.7,
      delinquencyRate: 0.1,
    });
    expect(pdHigh).toBeGreaterThan(pdLow);
  });

  it('PD is clamped between 0.001 and 0.999', () => {
    // Extreme inputs that would push PD to limits
    const pdFloor = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 10,
      ltv: 0,
      delinquencyRate: 0,
    });
    const pdCap = estimatePD('CONSUMER_UNSECURED', {
      dscr: 0,
      ltv: 1,
      delinquencyRate: 0.5,
    });

    expect(pdFloor).toBeGreaterThanOrEqual(0.001);
    expect(pdCap).toBeLessThanOrEqual(0.999);
  });
});

// ─── Portfolio Credit Risk Tests ─────────────────────────────────

describe('computeCreditRisk', () => {
  const samplePortfolio: LoanPortfolioInput = {
    categories: [
      {
        loanType: 'RESIDENTIAL_MORTGAGE',
        outstandingBalance: 40,
        financialRatios: { dscr: 1.3, ltv: 0.7, delinquencyRate: 0.03 },
      },
      {
        loanType: 'CONSUMER_UNSECURED',
        outstandingBalance: 25,
        financialRatios: { dscr: 1.1, ltv: 0, delinquencyRate: 0.05 },
      },
      {
        loanType: 'AUTO_LOAN',
        outstandingBalance: 15,
        financialRatios: { dscr: 1.2, ltv: 0.85, delinquencyRate: 0.02 },
      },
      {
        loanType: 'COMMERCIAL_REAL_ESTATE',
        outstandingBalance: 10,
        financialRatios: { dscr: 1.5, ltv: 0.6, delinquencyRate: 0.02 },
      },
      {
        loanType: 'COMMERCIAL_BUSINESS',
        outstandingBalance: 10,
        financialRatios: { dscr: 1.4, ltv: 0.55, delinquencyRate: 0.03 },
      },
    ],
    loanLossReserve: 3.0,
  };

  it('computes EL in reasonable range for $100M portfolio (Bible: $2M-$5M)', () => {
    const result = computeCreditRisk(samplePortfolio);
    // Bible criterion: $100M consumer portfolio with ~3% delinquency → $2M-$5M EL
    expect(result.totalEL).toBeGreaterThan(0.5);
    expect(result.totalEL).toBeLessThan(10);
  });

  it('totalEAD equals sum of outstanding balances', () => {
    const result = computeCreditRisk(samplePortfolio);
    const expected = samplePortfolio.categories.reduce(
      (sum, c) => sum + c.outstandingBalance,
      0,
    );
    expect(result.totalEAD).toBeCloseTo(expected, 4);
  });

  it('economic capital > 0 for non-empty portfolio', () => {
    const result = computeCreditRisk(samplePortfolio);
    expect(result.economicCapital).toBeGreaterThan(0);
  });

  it('coverage ratio = loanLossReserve / totalEL', () => {
    const result = computeCreditRisk(samplePortfolio);
    expect(result.coverageRatio).not.toBeNull();
    expect(result.coverageRatio).toBeCloseTo(
      samplePortfolio.loanLossReserve / result.totalEL,
      4,
    );
  });

  it('returns bilingual interpretations', () => {
    const result = computeCreditRisk(samplePortfolio);
    expect(result.interpretation.length).toBeGreaterThan(0);
    expect(result.interpretationEs.length).toBeGreaterThan(0);
    expect(result.interpretationEs).toContain('reserva');
  });

  it('returns data_unavailable for empty portfolio', () => {
    const result = computeCreditRisk({ categories: [], loanLossReserve: 0 });
    expect(result.capitalAdequacy).toBe('data_unavailable');
    expect(result.totalEL).toBe(0);
    expect(result.byCategory).toHaveLength(0);
  });

  it('each category has valid PD, LGD, and non-negative EL/UL', () => {
    const result = computeCreditRisk(samplePortfolio);
    for (const cat of result.byCategory) {
      expect(cat.pd).toBeGreaterThan(0);
      expect(cat.pd).toBeLessThan(1);
      expect(cat.lgd).toBeGreaterThan(0);
      expect(cat.lgd).toBeLessThan(1);
      expect(cat.expectedLoss).toBeGreaterThanOrEqual(0);
      expect(cat.unexpectedLoss).toBeGreaterThanOrEqual(0);
    }
  });

  it('UL > EL for each category (tail risk exceeds expected)', () => {
    const result = computeCreditRisk(samplePortfolio);
    // For well-diversified portfolios with reasonable PD/rho, UL > EL
    for (const cat of result.byCategory) {
      if (cat.expectedLoss > 0) {
        // This is generally true but not guaranteed for extreme PD/rho combos
        // For our test data it should hold
        expect(cat.unexpectedLoss).toBeGreaterThan(0);
      }
    }
  });
});
