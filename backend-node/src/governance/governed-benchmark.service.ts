/**
 * GovernedBenchmarkService — FAANG Audit P1 item #3.
 *
 * Managed yield curves and benchmark datasets with provenance, versioning,
 * refresh policy, and validation status. The existing YieldCurve model
 * remains for institution-specific curves; this service manages the
 * governed (institution-independent) reference datasets.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma.service';
import type {
  BenchmarkFilter,
  GovernedBenchmarkSeed,
} from './governance.types';

@Injectable()
export class GovernedBenchmarkService {
  private readonly logger = new Logger(GovernedBenchmarkService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(filter?: BenchmarkFilter) {
    const where: Record<string, unknown> = {};
    if (filter?.benchmarkType) where.benchmarkType = filter.benchmarkType;
    if (filter?.status) where.status = filter.status;
    return this.prisma.governedBenchmark.findMany({
      where,
      orderBy: [{ benchmarkType: 'asc' }, { displayName: 'asc' }],
    });
  }

  async getById(id: string) {
    const b = await this.prisma.governedBenchmark.findUnique({ where: { id } });
    if (!b) throw new NotFoundException(`Governed benchmark ${id} not found`);
    return b;
  }

  async getByKey(datasetKey: string) {
    const b = await this.prisma.governedBenchmark.findUnique({
      where: { datasetKey },
    });
    if (!b)
      throw new NotFoundException(`Benchmark key "${datasetKey}" not found`);
    return b;
  }

  async upsert(entry: GovernedBenchmarkSeed) {
    const dataChecksum = `sha256:${crypto.createHash('sha256').update(JSON.stringify(entry.data)).digest('hex')}`;
    return this.prisma.governedBenchmark.upsert({
      where: { datasetKey: entry.datasetKey },
      create: {
        datasetKey: entry.datasetKey,
        displayName: entry.displayName,
        description: entry.description,
        benchmarkType: entry.benchmarkType,
        version: entry.version,
        status: entry.status,
        asOfDate: entry.asOfDate,
        source: entry.source,
        ownerName: entry.ownerName,
        refreshPolicy: entry.refreshPolicy,
        data: entry.data,
        provenance: entry.provenance ?? undefined,
        fallbackPolicy: entry.fallbackPolicy,
        dataChecksum,
        approvedAt: entry.status === 'APPROVED' ? new Date() : undefined,
        approvedBy: entry.status === 'APPROVED' ? 'system-seed' : undefined,
      },
      update: {
        displayName: entry.displayName,
        description: entry.description,
        version: entry.version,
        source: entry.source,
        ownerName: entry.ownerName,
        refreshPolicy: entry.refreshPolicy,
        data: entry.data,
        provenance: entry.provenance ?? undefined,
        fallbackPolicy: entry.fallbackPolicy,
        dataChecksum,
      },
    });
  }

  async approve(id: string, approvedBy: string) {
    const b = await this.getById(id);
    if (b.status === 'APPROVED')
      throw new ConflictException('Already approved');
    if (b.status === 'RETIRED')
      throw new ConflictException('Cannot approve retired benchmark');
    return this.prisma.governedBenchmark.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy },
    });
  }

  async retire(id: string) {
    const b = await this.getById(id);
    if (b.status === 'RETIRED') throw new ConflictException('Already retired');
    return this.prisma.governedBenchmark.update({
      where: { id },
      data: { status: 'RETIRED', retiredAt: new Date() },
    });
  }

  async getApproved(benchmarkType?: string) {
    const where: Record<string, unknown> = { status: 'APPROVED' };
    if (benchmarkType) where.benchmarkType = benchmarkType;
    return this.prisma.governedBenchmark.findMany({
      where,
      orderBy: { datasetKey: 'asc' },
    });
  }
}
