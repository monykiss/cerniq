import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ScenarioPersistenceService {
  private readonly logger = new Logger(ScenarioPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveScenario(
    userId: string,
    dto: {
      institutionId: string;
      name: string;
      description?: string;
      scenarioType: string;
      parameters: Record<string, unknown>;
      results?: Record<string, unknown>;
      tags?: string[];
    },
  ) {
    this.logger.log(
      `Saving scenario "${dto.name}" for institution ${dto.institutionId}`,
    );
    return this.prisma.savedScenario.create({
      data: {
        institutionId: dto.institutionId,
        createdBy: userId,
        name: dto.name,
        description: dto.description,
        scenarioType: dto.scenarioType,
        parameters: dto.parameters as any,
        results: (dto.results as any) ?? undefined,
        tags: dto.tags ?? [],
      },
    });
  }

  async listScenarios(
    institutionId: string,
    opts?: { page?: number; pageSize?: number; tag?: string },
  ) {
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: any = { institutionId };
    if (opts?.tag) {
      where.tags = { has: opts.tag };
    }

    const [items, total] = await Promise.all([
      this.prisma.savedScenario.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.savedScenario.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getScenario(scenarioId: string) {
    const scenario = await this.prisma.savedScenario.findUnique({
      where: { id: scenarioId },
    });
    if (!scenario)
      throw new NotFoundException(`Scenario ${scenarioId} not found`);
    return scenario;
  }

  async compareScenarios(scenarioIds: string[]) {
    if (scenarioIds.length < 2 || scenarioIds.length > 4) {
      throw new BadRequestException('Compare requires 2-4 scenario IDs');
    }

    const scenarios = await this.prisma.savedScenario.findMany({
      where: { id: { in: scenarioIds } },
      orderBy: { createdAt: 'asc' },
    });

    if (scenarios.length !== scenarioIds.length) {
      const found = new Set(scenarios.map((s: any) => s.id));
      const missing = scenarioIds.filter((id) => !found.has(id));
      throw new NotFoundException(`Scenarios not found: ${missing.join(', ')}`);
    }

    // Build comparison matrix
    const metrics = this.extractComparisonMetrics(scenarios);

    return {
      scenarios: scenarios.map((s: any) => ({
        id: s.id,
        name: s.name,
        scenarioType: s.scenarioType,
        parameters: s.parameters,
        results: s.results,
        tags: s.tags,
        createdAt: s.createdAt,
      })),
      comparison: metrics,
    };
  }

  async duplicateScenario(
    scenarioId: string,
    userId: string,
    newName?: string,
  ) {
    const original = await this.getScenario(scenarioId);
    return this.prisma.savedScenario.create({
      data: {
        institutionId: original.institutionId,
        createdBy: userId,
        name: newName ?? `${original.name} (copy)`,
        description: original.description,
        scenarioType: original.scenarioType,
        parameters: original.parameters,
        results: original.results ?? undefined,
        tags: original.tags,
      },
    });
  }

  async deleteScenario(scenarioId: string) {
    const scenario = await this.prisma.savedScenario.findUnique({
      where: { id: scenarioId },
    });
    if (!scenario)
      throw new NotFoundException(`Scenario ${scenarioId} not found`);
    await this.prisma.savedScenario.delete({ where: { id: scenarioId } });
    return { deleted: true, id: scenarioId };
  }

  async updateScenario(
    scenarioId: string,
    updates: {
      name?: string;
      description?: string;
      tags?: string[];
      results?: Record<string, unknown>;
    },
  ) {
    const scenario = await this.prisma.savedScenario.findUnique({
      where: { id: scenarioId },
    });
    if (!scenario)
      throw new NotFoundException(`Scenario ${scenarioId} not found`);

    return this.prisma.savedScenario.update({
      where: { id: scenarioId },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && {
          description: updates.description,
        }),
        ...(updates.tags !== undefined && { tags: updates.tags }),
        ...(updates.results !== undefined && {
          results: updates.results as any,
        }),
      },
    });
  }

  // ─── Private ────────────────────────────────────────────────────

  private extractComparisonMetrics(scenarios: any[]) {
    const metricKeys = [
      { key: 'nimImpactBps', label: 'NIM Impact (bps)', higherIsBetter: false },
      { key: 'nimAfter', label: 'NIM After (%)', higherIsBetter: true },
      { key: 'lcrAfter', label: 'LCR After (%)', higherIsBetter: true },
      { key: 'capitalAfter', label: 'Capital After (%)', higherIsBetter: true },
      {
        key: 'examReadinessAfter',
        label: 'Exam Readiness',
        higherIsBetter: true,
      },
    ];

    const rows = metricKeys.map(({ key, label, higherIsBetter }) => {
      const values = scenarios.map((s) => {
        const results = (s.results ?? {}) as Record<string, unknown>;
        return typeof results[key] === 'number' ? results[key] : null;
      });

      // Determine best/worst
      const validValues = values.filter((v): v is number => v !== null);
      const best =
        validValues.length > 0
          ? higherIsBetter
            ? Math.max(...validValues)
            : Math.min(...validValues)
          : null;
      const worst =
        validValues.length > 0
          ? higherIsBetter
            ? Math.min(...validValues)
            : Math.max(...validValues)
          : null;

      return {
        metric: label,
        key,
        higherIsBetter,
        values,
        best,
        worst,
      };
    });

    // Overall verdict comparison
    const verdicts = scenarios.map((s) => {
      const results = (s.results ?? {}) as Record<string, unknown>;
      return (results.verdict as string) ?? 'N/A';
    });

    return { rows, verdicts };
  }
}
