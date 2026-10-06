import { TrendAnalysisService } from './trend-analysis.service';

describe('TrendAnalysisService', () => {
  let service: TrendAnalysisService;
  let prisma: any;

  const makeRun = (id: string, createdAt: Date, resultSummary: unknown) => ({
    id,
    createdAt,
    resultSummary,
  });

  beforeEach(() => {
    prisma = {
      analysisRun: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new TrendAnalysisService(prisma);
  });

  describe('getHistoricalTrend', () => {
    it('should return empty periods when no runs exist', async () => {
      const result = await service.getHistoricalTrend('inst_001');
      expect(result.institutionId).toBe('inst_001');
      expect(result.periodCount).toBe(0);
      expect(result.periods).toEqual([]);
    });

    it('should extract riskScore from resultSummary', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-01-15'), {
          summary: { riskScore: 72 },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods).toHaveLength(1);
      expect(result.periods[0].riskScore).toBe(72);
    });

    it('should extract durationGap from nested summary', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-02-01'), {
          summary: { durationGap: { durationGap: 1.4 } },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].durationGap).toBe(1.4);
    });

    it('should extract lcr from liquidity', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-02-01'), {
          summary: { liquidity: { lcr: 145.5 } },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].lcr).toBe(145.5);
    });

    it('should extract niiSensitivity as worst-case scenario impact', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-03-01'), {
          summary: {
            niiSensitivity: {
              scenarios: [
                { niImpactPct: -5 },
                { niImpactPct: 12 },
                { niImpactPct: -8 },
              ],
            },
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].niiSensitivity).toBe(12);
    });

    it('should extract capitalRatio from fullAnalysis summary', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-03-01'), {
          summary: {
            fullAnalysis: {
              summary: { equity: 15, totalAssets: 100 },
            },
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].capitalRatio).toBe(15);
    });

    it('should return null for metrics when resultSummary is null', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-01-01'), null),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      const p = result.periods[0];
      expect(p.riskScore).toBeNull();
      expect(p.capitalRatio).toBeNull();
      expect(p.lcr).toBeNull();
      expect(p.durationGap).toBeNull();
      expect(p.niiSensitivity).toBeNull();
      expect(p.eveSensitivity).toBeNull();
    });

    it('should return periods in chronological order (oldest first)', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_new', new Date('2026-03-01'), {
          summary: { riskScore: 80 },
        }),
        makeRun('run_old', new Date('2026-01-01'), {
          summary: { riskScore: 60 },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].runId).toBe('run_old');
      expect(result.periods[1].runId).toBe('run_new');
    });

    it('should filter metrics by metricKeys when provided', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-02-01'), {
          summary: {
            riskScore: 70,
            durationGap: { durationGap: 1.2 },
            liquidity: { lcr: 130 },
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001', [
        'riskScore',
      ]);
      const p = result.periods[0];
      expect(p.riskScore).toBe(70);
      expect(p.lcr).toBeNull();
      expect(p.durationGap).toBeNull();
    });

    it('should handle eveSensitivity from direct array', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-02-01'), {
          summary: {
            eveSensitivity: [
              { changePct: -2 },
              { changePct: 5 },
              { changePct: -7 },
            ],
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].eveSensitivity).toBe(7);
    });

    // Coverage: line 125 — summary is not an object
    it('returns null metrics when summary is not an object', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-01-01'), {
          summary: 'not-an-object',
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].riskScore).toBeNull();
    });

    // Coverage: line 160 — niiSensitivity with empty scenarios array
    it('returns null niiSensitivity when scenarios array is empty', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-01-01'), {
          summary: {
            niiSensitivity: { scenarios: [] },
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].niiSensitivity).toBeNull();
    });

    // Coverage: lines 186-194 — eveSensitivity from fullAnalysis.eve.scenarios
    it('extracts eveSensitivity from fullAnalysis.eve.scenarios', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-02-01'), {
          summary: {
            fullAnalysis: {
              eve: {
                scenarios: [
                  { changePct: -3 },
                  { changePct: 8 },
                  { changePct: -10 },
                ],
              },
            },
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].eveSensitivity).toBe(10);
    });

    // Coverage: eve missing from fullAnalysis
    it('returns null eveSensitivity when fullAnalysis has no eve', async () => {
      prisma.analysisRun.findMany.mockResolvedValue([
        makeRun('run_1', new Date('2026-02-01'), {
          summary: {
            fullAnalysis: { summary: {} },
          },
        }),
      ]);

      const result = await service.getHistoricalTrend('inst_001');
      expect(result.periods[0].eveSensitivity).toBeNull();
    });
  });
});
