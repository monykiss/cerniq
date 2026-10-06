import { DemoSeatAnalyticsService } from './demo-seat-analytics.service';

describe('DemoSeatAnalyticsService', () => {
  let service: DemoSeatAnalyticsService;
  let prisma: any;

  const now = new Date('2026-04-15T12:00:00.000Z');

  beforeEach(() => {
    prisma = {
      prospectInstitution: {
        count: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    service = new DemoSeatAnalyticsService(prisma);
  });

  describe('getAnalytics', () => {
    it('returns a zeros-everywhere shape when no demo seats exist', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(0);
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: null },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics(now);

      expect(result).toMatchObject({
        totals: {
          provisioned: 0,
          active: 0,
          expired: 0,
          converted: 0,
          viewedAtLeastOnce: 0,
        },
        rates: {
          conversionRatePct: 0,
          viewRatePct: 0,
        },
        revenue: {
          allTimeUsd: 0,
          thisMonthUsd: 0,
        },
        velocity: {
          provisionedLast7Days: 0,
          convertedLast7Days: 0,
          avgDaysToConvert: null,
        },
        topConvertingSnapshots: [],
      });
      expect(result.generatedAt).toBe(now.toISOString());
    });

    it('computes conversionRate as (converted / provisioned) * 100', async () => {
      // 10 provisioned, 3 converted → 30%
      const counts = [10, 5, 2, 3, 1, 6, 4, 1]; // provisioned, active, expired, convertedAll, convertedThisMonth, viewed, last7days prov, last7days conv
      let i = 0;
      prisma.prospectInstitution.count.mockImplementation(() =>
        Promise.resolve(counts[i++]),
      );
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: { toNumber: () => 0 } },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics(now);

      expect(result.totals.provisioned).toBe(10);
      expect(result.totals.converted).toBe(3);
      expect(result.rates.conversionRatePct).toBe(30);
      expect(result.rates.viewRatePct).toBe(60); // 6 viewed / 10 provisioned
    });

    it('sums revenue using Prisma Decimal.toNumber()', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(5);
      prisma.prospectInstitution.aggregate
        .mockResolvedValueOnce({
          _sum: { demoConvertedAmountUsd: { toNumber: () => 12450.5 } },
        })
        .mockResolvedValueOnce({
          _sum: { demoConvertedAmountUsd: { toNumber: () => 2500 } },
        });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics(now);

      expect(result.revenue.allTimeUsd).toBe(12450.5);
      expect(result.revenue.thisMonthUsd).toBe(2500);
    });

    it('tolerates plain number revenue (not a Decimal instance)', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(1);
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: 499 }, // plain number
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics(now);

      expect(result.revenue.allTimeUsd).toBe(499);
    });

    it('computes avgDaysToConvert as arithmetic mean across converted rows', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(2);
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: null },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([
        {
          // 5 days exactly
          demoProvisionedAt: new Date('2026-04-01T00:00:00Z'),
          demoConvertedAt: new Date('2026-04-06T00:00:00Z'),
        },
        {
          // 10 days exactly
          demoProvisionedAt: new Date('2026-04-01T00:00:00Z'),
          demoConvertedAt: new Date('2026-04-11T00:00:00Z'),
        },
      ]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics(now);

      expect(result.velocity.avgDaysToConvert).toBe(7.5);
    });

    it('avgDaysToConvert is null when no conversions exist', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(0);
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: null },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const result = await service.getAnalytics(now);

      expect(result.velocity.avgDaysToConvert).toBeNull();
    });

    it('surfaces the top 5 converting snapshots sorted by revenue desc', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(5);
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: null },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([
        {
          publicDataIdentifier: 'caguas',
          publicDataSource: 'cossec',
          _count: { _all: 3 },
          _sum: { demoConvertedAmountUsd: { toNumber: () => 17964 } },
        },
        {
          publicDataIdentifier: 'acacia',
          publicDataSource: 'cossec',
          _count: { _all: 2 },
          _sum: { demoConvertedAmountUsd: { toNumber: () => 5988 } },
        },
      ]);

      const result = await service.getAnalytics(now);

      expect(result.topConvertingSnapshots).toHaveLength(2);
      expect(result.topConvertingSnapshots[0]).toEqual({
        identifier: 'caguas',
        source: 'cossec',
        converted: 3,
        revenueUsd: 17964,
      });
      expect(prisma.prospectInstitution.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { _sum: { demoConvertedAmountUsd: 'desc' } },
          take: 5,
        }),
      );
    });

    it('active count excludes converted seats (they graduated from the funnel)', async () => {
      prisma.prospectInstitution.count.mockResolvedValue(0);
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: null },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      await service.getAnalytics(now);

      // The active count query must include `demoConvertedAt: null`
      const calls = prisma.prospectInstitution.count.mock.calls;
      const activeCall = calls.find(
        (c: any[]) =>
          c[0]?.where?.demoExpiresAt && 'gte' in c[0].where.demoExpiresAt,
      );
      expect(activeCall).toBeDefined();
      expect(activeCall[0].where.demoConvertedAt).toBeNull();
    });

    it('runs all aggregate queries in parallel (Promise.all)', async () => {
      // Verify the 12 counts/aggregates are started before any resolves
      let resolveCounter = 0;
      let startCounter = 0;

      prisma.prospectInstitution.count.mockImplementation(() => {
        startCounter++;
        return new Promise((res) => {
          // Simulate async — all calls should be started before any resolves
          setTimeout(() => {
            resolveCounter++;
            res(0);
          }, 10);
        });
      });
      prisma.prospectInstitution.aggregate.mockResolvedValue({
        _sum: { demoConvertedAmountUsd: null },
      });
      prisma.prospectInstitution.findMany.mockResolvedValue([]);
      prisma.prospectInstitution.groupBy.mockResolvedValue([]);

      const promise = service.getAnalytics(now);
      // Immediately after kicking off getAnalytics, all count calls should
      // be in flight before the first microtask resolves them.
      expect(startCounter).toBeGreaterThanOrEqual(8);

      await promise;
      expect(resolveCounter).toBe(startCounter);
    });
  });
});
