import { Test, TestingModule } from '@nestjs/testing';
import {
  CossecMatchingService,
  normalize,
  levenshteinSimilarity,
} from './cossec-matching.service';
import { PrismaService } from '../prisma.service';

jest.mock('../prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

describe('CossecMatchingService', () => {
  let service: CossecMatchingService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      prospectInstitution: {
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CossecMatchingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CossecMatchingService>(CossecMatchingService);
  });

  // ── normalize (exported utility) ─────────────────────────────────────────

  describe('normalize', () => {
    it('should lowercase and remove accents', () => {
      expect(normalize('Crédito')).toBe('credito');
      expect(normalize('CAGUAS')).toBe('caguas');
    });

    it('should strip common cooperativa prefixes', () => {
      expect(normalize('Cooperativa de Ahorro y Crédito Caguas')).toBe(
        'caguas',
      );
      expect(normalize('Cooperativa de Ahorro y Credito ACACIA')).toBe(
        'acacia',
      );
    });

    it('should collapse whitespace', () => {
      expect(normalize('  Caguas   Regional  ')).toBe('caguas regional');
    });

    it('should handle names without prefix', () => {
      expect(normalize('Oriental')).toBe('oriental');
    });
  });

  // ── levenshteinSimilarity (exported utility) ─────────────────────────────

  describe('levenshteinSimilarity', () => {
    it('should return 1.0 for identical strings', () => {
      expect(levenshteinSimilarity('caguas', 'caguas')).toBe(1.0);
    });

    it('should return 0 for completely different strings', () => {
      expect(levenshteinSimilarity('abc', 'xyz')).toBeLessThan(0.5);
    });

    it('should return high similarity for close strings', () => {
      const sim = levenshteinSimilarity('caguas', 'caguaz');
      expect(sim).toBeGreaterThan(0.8);
    });

    it('should handle empty strings', () => {
      expect(levenshteinSimilarity('', '')).toBe(1.0);
      expect(levenshteinSimilarity('abc', '')).toBe(0);
    });
  });

  // ── matchInstitution ─────────────────────────────────────────────────────

  describe('matchInstitution', () => {
    const mockProspects = [
      { id: 'inst-caguas', name: 'Caguas' },
      { id: 'inst-acacia', name: 'ACACIA' },
      { id: 'inst-oriental', name: 'Oriental' },
      { id: 'inst-bayamon', name: 'Bayamón' },
    ];

    beforeEach(() => {
      prisma.prospectInstitution.findMany.mockResolvedValue(mockProspects);
    });

    it('should return confidence 1.0 for exact name match', async () => {
      const result = await service.matchInstitution('Caguas');

      expect(result.matched).toBe(true);
      expect(result.prospectInstitutionId).toBe('inst-caguas');
      expect(result.confidence).toBe(1.0);
    });

    it('should handle accent removal ("crédito" → "credito")', async () => {
      // "Cooperativa de Ahorro y Crédito Caguas" normalizes to "caguas"
      const result = await service.matchInstitution(
        'Cooperativa de Ahorro y Crédito Caguas',
      );

      expect(result.matched).toBe(true);
      expect(result.prospectInstitutionId).toBe('inst-caguas');
      expect(result.confidence).toBe(1.0);
    });

    it('should strip common prefix and match', async () => {
      const result = await service.matchInstitution(
        'Cooperativa de Ahorro y Credito ACACIA',
      );

      expect(result.matched).toBe(true);
      expect(result.prospectInstitutionId).toBe('inst-acacia');
      expect(result.confidence).toBe(1.0);
    });

    it('should match with accent differences (Bayamón)', async () => {
      const result = await service.matchInstitution('Bayamon');

      expect(result.matched).toBe(true);
      expect(result.prospectInstitutionId).toBe('inst-bayamon');
      expect(result.confidence).toBe(1.0);
    });

    it('should return unmatched for below-threshold matches', async () => {
      const result = await service.matchInstitution(
        'Completely Unknown Institution XYZ',
      );

      expect(result.matched).toBe(false);
      expect(result.confidence).toBeLessThan(0.8);
    });

    it('should use manual match overrides', async () => {
      prisma.prospectInstitution.findUniqueOrThrow.mockResolvedValue({
        id: 'inst-caguas',
      });

      await service.addManualMatch('Weird Caguas Name', 'inst-caguas');

      const result = await service.matchInstitution('Weird Caguas Name');

      expect(result.matched).toBe(true);
      expect(result.prospectInstitutionId).toBe('inst-caguas');
      expect(result.confidence).toBe(1.0);
    });

    it('should cache successful matches', async () => {
      // First call loads prospects and matches
      await service.matchInstitution('Caguas');
      // Second call should use cache
      const result = await service.matchInstitution('Caguas');

      expect(result.matched).toBe(true);
      expect(result.prospectInstitutionId).toBe('inst-caguas');

      // getMatchCache should contain the entry
      const cache = service.getMatchCache();
      expect(cache.has('caguas')).toBe(true);
    });
  });
});
