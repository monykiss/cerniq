import { DepositBetaService } from './deposit-beta.service';

describe('DepositBetaService', () => {
  let service: DepositBetaService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    service = new DepositBetaService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getDepositBetas: heuristic defaults ───────────────────

  it('returns default betas for common deposit subcategories', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'demand_deposits', balance: 100, depositBeta: null },
      { subcategory: 'savings', balance: 80, depositBeta: null },
      { subcategory: 'time_deposits', balance: 60, depositBeta: null },
    ]);

    const betas = await service.getDepositBetas('inst_123');

    expect(betas).toHaveLength(3);
    const demand = betas.find((b) => b.subcategory === 'demand_deposits');
    expect(demand).toBeDefined();
    expect(demand!.currentBeta).toBe(0.1);
    expect(demand!.source).toBe('heuristic');

    const savings = betas.find((b) => b.subcategory === 'savings');
    expect(savings!.currentBeta).toBe(0.4);

    const time = betas.find((b) => b.subcategory === 'time_deposits');
    expect(time!.currentBeta).toBe(0.8);
  });

  // ── Manual override respected ─────────────────────────────

  it('uses manual beta when depositBeta is set on the item', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'savings', balance: 100, depositBeta: 0.55 },
    ]);

    const betas = await service.getDepositBetas('inst_123');

    expect(betas[0].currentBeta).toBe(0.55);
    expect(betas[0].source).toBe('manual');
    // Suggested beta should still be the heuristic
    expect(betas[0].suggestedBeta).toBe(0.4);
  });

  // ── updateDepositBetas: clamps 0-1 ────────────────────────

  it('clamps beta values to [0, 1] range on update', async () => {
    await service.updateDepositBetas('inst_123', [
      { subcategory: 'savings', beta: 1.5 },
    ]);

    expect(prisma.balanceSheetItem.updateMany).toHaveBeenCalledWith({
      where: {
        institutionId: 'inst_123',
        subcategory: 'savings',
        category: 'liability',
      },
      data: { depositBeta: 1 }, // clamped from 1.5 to 1.0
    });
  });

  // ── calculateBetaImpact: NII sensitivity ──────────────────

  it('computes NII increase for +100bps shock with low-beta deposits', async () => {
    prisma.balanceSheetItem.findMany
      .mockResolvedValueOnce([
        // First call: all items for calculateBetaImpact
        {
          category: 'asset',
          subcategory: 'loans',
          balance: 100,
          rate: 0.06,
          rateType: 'fixed',
          depositBeta: null,
        },
        {
          category: 'liability',
          subcategory: 'demand_deposits',
          balance: 80,
          rate: 0.005,
          rateType: 'variable',
          depositBeta: null,
        },
      ])
      .mockResolvedValueOnce([
        // Second call: liabilities for getDepositBetas
        {
          subcategory: 'demand_deposits',
          balance: 80,
          depositBeta: null,
        },
      ]);

    const impact = await service.calculateBetaImpact('inst_123', 100);

    // Asset income goes up by full 100bps (beta=1.0): 100 * 0.01 = 1.0
    // Liability cost goes up by beta*100bps (beta=0.1): 80 * 0.001 = 0.08
    // Net delta = 1.0 - 0.08 = 0.92 (approximately)
    expect(impact.niiDelta).toBeGreaterThan(0);
    expect(impact.niiDeltaPct).toBeGreaterThan(0);
    expect(impact.baseNII).toBeGreaterThan(0);
    expect(impact.adjustedNII).toBeGreaterThan(impact.baseNII);
  });

  // ── calibrateBeta: OLS regression ─────────────────────────

  it('calibrates beta via OLS to approximately 0.5 for matching changes', () => {
    // Market rates go up by 100bps each period; deposit rates go up by 50bps each
    const marketRates = [0.02, 0.03, 0.04, 0.05, 0.06];
    const depositRates = [0.01, 0.015, 0.02, 0.025, 0.03];

    const beta = service.calibrateBeta(marketRates, depositRates);

    expect(beta).toBeCloseTo(0.5, 2);
  });

  it('returns 0.5 default when insufficient data for calibration', () => {
    const beta = service.calibrateBeta([0.02, 0.03], [0.01, 0.015]);
    expect(beta).toBe(0.5);
  });

  it('returns 0.5 when arrays are different lengths', () => {
    const beta = service.calibrateBeta([0.02, 0.03, 0.04], [0.01, 0.015]);
    expect(beta).toBe(0.5);
  });

  it('clamps calibrated beta to [0, 1]', () => {
    // If deposit rates move more than market rates, beta > 1, should clamp
    const marketRates = [0.01, 0.02, 0.03, 0.04, 0.05];
    const depositRates = [0.01, 0.03, 0.05, 0.07, 0.09]; // 2x market
    const beta = service.calibrateBeta(marketRates, depositRates);
    expect(beta).toBeLessThanOrEqual(1);
  });

  it('returns 0.5 when sumXX is 0 (no market rate changes)', () => {
    const marketRates = [0.03, 0.03, 0.03, 0.03];
    const depositRates = [0.01, 0.02, 0.03, 0.04];
    const beta = service.calibrateBeta(marketRates, depositRates);
    expect(beta).toBe(0.5);
  });

  it('calibrates beta close to 1 for matching changes', () => {
    const marketRates = [0.02, 0.03, 0.04, 0.05, 0.06];
    const depositRates = [0.01, 0.02, 0.03, 0.04, 0.05];
    const beta = service.calibrateBeta(marketRates, depositRates);
    expect(beta).toBeCloseTo(1.0, 2);
  });

  // ── getDefaultBeta: heuristic matching ──────────────────────

  it('returns correct beta for checking subcategory', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'checking', balance: 100, depositBeta: null },
    ]);
    const betas = await service.getDepositBetas('inst_123');
    expect(betas[0].currentBeta).toBe(0.1);
  });

  it('returns correct beta for ahorro (savings) subcategory', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'ahorro', balance: 100, depositBeta: null },
    ]);
    const betas = await service.getDepositBetas('inst_123');
    expect(betas[0].currentBeta).toBe(0.4);
  });

  it('returns correct beta for CD subcategory', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'cd_12month', balance: 100, depositBeta: null },
    ]);
    const betas = await service.getDepositBetas('inst_123');
    expect(betas[0].currentBeta).toBe(0.8);
  });

  it('returns correct beta for plazo subcategory', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'plazo_fijo', balance: 100, depositBeta: null },
    ]);
    const betas = await service.getDepositBetas('inst_123');
    expect(betas[0].currentBeta).toBe(0.8);
  });

  it('returns default 0.6 for unknown subcategory', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'special_product', balance: 100, depositBeta: null },
    ]);
    const betas = await service.getDepositBetas('inst_123');
    expect(betas[0].currentBeta).toBe(0.6);
  });

  it('aggregates same subcategory items', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { subcategory: 'savings', balance: 100, depositBeta: null },
      { subcategory: 'savings', balance: 50, depositBeta: 0.55 },
    ]);
    const betas = await service.getDepositBetas('inst_123');
    // Should have one entry for savings with beta from second item
    expect(betas).toHaveLength(1);
    expect(betas[0].currentBeta).toBe(0.55);
    expect(betas[0].source).toBe('manual');
  });

  // ── updateDepositBetas ─────────────────────────────────────

  it('clamps negative beta to 0', async () => {
    await service.updateDepositBetas('inst_123', [
      { subcategory: 'savings', beta: -0.5 },
    ]);
    expect(prisma.balanceSheetItem.updateMany).toHaveBeenCalledWith({
      where: {
        institutionId: 'inst_123',
        subcategory: 'savings',
        category: 'liability',
      },
      data: { depositBeta: 0 },
    });
  });

  it('updates multiple subcategories', async () => {
    await service.updateDepositBetas('inst_123', [
      { subcategory: 'savings', beta: 0.5 },
      { subcategory: 'demand_deposits', beta: 0.15 },
    ]);
    expect(prisma.balanceSheetItem.updateMany).toHaveBeenCalledTimes(2);
  });

  // ── calculateBetaImpact with zero baseNII ──────────────────

  it('returns 0 niiDeltaPct when baseNII is 0', async () => {
    prisma.balanceSheetItem.findMany
      .mockResolvedValueOnce([
        {
          category: 'asset',
          subcategory: 'loans',
          balance: 0,
          rate: 0,
          depositBeta: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const impact = await service.calculateBetaImpact('inst_zero', 100);
    expect(impact.niiDeltaPct).toBe(0);
  });
});
