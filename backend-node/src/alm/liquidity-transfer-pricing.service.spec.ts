import { LiquidityTransferPricingService } from './liquidity-transfer-pricing.service';

describe('LiquidityTransferPricingService', () => {
  let service: LiquidityTransferPricingService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      balanceSheetItem: { findMany: jest.fn() },
    };
    service = new LiquidityTransferPricingService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns data_unavailable when no balance sheet items exist', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const result = await service.computeLTP('inst_1');

    expect(result.status).toBe('data_unavailable');
    expect(result.segments).toEqual([]);
    expect(result.totalLiquidityCharge).toBeNull();
    expect(result.netLTPTransfer).toBeNull();
    expect(result.topConsumers).toEqual([]);
    expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
      true,
    );
  });

  it('charges assets and credits liabilities for liquidity', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'mortgage',
        category: 'asset',
        balance: 100,
        rate: 0.055,
        duration: 7,
      },
      {
        subcategory: 'demand_deposits',
        category: 'liability',
        balance: 80,
        rate: 0.005,
        duration: 0.1,
      },
    ]);

    const result = await service.computeLTP('inst_1');

    const asset = result.segments.find((s) => s.category === 'asset');
    const liability = result.segments.find((s) => s.category === 'liability');
    expect(asset).toBeDefined();
    expect(liability).toBeDefined();
    expect(asset!.liquidityCharge).toBeGreaterThan(0); // charged
    expect(liability!.liquidityCharge).toBeLessThan(0); // credited
    expect(asset!.isLiquidityConsumer).toBe(true);
    expect(liability!.isLiquidityConsumer).toBe(false);
  });

  it('after-LTP NIM reflects liquidity premium adjustment', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'loans',
        category: 'asset',
        balance: 200,
        rate: 0.06,
        duration: 5,
      },
    ]);

    const result = await service.computeLTP('inst_1');
    const seg = result.segments[0];
    // Asset after-LTP NIM should be lower than before (charged premium)
    expect(seg.afterLTP_NIM).toBeLessThan(seg.beforeLTP_NIM);
  });

  it('includes internal funding curve with all 6 tenor buckets', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);
    const result = await service.computeLTP('inst_1');

    expect(result.internalFundingCurve).toHaveLength(6);
    expect(result.internalFundingCurve[0].bucket).toBe('0-3M');
    expect(result.internalFundingCurve[5].bucket).toBe('>10Y');
  });

  it('net LTP transfer equals charge minus credit', async () => {
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      {
        subcategory: 'loans',
        category: 'asset',
        balance: 100,
        rate: 0.06,
        duration: 3,
      },
      {
        subcategory: 'deposits',
        category: 'liability',
        balance: 90,
        rate: 0.02,
        duration: 0.5,
      },
    ]);

    const result = await service.computeLTP('inst_1');
    expect(result.netLTPTransfer).toBeCloseTo(
      result.totalLiquidityCharge! - result.totalLiquidityCredit!,
      2,
    );
  });
});
