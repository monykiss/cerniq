import { Prisma } from '@prisma/client';
import { CapitalOptimizerService } from './capital-optimizer.service';

describe('CapitalOptimizerService', () => {
  let svc: CapitalOptimizerService;

  beforeEach(() => {
    const mockPrisma = {
      balanceSheetItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    svc = new CapitalOptimizerService(mockPrisma);
  });

  // ── D1: empty balance sheet → data_unavailable, never demo ──
  // (Real reallocation math is covered by the "with real balance sheet data"
  // block below; the former top-level tests only asserted static demo values.)
  it('returns data_unavailable with a CRITICAL gap when no items exist', async () => {
    const result = await svc.optimize('inst-1', 'conservative');
    expect(result.status).toBe('data_unavailable');
    expect(result.deltaAllocations).toEqual([]);
    expect(result.projectedNIIGain).toBeNull();
    expect(result.constraintSlacks).toEqual([]);
    expect(result.aggressivenessLevel).toBe('conservative');
    expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
      true,
    );
  });

  // ── With real balance sheet items ──────────────────────────
  describe('with real balance sheet data', () => {
    let svcReal: CapitalOptimizerService;

    beforeEach(() => {
      const items = [
        {
          category: 'asset',
          subcategory: 'cash_equivalents',
          balance: 30,
          rate: 0.02,
        },
        {
          category: 'asset',
          subcategory: 'investment_securities',
          balance: 50,
          rate: 0.042,
        },
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          balance: 80,
          rate: 0.065,
        },
        {
          category: 'asset',
          subcategory: 'commercial_loans',
          balance: 60,
          rate: 0.075,
        },
        {
          category: 'liability',
          subcategory: 'savings_deposits',
          balance: 120,
          rate: 0.015,
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          balance: 60,
          rate: 0.035,
        },
      ];
      const mockPrisma = {
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue(items),
        },
      } as any;
      svcReal = new CapitalOptimizerService(mockPrisma);
    });

    it('suggests moving from low-yield to high-yield assets', async () => {
      const result = await svcReal.optimize('inst-1');
      expect(result.deltaAllocations.length).toBeGreaterThan(0);
      // First allocation should be a reduction (negative delta)
      const reduction = result.deltaAllocations.find((d) => d.deltaUSD < 0);
      const increase = result.deltaAllocations.find((d) => d.deltaUSD > 0);
      expect(reduction).toBeDefined();
      expect(increase).toBeDefined();
    });

    it('projected NII gain is positive when rate spread exists', async () => {
      const result = await svcReal.optimize('inst-1');
      expect(result.projectedNIIGain).toBeGreaterThan(0);
    });

    it('conservative mode moves less than aggressive mode', async () => {
      const conservative = await svcReal.optimize('inst-1', 'conservative');
      const aggressive = await svcReal.optimize('inst-1', 'aggressive');

      const consMove = conservative.deltaAllocations
        .filter((d) => d.deltaUSD > 0)
        .reduce((s, d) => s + d.deltaUSD, 0);
      const aggMove = aggressive.deltaAllocations
        .filter((d) => d.deltaUSD > 0)
        .reduce((s, d) => s + d.deltaUSD, 0);

      expect(aggMove).toBeGreaterThanOrEqual(consMove);
    });

    it('does not breach concentration limits (30% max)', async () => {
      const result = await svcReal.optimize('inst-1');
      const totalAssets = 30 + 50 + 80 + 60;
      for (const delta of result.deltaAllocations) {
        if (delta.deltaUSD > 0) {
          expect(delta.suggestedBalance / totalAssets).toBeLessThanOrEqual(
            0.31,
          );
        }
      }
    });

    it('constraint analysis includes NWR check', async () => {
      const result = await svcReal.optimize('inst-1');
      const nwrConstraint = result.constraintSlacks.find((c) =>
        c.constraint.includes('NWR'),
      );
      expect(nwrConstraint).toBeDefined();
    });

    it('narrative describes reallocation for profitable moves', async () => {
      const result = await svcReal.optimize('inst-1');
      if (result.projectedNIIGain! > 0) {
        expect(result.narrative).toContain('Shift');
        expect(result.narrative).toContain('NII');
      }
    });

    it('delta allocations sum to zero (balanced reallocation)', async () => {
      const result = await svcReal.optimize('inst-1');
      const totalDelta = result.deltaAllocations.reduce(
        (s, d) => s + d.deltaUSD,
        0,
      );
      expect(totalDelta).toBeCloseTo(0, 1);
    });
  });

  // ── Prisma Decimal coercion (the production bug) ────────────
  it('coerces Prisma Decimal balances — NWR is summed, not string-concatenated', async () => {
    const D = (n: number) => new Prisma.Decimal(n);
    const items = [
      {
        category: 'asset',
        subcategory: 'cash_equivalents',
        balance: D(30),
        rate: D(0.02),
      },
      {
        category: 'asset',
        subcategory: 'investment_securities',
        balance: D(50),
        rate: D(0.042),
      },
      {
        category: 'asset',
        subcategory: 'consumer_loans',
        balance: D(80),
        rate: D(0.065),
      },
      {
        category: 'asset',
        subcategory: 'commercial_loans',
        balance: D(60),
        rate: D(0.075),
      },
      {
        category: 'liability',
        subcategory: 'savings_deposits',
        balance: D(120),
        rate: D(0.015),
      },
      {
        category: 'liability',
        subcategory: 'time_deposits',
        balance: D(60),
        rate: D(0.035),
      },
    ];
    const svcDec = new CapitalOptimizerService({
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
    } as any);
    const result = await svcDec.optimize('inst-dec');
    // equity 40 / totalAssets 220 = 18.18%. With the string-concat bug,
    // totalAssets would be "030508060" → NWR ≈ 100%. 18.2 proves summation.
    const nwr = result.constraintSlacks.find((c) =>
      c.constraint.includes('NWR'),
    );
    expect(nwr?.currentValue).toBeCloseTo(18.2, 1);
    expect(result.projectedNIIGain).toBeGreaterThan(0);
  });
});
