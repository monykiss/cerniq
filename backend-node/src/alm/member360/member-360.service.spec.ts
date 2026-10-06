import { NotFoundException } from '@nestjs/common';
import { MemberAccountCategory, MemberLifecycleStage } from '@prisma/client';
import { Member360Service } from './member-360.service';
import { MemberFixtureService } from './member-fixture.service';
import { MemberLifecycleService } from './member-lifecycle.service';
import { LoanLifecycleService } from './loan-lifecycle.service';

function buildPrismaMock() {
  const tx = {
    member: { upsert: jest.fn() },
    memberAccount: { deleteMany: jest.fn(), createMany: jest.fn() },
    memberLifecycleEvent: { create: jest.fn() },
  };
  return {
    member: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    __tx: tx,
  };
}

describe('Member360Service', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: Member360Service;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new Member360Service(
      prisma as never,
      new MemberFixtureService(new LoanLifecycleService()),
      new MemberLifecycleService(),
      new LoanLifecycleService(),
    );
  });

  describe('seedDemoMembers', () => {
    it('refuses to seed when the institution already has real (non-fixture) members', async () => {
      prisma.member.count.mockResolvedValue(3);

      const result = await service.seedDemoMembers('inst-1', 10);

      expect(result.skipped).toBe(true);
      expect(result.created).toBe(0);
      expect(result.reason).toMatch(/real/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('seeds the requested count when the institution has no real members', async () => {
      prisma.member.count.mockResolvedValue(0);
      prisma.__tx.member.upsert.mockResolvedValue({ id: 'member-x' });

      const result = await service.seedDemoMembers('inst-1', 5);

      expect(result.skipped).toBe(false);
      expect(result.created).toBe(5);
      expect(prisma.__tx.member.upsert).toHaveBeenCalledTimes(5);
      expect(prisma.__tx.memberLifecycleEvent.create).toHaveBeenCalledTimes(5);
    });
  });

  describe('listMembers', () => {
    it('emits a NO_MEMBER_DATA WARNING gap when the institution has zero members', async () => {
      prisma.member.count.mockResolvedValue(0);
      prisma.member.findMany.mockResolvedValue([]);

      const result = await service.listMembers('inst-1');

      expect(result.total).toBe(0);
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0].reason).toBe('NO_MEMBER_DATA');
    });

    it('does not emit a gap when members exist', async () => {
      prisma.member.count.mockResolvedValue(1);
      prisma.member.findMany.mockResolvedValue([
        {
          id: 'm1',
          memberNumber: 'M-10000',
          fullName: 'Ana Rivera',
          memberSince: new Date('2020-01-01'),
          lifecycleStage: MemberLifecycleStage.ACTIVE,
          riskScore: 10,
          accounts: [
            { category: MemberAccountCategory.DEPOSIT, balance: 500 },
            { category: MemberAccountCategory.LOAN, balance: 2000 },
          ],
        },
      ]);

      const result = await service.listMembers('inst-1');

      expect(result.gaps).toHaveLength(0);
      expect(result.members[0].totalDeposits).toBe(500);
      expect(result.members[0].totalLoans).toBe(2000);
    });

    it('clamps page size to the documented maximum', async () => {
      prisma.member.count.mockResolvedValue(0);
      prisma.member.findMany.mockResolvedValue([]);

      const result = await service.listMembers('inst-1', { pageSize: 99999 });

      expect(result.pageSize).toBe(100);
    });
  });

  describe('getMemberProfile', () => {
    it('throws NotFoundException when the member does not belong to the institution', async () => {
      prisma.member.findFirst.mockResolvedValue(null);

      await expect(
        service.getMemberProfile('inst-1', 'missing-member'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('aggregates financial overview and regulatory health from account rows', async () => {
      prisma.member.findFirst.mockResolvedValue({
        id: 'm1',
        memberNumber: 'M-10001',
        fullName: 'Carlos Torres',
        memberSince: new Date('2018-05-01'),
        accounts: [
          {
            id: 'acc-share',
            productType: 'acciones',
            category: MemberAccountCategory.SHARE,
            balance: 100,
            interestRate: null,
            delinquencyDays: null,
            maturityDate: null,
            openedDate: new Date('2018-05-01'),
            cossecClassification: null,
          },
          {
            id: 'acc-savings',
            productType: 'cuenta de ahorros',
            category: MemberAccountCategory.DEPOSIT,
            balance: 3000,
            interestRate: 0.01,
            delinquencyDays: null,
            maturityDate: null,
            openedDate: new Date('2018-06-01'),
            cossecClassification: null,
          },
          {
            id: 'acc-loan',
            productType: 'préstamo de auto',
            category: MemberAccountCategory.LOAN,
            balance: 12000,
            interestRate: 0.07,
            delinquencyDays: 45,
            maturityDate: new Date('2028-01-01'),
            openedDate: new Date('2023-01-01'),
            cossecClassification: 'substandard',
          },
        ],
        lifecycleEvents: [],
      });

      const profile = await service.getMemberProfile('inst-1', 'm1');

      expect(profile.financialOverview.totalDeposits).toBe(3000);
      expect(profile.financialOverview.totalShares).toBe(100);
      expect(profile.financialOverview.activeLoanBalance).toBe(12000);
      expect(profile.regulatoryHealth.worstCossecClassification).toBe(
        'substandard',
      );
      expect(profile.regulatoryHealth.lifecycleStage).toBe(
        MemberLifecycleStage.DELINQUENT,
      );
      expect(profile.regulatoryHealth.ceclStage).toBe(2);
    });

    it('flags a gap when a member holds loans with no COSSEC classification on any of them', async () => {
      prisma.member.findFirst.mockResolvedValue({
        id: 'm1',
        memberNumber: 'M-10002',
        fullName: 'Lourdes Ortiz',
        memberSince: new Date('2018-05-01'),
        accounts: [
          {
            id: 'acc-loan',
            productType: 'préstamo personal',
            category: MemberAccountCategory.LOAN,
            balance: 4000,
            interestRate: 0.1,
            delinquencyDays: 0,
            maturityDate: null,
            openedDate: new Date('2023-01-01'),
            cossecClassification: null,
          },
        ],
        lifecycleEvents: [],
      });

      const profile = await service.getMemberProfile('inst-1', 'm1');

      expect(profile.regulatoryHealth.worstCossecClassification).toBeNull();
      expect(
        profile.gaps.some(
          (g) => g.field === 'member360.regulatoryHealth.cossecClassification',
        ),
      ).toBe(true);
    });
  });
});
