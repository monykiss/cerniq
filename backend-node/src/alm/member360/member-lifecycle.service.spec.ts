import { MemberAccountCategory, MemberLifecycleStage } from '@prisma/client';
import {
  MemberLifecycleService,
  type AccountSignal,
} from './member-lifecycle.service';

function account(overrides: Partial<AccountSignal> = {}): AccountSignal {
  return {
    id: 'acc-1',
    productType: 'préstamo personal',
    category: MemberAccountCategory.LOAN,
    balance: 5000,
    delinquencyDays: 0,
    maturityDate: null,
    openedDate: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('MemberLifecycleService', () => {
  let service: MemberLifecycleService;
  const now = new Date('2026-08-12T00:00:00Z');

  beforeEach(() => {
    service = new MemberLifecycleService();
  });

  describe('classifyStage', () => {
    it('classifies a brand-new member with no accounts as ONBOARDING', () => {
      const memberSince = new Date('2026-08-01T00:00:00Z'); // 11 days ago
      const result = service.classifyStage([], memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.ONBOARDING);
    });

    it('classifies a member with only a share deposit within the onboarding window as ONBOARDING', () => {
      const memberSince = new Date('2026-08-05T00:00:00Z');
      const shareOnly = [
        account({
          category: MemberAccountCategory.SHARE,
          delinquencyDays: null,
        }),
      ];
      const result = service.classifyStage(shareOnly, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.ONBOARDING);
    });

    it('classifies all-current accounts as ACTIVE', () => {
      const memberSince = new Date('2020-01-01T00:00:00Z');
      const accounts = [account({ delinquencyDays: 0 })];
      const result = service.classifyStage(accounts, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.ACTIVE);
    });

    it('classifies 1-29 DPD as AT_RISK', () => {
      const memberSince = new Date('2020-01-01T00:00:00Z');
      const accounts = [account({ delinquencyDays: 15 })];
      const result = service.classifyStage(accounts, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.AT_RISK);
    });

    it('classifies 30-89 DPD as DELINQUENT', () => {
      const memberSince = new Date('2020-01-01T00:00:00Z');
      const accounts = [account({ delinquencyDays: 45 })];
      const result = service.classifyStage(accounts, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.DELINQUENT);
    });

    it('classifies 90+ DPD as WORKOUT, never as CHARGED_OFF', () => {
      const memberSince = new Date('2020-01-01T00:00:00Z');
      const accounts = [account({ delinquencyDays: 120 })];
      const result = service.classifyStage(accounts, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.WORKOUT);
      expect(result.stage).not.toBe(MemberLifecycleStage.CHARGED_OFF);
    });

    it('takes the WORST delinquency across multiple loans, not the average', () => {
      const memberSince = new Date('2020-01-01T00:00:00Z');
      const accounts = [
        account({ id: 'a', delinquencyDays: 0 }),
        account({ id: 'b', delinquencyDays: 95 }),
      ];
      const result = service.classifyStage(accounts, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.WORKOUT);
    });

    it('classifies zero-balance accounts as CHURNED', () => {
      const memberSince = new Date('2020-01-01T00:00:00Z');
      const accounts = [account({ balance: 0, delinquencyDays: 0 })];
      const result = service.classifyStage(accounts, memberSince, now);
      expect(result.stage).toBe(MemberLifecycleStage.CHURNED);
    });

    it('always returns at least one human-readable reason', () => {
      const result = service.classifyStage(
        [account()],
        new Date('2020-01-01T00:00:00Z'),
        now,
      );
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  describe('assessRisk (D1)', () => {
    it('returns null riskScore/ceclStage/ratio with a WARNING gap when there are no accounts', () => {
      const result = service.assessRisk('m1', []);
      expect(result.riskScore).toBeNull();
      expect(result.ceclStage).toBeNull();
      expect(result.loanToDepositRatio).toBeNull();
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0].reason).toBe('MEMBER_RISK_SCORE_UNAVAILABLE');
    });

    it('never returns a fabricated 0 or 50 in place of null', () => {
      const result = service.assessRisk('m1', []);
      expect(result.riskScore).not.toBe(0);
      expect(result.riskScore).not.toBe(50);
    });

    it('computes ceclStage as the worst stage across loan accounts', () => {
      const result = service.assessRisk('m1', [
        account({ id: 'a', delinquencyDays: 0 }), // stage 1
        account({ id: 'b', delinquencyDays: 95 }), // stage 3
      ]);
      expect(result.ceclStage).toBe(3);
    });

    it('leaves ceclStage null when the member holds no loans', () => {
      const result = service.assessRisk('m1', [
        account({
          category: MemberAccountCategory.SHARE,
          delinquencyDays: null,
          balance: 200,
        }),
      ]);
      expect(result.ceclStage).toBeNull();
    });

    it('computes loanToDepositRatio as loans / deposits', () => {
      const result = service.assessRisk('m1', [
        account({
          id: 'loan',
          category: MemberAccountCategory.LOAN,
          balance: 4000,
          delinquencyDays: 0,
        }),
        account({
          id: 'dep',
          category: MemberAccountCategory.DEPOSIT,
          balance: 2000,
          delinquencyDays: null,
        }),
      ]);
      expect(result.loanToDepositRatio).toBe(2);
    });

    it('flags an unclassified ratio (loans with no deposit balance) with a gap rather than a fabricated 0', () => {
      const result = service.assessRisk('m1', [
        account({
          category: MemberAccountCategory.LOAN,
          balance: 4000,
          delinquencyDays: 0,
        }),
      ]);
      expect(result.loanToDepositRatio).toBeNull();
      expect(
        result.gaps.some((g) => g.reason === 'MEMBER_ACCOUNTS_MISSING'),
      ).toBe(true);
    });

    it('keeps riskScore within [0, 100] even under heavy delinquency + leverage', () => {
      const result = service.assessRisk('m1', [
        account({ id: 'loan', balance: 50000, delinquencyDays: 200 }),
      ]);
      expect(result.riskScore).not.toBeNull();
      expect(result.riskScore as number).toBeGreaterThanOrEqual(0);
      expect(result.riskScore as number).toBeLessThanOrEqual(100);
    });
  });

  describe('computeNextBestActions', () => {
    it('recommends a CD renewal when a CD matures within 30 days', () => {
      const soon = new Date(now.getTime() + 10 * 86_400_000);
      const actions = service.computeNextBestActions(
        [
          account({
            id: 'cd-1',
            productType: 'certificado de depósito',
            category: MemberAccountCategory.DEPOSIT,
            maturityDate: soon,
            delinquencyDays: null,
          }),
        ],
        MemberLifecycleStage.ACTIVE,
        now,
      );
      expect(actions.some((a) => a.id === 'cd-renewal-cd-1')).toBe(true);
    });

    it('does not recommend a CD renewal for a CD maturing far in the future', () => {
      const farOff = new Date(now.getTime() + 200 * 86_400_000);
      const actions = service.computeNextBestActions(
        [
          account({
            id: 'cd-1',
            productType: 'certificado de depósito',
            category: MemberAccountCategory.DEPOSIT,
            maturityDate: farOff,
            delinquencyDays: null,
          }),
        ],
        MemberLifecycleStage.ACTIVE,
        now,
      );
      expect(actions.some((a) => a.id === 'cd-renewal-cd-1')).toBe(false);
    });

    it('recommends a pre-approved credit line for a high-balance saver with no loan', () => {
      const actions = service.computeNextBestActions(
        [
          account({
            category: MemberAccountCategory.DEPOSIT,
            balance: 10000,
            delinquencyDays: null,
          }),
        ],
        MemberLifecycleStage.ACTIVE,
        now,
      );
      expect(actions.some((a) => a.id === 'preapproved-credit-line')).toBe(
        true,
      );
    });

    it('recommends outreach for AT_RISK/DELINQUENT/WORKOUT stages', () => {
      for (const stage of [
        MemberLifecycleStage.AT_RISK,
        MemberLifecycleStage.DELINQUENT,
        MemberLifecycleStage.WORKOUT,
      ]) {
        const actions = service.computeNextBestActions([], stage, now);
        expect(actions.some((a) => a.id === 'outreach-workout')).toBe(true);
      }
    });

    it('does not recommend outreach for a healthy ACTIVE member', () => {
      const actions = service.computeNextBestActions(
        [account({ delinquencyDays: 0 })],
        MemberLifecycleStage.ACTIVE,
        now,
      );
      expect(actions.some((a) => a.id === 'outreach-workout')).toBe(false);
    });

    it('recommends a refinance review after 12+ on-time months', () => {
      const openedOverAYearAgo = new Date(now.getTime() - 400 * 86_400_000);
      const actions = service.computeNextBestActions(
        [
          account({
            id: 'loan-1',
            delinquencyDays: 0,
            openedDate: openedOverAYearAgo,
          }),
        ],
        MemberLifecycleStage.ACTIVE,
        now,
      );
      expect(actions.some((a) => a.id === 'refi-offer-loan-1')).toBe(true);
    });
  });
});
