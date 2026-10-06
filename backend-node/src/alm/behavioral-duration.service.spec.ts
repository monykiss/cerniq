import { BehavioralDurationService } from './behavioral-duration.service';

describe('BehavioralDurationService', () => {
  let service: BehavioralDurationService;

  // Mock PrismaService
  const mockPrisma = {
    balanceSheetItem: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    service = new BehavioralDurationService(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Hutchison-Pennacchi Duration Formula ───────────────────

  it('should compute behavioral duration using Hutchison-Pennacchi formula for demand deposits', async () => {
    // D_NMD = beta / (kappa + phi) with kappa=0.15
    // demand_deposits: beta=0.1, phi=0.08 => D = 0.1 / (0.15+0.08) = 0.4348
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'demand_deposits',
        balance: 100_000_000,
        depositBeta: null,
      },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    expect(result.deposits).toHaveLength(1);
    const dep = result.deposits[0];
    expect(dep.subcategory).toBe('demand_deposits');
    expect(dep.contractualDuration).toBe(0);
    // Hutchison core: 0.1 / (0.15 + 0.08) = 0.4348, with convexity adj
    expect(dep.behavioralDuration).toBeGreaterThan(0.25);
    expect(dep.behavioralDuration).toBeLessThan(1.5);
    expect(dep.beta).toBeCloseTo(0.1, 2);
    expect(dep.runoffRate).toBeCloseTo(0.08, 2);
  });

  it('should compute behavioral duration for money market deposits with higher beta', async () => {
    // money_market: beta=0.41, phi=0.15 => D = 0.41 / (0.15+0.15) = 1.3667
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'money_market', balance: 50_000_000, depositBeta: null },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    const dep = result.deposits[0];
    expect(dep.subcategory).toBe('money_market');
    // Higher beta => longer behavioral duration
    expect(dep.behavioralDuration).toBeGreaterThan(1.0);
    expect(dep.beta).toBeCloseTo(0.41, 2);
    expect(dep.runoffRate).toBeCloseTo(0.15, 2);
  });

  it('should use custom depositBeta from balance sheet item when available', async () => {
    const customBeta = 0.25;
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'demand_deposits',
        balance: 100_000_000,
        depositBeta: customBeta,
      },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    expect(result.deposits[0].beta).toBeCloseTo(customBeta, 2);
  });

  it('should compute portfolio weighted behavioral duration across multiple deposit types', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'demand_deposits',
        balance: 60_000_000,
        depositBeta: null,
      },
      { subcategory: 'savings', balance: 40_000_000, depositBeta: null },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    expect(result.deposits).toHaveLength(2);
    // Portfolio behavioral duration should be a balance-weighted average
    expect(result.portfolioBehavioralDuration).toBeGreaterThan(0);
    // Contractual is always 0 for NMDs
    expect(result.portfolioContractualDuration).toBe(0);
    // Duration correction = behavioral - contractual (positive)
    expect(result.durationCorrection).toBeCloseTo(
      result.portfolioBehavioralDuration,
      2,
    );
  });

  it('should compute EVE impact correction proportional to behavioral duration and balance', async () => {
    const balance = 100_000_000;
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'savings', balance, depositBeta: null },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    // EVE correction should be positive (behavioral duration > contractual)
    expect(result.eveImpactCorrection).toBeGreaterThan(0);
    // Rough magnitude check: correction ~ behavioralDuration * balance * 0.02
    // For savings: beta=0.18, phi=0.10, D ~ 0.18/0.25 ~ 0.72yr
    // EVE ~ 0.72 * 100M * 0.02 ~ $1.44M
    expect(result.eveImpactCorrection).toBeGreaterThan(100_000);
    expect(result.eveImpactCorrection).toBeLessThan(50_000_000);
  });

  it('should skip non-NMD items like time deposits or borrowings', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'demand_deposits',
        balance: 50_000_000,
        depositBeta: null,
      },
      { subcategory: 'time_deposits', balance: 30_000_000, depositBeta: null },
      { subcategory: 'borrowings', balance: 20_000_000, depositBeta: null },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    // Only demand_deposits should be processed
    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0].subcategory).toBe('demand_deposits');
  });

  it('should return zero durations when no NMD items exist', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const result = await service.computeBehavioralDurations('inst-1');

    expect(result.deposits).toHaveLength(0);
    expect(result.portfolioContractualDuration).toBe(0);
    expect(result.portfolioBehavioralDuration).toBe(0);
    expect(result.durationCorrection).toBe(0);
    expect(result.eveImpactCorrection).toBe(0);
  });

  it('should clamp behavioral duration between 0.25 and 10 years', async () => {
    // Very high beta to push duration up
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'demand_deposits',
        balance: 100_000_000,
        depositBeta: 5.0,
      },
    ]);

    const result = await service.computeBehavioralDurations('inst-1');

    // D = 5.0 / (0.15+0.08) = 21.74, but clamped to 10
    expect(result.deposits[0].behavioralDuration).toBeLessThanOrEqual(10);
    expect(result.deposits[0].behavioralDuration).toBeGreaterThanOrEqual(0.25);
  });

  it('should include share_drafts in NMD processing', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'share_drafts', balance: 30_000_000, depositBeta: null },
    ]);
    const result = await service.computeBehavioralDurations('inst-1');
    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0].subcategory).toBe('share_drafts');
    expect(result.deposits[0].beta).toBeCloseTo(0.13, 2);
    expect(result.deposits[0].runoffRate).toBeCloseTo(0.09, 2);
  });

  it('should throw InternalServerErrorException on prisma failure', async () => {
    mockPrisma.balanceSheetItem.findMany.mockRejectedValue(
      new Error('DB error'),
    );
    await expect(service.computeBehavioralDurations('inst-1')).rejects.toThrow(
      'Computation failed',
    );
  });

  it('should generate both EN and ES narratives', async () => {
    mockPrisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'savings', balance: 50_000_000, depositBeta: null },
    ]);
    const result = await service.computeBehavioralDurations('inst-1');
    expect(result.narrativeEn).toContain('behavioral duration');
    expect(result.narrativeEs).toContain('duración conductual');
    expect(result.narrativeEn).toContain('years');
    expect(result.narrativeEs).toContain('años');
  });
});
