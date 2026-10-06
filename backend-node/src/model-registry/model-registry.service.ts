/**
 * ModelRegistryService — FAANG Audit P1: Formal model governance.
 *
 * CRUD + approve/retire lifecycle for every production-facing model.
 * The registry is database-backed (not in-memory) so it survives restarts
 * and is queryable across horizontally scaled processes.
 *
 * Key design choices:
 *   - modelKey is the unique identity. Version bumps create a new entry
 *     and DEPRECATE the old one (not update-in-place).
 *   - approve() and retire() are separate operations with actor + timestamp.
 *   - Validation artifacts are child records (cascade delete on model removal).
 *   - All queries return plain objects — no Prisma model leakage.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type {
  ModelRegistryFilter,
  ApproveModelInput,
  RetireModelInput,
  ModelSeedEntry,
} from './model-registry.types';

@Injectable()
export class ModelRegistryService {
  private readonly logger = new Logger(ModelRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** List models with optional filters. */
  async list(filter?: ModelRegistryFilter) {
    const where: Record<string, unknown> = {};
    if (filter?.category) where.category = filter.category;
    if (filter?.status) where.status = filter.status;
    if (filter?.riskTier) where.riskTier = filter.riskTier;

    return this.prisma.modelRegistryEntry.findMany({
      where,
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
      include: { validationArtifacts: true },
    });
  }

  /** Get a single model by id or throw. */
  async getById(id: string) {
    const model = await this.prisma.modelRegistryEntry.findUnique({
      where: { id },
      include: { validationArtifacts: true },
    });
    if (!model) throw new NotFoundException(`Model ${id} not found`);
    return model;
  }

  /** Get a single model by modelKey or throw. */
  async getByKey(modelKey: string) {
    const model = await this.prisma.modelRegistryEntry.findUnique({
      where: { modelKey },
      include: { validationArtifacts: true },
    });
    if (!model)
      throw new NotFoundException(`Model key "${modelKey}" not found`);
    return model;
  }

  /** Upsert a model by modelKey. Used by the seeder. */
  async upsert(entry: ModelSeedEntry) {
    return this.prisma.modelRegistryEntry.upsert({
      where: { modelKey: entry.modelKey },
      create: {
        modelKey: entry.modelKey,
        displayName: entry.displayName,
        description: entry.description,
        version: entry.version,
        category: entry.category,
        riskTier: entry.riskTier,
        status: entry.status,
        ownerName: entry.ownerName,
        serviceFile: entry.serviceFile,
        entryFunction: entry.entryFunction,
        calibrationMetadata: entry.calibrationMetadata ?? undefined,
        requiredInputs: entry.requiredInputs ?? undefined,
        limitations: entry.limitations ?? undefined,
        approvedAt: entry.status === 'APPROVED' ? new Date() : undefined,
        approvedBy: entry.status === 'APPROVED' ? 'system-seed' : undefined,
      },
      update: {
        displayName: entry.displayName,
        description: entry.description,
        version: entry.version,
        category: entry.category,
        riskTier: entry.riskTier,
        ownerName: entry.ownerName,
        serviceFile: entry.serviceFile,
        entryFunction: entry.entryFunction,
        calibrationMetadata: entry.calibrationMetadata ?? undefined,
        requiredInputs: entry.requiredInputs ?? undefined,
        limitations: entry.limitations ?? undefined,
      },
    });
  }

  /**
   * Approve a model for production use.
   * Only DRAFT or CANDIDATE models can be approved.
   */
  async approve(id: string, input: ApproveModelInput) {
    const model = await this.getById(id);
    if (model.status === 'APPROVED') {
      throw new ConflictException(
        `Model "${model.modelKey}" is already approved`,
      );
    }
    if (model.status === 'RETIRED') {
      throw new ConflictException(
        `Cannot approve retired model "${model.modelKey}". Create a new version instead.`,
      );
    }

    const updated = await this.prisma.modelRegistryEntry.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: input.approvedBy,
      },
    });
    this.logger.log(`Model approved: ${model.modelKey} by ${input.approvedBy}`);
    return updated;
  }

  /**
   * Retire a model from production.
   * Reason is mandatory — auditors need to know why.
   */
  async retire(id: string, input: RetireModelInput) {
    const model = await this.getById(id);
    if (model.status === 'RETIRED') {
      throw new ConflictException(
        `Model "${model.modelKey}" is already retired`,
      );
    }

    const updated = await this.prisma.modelRegistryEntry.update({
      where: { id },
      data: {
        status: 'RETIRED',
        retiredAt: new Date(),
        retiredBy: input.retiredBy,
        retiredReason: input.reason,
      },
    });
    this.logger.log(
      `Model retired: ${model.modelKey} by ${input.retiredBy} — ${input.reason}`,
    );
    return updated;
  }

  /** Deprecate a model (superseded by a newer version but still callable). */
  async deprecate(id: string, reason: string) {
    const model = await this.getById(id);
    if (model.status === 'RETIRED') {
      throw new ConflictException(
        `Cannot deprecate retired model "${model.modelKey}"`,
      );
    }
    return this.prisma.modelRegistryEntry.update({
      where: { id },
      data: { status: 'DEPRECATED' },
    });
  }

  /** Submit a DRAFT model for validation review. */
  async submitForReview(id: string) {
    const model = await this.getById(id);
    if (model.status !== 'DRAFT') {
      throw new ConflictException(
        `Only DRAFT models can be submitted for review. Current: ${model.status}`,
      );
    }
    return this.prisma.modelRegistryEntry.update({
      where: { id },
      data: { status: 'CANDIDATE' },
    });
  }

  /** Add a validation artifact to a model. */
  async addValidationArtifact(
    modelId: string,
    artifact: {
      artifactType: string;
      label: string;
      storageLocator: string;
      checksum?: string;
      producedBy: string;
      producedAt: Date;
      validationMetadata?: Record<string, unknown>;
    },
  ) {
    await this.getById(modelId); // ensure model exists
    return this.prisma.modelValidationArtifact.create({
      data: {
        modelRegistryId: modelId,
        ...artifact,
      },
    });
  }

  /** Summary statistics for the admin dashboard. */
  async getSummary() {
    const [total, byStatus, byCategory, byTier] = await Promise.all([
      this.prisma.modelRegistryEntry.count(),
      this.prisma.modelRegistryEntry.groupBy({ by: ['status'], _count: true }),
      this.prisma.modelRegistryEntry.groupBy({
        by: ['category'],
        _count: true,
      }),
      this.prisma.modelRegistryEntry.groupBy({
        by: ['riskTier'],
        _count: true,
      }),
    ]);

    return {
      total,
      byStatus: Object.fromEntries(
        byStatus.map((s: any) => [s.status, s._count]),
      ),
      byCategory: Object.fromEntries(
        byCategory.map((c: any) => [c.category, c._count]),
      ),
      byTier: Object.fromEntries(
        byTier.map((t: any) => [t.riskTier, t._count]),
      ),
    };
  }

  /**
   * Get all APPROVED models for a given category.
   * Used by ReportPreflight to verify model governance before report generation.
   */
  async getApprovedModels(category?: string) {
    const where: Record<string, unknown> = { status: 'APPROVED' };
    if (category) where.category = category;
    return this.prisma.modelRegistryEntry.findMany({
      where,
      orderBy: { modelKey: 'asc' },
    });
  }
}
