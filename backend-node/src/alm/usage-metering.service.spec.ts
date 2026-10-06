import { UsageMeteringService } from './usage-metering.service';

describe('UsageMeteringService', () => {
  let service: UsageMeteringService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      usageMeterEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      institution: {
        findUnique: jest.fn().mockResolvedValue({
          workspace: {
            owner: {
              subscription: { tier: 'silver' },
            },
          },
        }),
      },
    };
    service = new UsageMeteringService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('records usage event via prisma', async () => {
    await service.recordEvent('inst_1', 'compute_job', 1, { model: 'var' });
    expect(prisma.usageMeterEvent.create).toHaveBeenCalledWith({
      data: {
        institutionId: 'inst_1',
        eventType: 'compute_job',
        quantity: 1,
        metadata: { model: 'var' },
      },
    });
  });

  it('returns usage summary with zero usage when no events', async () => {
    const result = await service.getUsageSummary('inst_1', '2026-03');

    expect(result.institutionId).toBe('inst_1');
    expect(result.period).toBe('2026-03');
    expect(result.tier).toBe('silver');
    expect(result.totalOverageCost).toBe(0);
    expect(result.usage.compute_job).toEqual({
      used: 0,
      included: 100,
      overage: 0,
      overageCost: 0,
    });
  });

  it('computes overage cost when usage exceeds tier limit', async () => {
    prisma.usageMeterEvent.groupBy.mockResolvedValue([
      { eventType: 'compute_job', _sum: { quantity: 150 } },
      { eventType: 'api_call', _sum: { quantity: 12000 } },
    ]);

    const result = await service.getUsageSummary('inst_1', '2026-03');

    // Silver tier: compute_job limit=100, api_call limit=10000
    expect(result.usage.compute_job.overage).toBe(50);
    expect(result.usage.compute_job.overageCost).toBe(25); // 50 * $0.50
    expect(result.usage.api_call.overage).toBe(2000);
    expect(result.usage.api_call.overageCost).toBe(10); // 2000 * $0.005
    expect(result.totalOverageCost).toBe(35);
  });

  it('defaults to silver tier when subscription is missing', async () => {
    prisma.institution.findUnique.mockResolvedValue(null);

    const result = await service.getUsageSummary('inst_1');
    expect(result.tier).toBe('silver');
    expect(result.usage.compute_job.included).toBe(100);
  });

  it('uses current month when no month parameter provided', async () => {
    const result = await service.getUsageSummary('inst_1');
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(result.period).toBe(expected);
  });
});
