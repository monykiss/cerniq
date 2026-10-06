/**
 * ModelRegistryService specs — FAANG Audit P1.
 *
 * Tests the full lifecycle: upsert, list, filter, approve, retire,
 * deprecate, submit-for-review, validation artifacts, and summary.
 * Uses in-memory Prisma fakes consistent with the project pattern.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ModelRegistryService } from './model-registry.service';
import { PrismaService } from '../prisma.service';

// ── In-memory store ──────────────────────────────────────────────

function createMockPrisma() {
  const models: any[] = [];
  const artifacts: any[] = [];
  let idCounter = 1;

  return {
    modelRegistryEntry: {
      findMany: jest.fn(({ where, orderBy, include }: any = {}) => {
        let result = [...models];
        if (where) {
          if (where.status)
            result = result.filter((m) => m.status === where.status);
          if (where.category)
            result = result.filter((m) => m.category === where.category);
          if (where.riskTier)
            result = result.filter((m) => m.riskTier === where.riskTier);
        }
        if (include?.validationArtifacts) {
          result = result.map((m) => ({
            ...m,
            validationArtifacts: artifacts.filter(
              (a) => a.modelRegistryId === m.id,
            ),
          }));
        }
        return Promise.resolve(result);
      }),
      findUnique: jest.fn(({ where, include }: any) => {
        const found = where.id
          ? models.find((m) => m.id === where.id)
          : models.find((m) => m.modelKey === where.modelKey);
        if (!found) return Promise.resolve(null);
        if (include?.validationArtifacts) {
          return Promise.resolve({
            ...found,
            validationArtifacts: artifacts.filter(
              (a) => a.modelRegistryId === found.id,
            ),
          });
        }
        return Promise.resolve(found);
      }),
      upsert: jest.fn(({ where, create, update }: any) => {
        const existing = models.find((m) => m.modelKey === where.modelKey);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return Promise.resolve(existing);
        }
        const newModel = {
          id: `model-${idCounter++}`,
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
          validationArtifacts: [],
        };
        models.push(newModel);
        return Promise.resolve(newModel);
      }),
      update: jest.fn(({ where, data }: any) => {
        const found = models.find((m) => m.id === where.id);
        if (!found) throw new Error('Not found');
        Object.assign(found, data, { updatedAt: new Date() });
        return Promise.resolve(found);
      }),
      count: jest.fn(() => Promise.resolve(models.length)),
      groupBy: jest.fn(({ by }: any) => {
        const field = by[0];
        const groups: Record<string, number> = {};
        for (const m of models) {
          groups[m[field]] = (groups[m[field]] || 0) + 1;
        }
        return Promise.resolve(
          Object.entries(groups).map(([k, v]) => ({ [field]: k, _count: v })),
        );
      }),
    },
    modelValidationArtifact: {
      create: jest.fn(({ data }: any) => {
        const newArtifact = {
          id: `artifact-${idCounter++}`,
          ...data,
          createdAt: new Date(),
        };
        artifacts.push(newArtifact);
        return Promise.resolve(newArtifact);
      }),
    },
    _models: models,
    _artifacts: artifacts,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('ModelRegistryService', () => {
  let service: ModelRegistryService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRegistryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ModelRegistryService);
  });

  const seedModel = (overrides: Partial<any> = {}) =>
    service.upsert({
      modelKey: 'alm.duration-gap',
      displayName: 'Duration Gap',
      description: 'Test model',
      version: '1.0.0',
      category: 'ALM_CORE',
      riskTier: 'TIER_1',
      status: 'APPROVED',
      ownerName: 'Test Team',
      serviceFile: 'alm/alm-enterprise.service.ts',
      entryFunction: 'calculateDurationGap',
      ...overrides,
    });

  // ── Upsert ──

  it('creates a new model on first upsert', async () => {
    const result = await seedModel();
    expect(result.modelKey).toBe('alm.duration-gap');
    expect(result.id).toBeDefined();
    expect(prisma._models).toHaveLength(1);
  });

  it('updates existing model on re-upsert without duplicating', async () => {
    await seedModel();
    await seedModel({ version: '1.1.0' });
    expect(prisma._models).toHaveLength(1);
    expect(prisma._models[0].version).toBe('1.1.0');
  });

  it('creates separate entries for different modelKeys', async () => {
    await seedModel();
    await seedModel({ modelKey: 'alm.lcr', displayName: 'LCR' });
    expect(prisma._models).toHaveLength(2);
  });

  // ── List / Filter ──

  it('lists all models', async () => {
    await seedModel();
    await seedModel({ modelKey: 'credit.cecl', category: 'CREDIT_RISK' });
    const all = await service.list();
    expect(all).toHaveLength(2);
  });

  it('filters by category', async () => {
    await seedModel();
    await seedModel({ modelKey: 'credit.cecl', category: 'CREDIT_RISK' });
    const filtered = await service.list({ category: 'ALM_CORE' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].modelKey).toBe('alm.duration-gap');
  });

  it('filters by status', async () => {
    await seedModel();
    await seedModel({ modelKey: 'draft.model', status: 'DRAFT' });
    const filtered = await service.list({ status: 'APPROVED' });
    expect(filtered).toHaveLength(1);
  });

  it('filters by riskTier', async () => {
    await seedModel();
    await seedModel({ modelKey: 'low.model', riskTier: 'TIER_3' });
    const filtered = await service.list({ riskTier: 'TIER_1' });
    expect(filtered).toHaveLength(1);
  });

  // ── Get ──

  it('gets a model by id', async () => {
    const created = await seedModel();
    const found = await service.getById(created.id);
    expect(found.modelKey).toBe('alm.duration-gap');
  });

  it('throws NotFoundException for missing id', async () => {
    await expect(service.getById('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gets a model by modelKey', async () => {
    await seedModel();
    const found = await service.getByKey('alm.duration-gap');
    expect(found.displayName).toBe('Duration Gap');
  });

  it('throws NotFoundException for missing modelKey', async () => {
    await expect(service.getByKey('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── Approve ──

  it('approves a DRAFT model', async () => {
    const created = await seedModel({ status: 'DRAFT' });
    const approved = await service.approve(created.id, {
      approvedBy: 'reviewer@cerniq.io',
    });
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('reviewer@cerniq.io');
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it('approves a CANDIDATE model', async () => {
    const created = await seedModel({ status: 'CANDIDATE' });
    const approved = await service.approve(created.id, {
      approvedBy: 'reviewer',
    });
    expect(approved.status).toBe('APPROVED');
  });

  it('rejects double approval', async () => {
    const created = await seedModel({ status: 'APPROVED' });
    await expect(
      service.approve(created.id, { approvedBy: 'reviewer' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects approving a retired model', async () => {
    const created = await seedModel({ status: 'RETIRED' });
    await expect(
      service.approve(created.id, { approvedBy: 'reviewer' }),
    ).rejects.toThrow(ConflictException);
  });

  // ── Retire ──

  it('retires an approved model with reason', async () => {
    const created = await seedModel({ status: 'APPROVED' });
    const retired = await service.retire(created.id, {
      retiredBy: 'admin@cerniq.io',
      reason: 'Superseded by v2',
    });
    expect(retired.status).toBe('RETIRED');
    expect(retired.retiredBy).toBe('admin@cerniq.io');
    expect(retired.retiredReason).toBe('Superseded by v2');
  });

  it('rejects retiring an already retired model', async () => {
    const created = await seedModel({ status: 'RETIRED' });
    await expect(
      service.retire(created.id, { retiredBy: 'admin', reason: 'test' }),
    ).rejects.toThrow(ConflictException);
  });

  // ── Deprecate ──

  it('deprecates an approved model', async () => {
    const created = await seedModel({ status: 'APPROVED' });
    const deprecated = await service.deprecate(
      created.id,
      'New version available',
    );
    expect(deprecated.status).toBe('DEPRECATED');
  });

  it('rejects deprecating a retired model', async () => {
    const created = await seedModel({ status: 'RETIRED' });
    await expect(service.deprecate(created.id, 'test')).rejects.toThrow(
      ConflictException,
    );
  });

  // ── Submit for Review ──

  it('submits a DRAFT model for review', async () => {
    const created = await seedModel({ status: 'DRAFT' });
    const submitted = await service.submitForReview(created.id);
    expect(submitted.status).toBe('CANDIDATE');
  });

  it('rejects submitting non-DRAFT model for review', async () => {
    const created = await seedModel({ status: 'APPROVED' });
    await expect(service.submitForReview(created.id)).rejects.toThrow(
      ConflictException,
    );
  });

  // ── Validation Artifacts ──

  it('adds a validation artifact to a model', async () => {
    const model = await seedModel();
    const artifact = await service.addValidationArtifact(model.id, {
      artifactType: 'golden_test',
      label: 'Duration gap golden test',
      storageLocator: 'test/golden/duration-gap.json',
      checksum: 'sha256:abc123',
      producedBy: 'CI pipeline',
      producedAt: new Date(),
      validationMetadata: { tolerance: 0.001 },
    });
    expect(artifact.artifactType).toBe('golden_test');
    expect(artifact.modelRegistryId).toBe(model.id);
  });

  it('throws when adding artifact to nonexistent model', async () => {
    await expect(
      service.addValidationArtifact('nonexistent', {
        artifactType: 'backtest',
        label: 'test',
        storageLocator: '/tmp/test',
        producedBy: 'test',
        producedAt: new Date(),
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── Summary ──

  it('returns correct summary statistics', async () => {
    await seedModel({ status: 'APPROVED' });
    await seedModel({
      modelKey: 'credit.cecl',
      category: 'CREDIT_RISK',
      status: 'DRAFT',
    });
    await seedModel({
      modelKey: 'stress.mc',
      category: 'STRESS_TEST',
      riskTier: 'TIER_2',
      status: 'APPROVED',
    });

    const summary = await service.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.byStatus.APPROVED).toBe(2);
    expect(summary.byStatus.DRAFT).toBe(1);
    expect(summary.byCategory.ALM_CORE).toBe(1);
    expect(summary.byCategory.CREDIT_RISK).toBe(1);
  });

  // ── getApprovedModels ──

  it('returns only APPROVED models, optionally filtered by category', async () => {
    await seedModel({ status: 'APPROVED' });
    await seedModel({ modelKey: 'draft.x', status: 'DRAFT' });
    await seedModel({
      modelKey: 'credit.x',
      category: 'CREDIT_RISK',
      status: 'APPROVED',
    });

    const all = await service.getApprovedModels();
    expect(all).toHaveLength(2);

    const almOnly = await service.getApprovedModels('ALM_CORE');
    expect(almOnly).toHaveLength(1);
    expect(almOnly[0].modelKey).toBe('alm.duration-gap');
  });
});
