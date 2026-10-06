import { NotFoundException } from '@nestjs/common';
import { DataExportService } from './data-export.service';

describe('DataExportService', () => {
  let service: DataExportService;
  let prisma: any;

  const makeRun = (resultSummary: unknown) => ({
    id: 'run_1',
    createdAt: new Date('2026-03-15T12:00:00Z'),
    resultSummary,
    institution: {
      id: 'inst_001',
      name: 'Coop Test',
      reportingDate: new Date('2026-01-31T00:00:00Z'),
    },
  });

  beforeEach(() => {
    prisma = {
      analysisRun: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new DataExportService(prisma);
  });

  describe('exportMetrics - JSON format', () => {
    it('should throw NotFoundException when no completed run exists', async () => {
      await expect(service.exportMetrics('inst_999', 'json')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return ExportableMetrics object for JSON format', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(
        makeRun({
          summary: {
            riskScore: 65,
            durationGap: {
              durationGap: 1.5,
              riskProfile: 'asset-sensitive',
              assetDuration: 3.2,
              liabilityDuration: 1.7,
            },
            liquidity: { lcr: 130, status: 'compliant' },
            niiSensitivity: { baseNII: 2.3, riskRating: 'low' },
            fullAnalysis: {
              summary: { totalAssets: 100, totalLiabilities: 85, equity: 15 },
              eve: { baseEVE: 20 },
              bpv: { netBPV: 0.5 },
            },
          },
        }),
      );

      const result = await service.exportMetrics('inst_001', 'json');
      expect(typeof result).toBe('object');
      const metrics = result as any;
      expect(metrics.institutionId).toBe('inst_001');
      expect(metrics.institutionName).toBe('Coop Test');
      expect(metrics.riskScore).toBe(65);
      expect(metrics.durationGap).toBe(1.5);
      expect(metrics.durationGapRiskProfile).toBe('asset-sensitive');
      expect(metrics.assetDuration).toBe(3.2);
      expect(metrics.liabilityDuration).toBe(1.7);
      expect(metrics.lcr).toBe(130);
      expect(metrics.lcrStatus).toBe('compliant');
      expect(metrics.baseNII).toBe(2.3);
      expect(metrics.niiRiskRating).toBe('low');
      expect(metrics.totalAssets).toBe(100);
      expect(metrics.totalLiabilities).toBe(85);
      expect(metrics.equity).toBe(15);
      expect(metrics.capitalRatio).toBe(15);
      expect(metrics.baseEVE).toBe(20);
      expect(metrics.netBPV).toBe(0.5);
    });

    it('should return null for all metrics when resultSummary is null', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(makeRun(null));

      const result = await service.exportMetrics('inst_001', 'json');
      const metrics = result as any;
      expect(metrics.riskScore).toBeNull();
      expect(metrics.capitalRatio).toBeNull();
      expect(metrics.lcr).toBeNull();
      expect(metrics.durationGap).toBeNull();
    });

    it('should return null for all metrics when summary is missing', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(
        makeRun({ other: 'data' }),
      );

      const result = await service.exportMetrics('inst_001', 'json');
      const metrics = result as any;
      expect(metrics.riskScore).toBeNull();
    });
  });

  describe('exportMetrics - CSV format', () => {
    it('should return a CSV string with headers and values', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(
        makeRun({
          summary: {
            riskScore: 72,
            liquidity: { lcr: 145, status: 'compliant' },
          },
        }),
      );

      const result = await service.exportMetrics('inst_001', 'csv');
      expect(typeof result).toBe('string');
      const csv = result as string;
      const lines = csv.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);

      expect(lines[0]).toContain('institutionId');
      expect(lines[0]).toContain('riskScore');
      expect(lines[0]).toContain('lcr');
      expect(lines[1]).toContain('72');
      expect(lines[1]).toContain('145');
    });

    it('should properly escape CSV values with commas', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue({
        id: 'run_1',
        createdAt: new Date('2026-03-15T12:00:00Z'),
        resultSummary: { summary: { riskScore: 50 } },
        institution: {
          id: 'inst_001',
          name: 'Coop, Test "Inc"',
          reportingDate: new Date('2026-01-31'),
        },
      });

      const result = await service.exportMetrics('inst_001', 'csv');
      const csv = result as string;
      expect(csv).toContain('"Coop, Test ""Inc"""');
    });

    it('should output DATA_UNAVAILABLE for null values in CSV', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(makeRun(null));

      const result = await service.exportMetrics('inst_001', 'csv');
      const csv = result as string;
      const values = csv.split('\n')[1].split(',');
      const unavailableCount = values.filter(
        (v) => v === 'DATA_UNAVAILABLE',
      ).length;
      // All numeric/status fields should be DATA_UNAVAILABLE when resultSummary is null
      expect(unavailableCount).toBeGreaterThan(5);
      // No empty strings for null fields
      const emptyNumericFields = values
        .slice(3) // skip institutionId, institutionName, reportDate (always populated)
        .filter((v) => v === '');
      expect(emptyNumericFields).toHaveLength(0);
    });
  });

  describe('capitalRatio computation', () => {
    it('should compute capitalRatio as equity/totalAssets * 100', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(
        makeRun({
          summary: {
            fullAnalysis: {
              summary: { equity: 20, totalAssets: 200 },
            },
          },
        }),
      );

      const result = await service.exportMetrics('inst_001', 'json');
      expect((result as any).capitalRatio).toBe(10);
    });

    it('should not compute capitalRatio when totalAssets is 0', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(
        makeRun({
          summary: {
            fullAnalysis: {
              summary: { equity: 10, totalAssets: 0 },
            },
          },
        }),
      );

      const result = await service.exportMetrics('inst_001', 'json');
      expect((result as any).capitalRatio).toBeNull();
    });

    it('safeString returns null for non-string values', async () => {
      prisma.analysisRun.findFirst.mockResolvedValue(
        makeRun({
          summary: {
            durationGap: {
              durationGap: 2.5,
              riskProfile: 42, // non-string triggers safeString null path
              assetDuration: 3,
              liabilityDuration: 1,
            },
          },
        }),
      );

      const result = await service.exportMetrics('inst_001', 'json');
      expect((result as any).durationGapRiskProfile).toBeNull();
    });
  });
});
