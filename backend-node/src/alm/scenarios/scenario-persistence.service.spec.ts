import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ScenarioPersistenceService } from './scenario-persistence.service';

describe('ScenarioPersistenceService', () => {
  let service: ScenarioPersistenceService;
  const mockPrisma = {
    savedScenario: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    service = new ScenarioPersistenceService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should save a scenario', async () => {
    mockPrisma.savedScenario.create.mockResolvedValue({
      id: 'sc-1',
      name: 'Rate Shock +200',
    });
    const result = await service.saveScenario('user-1', {
      institutionId: 'inst-1',
      name: 'Rate Shock +200',
      scenarioType: 'rate_shock',
      parameters: { shockBps: 200 },
    });
    expect(result.id).toBe('sc-1');
  });

  it('should list scenarios with pagination', async () => {
    mockPrisma.savedScenario.findMany.mockResolvedValue([{ id: 'sc-1' }]);
    mockPrisma.savedScenario.count.mockResolvedValue(1);
    const result = await service.listScenarios('inst-1', {
      page: 1,
      pageSize: 10,
    });
    expect(result.items.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it('should throw NotFoundException for missing scenario', async () => {
    mockPrisma.savedScenario.findUnique.mockResolvedValue(null);
    await expect(service.getScenario('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw BadRequestException for invalid compare count', async () => {
    await expect(service.compareScenarios(['sc-1'])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should delete scenario and return confirmation', async () => {
    mockPrisma.savedScenario.findUnique.mockResolvedValue({ id: 'sc-1' });
    mockPrisma.savedScenario.delete.mockResolvedValue({});
    const result = await service.deleteScenario('sc-1');
    expect(result.deleted).toBe(true);
    expect(result.id).toBe('sc-1');
  });

  // ── Coverage boost: compareScenarios, duplicateScenario, updateScenario ──
  describe('compareScenarios', () => {
    it('compares 2 scenarios and returns comparison metrics', async () => {
      const scenarios = [
        {
          id: 'sc-1',
          name: 'Base',
          scenarioType: 'rate_shock',
          parameters: {},
          results: { nimImpactBps: 10, nimAfter: 3.5, verdict: 'RESILIENT' },
          tags: [],
          createdAt: new Date(),
        },
        {
          id: 'sc-2',
          name: 'Stress',
          scenarioType: 'rate_shock',
          parameters: {},
          results: { nimImpactBps: 25, nimAfter: 2.8, verdict: 'VULNERABLE' },
          tags: [],
          createdAt: new Date(),
        },
      ];
      mockPrisma.savedScenario.findMany.mockResolvedValue(scenarios);

      const result = await service.compareScenarios(['sc-1', 'sc-2']);
      expect(result.scenarios).toHaveLength(2);
      expect(result.comparison.rows.length).toBeGreaterThan(0);
      expect(result.comparison.verdicts).toEqual(['RESILIENT', 'VULNERABLE']);
    });

    it('throws NotFoundException when some scenarios are missing', async () => {
      mockPrisma.savedScenario.findMany.mockResolvedValue([
        {
          id: 'sc-1',
          name: 'Base',
          results: {},
          tags: [],
          createdAt: new Date(),
        },
      ]);

      await expect(
        service.compareScenarios(['sc-1', 'sc-missing']),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects more than 4 scenario IDs', async () => {
      await expect(
        service.compareScenarios(['a', 'b', 'c', 'd', 'e']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('duplicateScenario', () => {
    it('creates a copy with (copy) suffix by default', async () => {
      mockPrisma.savedScenario.findUnique.mockResolvedValue({
        id: 'sc-1',
        name: 'Original',
        institutionId: 'inst-1',
        description: 'test desc',
        scenarioType: 'rate_shock',
        parameters: { shockBps: 100 },
        results: null,
        tags: ['tag1'],
      });
      mockPrisma.savedScenario.create.mockResolvedValue({
        id: 'sc-dup',
        name: 'Original (copy)',
      });

      const result = await service.duplicateScenario('sc-1', 'user-1');
      expect(result.name).toBe('Original (copy)');
      expect(mockPrisma.savedScenario.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Original (copy)' }),
        }),
      );
    });

    it('uses custom name when provided', async () => {
      mockPrisma.savedScenario.findUnique.mockResolvedValue({
        id: 'sc-1',
        name: 'Original',
        institutionId: 'inst-1',
        description: null,
        scenarioType: 'custom',
        parameters: {},
        results: null,
        tags: [],
      });
      mockPrisma.savedScenario.create.mockResolvedValue({
        id: 'sc-dup2',
        name: 'My Custom Name',
      });

      const result = await service.duplicateScenario(
        'sc-1',
        'user-1',
        'My Custom Name',
      );
      expect(result.name).toBe('My Custom Name');
    });
  });

  describe('updateScenario', () => {
    it('updates name and tags on existing scenario', async () => {
      mockPrisma.savedScenario.findUnique.mockResolvedValue({
        id: 'sc-1',
        name: 'Old Name',
      });
      mockPrisma.savedScenario.update.mockResolvedValue({
        id: 'sc-1',
        name: 'New Name',
        tags: ['updated'],
      });

      const result = await service.updateScenario('sc-1', {
        name: 'New Name',
        tags: ['updated'],
      });
      expect(result.name).toBe('New Name');
      expect(result.tags).toEqual(['updated']);
    });

    it('throws NotFoundException for non-existent scenario', async () => {
      mockPrisma.savedScenario.findUnique.mockResolvedValue(null);
      await expect(
        service.updateScenario('missing', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
