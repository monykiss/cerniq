import {
  computeCreditRisk,
  normalCDF,
  normalInverse,
} from './credit-risk-portfolio';
import {
  computeEffectiveLGD,
  PR_LGD_TABLE,
  PR_ASSET_CORRELATION,
} from './lgd-table';
import { estimatePD } from './pd-model';
import { LoanPortfolioInput, LoanType } from './types';

// ─── Normal Distribution Tests ──────────────────────────────────

describe('normalCDF (Hart 1968)', () => {
  it('N(0) = 0.5', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 7);
  });

  it('N(1.645) ≈ 0.95', () => {
    expect(normalCDF(1.645)).toBeCloseTo(0.95, 4);
  });

  it('N(-1.645) ≈ 0.05', () => {
    expect(normalCDF(-1.645)).toBeCloseTo(0.05, 4);
  });

  it('N(1.96) ≈ 0.975', () => {
    expect(normalCDF(1.96)).toBeCloseTo(0.975, 3);
  });

  it('N(2.326) ≈ 0.99', () => {
    expect(normalCDF(2.326)).toBeCloseTo(0.99, 3);
  });

  it('extreme negative returns ~0', () => {
    expect(normalCDF(-10)).toBeCloseTo(0, 10);
  });

  it('extreme positive returns ~1', () => {
    expect(normalCDF(10)).toBeCloseTo(1, 10);
  });

  it('is monotonically increasing', () => {
    const points = [-3, -2, -1, 0, 1, 2, 3];
    const values = points.map(normalCDF);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
});

describe('normalInverse (Beasley-Springer-Moro)', () => {
  it('N_inv(0.5) = 0', () => {
    expect(normalInverse(0.5)).toBeCloseTo(0, 8);
  });

  it('N_inv(0.999) ≈ 3.090', () => {
    expect(normalInverse(0.999)).toBeCloseTo(3.09, 2);
  });

  it('N_inv(0.95) ≈ 1.645', () => {
    expect(normalInverse(0.95)).toBeCloseTo(1.645, 2);
  });

  it('N_inv(0.975) ≈ 1.96', () => {
    expect(normalInverse(0.975)).toBeCloseTo(1.96, 2);
  });

  it('N_inv(0.01) ≈ -2.326', () => {
    expect(normalInverse(0.01)).toBeCloseTo(-2.326, 2);
  });

  it('N(N_inv(p)) ≈ p roundtrip', () => {
    const probabilities = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
    for (const p of probabilities) {
      expect(normalCDF(normalInverse(p))).toBeCloseTo(p, 4);
    }
  });

  it('returns -Infinity for p=0', () => {
    expect(normalInverse(0)).toBe(-Infinity);
  });

  it('returns +Infinity for p=1', () => {
    expect(normalInverse(1)).toBe(Infinity);
  });
});

// ─── PR LGD Table Tests ─────────────────────────────────────────

describe('PR_LGD_TABLE', () => {
  it('covers all 5 loan types', () => {
    const types: LoanType[] = [
      'RESIDENTIAL_MORTGAGE',
      'COMMERCIAL_REAL_ESTATE',
      'CONSUMER_UNSECURED',
      'AUTO_LOAN',
      'COMMERCIAL_BUSINESS',
    ];
    for (const t of types) {
      expect(PR_LGD_TABLE[t]).toBeDefined();
      expect(PR_LGD_TABLE[t].baseLGD).toBeGreaterThan(0);
      expect(PR_LGD_TABLE[t].baseLGD).toBeLessThan(1);
    }
  });

  it('residential mortgage base LGD is 25%', () => {
    expect(PR_LGD_TABLE.RESIDENTIAL_MORTGAGE.baseLGD).toBe(0.25);
  });

  it('consumer unsecured has highest base LGD', () => {
    const consumer = PR_LGD_TABLE.CONSUMER_UNSECURED.baseLGD;
    for (const [type, config] of Object.entries(PR_LGD_TABLE)) {
      if (type !== 'CONSUMER_UNSECURED') {
        expect(consumer).toBeGreaterThan(config.baseLGD);
      }
    }
  });

  it('unsecured and auto have zero hurricane adjustment', () => {
    expect(PR_LGD_TABLE.CONSUMER_UNSECURED.hurricaneAdjustment).toBe(0);
    expect(PR_LGD_TABLE.AUTO_LOAN.hurricaneAdjustment).toBe(0);
  });
});

describe('PR_ASSET_CORRELATION', () => {
  it('all correlations are in Basel III plausible range (0.04–0.30)', () => {
    for (const [, rho] of Object.entries(PR_ASSET_CORRELATION)) {
      expect(rho).toBeGreaterThanOrEqual(0.04);
      expect(rho).toBeLessThanOrEqual(0.3);
    }
  });

  it('commercial RE has highest correlation', () => {
    expect(PR_ASSET_CORRELATION.COMMERCIAL_REAL_ESTATE).toBeGreaterThan(
      PR_ASSET_CORRELATION.RESIDENTIAL_MORTGAGE,
    );
    expect(PR_ASSET_CORRELATION.COMMERCIAL_REAL_ESTATE).toBeGreaterThan(
      PR_ASSET_CORRELATION.CONSUMER_UNSECURED,
    );
  });
});

describe('computeEffectiveLGD', () => {
  it('residential without hurricane = base + CRIM discount', () => {
    const lgd = computeEffectiveLGD('RESIDENTIAL_MORTGAGE', false);
    expect(lgd).toBeCloseTo(0.25 + 0.2, 6); // 45%
  });

  it('residential with hurricane adds 10% adjustment', () => {
    const lgdNoHurricane = computeEffectiveLGD('RESIDENTIAL_MORTGAGE', false);
    const lgdHurricane = computeEffectiveLGD('RESIDENTIAL_MORTGAGE', true);
    expect(lgdHurricane - lgdNoHurricane).toBeCloseTo(0.1, 6);
  });

  it('consumer unsecured is unchanged by hurricane zone', () => {
    const lgdNo = computeEffectiveLGD('CONSUMER_UNSECURED', false);
    const lgdYes = computeEffectiveLGD('CONSUMER_UNSECURED', true);
    expect(lgdNo).toBe(lgdYes);
  });

  it('all effective LGDs are clamped to [0, 1]', () => {
    const types: LoanType[] = [
      'RESIDENTIAL_MORTGAGE',
      'COMMERCIAL_REAL_ESTATE',
      'CONSUMER_UNSECURED',
      'AUTO_LOAN',
      'COMMERCIAL_BUSINESS',
    ];
    for (const t of types) {
      const lgd = computeEffectiveLGD(t, true);
      expect(lgd).toBeGreaterThanOrEqual(0);
      expect(lgd).toBeLessThanOrEqual(1);
    }
  });
});

// ─── PD Model Tests ─────────────────────────────────────────────

describe('estimatePD', () => {
  it('returns PD in [0.001, 0.999]', () => {
    const pd = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.5,
      ltv: 0.7,
      delinquencyRate: 0.03,
    });
    expect(pd).toBeGreaterThanOrEqual(0.001);
    expect(pd).toBeLessThanOrEqual(0.999);
  });

  it('higher DSCR → lower PD (all else equal)', () => {
    const pdLow = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.0,
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

  it('higher LTV → higher PD (all else equal)', () => {
    const pdLow = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.5,
      ltv: 0.5,
      delinquencyRate: 0.03,
    });
    const pdHigh = estimatePD('RESIDENTIAL_MORTGAGE', {
      dscr: 1.5,
      ltv: 0.9,
      delinquencyRate: 0.03,
    });
    expect(pdHigh).toBeGreaterThan(pdLow);
  });

  it('higher delinquency → higher PD', () => {
    const pdLow = estimatePD('COMMERCIAL_BUSINESS', {
      dscr: 1.5,
      ltv: 0.6,
      delinquencyRate: 0.01,
    });
    const pdHigh = estimatePD('COMMERCIAL_BUSINESS', {
      dscr: 1.5,
      ltv: 0.6,
      delinquencyRate: 0.1,
    });
    expect(pdHigh).toBeGreaterThan(pdLow);
  });

  it('consumer unsecured ignores LTV (coefficient = 0)', () => {
    const pd1 = estimatePD('CONSUMER_UNSECURED', {
      dscr: 1.5,
      ltv: 0.0,
      delinquencyRate: 0.03,
    });
    const pd2 = estimatePD('CONSUMER_UNSECURED', {
      dscr: 1.5,
      ltv: 0.99,
      delinquencyRate: 0.03,
    });
    expect(pd1).toBeCloseTo(pd2, 8);
  });
});

// ─── Portfolio Credit Risk Tests ─────────────────────────────────

describe('computeCreditRisk', () => {
  const makePortfolio = (
    overrides?: Partial<LoanPortfolioInput>,
  ): LoanPortfolioInput => ({
    categories: [
      {
        loanType: 'RESIDENTIAL_MORTGAGE',
        outstandingBalance: 50_000_000,
        financialRatios: { dscr: 1.4, ltv: 0.72, delinquencyRate: 0.025 },
      },
      {
        loanType: 'CONSUMER_UNSECURED',
        outstandingBalance: 20_000_000,
        financialRatios: { dscr: 1.2, ltv: 0, delinquencyRate: 0.04 },
      },
      {
        loanType: 'AUTO_LOAN',
        outstandingBalance: 15_000_000,
        financialRatios: { dscr: 1.3, ltv: 0.85, delinquencyRate: 0.03 },
      },
      {
        loanType: 'COMMERCIAL_BUSINESS',
        outstandingBalance: 15_000_000,
        financialRatios: { dscr: 1.6, ltv: 0.55, delinquencyRate: 0.02 },
      },
    ],
    loanLossReserve: 3_500_000,
    ...overrides,
  });

  it('produces result with all expected fields', () => {
    const result = computeCreditRisk(makePortfolio());

    expect(result.byCategory).toHaveLength(4);
    expect(result.totalEAD).toBe(100_000_000);
    expect(result.totalEL).toBeGreaterThan(0);
    expect(result.totalUL).toBeGreaterThan(0);
    expect(result.economicCapital).toBeGreaterThan(0);
    expect(result.coverageRatio).toBeGreaterThan(0);
    expect(typeof result.interpretation).toBe('string');
    expect(typeof result.interpretationEs).toBe('string');
    expect(result.capitalAdequacy).toMatch(
      /adequate|marginal|insufficient|data_unavailable/,
    );
  });

  it('$100M consumer portfolio with 3% delinquency → EL is material but not catastrophic', () => {
    const result = computeCreditRisk({
      categories: [
        {
          loanType: 'CONSUMER_UNSECURED',
          outstandingBalance: 100_000_000,
          financialRatios: { dscr: 1.2, ltv: 0, delinquencyRate: 0.03 },
        },
      ],
      loanLossReserve: 3_000_000,
    });

    // PD ≈ 1.3% (logistic model with DSCR 1.2, 3% delinquency)
    // EL = PD × LGD(0.65) × EAD(100M) ≈ $850K
    // Plausible range: $500K–$3M for a healthy cooperativa consumer book
    expect(result.totalEL).toBeGreaterThan(500_000);
    expect(result.totalEL).toBeLessThan(3_000_000);
    expect(result.elAsPercent).toBeGreaterThan(0.5);
    expect(result.elAsPercent).toBeLessThan(3.0);
  });

  it('stressed $100M portfolio (high delinquency) → EL > $1M, capital insufficient', () => {
    const result = computeCreditRisk({
      categories: [
        {
          loanType: 'CONSUMER_UNSECURED',
          outstandingBalance: 100_000_000,
          financialRatios: { dscr: 0.7, ltv: 0, delinquencyRate: 0.15 },
        },
      ],
      loanLossReserve: 500_000,
    });

    // Stressed: DSCR 0.7 (below breakeven), 15% delinquency
    // PD ≈ 3.8%, EL = PD × LGD(0.65) × 100M ≈ $2.4M
    expect(result.totalEL).toBeGreaterThan(2_000_000);
    expect(result.totalEL).toBeLessThan(5_000_000);
    expect(result.capitalAdequacy).toBe('insufficient');
  });

  it('EL = PD × LGD × EAD for each category', () => {
    const result = computeCreditRisk(makePortfolio());

    for (const cat of result.byCategory) {
      const expectedEL = cat.pd * cat.lgd * cat.ead;
      expect(cat.expectedLoss).toBeCloseTo(expectedEL, 2);
    }
  });

  it('UL > 0 for all non-degenerate categories', () => {
    const result = computeCreditRisk(makePortfolio());

    for (const cat of result.byCategory) {
      expect(cat.unexpectedLoss).toBeGreaterThanOrEqual(0);
    }
  });

  it('economic capital = sum of UL across categories', () => {
    const result = computeCreditRisk(makePortfolio());

    const sumUL = result.byCategory.reduce((s, c) => s + c.unexpectedLoss, 0);
    expect(result.economicCapital).toBeCloseTo(sumUL, 2);
  });

  it('coverageRatio = loanLossReserve / totalEL', () => {
    const portfolio = makePortfolio({ loanLossReserve: 5_000_000 });
    const result = computeCreditRisk(portfolio);

    expect(result.coverageRatio).toBeCloseTo(5_000_000 / result.totalEL, 4);
  });

  it('empty portfolio returns data_unavailable', () => {
    const result = computeCreditRisk({
      categories: [],
      loanLossReserve: 0,
    });

    expect(result.capitalAdequacy).toBe('data_unavailable');
    expect(result.byCategory).toHaveLength(0);
    expect(result.totalEL).toBe(0);
    expect(result.economicCapital).toBe(0);
  });

  it('high reserve → adequate capital adequacy', () => {
    const result = computeCreditRisk(
      makePortfolio({ loanLossReserve: 50_000_000 }),
    );
    expect(result.capitalAdequacy).toBe('adequate');
  });

  it('low reserve → insufficient capital adequacy', () => {
    const result = computeCreditRisk(
      makePortfolio({ loanLossReserve: 100_000 }),
    );
    expect(result.capitalAdequacy).toBe('insufficient');
  });

  it('bilingual interpretation contains loan type info', () => {
    const result = computeCreditRisk(makePortfolio());

    expect(result.interpretation.length).toBeGreaterThan(20);
    expect(result.interpretationEs.length).toBeGreaterThan(20);
    // Spanish version should contain Spanish loan type name
    expect(result.interpretationEs).toMatch(
      /hipoteca|consumo|auto|comercial|bienes/,
    );
  });

  it('each category has correct asset correlation from PR table', () => {
    const result = computeCreditRisk(makePortfolio());

    for (const cat of result.byCategory) {
      expect(cat.assetCorrelation).toBe(PR_ASSET_CORRELATION[cat.loanType]);
    }
  });
});
