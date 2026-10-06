/**
 * ReportArtifactService — FAANG Audit P1 #4: Immutable report lineage.
 *
 * Every generated report is recorded as an immutable artifact with:
 *   - Which AnalysisRun produced the inputs
 *   - Which model versions were used (from preflight modelLineage)
 *   - SHA-256 checksum of the generated content
 *   - Preflight gaps present at generation time
 *
 * Artifacts are append-only: no updates, no deletes. An auditor can
 * take any distributed PDF, compute its SHA-256, look up the artifact,
 * and trace back to the exact models, data, and gaps that produced it.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma.service';
import type { ModelLineageEntry } from './report-preflight.service';
import type { DataGap } from './data-gap';

export interface CreateArtifactInput {
  institutionId: string;
  analysisRunId?: string;
  reportJobId?: string;
  format:
    | 'PDF_ES'
    | 'PDF_EN'
    | 'EXCEL'
    | 'JSON_BINDER'
    | 'CSV_TEMPLATE'
    | 'CAEL_JSON'
    | 'CAEL_HTML';
  language?: string;
  templateVersion?: string;
  content: Buffer;
  storageLocator: string;
  modelLineage: ModelLineageEntry[];
  datasetVersions?: Record<string, unknown>;
  preflightGaps?: DataGap[];
  preflightReady?: boolean;
  generatedBy?: string;
}

export interface ArtifactRecord {
  id: string;
  institutionId: string;
  format: string;
  contentChecksum: string;
  sizeBytes: number;
  storageLocator: string;
  modelLineageSnapshot: unknown;
  preflightReady: boolean;
  generatedAt: Date;
}

@Injectable()
export class ReportArtifactService {
  private readonly logger = new Logger(ReportArtifactService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a generated report as an immutable artifact.
   * Computes SHA-256 checksum from content buffer.
   */
  async record(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const checksum = `sha256:${crypto.createHash('sha256').update(input.content).digest('hex')}`;
    const sizeBytes = input.content.length;

    const artifact = await this.prisma.reportArtifact.create({
      data: {
        institutionId: input.institutionId,
        analysisRunId: input.analysisRunId,
        reportJobId: input.reportJobId,
        format: input.format,
        language: input.language,
        templateVersion: input.templateVersion ?? 'alm-v1',
        contentChecksum: checksum,
        sizeBytes,
        storageLocator: input.storageLocator,
        modelLineageSnapshot: input.modelLineage as any,
        datasetVersions: input.datasetVersions ?? undefined,
        preflightGaps: (input.preflightGaps as any) ?? undefined,
        preflightReady: input.preflightReady ?? false,
        generatedBy: input.generatedBy,
      },
    });

    this.logger.log({
      event: 'artifact_recorded',
      id: artifact.id,
      institutionId: input.institutionId,
      format: input.format,
      checksum,
      sizeBytes,
      modelCount: input.modelLineage.length,
    });

    return artifact as ArtifactRecord;
  }

  /** Look up an artifact by its content checksum. */
  async findByChecksum(checksum: string): Promise<ArtifactRecord | null> {
    return this.prisma.reportArtifact.findFirst({
      where: { contentChecksum: checksum },
    }) as Promise<ArtifactRecord | null>;
  }

  /** Get artifact by id. */
  async getById(id: string): Promise<ArtifactRecord> {
    const a = await this.prisma.reportArtifact.findUnique({ where: { id } });
    if (!a) throw new NotFoundException(`Report artifact ${id} not found`);
    return a as ArtifactRecord;
  }

  /** List artifacts for an institution, most recent first. */
  async listForInstitution(
    institutionId: string,
    limit = 50,
  ): Promise<ArtifactRecord[]> {
    return this.prisma.reportArtifact.findMany({
      where: { institutionId },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    }) as Promise<ArtifactRecord[]>;
  }

  /** List artifacts for an analysis run. */
  async listForAnalysisRun(analysisRunId: string): Promise<ArtifactRecord[]> {
    return this.prisma.reportArtifact.findMany({
      where: { analysisRunId },
      orderBy: { generatedAt: 'desc' },
    }) as Promise<ArtifactRecord[]>;
  }

  /**
   * Verify an artifact's integrity by comparing a computed checksum
   * against the stored checksum.
   */
  async verify(
    id: string,
    content: Buffer,
  ): Promise<{ valid: boolean; stored: string; computed: string }> {
    const artifact = await this.getById(id);
    const computed = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
    return {
      valid: artifact.contentChecksum === computed,
      stored: artifact.contentChecksum,
      computed,
    };
  }
}
