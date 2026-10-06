import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CossecIngestController } from './cossec-ingest.controller';
import { CossecIngestService } from './cossec-ingest.service';
import { CossecMatchingService } from './cossec-matching.service';
import { AdminKeyGuard } from '../auth/admin-key.guard';

// First spec for CossecIngestController — co-located per CO-LOCATED
// orphan-spec convention. Covers:
//   (a) class-level `AdminKeyGuard` wiring (reflection lock — single
//       point that gates all 5 routes);
//   (b) handler delegation to CossecIngestService / CossecMatchingService;
//   (c) Zod-failure surface (BadRequestException) for the 3 body/query
//       parsing branches.
// Admin-key auth behavior itself is covered by `admin-key.guard.spec.ts`.

describe('CossecIngestController', () => {
  let controller: CossecIngestController;
  let ingestService: Record<string, jest.Mock>;
  let matchingService: Record<string, jest.Mock>;

  beforeEach(async () => {
    ingestService = {
      ingestFindings: jest.fn(),
      getFindingsByCategory: jest.fn(),
      getExamYearSummary: jest.fn(),
      getInstitutionFindings: jest.fn(),
    };
    matchingService = {
      addManualMatch: jest.fn(),
      getMatchCache: jest.fn().mockReturnValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CossecIngestController],
      providers: [
        { provide: CossecIngestService, useValue: ingestService },
        { provide: CossecMatchingService, useValue: matchingService },
      ],
    })
      .overrideGuard(AdminKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CossecIngestController>(CossecIngestController);
  });

  it('has AdminKeyGuard wired at the class level (gates all 5 routes)', () => {
    const guards =
      Reflect.getMetadata('__guards__', CossecIngestController) ?? [];
    const names = guards.map((g: { name?: string }) => g?.name ?? String(g));
    expect(names).toContain('AdminKeyGuard');
  });

  describe('ingest', () => {
    const validPayload = {
      examYear: 2024,
      source: 'cossec-2024-Q4.pdf',
      findings: [
        {
          institutionName: 'Coop A',
          category: 'LIQUIDITY',
          severity: 'HIGH',
          findingText: 'Material liquidity gap identified in 30-day bucket.',
          parserConfidence: 0.92,
        },
      ],
    };

    it('parses payload + delegates to ingestService.ingestFindings', async () => {
      ingestService.ingestFindings.mockResolvedValue({
        totalReceived: 1,
        matched: 1,
        unmatched: 0,
        created: 1,
        duplicatesSkipped: 0,
        unmatchedInstitutions: [],
      });
      const result = await controller.ingest(validPayload);
      expect(result.message).toBe('Ingest complete');
      expect(ingestService.ingestFindings).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequest when the body fails Zod validation', async () => {
      await expect(
        controller.ingest({ examYear: 'not-a-year' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ingestService.ingestFindings).not.toHaveBeenCalled();
    });
  });

  describe('listFindings', () => {
    it('returns category-filtered stats when category filter is set', async () => {
      ingestService.getFindingsByCategory.mockResolvedValue({
        category: 'LIQUIDITY',
        total: 12,
      });
      const result = await controller.listFindings({
        category: 'LIQUIDITY',
        severity: 'HIGH',
      });
      expect(result).toEqual({ category: 'LIQUIDITY', total: 12 });
      expect(ingestService.getFindingsByCategory).toHaveBeenCalledWith(
        'LIQUIDITY',
        'HIGH',
      );
    });

    it('returns exam-year summary when examYear filter is set', async () => {
      ingestService.getExamYearSummary.mockResolvedValue({
        examYear: 2024,
        total: 50,
      });
      const result = await controller.listFindings({ examYear: '2024' });
      expect(result).toEqual({ examYear: 2024, total: 50 });
      expect(ingestService.getExamYearSummary).toHaveBeenCalledWith(2024);
    });

    it('returns a helper message when no filter is provided', async () => {
      const result = await controller.listFindings({});
      expect(result).toEqual({
        message: 'Provide category or examYear filter',
      });
    });
  });

  describe('getInstitutionFindings', () => {
    it('delegates to ingestService.getInstitutionFindings + wraps result', async () => {
      ingestService.getInstitutionFindings.mockResolvedValue([
        { id: 'f1' },
        { id: 'f2' },
      ]);
      const result = await controller.getInstitutionFindings('prosp-1');
      expect(result.prospectInstitutionId).toBe('prosp-1');
      expect(result.count).toBe(2);
      expect(result.findings).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('aggregates non-empty category stats + reports match-cache size', async () => {
      ingestService.getFindingsByCategory.mockImplementation((cat: string) =>
        Promise.resolve({ category: cat, total: cat === 'LIQUIDITY' ? 4 : 0 }),
      );
      matchingService.getMatchCache.mockReturnValue(
        new Map([['Coop A', 'p1']]),
      );

      const result = await controller.getStats();
      expect(result.totalCategories).toBe(1);
      expect(result.categories).toEqual([{ category: 'LIQUIDITY', total: 4 }]);
      expect(result.matchCacheSize).toBe(1);
    });
  });

  describe('manualMatch', () => {
    it('parses body + delegates to matchingService.addManualMatch', async () => {
      matchingService.addManualMatch.mockResolvedValue(undefined);
      const result = await controller.manualMatch({
        institutionName: 'Coop A',
        prospectInstitutionId: 'prosp-1',
      });
      expect(result.message).toContain('"Coop A"');
      expect(matchingService.addManualMatch).toHaveBeenCalledWith(
        'Coop A',
        'prosp-1',
      );
    });

    it('throws BadRequest when body fails Zod validation', async () => {
      await expect(
        controller.manualMatch({ institutionName: 'Coop A' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(matchingService.addManualMatch).not.toHaveBeenCalled();
    });
  });
});
