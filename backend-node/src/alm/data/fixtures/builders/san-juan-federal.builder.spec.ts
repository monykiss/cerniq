/**
 * Specs for the dynamic SIC 2026 demo-institution builder.
 *
 * These assert RELATIONSHIPS (derived = function of inputs), never frozen output
 * literals: equity = totalAssets × capitalRatio, cash/borrowings are the balance
 * plugs, segments reconcile to the loan book, LCR is computed from HQLA. The
 * "generated, not frozen" block proves the institution actually moves when its
 * parameters move — the whole point of replacing the static JSON fixture.
 */
import {
  buildSanJuanFederalDemo,
  SAN_JUAN_FEDERAL_DEFAULTS,
} from './san-juan-federal.builder';

type Fixture = ReturnType<typeof buildSanJuanFederalDemo>;

const sumAssets = (fx: Fixture) =>
  fx.items
    .filter((i) => i.category === 'asset')
    .reduce((s, i) => s + i.balance, 0);
const sumLiabilities = (fx: Fixture) =>
  fx.items
    .filter((i) => i.category === 'liability')
    .reduce((s, i) => s + i.balance, 0);
const bySubcat = (fx: Fixture, sc: string) =>
  fx.items
    .filter((i) => i.subcategory === sc)
    .reduce((s, i) => s + i.balance, 0);

describe('buildSanJuanFederalDemo', () => {
  describe('default parameters reproduce the demo brief by COMPUTATION', () => {
    const p = SAN_JUAN_FEDERAL_DEFAULTS;
    const fx = buildSanJuanFederalDemo();
    const totalLoans =
      p.loans.consumer + p.loans.residential + p.loans.commercial;
    const totalInvestments = p.investments.treasuries + p.investments.agencyMbs;
    const totalDeposits =
      p.deposits.savings +
      p.deposits.shareCertificates +
      p.deposits.demand +
      p.deposits.timeDeposits;

    it('asset side sums to the requested total assets', () => {
      expect(sumAssets(fx)).toBeCloseTo(p.totalAssets, 6);
    });

    it('equity is derived from the capital ratio and equals assets − liabilities', () => {
      const equity = sumAssets(fx) - sumLiabilities(fx);
      expect(equity).toBeCloseTo(p.totalAssets * (p.capitalRatioPct / 100), 6);
    });

    it('cash is the derived asset-side plug (assets − loans − investments)', () => {
      expect(bySubcat(fx, 'cash_equivalents')).toBeCloseTo(
        p.totalAssets - totalLoans - totalInvestments,
        6,
      );
    });

    it('borrowings is the derived liability-side plug (liabilities − deposits)', () => {
      const liabilities =
        p.totalAssets - p.totalAssets * (p.capitalRatioPct / 100);
      expect(bySubcat(fx, 'borrowings')).toBeCloseTo(
        liabilities - totalDeposits,
        6,
      );
    });

    it('loan segments reconcile to the loan book', () => {
      const segTotal = (fx.loanSegments ?? []).reduce(
        (s, seg) => s + seg.balance,
        0,
      );
      expect(segTotal).toBeCloseTo(totalLoans, 6);
    });

    it('LCR is computed from HQLA and outflows, not stored as a literal', () => {
      const expected =
        ((p.liquidity.hqlaLevel1 + p.liquidity.hqlaLevel2) /
          p.liquidity.cashOutflows) *
        100;
      expect(fx.liquidity.lcr).toBeCloseTo(expected, 2);
    });

    it('is a Spanish-first COSSEC cooperativa', () => {
      expect(fx.type).toBe('cooperativa');
      expect(fx.primaryRegulator).toBe('COSSEC');
      expect(fx.preferredLanguage).toBe('es');
    });
  });

  describe('the institution is generated, not frozen', () => {
    it('changing the capital ratio moves equity and the borrowings plug', () => {
      const base = buildSanJuanFederalDemo();
      const higher = buildSanJuanFederalDemo({ capitalRatioPct: 12 });
      const equity = (fx: Fixture) => sumAssets(fx) - sumLiabilities(fx);
      expect(equity(higher)).toBeGreaterThan(equity(base));
      // more equity ⇒ fewer liabilities ⇒ smaller borrowings plug (deposits fixed)
      expect(bySubcat(higher, 'borrowings')).toBeLessThan(
        bySubcat(base, 'borrowings'),
      );
    });

    it('changing the consumer book moves the cash plug and the consumer segment', () => {
      const base = buildSanJuanFederalDemo();
      const fewer = buildSanJuanFederalDemo({
        loans: { consumer: 60, residential: 60, commercial: 35 },
      });
      // smaller loan book ⇒ larger cash plug (total assets fixed)
      expect(bySubcat(fewer, 'cash_equivalents')).toBeGreaterThan(
        bySubcat(base, 'cash_equivalents'),
      );
      expect(bySubcat(fewer, 'consumer_loans')).toBe(60);
    });

    it('is deterministic — same params produce a deep-equal fixture', () => {
      expect(buildSanJuanFederalDemo()).toEqual(buildSanJuanFederalDemo());
    });
  });

  describe('refuses to emit an impossible balance sheet', () => {
    it('throws when loans + investments exceed total assets (negative cash)', () => {
      expect(() =>
        buildSanJuanFederalDemo({
          loans: { consumer: 300, residential: 60, commercial: 35 },
        }),
      ).toThrow(/cash/i);
    });

    it('throws when deposits exceed liabilities (negative borrowings)', () => {
      expect(() =>
        buildSanJuanFederalDemo({
          deposits: {
            savings: 300,
            shareCertificates: 70,
            demand: 30,
            timeDeposits: 15,
          },
        }),
      ).toThrow(/borrowings/i);
    });
  });
});
