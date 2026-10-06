import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      expense: {
        aggregate: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      organizationMember: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getSummary', () => {
    it('should return summary analytics', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'ADMIN',
      });

      prisma.expense.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: 5000 },
          _count: 25,
          _avg: { amount: 200 },
        })
        .mockResolvedValueOnce({
          _sum: { amount: 4000 },
        });

      prisma.expense.count
        .mockResolvedValueOnce(20) // approved
        .mockResolvedValueOnce(22); // total decided

      prisma.expense.groupBy.mockResolvedValue([
        { category: 'Meals & Entertainment', _sum: { amount: 2000 } },
      ]);

      const result = await service.getSummary('org-1', 'user-1');

      expect(result.totalSpend).toBe(5000);
      expect(result.totalExpenses).toBe(25);
      expect(result.approvalRate).toBeCloseTo(90.9, 0);
      expect(result.topCategory).toBe('Meals & Entertainment');
    });
  });

  describe('getCategoryBreakdown', () => {
    it('should return categories with percentages', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'MEMBER',
      });

      prisma.expense.groupBy.mockResolvedValue([
        { category: 'Travel', _sum: { amount: 3000 }, _count: 10 },
        { category: 'Meals', _sum: { amount: 2000 }, _count: 20 },
        { category: 'Other', _sum: { amount: 1000 }, _count: 5 },
      ]);

      const result = await service.getCategoryBreakdown('org-1', 'user-1');

      expect(result).toHaveLength(3);
      expect(result[0].category).toBe('Travel');
      expect(result[0].percentage).toBe(50);
      expect(result[1].percentage).toBeCloseTo(33.3, 0);
    });
  });

  describe('getTeamComparison', () => {
    it('should return team member spending data', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'ADMIN',
      });

      prisma.expense.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          amount: 500,
          status: 'APPROVED',
          user: { id: 'user-1', name: 'Alice', email: 'alice@test.com' },
        },
        {
          userId: 'user-1',
          amount: 300,
          status: 'SUBMITTED',
          user: { id: 'user-1', name: 'Alice', email: 'alice@test.com' },
        },
        {
          userId: 'user-2',
          amount: 200,
          status: 'REJECTED',
          user: { id: 'user-2', name: 'Bob', email: 'bob@test.com' },
        },
      ]);

      const result = await service.getTeamComparison('org-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].userName).toBe('Alice');
      expect(result[0].totalAmount).toBe(800);
      expect(result[0].expenseCount).toBe(2);
      expect(result[1].rejectedCount).toBe(1);
    });
  });

  describe('getSpendingTrends', () => {
    it('should group expenses by month', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'MEMBER',
      });

      prisma.expense.findMany.mockResolvedValue([
        { amount: 100, transactionDate: new Date('2025-01-15') },
        { amount: 200, transactionDate: new Date('2025-01-20') },
        { amount: 300, transactionDate: new Date('2025-02-10') },
      ]);

      const result = await service.getSpendingTrends('org-1', 'user-1', {
        startDate: '2025-01-01',
        endDate: '2025-03-01',
      });

      expect(result).toHaveLength(2);
      expect(result[0].period).toBe('2025-01');
      expect(result[0].totalAmount).toBe(300);
      expect(result[0].expenseCount).toBe(2);
      expect(result[1].period).toBe('2025-02');
      expect(result[1].totalAmount).toBe(300);
    });
  });

  describe('verifyMembership', () => {
    it('should throw ForbiddenException for non-members', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(service.getSummary('org-1', 'non-member')).rejects.toThrow(
        'You are not a member of this organization',
      );
    });
  });

  // Coverage: line 174 — getCategoryBreakdown with date range
  describe('getCategoryBreakdown with date range', () => {
    it('should filter by date range when provided', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'MEMBER',
      });
      prisma.expense.groupBy.mockResolvedValue([
        { category: 'Travel', _sum: { amount: 1000 }, _count: 5 },
      ]);

      const result = await service.getCategoryBreakdown('org-1', 'user-1', {
        startDate: '2026-01-01',
        endDate: '2026-03-01',
      });

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('Travel');
    });
  });

  // Coverage: line 216 — getTeamComparison with date range
  describe('getTeamComparison with date range', () => {
    it('should filter by date range when provided', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'ADMIN',
      });
      prisma.expense.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          amount: 500,
          status: 'APPROVED',
          user: { id: 'user-1', name: 'Alice', email: 'alice@test.com' },
        },
      ]);

      const result = await service.getTeamComparison('org-1', 'user-1', {
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      });
      expect(result).toHaveLength(1);
    });
  });

  // Coverage: lines 271-290 — exportExpenses
  describe('exportExpenses', () => {
    it('should return formatted expense records', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'ADMIN',
      });
      prisma.expense.findMany.mockResolvedValue([
        {
          transactionDate: new Date('2026-02-15'),
          merchantName: 'Starbucks',
          amount: 5.5,
          currency: 'USD',
          category: 'Meals',
          status: 'APPROVED',
          user: { name: 'Alice', email: 'alice@test.com' },
        },
      ]);

      const result = await service.exportExpenses('org-1', 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0].Merchant).toBe('Starbucks');
      expect(result[0].Amount).toBe(5.5);
      expect(result[0].Currency).toBe('USD');
    });

    it('should filter by date range when provided', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: '1',
        role: 'ADMIN',
      });
      prisma.expense.findMany.mockResolvedValue([]);

      const result = await service.exportExpenses('org-1', 'user-1', {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      });
      expect(result).toEqual([]);
    });
  });
});
