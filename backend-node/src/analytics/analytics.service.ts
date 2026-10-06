import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface SpendingTrend {
  period: string;
  totalAmount: number;
  expenseCount: number;
  avgAmount: number;
}

export interface CategoryBreakdown {
  category: string;
  totalAmount: number;
  expenseCount: number;
  percentage: number;
}

export interface TeamMemberSpend {
  userId: string;
  userName: string;
  userEmail: string;
  totalAmount: number;
  expenseCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface AnalyticsSummary {
  totalSpend: number;
  totalExpenses: number;
  avgExpenseAmount: number;
  approvalRate: number;
  topCategory: string;
  monthOverMonthChange: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get overall analytics summary for an organization
   */
  async getSummary(
    organizationId: string,
    userId: string,
  ): Promise<AnalyticsSummary> {
    await this.verifyMembership(organizationId, userId);

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Current month expenses
    const currentMonth = await this.prisma.expense.aggregate({
      where: {
        organizationId,
        transactionDate: { gte: thisMonthStart },
      },
      _sum: { amount: true },
      _count: true,
      _avg: { amount: true },
    });

    // Last month expenses
    const lastMonth = await this.prisma.expense.aggregate({
      where: {
        organizationId,
        transactionDate: { gte: lastMonthStart, lte: lastMonthEnd },
      },
      _sum: { amount: true },
    });

    // Approval rate
    const approved = await this.prisma.expense.count({
      where: { organizationId, status: 'APPROVED' },
    });
    const total = await this.prisma.expense.count({
      where: { organizationId, status: { in: ['APPROVED', 'REJECTED'] } },
    });

    // Top category
    const categories = await this.prisma.expense.groupBy({
      by: ['category'],
      where: { organizationId },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 1,
    });

    const currentTotal = Number(currentMonth._sum.amount || 0);
    const lastTotal = Number(lastMonth._sum.amount || 0);
    const change =
      lastTotal > 0 ? ((currentTotal - lastTotal) / lastTotal) * 100 : 0;

    return {
      totalSpend: currentTotal,
      totalExpenses: currentMonth._count,
      avgExpenseAmount: Number(currentMonth._avg.amount || 0),
      approvalRate: total > 0 ? (approved / total) * 100 : 0,
      topCategory: categories[0]?.category || 'N/A',
      monthOverMonthChange: Math.round(change * 10) / 10,
    };
  }

  /**
   * Get spending trends over time
   */
  async getSpendingTrends(
    organizationId: string,
    userId: string,
    range: DateRange,
  ): Promise<SpendingTrend[]> {
    await this.verifyMembership(organizationId, userId);

    const expenses = await this.prisma.expense.findMany({
      where: {
        organizationId,
        transactionDate: {
          gte: new Date(range.startDate),
          lte: new Date(range.endDate),
        },
      },
      select: {
        amount: true,
        transactionDate: true,
      },
      orderBy: { transactionDate: 'asc' },
      take: 500,
    });

    // Group by month
    const trends = new Map<string, { total: number; count: number }>();

    for (const expense of expenses) {
      const date = new Date(expense.transactionDate);
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!trends.has(period)) {
        trends.set(period, { total: 0, count: 0 });
      }

      const entry = trends.get(period)!;
      entry.total += Number(expense.amount);
      entry.count += 1;
    }

    return Array.from(trends.entries()).map(([period, data]) => ({
      period,
      totalAmount: Math.round(data.total * 100) / 100,
      expenseCount: data.count,
      avgAmount: Math.round((data.total / data.count) * 100) / 100,
    }));
  }

  /**
   * Get expense breakdown by category
   */
  async getCategoryBreakdown(
    organizationId: string,
    userId: string,
    range?: DateRange,
  ): Promise<CategoryBreakdown[]> {
    await this.verifyMembership(organizationId, userId);

    const where: any = { organizationId };
    if (range) {
      where.transactionDate = {
        gte: new Date(range.startDate),
        lte: new Date(range.endDate),
      };
    }

    const categories = await this.prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
    });

    const grandTotal = categories.reduce(
      (sum: number, c: any) => sum + Number(c._sum.amount || 0),
      0,
    );

    return categories.map((c: any) => ({
      category: c.category || 'Uncategorized',
      totalAmount: Number(c._sum.amount || 0),
      expenseCount: c._count,
      percentage:
        grandTotal > 0
          ? Math.round((Number(c._sum.amount || 0) / grandTotal) * 1000) / 10
          : 0,
    }));
  }

  /**
   * Get spending by team member
   */
  async getTeamComparison(
    organizationId: string,
    userId: string,
    range?: DateRange,
  ): Promise<TeamMemberSpend[]> {
    await this.verifyMembership(organizationId, userId);

    const where: any = { organizationId };
    if (range) {
      where.transactionDate = {
        gte: new Date(range.startDate),
        lte: new Date(range.endDate),
      };
    }

    // Get all expenses grouped by user
    const expenses = await this.prisma.expense.findMany({
      where,
      select: {
        userId: true,
        amount: true,
        status: true,
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      take: 500,
    });

    const teamMap = new Map<string, TeamMemberSpend>();

    for (const expense of expenses) {
      if (!teamMap.has(expense.userId)) {
        teamMap.set(expense.userId, {
          userId: expense.userId,
          userName: expense.user.name || 'Unknown',
          userEmail: expense.user.email,
          totalAmount: 0,
          expenseCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
        });
      }

      const member = teamMap.get(expense.userId)!;
      member.totalAmount += Number(expense.amount);
      member.expenseCount += 1;
      if (expense.status === 'APPROVED') member.approvedCount += 1;
      if (expense.status === 'REJECTED') member.rejectedCount += 1;
    }

    return Array.from(teamMap.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount,
    );
  }

  /**
   * Export analytics data as CSV-ready format
   */
  async exportExpenses(
    organizationId: string,
    userId: string,
    range?: DateRange,
  ): Promise<Record<string, any>[]> {
    await this.verifyMembership(organizationId, userId);

    const where: any = { organizationId };
    if (range) {
      where.transactionDate = {
        gte: new Date(range.startDate),
        lte: new Date(range.endDate),
      };
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { transactionDate: 'desc' },
      take: 500,
    });

    return expenses.map((e: any) => ({
      Date: new Date(e.transactionDate).toISOString().split('T')[0],
      Merchant: e.merchantName,
      Amount: Number(e.amount),
      Currency: e.currency,
      Category: e.category || 'Uncategorized',
      Status: e.status,
      Description: e.description || '',
      'Submitted By': e.user.name || e.user.email,
      'AI Extracted': e.aiExtracted ? 'Yes' : 'No',
    }));
  }

  private async verifyMembership(organizationId: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this organization');
    }
    return member;
  }
}
