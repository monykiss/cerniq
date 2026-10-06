import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  AlmEnterpriseService,
  type ALMSummaryResult,
} from './alm-enterprise.service';
import {
  StressTestingService,
  type MonteCarloParams,
  type StressTestResult,
} from './stress-testing/stress-testing.service';
import { type CreateAnalysisRunDto } from './dto/create-analysis-run.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

const DEFAULT_RATE_SHOCKS = [-300, -200, -100, -50, 0, 50, 100, 200, 300];
const DEFAULT_STRESS_PARAMS: MonteCarloParams = {
  paths: 1000,
  horizon: 12,
  volatility: 150,
  meanReversion: 0.15,
};

function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type PersistedRun = {
  id: string;
  institutionId: string;
  createdByUserId: string;
  status: string;
  analysisType: string;
  triggeredBy: string;
  modelVersion: string;
  scenarioSet: string;
  assumptions: unknown;
  parameterSnapshot: unknown;
  balanceSheetSnapshot: unknown;
  resultSummary: unknown;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  institution: {
    id: string;
    name: string;
    type: string;
    totalAssets: number;
    currency: string;
    reportingDate: Date;
  };
};

@Injectable()
export class AnalysisRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly stressTesting: StressTestingService,
  ) {}

  async createRun(userId: string, dto: CreateAnalysisRunDto) {
    const institution = await this.assertInstitutionAccess(
      dto.institutionId,
      userId,
    );
    const normalizedRateShocks = this.normalizeRateShocks(dto.rateShocks);
    const stressParams = this.normalizeStressParams(dto.stressTesting);
    const balanceSheetSnapshot = toJsonValue(
      await this.almEnterprise.getBalanceSheetSnapshot(dto.institutionId),
    );

    const parameterSnapshot = {
      engine: 'nest-alm',
      analysisType: dto.analysisType || 'full_analysis',
      rateShocks: normalizedRateShocks,
      stressTesting: stressParams,
      reportingDate: institution.reportingDate.toISOString(),
      fedFundsRateBps: parseInt(process.env.FED_FUNDS_RATE_BPS || '450', 10),
      liquiditySource: 'latest_position_or_derived',
    };

    const run = await this.prisma.analysisRun.create({
      data: {
        institutionId: dto.institutionId,
        createdByUserId: userId,
        analysisType: dto.analysisType || 'full_analysis',
        triggeredBy: dto.triggeredBy || 'manual_api',
        modelVersion: dto.modelVersion || 'alm-v1',
        scenarioSet:
          dto.scenarioSet || this.deriveScenarioSet(normalizedRateShocks),
        assumptions: toJsonValue(dto.assumptions || {}),
        parameterSnapshot: toJsonValue(parameterSnapshot),
        balanceSheetSnapshot,
      },
      include: {
        institution: {
          select: {
            id: true,
            name: true,
            type: true,
            totalAssets: true,
            currency: true,
            reportingDate: true,
          },
        },
      },
    });

    try {
      const [summary, stressTest] = await Promise.all([
        this.almEnterprise.getALMSummary(
          dto.institutionId,
          normalizedRateShocks,
        ),
        this.stressTesting.runFullStressTest(dto.institutionId, stressParams),
      ]);

      const resultSummary = toJsonValue({
        summary,
        stressTest,
      });

      const completedRun = await this.prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          resultSummary,
        },
        include: {
          institution: {
            select: {
              id: true,
              name: true,
              type: true,
              totalAssets: true,
              currency: true,
              reportingDate: true,
            },
          },
        },
      });

      return this.serializeRun(completedRun);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Analysis run failed';

      const failedRun = await this.prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message,
        },
        include: {
          institution: {
            select: {
              id: true,
              name: true,
              type: true,
              totalAssets: true,
              currency: true,
              reportingDate: true,
            },
          },
        },
      });

      return this.serializeRun(failedRun);
    }
  }

  async listRuns(
    userId: string,
    institutionId?: string,
    pagination?: PaginationQueryDto,
  ) {
    const page = pagination?.page || 1;
    const pageSize = pagination?.pageSize || 20;
    const where = {
      createdByUserId: userId,
      ...(institutionId ? { institutionId } : {}),
    };
    const include = {
      institution: {
        select: {
          id: true,
          name: true,
          type: true,
          totalAssets: true,
          currency: true,
          reportingDate: true,
        },
      },
    };

    const [runs, total] = await Promise.all([
      this.prisma.analysisRun.findMany({
        where,
        include,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: pagination?.sortOrder || 'desc' },
      }),
      this.prisma.analysisRun.count({ where }),
    ]);

    return {
      items: runs.map((run: any) => this.serializeRun(run)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getRun(userId: string, runId: string) {
    const run = await this.prisma.analysisRun.findFirst({
      where: {
        id: runId,
        createdByUserId: userId,
      },
      include: {
        institution: {
          select: {
            id: true,
            name: true,
            type: true,
            totalAssets: true,
            currency: true,
            reportingDate: true,
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException('Analysis run not found');
    }

    return this.serializeRun(run);
  }

  private async assertInstitutionAccess(institutionId: string, userId: string) {
    const institution = await this.prisma.institution.findFirst({
      where: {
        id: institutionId,
        workspace: {
          ownerId: userId,
        },
      },
      select: {
        id: true,
        name: true,
        reportingDate: true,
      },
    });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    return institution;
  }

  private normalizeRateShocks(rateShocks?: number[]): number[] {
    if (!rateShocks || rateShocks.length === 0) {
      return [...DEFAULT_RATE_SHOCKS];
    }

    const unique = Array.from(
      new Set(rateShocks.map((value) => Math.trunc(value))),
    );
    return unique.sort((a, b) => a - b);
  }

  private normalizeStressParams(
    params?: CreateAnalysisRunDto['stressTesting'],
  ): MonteCarloParams {
    return {
      paths: params?.paths ?? DEFAULT_STRESS_PARAMS.paths,
      horizon: params?.horizon ?? DEFAULT_STRESS_PARAMS.horizon,
      volatility: params?.volatility ?? DEFAULT_STRESS_PARAMS.volatility,
      meanReversion:
        params?.meanReversion ?? DEFAULT_STRESS_PARAMS.meanReversion,
    };
  }

  private deriveScenarioSet(rateShocks: number[]): string {
    const isDefault =
      rateShocks.length === DEFAULT_RATE_SHOCKS.length &&
      rateShocks.every((value, index) => value === DEFAULT_RATE_SHOCKS[index]);

    return isDefault
      ? 'base_parallel_shocks'
      : `custom_${rateShocks.join('_')}`;
  }

  private serializeRun(run: PersistedRun) {
    const resultSummary = run.resultSummary as
      | {
          summary?: ALMSummaryResult;
          stressTest?: StressTestResult;
        }
      | null
      | undefined;

    return {
      id: run.id,
      institutionId: run.institutionId,
      createdByUserId: run.createdByUserId,
      status: run.status,
      analysisType: run.analysisType,
      triggeredBy: run.triggeredBy,
      modelVersion: run.modelVersion,
      scenarioSet: run.scenarioSet,
      assumptions: run.assumptions,
      parameterSnapshot: run.parameterSnapshot,
      balanceSheetSnapshot: run.balanceSheetSnapshot,
      resultSummary: resultSummary || null,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
      institution: {
        ...run.institution,
        reportingDate: run.institution.reportingDate.toISOString(),
      },
    };
  }
}
