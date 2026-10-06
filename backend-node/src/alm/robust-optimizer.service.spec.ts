import { RobustOptimizerService } from './robust-optimizer.service';

describe('RobustOptimizerService', () => {
  let service: RobustOptimizerService;
  const mockPrisma = {
    balanceSheetItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          balance: 100,
          rate: 0.07,
        },
        {
          category: 'asset',
          subcategory: 'commercial_re',
          balance: 80,
          rate: 0.055,
        },
        {
          category: 'liability',
          subcategory: 'savings',
          balance: 90,
          rate: 0.015,
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          balance: 70,
          rate: 0.04,
        },
      ]),
    },
  } as any;
  const mockStressV2 = {
    getPresetScenarios: jest.fn().mockReturnValue([
      {
        name: 'Severe Adverse',
        ratePathBps: [75, 75, 100, 50, 0, -25, -50, -50, -25],
        gdpDelta: -0.035,
      },
      {
        name: 'Hurricane',
        ratePathBps: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        gdpDelta: -0.08,
      },
      {
        name: 'Stagflation',
        ratePathBps: [100, 100, 75, 50, 25, 25, 0, 0, -25],
        gdpDelta: -0.015,
      },
    ]),
  } as any;

  beforeEach(() => {
    service = new RobustOptimizerService(mockPrisma, mockStressV2);
  });

  it('should use minimax-regret strategy', async () => {
    const result = await service.optimize('inst-1');
    expect(result.strategy).toBe('minimax-regret');
  });

  it('scenarioPerformance should cover all 3 DFAST scenarios', async () => {
    const result = await service.optimize('inst-1');
    expect(result.scenarioPerformance).toHaveLength(3);
  });

  it('maxRegret should be non-negative', async () => {
    const result = await service.optimize('inst-1');
    expect(result.maxRegret).toBeGreaterThanOrEqual(0);
  });

  it('narratives should be present in both languages', async () => {
    const result = await service.optimize('inst-1');
    expect(result.narrativeEn).toContain('minimax-regret');
    expect(result.narrativeEs).toContain('minimax-regret');
  });

  it('conservative mode should move less than aggressive', async () => {
    const conservative = await service.optimize('inst-1', 'conservative');
    const aggressive = await service.optimize('inst-1', 'aggressive');
    const totalMoveC = conservative.bestAllocation.reduce(
      (s, a) => s + Math.abs(a.suggestedDelta),
      0,
    );
    const totalMoveA = aggressive.bestAllocation.reduce(
      (s, a) => s + Math.abs(a.suggestedDelta),
      0,
    );
    expect(totalMoveC).toBeLessThanOrEqual(totalMoveA + 0.01);
  });
});
