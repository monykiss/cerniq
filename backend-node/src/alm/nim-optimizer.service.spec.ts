import { NIMOptimizerService } from './nim-optimizer.service';

describe('NIMOptimizerService', () => {
  let service: NIMOptimizerService;

  describe('with empty balance sheet (D1 data_unavailable)', () => {
    beforeEach(() => {
      const mockPrisma = {
        balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;
      service = new NIMOptimizerService(mockPrisma);
    });

    it('returns data_unavailable with a CRITICAL gap (no fabricated NIM)', async () => {
      const result = await service.optimize('inst-1');
      expect(result.status).toBe('data_unavailable');
      expect(result.currentNIM).toBeNull();
      expect(result.projectedNIM).toBeNull();
      expect(result.recommendations).toEqual([]);
      expect(result.gaps?.some((g) => g.reason === 'EMPTY_BALANCE_SHEET')).toBe(
        true,
      );
    });
  });

  describe('with balance sheet items', () => {
    beforeEach(() => {
      const mockPrisma = {
        balanceSheetItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              category: 'asset',
              subcategory: 'consumer_loans',
              balance: 100,
              rate: 0.06,
            },
            {
              category: 'liability',
              subcategory: 'time_deposits',
              balance: 80,
              rate: 0.05,
            },
          ]),
        },
      } as any;
      service = new NIMOptimizerService(mockPrisma);
    });

    it('should generate recommendations for mispriced items', async () => {
      const result = await service.optimize('inst-1');
      expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
      expect(result.currentNIM).toBeGreaterThan(0);
    });

    it('projected NIM should be >= current NIM', async () => {
      const result = await service.optimize('inst-1');
      expect(result.projectedNIM).toBeGreaterThanOrEqual(result.currentNIM!);
    });

    it('totalNIIGain should match sum of recommendation impacts', async () => {
      const result = await service.optimize('inst-1');
      const sumImpacts = result.recommendations.reduce(
        (s, r) => s + r.niiImpact,
        0,
      );
      expect(result.totalNIIGain).toBeCloseTo(sumImpacts, 1);
    });
  });
});
