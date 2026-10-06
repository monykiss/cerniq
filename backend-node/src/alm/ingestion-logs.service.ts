import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { type CSVParseResult } from './csv-ingestion.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

export const ALM_CSV_SCHEMA_VERSION = 'alm_csv_v1';

function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

@Injectable()
export class IngestionLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordLog(params: {
    userId: string;
    institutionId?: string | null;
    reportJobId?: string | null;
    source: 'manual_upload' | 'portal_submit';
    sourceFilename?: string;
    schemaVersion?: string;
    dryRun?: boolean;
    status: 'VALIDATED' | 'IMPORTED' | 'FAILED' | 'DRY_RUN';
    parseResult: CSVParseResult;
    importedCount?: number;
  }) {
    return this.prisma.ingestionLog.create({
      data: {
        institutionId: params.institutionId || null,
        createdByUserId: params.userId,
        reportJobId: params.reportJobId || null,
        source: params.source,
        sourceFilename: params.sourceFilename || null,
        schemaVersion: params.schemaVersion || ALM_CSV_SCHEMA_VERSION,
        dryRun: params.dryRun ?? false,
        status: params.status,
        totalRows: params.parseResult.summary.totalRows,
        validRows: params.parseResult.summary.validRows,
        errorRows: params.parseResult.summary.errorRows,
        totalAssets: params.parseResult.summary.totalAssets,
        totalLiabilities: params.parseResult.summary.totalLiabilities,
        importedCount: params.importedCount ?? 0,
        warnings: toJsonValue(params.parseResult.warnings),
        errors: toJsonValue(params.parseResult.errors),
      },
    });
  }

  async listInstitutionLogs(
    userId: string,
    institutionId: string,
    pagination?: PaginationQueryDto,
  ) {
    await this.assertInstitutionAccess(userId, institutionId);

    const page = pagination?.page || 1;
    const pageSize = pagination?.pageSize || 20;
    const where = {
      institutionId,
      createdByUserId: userId,
    };

    const [items, total] = await Promise.all([
      this.prisma.ingestionLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: pagination?.sortOrder || 'desc' },
      }),
      this.prisma.ingestionLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async listJobLogs(userId: string, reportJobId: string) {
    const job = await this.prisma.reportJob.findFirst({
      where: { id: reportJobId, userId },
      select: { id: true },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return this.prisma.ingestionLog.findMany({
      where: {
        reportJobId,
        createdByUserId: userId,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async assertInstitutionAccess(userId: string, institutionId: string) {
    const institution = await this.prisma.institution.findFirst({
      where: {
        id: institutionId,
        workspace: {
          ownerId: userId,
        },
      },
      select: { id: true },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }
  }
}
