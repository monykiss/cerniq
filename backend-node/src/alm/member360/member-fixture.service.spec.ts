import { MemberAccountCategory } from '@prisma/client';
import { MemberFixtureService } from './member-fixture.service';
import { MemberLifecycleService } from './member-lifecycle.service';
import {
  LOAN_LIFECYCLE_STAGES,
  LoanLifecycleService,
} from './loan-lifecycle.service';
import { mapProductLabel } from '../cooperativa/product-mapping';
import { COOPERATIVA_PRODUCT_REGISTRY } from '../cooperativa/product-registry';

describe('MemberFixtureService', () => {
  let service: MemberFixtureService;

  beforeEach(() => {
    service = new MemberFixtureService(new LoanLifecycleService());
  });

  it('is deterministic: same institutionId + count produces byte-identical output', () => {
    const a = service.generateMembers('inst-demo-1', 20);
    const b = service.generateMembers('inst-demo-1', 20);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces different books for different institutions', () => {
    const a = service.generateMembers('inst-demo-1', 20);
    const b = service.generateMembers('inst-demo-2', 20);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('generates the requested member count', () => {
    const members = service.generateMembers('inst-demo-1', 37);
    expect(members).toHaveLength(37);
  });

  it('every member carries a SHARE account (mandatory cooperativa membership)', () => {
    const members = service.generateMembers('inst-demo-1', 50);
    for (const member of members) {
      expect(
        member.accounts.some((a) => a.category === MemberAccountCategory.SHARE),
      ).toBe(true);
    }
  });

  it('every member number is unique within the generated book', () => {
    const members = service.generateMembers('inst-demo-1', 100);
    const numbers = new Set(members.map((m) => m.memberNumber));
    expect(numbers.size).toBe(100);
  });

  it('every loan account has a delinquencyDays value and a derived COSSEC classification', () => {
    const members = service.generateMembers('inst-demo-1', 50);
    const loanAccounts = members.flatMap((m) =>
      m.accounts.filter((a) => a.category === MemberAccountCategory.LOAN),
    );
    expect(loanAccounts.length).toBeGreaterThan(0);
    for (const account of loanAccounts) {
      expect(account.delinquencyDays).not.toBeNull();
      expect(account.cossecClassification).not.toBeNull();
    }
  });

  it('non-loan accounts (SHARE) carry no delinquency days or COSSEC classification', () => {
    const members = service.generateMembers('inst-demo-1', 50);
    const shareAccounts = members.flatMap((m) =>
      m.accounts.filter((a) => a.category === MemberAccountCategory.SHARE),
    );
    for (const account of shareAccounts) {
      expect(account.delinquencyDays).toBeNull();
      expect(account.cossecClassification).toBeNull();
    }
  });

  it('CD accounts (certificado de depósito) carry a maturity date', () => {
    const members = service.generateMembers('inst-demo-1', 80);
    const cds = members.flatMap((m) =>
      m.accounts.filter((a) => a.productType === 'certificado de depósito'),
    );
    expect(cds.length).toBeGreaterThan(0);
    for (const cd of cds) {
      expect(cd.maturityDate).not.toBeNull();
    }
  });

  it('all balances are finite, and zero only where zero is the TRUE value', () => {
    const members = service.generateMembers('inst-demo-1', 50);
    const churnedStart = MemberFixtureService.ONBOARDING_COHORT;
    const churnedEnd = churnedStart + MemberFixtureService.CHURNED_COHORT;

    // There are exactly TWO honest sources of a zero balance, and D1 requires
    // both to be real values rather than stand-ins for unknown data:
    //   1. the churned cohort — every account closed out;
    //   2. the paid-off loan cohort — the LOAN is repaid while the member's
    //      shares and deposits still hold money (they are an active socio who
    //      finished paying off a car, which is the point of a lifecycle view).
    // Anything else at zero would be a phantom.
    members.forEach((member, index) => {
      const isChurnedCohort = index >= churnedStart && index < churnedEnd;
      for (const account of member.accounts) {
        expect(Number.isFinite(account.balance)).toBe(true);
        expect(account.balance).toBeGreaterThanOrEqual(0);

        if (isChurnedCohort) {
          expect(account.balance).toBe(0);
        } else if (account.balance === 0) {
          expect(account.loanStage).toBe('PAID_OFF');
          expect(account.category).toBe(MemberAccountCategory.LOAN);
        }
      }
    });
  });

  it('a paid-off member still holds real money outside the repaid loan', () => {
    const members = service.generateMembers('inst-demo-1', 250);
    const paidOff = members.filter((m) =>
      m.accounts.some((a) => a.loanStage === 'PAID_OFF'),
    );
    expect(paidOff.length).toBeGreaterThan(0);
    for (const member of paidOff) {
      const nonLoan = member.accounts.filter(
        (a) => a.category !== MemberAccountCategory.LOAN,
      );
      // Otherwise the classifier would read them as CHURNED, which is exactly
      // the contradiction the churned cohort avoids by carrying no loans.
      expect(nonLoan.reduce((sum, a) => sum + a.balance, 0)).toBeGreaterThan(0);
    }
  });

  it('guarantees a demo book reaches ONBOARDING and CHURNED, not just the middle stages', () => {
    // Regression guard for the gap found on 2026-08-13: purely stochastic
    // generation produced 0 onboarding and 0 churned members in a 250-member
    // book, so two lifecycle columns rendered permanently empty in the UI.
    const members = service.generateMembers('inst-demo-1', 50);

    const onboarding = members.slice(0, MemberFixtureService.ONBOARDING_COHORT);
    expect(onboarding).toHaveLength(MemberFixtureService.ONBOARDING_COHORT);
    for (const member of onboarding) {
      // The classifier's onboarding rule: a single SHARE account inside the
      // 30-day tenure window.
      expect(member.accounts).toHaveLength(1);
      expect(member.accounts[0].category).toBe(MemberAccountCategory.SHARE);
      const tenureDays =
        (Date.now() - member.memberSince.getTime()) / 86_400_000;
      expect(tenureDays).toBeLessThanOrEqual(
        MemberLifecycleService.ONBOARDING_WINDOW_DAYS,
      );
    }

    const churned = members.slice(
      MemberFixtureService.ONBOARDING_COHORT,
      MemberFixtureService.ONBOARDING_COHORT +
        MemberFixtureService.CHURNED_COHORT,
    );
    expect(churned).toHaveLength(MemberFixtureService.CHURNED_COHORT);
    for (const member of churned) {
      const total = member.accounts.reduce((sum, a) => sum + a.balance, 0);
      expect(total).toBe(0);
      // A churned member never carries an outstanding loan.
      expect(
        member.accounts.some((a) => a.category === MemberAccountCategory.LOAN),
      ).toBe(false);
    }
  });

  it('skips the pinned cohorts for small books so a tiny fixture is not majority-pinned', () => {
    const small = service.generateMembers(
      'inst-demo-1',
      MemberFixtureService.MIN_BOOK_FOR_COHORTS - 1,
    );
    // With no cohorts, every balance is drawn from a strictly positive range.
    for (const member of small) {
      for (const account of member.accounts) {
        expect(account.balance).toBeGreaterThan(0);
      }
    }
  });

  it('memberSince is always in the past', () => {
    const members = service.generateMembers('inst-demo-1', 20);
    const now = Date.now();
    for (const member of members) {
      expect(member.memberSince.getTime()).toBeLessThan(now);
    }
  });

  describe('canonical product taxonomy', () => {
    it('every generated account carries a registry product code', () => {
      const members = service.generateMembers('inst-demo-1', 250);
      const accounts = members.flatMap((m) => m.accounts);
      expect(accounts.length).toBeGreaterThan(0);
      for (const a of accounts) {
        expect(COOPERATIVA_PRODUCT_REGISTRY[a.productCode]).toBeDefined();
      }
    });

    it('the declared productCode agrees with what mapProductLabel resolves', () => {
      // The template declares its code explicitly AND the mapper must agree.
      // This is what stops the label and the code drifting apart again.
      const members = service.generateMembers('inst-demo-1', 250);
      for (const a of members.flatMap((m) => m.accounts)) {
        expect(mapProductLabel(a.productType)?.productType).toBe(a.productCode);
      }
    });

    it('generates all four founder-named loan products', () => {
      const codes = new Set(
        service
          .generateMembers('inst-demo-1', 250)
          .flatMap((m) => m.accounts)
          .map((a) => a.productCode),
      );
      expect(codes.has('PRESTAMO_AUTO')).toBe(true);
      expect(codes.has('PRESTAMO_PERSONAL')).toBe(true);
      expect(codes.has('HIPOTECA')).toBe(true);
      expect(codes.has('PRESTAMO_COMERCIAL')).toBe(true);
    });
  });

  describe('loan lifecycle coverage', () => {
    it('every loan lifecycle stage appears in a full demo book', () => {
      // The sales-demo failure mode this guards: a stage the classifier can
      // emit rendering as a permanently empty column.
      const stages = new Set(
        service
          .generateMembers('inst-demo-1', 250)
          .flatMap((m) => m.accounts)
          .map((a) => a.loanStage)
          .filter((s): s is NonNullable<typeof s> => s !== null),
      );
      for (const stage of LOAN_LIFECYCLE_STAGES) {
        expect([...stages]).toContain(stage);
      }
    });

    it('non-loan accounts carry no loan stage', () => {
      const members = service.generateMembers('inst-demo-1', 100);
      for (const a of members.flatMap((m) => m.accounts)) {
        if (a.category !== MemberAccountCategory.LOAN) {
          expect(a.loanStage).toBeNull();
          expect(a.originalPrincipal).toBeNull();
        }
      }
    });

    it('original principal is never below the current balance', () => {
      const members = service.generateMembers('inst-demo-1', 250);
      for (const a of members.flatMap((m) => m.accounts)) {
        if (a.originalPrincipal !== null) {
          expect(a.originalPrincipal).toBeGreaterThanOrEqual(a.balance);
        }
      }
    });

    it('mortgages amortize on a longer clock than auto loans', () => {
      const accounts = service
        .generateMembers('inst-demo-1', 250)
        .flatMap((m) => m.accounts);
      const term = (code: string) => {
        const a = accounts.find(
          (x) => x.productCode === code && x.maturityDate !== null,
        );
        return a ? a.maturityDate!.getTime() - a.openedDate.getTime() : 0;
      };
      expect(term('HIPOTECA')).toBeGreaterThan(term('PRESTAMO_AUTO'));
    });

    it('stays deterministic with the lifecycle cohorts pinned', () => {
      const a = service.generateMembers('inst-demo-1', 250);
      const b = service.generateMembers('inst-demo-1', 250);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
