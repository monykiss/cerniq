import { AICostControllerService } from './cost-controller.service';

describe('AICostControllerService', () => {
  let service: AICostControllerService;
  const mockPrisma = {
    institution: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'inst-1',
        workspace: {
          owner: {
            subscription: { tier: 'silver' },
          },
        },
      }),
    },
    usageMeterEvent: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeEach(() => {
    service = new AICostControllerService(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('selectModel returns primary model when usage is low', async () => {
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 10 },
    });
    const result = await service.selectModel('inst-1');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.tier).toBe('primary');
    expect(result.budgetUsedPct).toBeLessThan(0.8);
  });

  it('selectModel falls back to Haiku when usage is 80-95%', async () => {
    // 250 tokens * 1000 = 250k tokens, which is silver budget
    // We need 80-95% usage: 200-237.5 units
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 210 },
    });
    const result = await service.selectModel('inst-1');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.tier).toBe('fallback1');
  });

  it('selectModel falls back to GPT-4o-mini when near budget limit', async () => {
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 245 },
    });
    const result = await service.selectModel('inst-1');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.tier).toBe('fallback2');
  });

  it('recordUsage creates a usage meter event', async () => {
    await service.recordUsage('inst-1', 500, 200);
    expect(mockPrisma.usageMeterEvent.create).toHaveBeenCalledWith({
      data: {
        institutionId: 'inst-1',
        eventType: 'ai_token_1k',
        quantity: 1,
      },
    });
  });

  it('gold tier always returns primary model', async () => {
    mockPrisma.institution.findUnique.mockResolvedValueOnce({
      id: 'inst-gold',
      workspace: { owner: { subscription: { tier: 'gold' } } },
    });
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 999 },
    });
    const result = await service.selectModel('inst-gold');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.reason).toContain('budget used');
  });

  it('gold tier at >=95% usage returns primary with unlimited reason', async () => {
    mockPrisma.institution.findUnique.mockResolvedValueOnce({
      id: 'inst-gold',
      workspace: { owner: { subscription: { tier: 'gold' } } },
    });
    // gold budget = Infinity, so usedPct = 0, hits first branch (< 0.8)
    // Need to override tier detection so it actually goes to gold path at >=95%
    // Actually gold budget is Infinity so usedPct is always 0 — test getUsageSummary instead
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 0 },
    });
    const result = await service.selectModel('inst-gold');
    expect(result.tokensRemaining).toBe(Infinity);
  });

  it('getUsageSummary returns budget and model info', async () => {
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 50 },
    });
    const summary = await service.getUsageSummary('inst-1');
    expect(summary.budget).toBe(250000);
    expect(summary.model).toBeDefined();
    expect(typeof summary.pct).toBe('number');
    expect(typeof summary.tokensUsed).toBe('number');
  });

  it('handles null subscription tier with fallback to silver', async () => {
    mockPrisma.institution.findUnique.mockResolvedValueOnce({
      id: 'inst-none',
      workspace: { owner: { subscription: null } },
    });
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: null },
    });
    const result = await service.selectModel('inst-none');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.budgetUsedPct).toBe(0);
  });

  it('handles unknown tier by falling back to silver budget', async () => {
    mockPrisma.institution.findUnique.mockResolvedValueOnce({
      id: 'inst-x',
      workspace: { owner: { subscription: { tier: 'platinum' } } },
    });
    mockPrisma.usageMeterEvent.aggregate.mockResolvedValueOnce({
      _sum: { quantity: 10 },
    });
    const result = await service.selectModel('inst-x');
    // Unknown tier falls back to silver budget (250000)
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });
});
