/**
 * GovernedScenarioService — FAANG Audit P1 item #2.
 *
 * Separates approved institutional scenarios from user-saved working
 * scenarios. The existing SavedScenario model remains for user drafts;
 * this service manages the governed (approved) scenarios that carry
 * regulatory weight.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ScenarioFilter, GovernedScenarioSeed } from './governance.types';

@Injectable()
export class GovernedScenarioService {
  private readonly logger = new Logger(GovernedScenarioService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(filter?: ScenarioFilter) {
    const where: Record<string, unknown> = {};
    if (filter?.scope) where.scope = filter.scope;
    if (filter?.status) where.status = filter.status;
    return this.prisma.governedScenario.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { displayName: 'asc' }],
    });
  }

  async getById(id: string) {
    const s = await this.prisma.governedScenario.findUnique({ where: { id } });
    if (!s) throw new NotFoundException(`Governed scenario ${id} not found`);
    return s;
  }

  async getByKey(scenarioKey: string) {
    const s = await this.prisma.governedScenario.findUnique({
      where: { scenarioKey },
    });
    if (!s)
      throw new NotFoundException(`Scenario key "${scenarioKey}" not found`);
    return s;
  }

  async upsert(entry: GovernedScenarioSeed) {
    return this.prisma.governedScenario.upsert({
      where: { scenarioKey: entry.scenarioKey },
      create: {
        scenarioKey: entry.scenarioKey,
        displayName: entry.displayName,
        description: entry.description,
        version: entry.version,
        scope: entry.scope,
        status: entry.status,
        source: entry.source,
        ownerName: entry.ownerName,
        parameters: entry.parameters,
        approvedUses: entry.approvedUses ?? [],
        provenance: entry.provenance ?? undefined,
        approvedAt: entry.status === 'APPROVED' ? new Date() : undefined,
        approvedBy: entry.status === 'APPROVED' ? 'system-seed' : undefined,
      },
      update: {
        displayName: entry.displayName,
        description: entry.description,
        version: entry.version,
        scope: entry.scope,
        source: entry.source,
        ownerName: entry.ownerName,
        parameters: entry.parameters,
        approvedUses: entry.approvedUses ?? [],
        provenance: entry.provenance ?? undefined,
      },
    });
  }

  async approve(id: string, approvedBy: string) {
    const s = await this.getById(id);
    if (s.status === 'APPROVED')
      throw new ConflictException('Already approved');
    if (s.status === 'RETIRED')
      throw new ConflictException('Cannot approve retired scenario');
    return this.prisma.governedScenario.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy },
    });
  }

  async retire(id: string, reason: string) {
    const s = await this.getById(id);
    if (s.status === 'RETIRED') throw new ConflictException('Already retired');
    return this.prisma.governedScenario.update({
      where: { id },
      data: { status: 'RETIRED', retiredAt: new Date(), retiredReason: reason },
    });
  }

  async getApproved(scope?: string) {
    const where: Record<string, unknown> = { status: 'APPROVED' };
    if (scope) where.scope = scope;
    return this.prisma.governedScenario.findMany({
      where,
      orderBy: { scenarioKey: 'asc' },
    });
  }
}
