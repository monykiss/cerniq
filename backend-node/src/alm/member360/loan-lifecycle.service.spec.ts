import { Test } from '@nestjs/testing';

import {
  LOAN_LIFECYCLE_STAGES,
  LoanLifecycleService,
  type LoanSignal,
} from './loan-lifecycle.service';

const AS_OF = new Date('2026-06-30T00:00:00.000Z');

/** A seasoned, performing loan. Individual tests override one field at a time. */
function loan(overrides: Partial<LoanSignal> = {}): LoanSignal {
  return {
    id: 'loan-1',
    productCode: 'PRESTAMO_AUTO',
    balance: 18_000,
    originalPrincipal: 30_000,
    delinquencyDays: 0,
    openedDate: new Date('2023-01-15T00:00:00.000Z'),
    maturityDate: new Date('2028-01-15T00:00:00.000Z'),
    ...overrides,
  };
}

describe('LoanLifecycleService', () => {
  let service: LoanLifecycleService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LoanLifecycleService],
    }).compile();
    service = moduleRef.get(LoanLifecycleService);
  });

  describe('the delinquency ladder', () => {
    it.each([
      [0, 'CURRENT', 'pass'],
      [1, 'EARLY_DELINQUENCY', 'pass'],
      [29, 'EARLY_DELINQUENCY', 'pass'],
      [30, 'DELINQUENT_30', 'special_mention'],
      [59, 'DELINQUENT_30', 'special_mention'],
      [60, 'DELINQUENT_60', 'substandard'],
      [89, 'DELINQUENT_60', 'substandard'],
      [90, 'NONACCRUAL', 'doubtful'],
      [400, 'NONACCRUAL', 'doubtful'],
    ])('%i DPD -> %s (%s)', (dpd, stage, cossec) => {
      const result = service.classifyLoan(
        loan({ delinquencyDays: dpd }),
        AS_OF,
      );
      expect(result.stage).toBe(stage);
      expect(result.cossecClassification).toBe(cossec);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('states the actual DPD in the reason, never an unexplained label', () => {
      const result = service.classifyLoan(loan({ delinquencyDays: 47 }), AS_OF);
      expect(result.reasons.join(' ')).toContain('47');
    });
  });

  describe('D1 — unknown delinquency is not performing', () => {
    it('returns a null stage rather than CURRENT when DPD is unknown', () => {
      const result = service.classifyLoan(
        loan({ delinquencyDays: null }),
        AS_OF,
      );
      expect(result.stage).toBeNull();
      expect(result.cossecClassification).toBeNull();
    });

    it('discloses the missing field as a gap', () => {
      const result = service.classifyLoan(
        loan({ delinquencyDays: null }),
        AS_OF,
      );
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0].reason).toBe('LOAN_TAPE_FIELD_MISSING');
    });

    it('never classifies an unknown-DPD loan as pass', () => {
      // A blanket 'pass' on an unclassified loan is compliance-by-omission.
      const result = service.classifyLoan(
        loan({ delinquencyDays: null }),
        AS_OF,
      );
      expect(result.cossecClassification).not.toBe('pass');
    });
  });

  describe('origination window', () => {
    it('a brand-new current loan is ORIGINATED, not CURRENT', () => {
      const result = service.classifyLoan(
        loan({ openedDate: new Date('2026-06-01T00:00:00.000Z') }),
        AS_OF,
      );
      expect(result.stage).toBe('ORIGINATED');
    });

    it('a loan past the window is CURRENT', () => {
      const result = service.classifyLoan(
        loan({ openedDate: new Date('2026-01-01T00:00:00.000Z') }),
        AS_OF,
      );
      expect(result.stage).toBe('CURRENT');
    });

    it('delinquency outranks the origination window', () => {
      const result = service.classifyLoan(
        loan({
          openedDate: new Date('2026-06-01T00:00:00.000Z'),
          delinquencyDays: 45,
        }),
        AS_OF,
      );
      expect(result.stage).toBe('DELINQUENT_30');
    });
  });

  describe('terminal states are explicit, never inferred', () => {
    it('CHARGED_OFF only when the back office says so', () => {
      expect(
        service.classifyLoan(loan({ chargedOff: true }), AS_OF).stage,
      ).toBe('CHARGED_OFF');
    });

    it('a 400-DPD loan is NONACCRUAL, not CHARGED_OFF', () => {
      // Charge-off is an accounting decision, not a delinquency inference.
      const result = service.classifyLoan(
        loan({ delinquencyDays: 400 }),
        AS_OF,
      );
      expect(result.stage).toBe('NONACCRUAL');
      expect(result.stage).not.toBe('CHARGED_OFF');
    });

    it('a zero balance is PAID_OFF', () => {
      const result = service.classifyLoan(loan({ balance: 0 }), AS_OF);
      expect(result.stage).toBe('PAID_OFF');
    });

    it('a charged-off loan with zero balance is CHARGED_OFF, not PAID_OFF', () => {
      // Ordering matters: writing a loan off also zeroes its balance, and
      // reporting that as "repaid" would hide a loss.
      const result = service.classifyLoan(
        loan({ balance: 0, chargedOff: true }),
        AS_OF,
      );
      expect(result.stage).toBe('CHARGED_OFF');
      expect(result.cossecClassification).toBe('loss');
    });
  });

  describe('WORKOUT is a restructuring, not a DPD bucket', () => {
    it('a re-aged loan reading 0 DPD is still WORKOUT', () => {
      const result = service.classifyLoan(
        loan({ restructured: true, delinquencyDays: 0 }),
        AS_OF,
      );
      expect(result.stage).toBe('WORKOUT');
    });

    it('a 120-DPD loan that was never restructured is NONACCRUAL, not WORKOUT', () => {
      const result = service.classifyLoan(
        loan({ delinquencyDays: 120 }),
        AS_OF,
      );
      expect(result.stage).toBe('NONACCRUAL');
    });

    it('a restructured and badly delinquent loan classifies substandard', () => {
      const result = service.classifyLoan(
        loan({ restructured: true, delinquencyDays: 65 }),
        AS_OF,
      );
      expect(result.stage).toBe('WORKOUT');
      expect(result.cossecClassification).toBe('substandard');
    });
  });

  describe('economics — priced off the product registry', () => {
    it('prices an auto loan from its registry PD/LGD', () => {
      const e = service.economics(loan(), AS_OF);
      expect(e.annualPd).toBeCloseTo(0.014);
      expect(e.lgd).toBeCloseTo(0.45);
      expect(e.expectedLoss).toBeCloseTo(18_000 * 0.014 * 0.45);
    });

    it('prices each founder-named product differently', () => {
      const products = [
        'PRESTAMO_AUTO',
        'PRESTAMO_PERSONAL',
        'HIPOTECA',
        'PRESTAMO_COMERCIAL',
      ] as const;
      const losses = products.map(
        (p) => service.economics(loan({ productCode: p }), AS_OF).expectedLoss,
      );
      // A mortgage must not price like an unsecured personal loan.
      expect(new Set(losses).size).toBe(products.length);
    });

    it('discloses that PD/LGD came from the registry prior, not loss history', () => {
      const e = service.economics(loan(), AS_OF);
      expect(e.gaps.some((g) => g.reason === 'PD_LGD_REGISTRY_DEFAULT')).toBe(
        true,
      );
    });

    it('returns nulls and a gap when the product could not be mapped', () => {
      const e = service.economics(loan({ productCode: null }), AS_OF);
      expect(e.expectedLoss).toBeNull();
      expect(e.annualPd).toBeNull();
      expect(e.gaps.some((g) => g.reason === 'PRODUCT_TYPE_UNMAPPED')).toBe(
        true,
      );
    });

    it('has no PD for deposit-side products, and calls that no gap', () => {
      const e = service.economics(
        loan({ productCode: 'CUENTA_AHORRO' }),
        AS_OF,
      );
      expect(e.expectedLoss).toBeNull();
      expect(e.gaps).toHaveLength(0);
    });
  });

  describe('amortization progress', () => {
    it('reports the fraction of term elapsed', () => {
      // Opened 2023-01-15, matures 2028-01-15, as-of 2026-06-30.
      const e = service.economics(loan(), AS_OF);
      expect(e.termElapsedFraction).toBeGreaterThan(0.6);
      expect(e.termElapsedFraction).toBeLessThan(0.75);
    });

    it('is null when maturity is unknown, never the registry WAM prior', () => {
      const e = service.economics(loan({ maturityDate: null }), AS_OF);
      expect(e.termElapsedFraction).toBeNull();
    });

    it('reports principal repaid against original', () => {
      const e = service.economics(
        loan({ balance: 18_000, originalPrincipal: 30_000 }),
        AS_OF,
      );
      expect(e.principalRepaidFraction).toBeCloseTo(0.4);
    });

    it('is null when original principal is unknown', () => {
      const e = service.economics(loan({ originalPrincipal: null }), AS_OF);
      expect(e.principalRepaidFraction).toBeNull();
    });
  });

  describe('stage vocabulary', () => {
    it('every declared stage is reachable except CHARGED_OFF-by-inference', () => {
      const reachable = new Set<string>();
      const cases: LoanSignal[] = [
        loan({ openedDate: new Date('2026-06-01T00:00:00.000Z') }), // ORIGINATED
        loan(), // CURRENT
        loan({ delinquencyDays: 10 }), // EARLY_DELINQUENCY
        loan({ delinquencyDays: 45 }), // DELINQUENT_30
        loan({ delinquencyDays: 75 }), // DELINQUENT_60
        loan({ delinquencyDays: 200 }), // NONACCRUAL
        loan({ restructured: true }), // WORKOUT
        loan({ balance: 0 }), // PAID_OFF
        loan({ chargedOff: true }), // CHARGED_OFF
      ];
      for (const c of cases) {
        const s = service.classifyLoan(c, AS_OF).stage;
        if (s !== null) reachable.add(s);
      }
      expect([...reachable].sort()).toEqual([...LOAN_LIFECYCLE_STAGES].sort());
    });
  });
});
