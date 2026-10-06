import { Test, TestingModule } from '@nestjs/testing';
import { CossecIngestService } from './cossec-ingest.service';
import { CossecMatchingService } from './cossec-matching.service';
import { PrismaService } from '../prisma.service';
import type { CossecIngestPayload } from './cossec.dto';

jest.mock('../prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

describe('CossecIngestService', () => {
  let service: CossecIngestService;
  let prisma: Record<string, any>;
  let matching: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      cossecExamFinding: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      prospectInstitution: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    matching = {
      matchInstitution: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CossecIngestService,
        { provide: PrismaService, useValue: prisma },
        { provide: CossecMatchingService, useValue: matching },
      ],
    }).compile();

    service = module.get<CossecIngestService>(CossecIngestService);
  });

  // ── ingestFindings ───────────────────────────────────────────────────────

  describe('ingestFindings', () => {
    const basePayload: CossecIngestPayload = {
      examYear: 2025,
      source: 'cossec-parser-v1',
      findings: [
        {
          institutionName: 'Cooperativa de Ahorro y Credito Caguas',
          category: 'ALM_POLICY',
          severity: 'HIGH',
          findingText:
            'Institution lacks a formal ALM policy approved by the board.',
          recommendation: 'Adopt a comprehensive ALM policy.',
          parserConfidence: 0.95,
        },
      ],
    };

    it('should create findings with correct FK links', async () => {
      matching.matchInstitution.mockResolvedValue({
        matched: true,
        prospectInstitutionId: 'inst-001',
        confidence: 0.95,
        matchedName: 'Caguas',
      });
      prisma.cossecExamFinding.findFirst.mockResolvedValue(null); // no duplicate
      prisma.cossecExamFinding.create.mockResolvedValue({ id: 'finding-1' });
      prisma.cossecExamFinding.findMany.mockResolvedValue([{ examYear: 2025 }]);
      prisma.prospectInstitution.update.mockResolvedValue({});

      const result = await service.ingestFindings(basePayload);

      expect(result.totalReceived).toBe(1);
      expect(result.matched).toBe(1);
      expect(result.created).toBe(1);
      expect(result.unmatched).toBe(0);

      expect(prisma.cossecExamFinding.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          prospectInstitutionId: 'inst-001',
          examYear: 2025,
          category: 'ALM_POLICY',
          severity: 'HIGH',
          findingText:
            'Institution lacks a formal ALM policy approved by the board.',
          parserConfidence: 0.95,
        }),
      });
    });

    it('should report unmatched institutions', async () => {
      matching.matchInstitution.mockResolvedValue({
        matched: false,
        confidence: 0.4,
      });

      const result = await service.ingestFindings(basePayload);

      expect(result.unmatched).toBe(1);
      expect(result.unmatchedInstitutions).toContain(
        'Cooperativa de Ahorro y Credito Caguas',
      );
      expect(prisma.cossecExamFinding.create).not.toHaveBeenCalled();
    });

    it('should skip duplicate findings (same institution + examYear + category + findingText)', async () => {
      matching.matchInstitution.mockResolvedValue({
        matched: true,
        prospectInstitutionId: 'inst-001',
        confidence: 1.0,
      });
      // Existing finding returned
      prisma.cossecExamFinding.findFirst.mockResolvedValue({
        id: 'existing-finding',
      });

      const result = await service.ingestFindings(basePayload);

      expect(result.matched).toBe(1);
      expect(result.duplicatesSkipped).toBe(1);
      expect(result.created).toBe(0);
      expect(prisma.cossecExamFinding.create).not.toHaveBeenCalled();
    });

    it('should update ProspectInstitution stats after ingest', async () => {
      matching.matchInstitution.mockResolvedValue({
        matched: true,
        prospectInstitutionId: 'inst-001',
        confidence: 0.92,
      });
      prisma.cossecExamFinding.findFirst.mockResolvedValue(null);
      prisma.cossecExamFinding.create.mockResolvedValue({ id: 'f-1' });
      prisma.cossecExamFinding.findMany.mockResolvedValue([
        { examYear: 2025 },
        { examYear: 2024 },
        { examYear: 2025 },
      ]);
      prisma.prospectInstitution.update.mockResolvedValue({});

      await service.ingestFindings(basePayload);

      expect(prisma.prospectInstitution.update).toHaveBeenCalledWith({
        where: { id: 'inst-001' },
        data: {
          cossecFindingsCount: 3,
          cossecLastExamYear: 2025,
        },
      });
    });

    it('should handle multiple findings with mixed matches', async () => {
      const multiPayload: CossecIngestPayload = {
        examYear: 2025,
        source: 'cossec-parser-v1',
        findings: [
          {
            institutionName: 'Coop Caguas',
            category: 'LIQUIDITY',
            severity: 'MEDIUM',
            findingText: 'Liquidity buffer below recommended levels.',
            parserConfidence: 0.9,
          },
          {
            institutionName: 'Unknown Coop XYZ',
            category: 'GOVERNANCE',
            severity: 'LOW',
            findingText: 'Minor governance finding.',
            parserConfidence: 0.7,
          },
          {
            institutionName: 'Coop Caguas',
            category: 'CAPITAL_ADEQUACY',
            severity: 'HIGH',
            findingText: 'Capital ratio below COSSEC minimum.',
            parserConfidence: 0.88,
          },
        ],
      };

      matching.matchInstitution
        .mockResolvedValueOnce({
          matched: true,
          prospectInstitutionId: 'inst-001',
          confidence: 0.9,
        })
        .mockResolvedValueOnce({
          matched: false,
          confidence: 0.3,
        })
        .mockResolvedValueOnce({
          matched: true,
          prospectInstitutionId: 'inst-001',
          confidence: 0.9,
        });

      prisma.cossecExamFinding.findFirst.mockResolvedValue(null);
      prisma.cossecExamFinding.create.mockResolvedValue({ id: 'f-new' });
      prisma.cossecExamFinding.findMany.mockResolvedValue([
        { examYear: 2025 },
        { examYear: 2025 },
      ]);
      prisma.prospectInstitution.update.mockResolvedValue({});

      const result = await service.ingestFindings(multiPayload);

      expect(result.totalReceived).toBe(3);
      expect(result.matched).toBe(2);
      expect(result.unmatched).toBe(1);
      expect(result.created).toBe(2);
      expect(result.unmatchedInstitutions).toEqual(['Unknown Coop XYZ']);
      // Update called once for inst-001 (deduped)
      expect(prisma.prospectInstitution.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── getInstitutionFindings ───────────────────────────────────────────────

  describe('getInstitutionFindings', () => {
    it('should return findings ordered by examYear desc', async () => {
      const mockFindings = [
        { id: 'f-1', examYear: 2025, category: 'ALM_POLICY' },
        { id: 'f-2', examYear: 2024, category: 'LIQUIDITY' },
      ];
      prisma.cossecExamFinding.findMany.mockResolvedValue(mockFindings);

      const result = await service.getInstitutionFindings('inst-001');

      expect(result).toEqual(mockFindings);
      expect(prisma.cossecExamFinding.findMany).toHaveBeenCalledWith({
        where: { prospectInstitutionId: 'inst-001' },
        orderBy: [
          { examYear: 'desc' },
          { severity: 'asc' },
          { category: 'asc' },
        ],
      });
    });
  });

  // ── getFindingsByCategory ────────────────────────────────────────────────

  describe('getFindingsByCategory', () => {
    it('should aggregate findings by severity', async () => {
      prisma.cossecExamFinding.findMany.mockResolvedValue([
        { severity: 'HIGH', prospectInstitutionId: 'inst-001' },
        { severity: 'HIGH', prospectInstitutionId: 'inst-002' },
        { severity: 'MEDIUM', prospectInstitutionId: 'inst-001' },
      ]);

      const result = await service.getFindingsByCategory('ALM_POLICY');

      expect(result.category).toBe('ALM_POLICY');
      expect(result.total).toBe(3);
      expect(result.bySeverity.HIGH).toBe(2);
      expect(result.bySeverity.MEDIUM).toBe(1);
      expect(result.institutions).toBe(2);
    });
  });

  // ── getExamYearSummary ──────────────────────────────────────────────────

  describe('getExamYearSummary', () => {
    it('should summarize findings for an exam year', async () => {
      prisma.cossecExamFinding.findMany.mockResolvedValue([
        {
          severity: 'HIGH',
          category: 'ALM_POLICY',
          prospectInstitutionId: 'i1',
        },
        {
          severity: 'MEDIUM',
          category: 'LIQUIDITY',
          prospectInstitutionId: 'i2',
        },
        {
          severity: 'HIGH',
          category: 'ALM_POLICY',
          prospectInstitutionId: 'i2',
        },
      ]);

      const result = await service.getExamYearSummary(2025);

      expect(result.examYear).toBe(2025);
      expect(result.totalFindings).toBe(3);
      expect(result.institutionsExamined).toBe(2);
      expect(result.bySeverity.HIGH).toBe(2);
      expect(result.bySeverity.MEDIUM).toBe(1);
      expect(result.byCategory.ALM_POLICY).toBe(2);
      expect(result.byCategory.LIQUIDITY).toBe(1);
    });
  });
});
