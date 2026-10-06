import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from '../alm/alm-enterprise.service';
import { AlmService } from '../alm/alm.service';
import { CSVIngestionService } from '../alm/csv-ingestion.service';
import {
  PR_COOP_BENCHMARKS,
  type SectorBenchmarks,
} from '../alm/benchmarks/pr-cooperativa-benchmarks';
import type { AnalyzeRequestDto } from './dto/analyze-request.dto';

export interface ApiAnalysisResult {
  analysisId: string;
  institutionName: string;
  institutionType: string;
  framework: string;
  period: string;
  ratios: any[];
  durationGap: any;
  niiSensitivity: any;
  lcr: any;
  examReadinessScore: number;
  overallStatus: string;
  recommendations: string[];
  benchmarks: SectorBenchmarks;
  summary: any;
  createdAt: string;
}

@Injectable()
export class ApiV1Service {
  private readonly logger = new Logger(ApiV1Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly almService: AlmService,
    private readonly csvIngestion: CSVIngestionService,
  ) {}

  /**
   * Run a full ALM analysis from raw balance sheet rows.
   * Creates a temporary workspace + institution, imports the rows,
   * runs the analysis, stores the result, and returns it.
   */
  async analyzeFromRows(
    userId: string,
    dto: AnalyzeRequestDto,
  ): Promise<ApiAnalysisResult> {
    this.logger.log(
      `API analysis: ${dto.institutionName} (${dto.rows.length} rows, ${dto.framework})`,
    );

    // Normalize rates: if >1, treat as percentage, convert to decimal
    const normalizedRows = dto.rows.map((row) => ({
      ...row,
      rate: row.rate > 1 ? row.rate / 100 : row.rate,
    }));

    // Create a temporary workspace for this API analysis
    const workspace = await this.prisma.workspace.create({
      data: {
        name: `API Analysis: ${dto.institutionName}`,
        ownerId: userId,
      },
    });

    // Calculate total assets from rows
    const totalAssets = normalizedRows
      .filter((r) => r.category === 'asset')
      .reduce((sum, r) => sum + Number(r.balance), 0);

    // Create institution
    const institution = await this.almEnterprise.createInstitution({
      workspaceId: workspace.id,
      name: dto.institutionName,
      type: dto.institutionType,
      totalAssets,
      currency: 'USD',
      reportingDate: dto.reportingDate || new Date().toISOString(),
    });

    // Import balance sheet items
    await this.almEnterprise.importBalanceSheetItems(
      institution.id,
      normalizedRows,
    );

    // Run COSSEC compliance analysis
    const compliance = await this.almEnterprise.getCOSSECCompliance(
      institution.id,
    );

    // Run ALM summary (includes duration gap, NII sensitivity, LCR)
    const almSummary = await this.almEnterprise.getALMSummary(
      institution.id,
      dto.rateShocksBps,
    );

    // Store as an analysis run
    const analysisRun = await this.prisma.analysisRun.create({
      data: {
        institutionId: institution.id,
        createdByUserId: userId,
        status: 'COMPLETED',
        analysisType: 'api_full_analysis',
        triggeredBy: 'public_api',
        modelVersion: 'alm-v1',
        scenarioSet: 'base_parallel_shocks',
        assumptions: {},
        parameterSnapshot: {
          engine: 'nest-alm',
          framework: dto.framework,
          period: dto.period,
          rowCount: dto.rows.length,
        },
        balanceSheetSnapshot: { rows: normalizedRows },
        resultSummary: {
          compliance,
          almSummary,
        },
        completedAt: new Date(),
      },
    });

    return {
      analysisId: analysisRun.id,
      institutionName: dto.institutionName,
      institutionType: dto.institutionType,
      framework: dto.framework,
      period: dto.period,
      ratios: compliance.ratios,
      durationGap: almSummary.durationGap,
      niiSensitivity: almSummary.niiSensitivity,
      lcr: almSummary.liquidity,
      examReadinessScore: compliance.examReadinessScore,
      overallStatus: compliance.overallStatus,
      recommendations: almSummary.recommendations,
      benchmarks: PR_COOP_BENCHMARKS,
      summary: compliance.summary,
      createdAt: analysisRun.createdAt.toISOString(),
    };
  }

  /**
   * Run analysis from CSV content.
   */
  async analyzeFromCSV(
    userId: string,
    csvContent: string,
    institutionName: string,
    institutionType: string,
    framework: string,
    period: string,
  ): Promise<ApiAnalysisResult> {
    const parseResult = this.csvIngestion.parseCSV(csvContent);

    if (!parseResult.valid) {
      throw new BadRequestException({
        success: false,
        error: 'CSV validation failed',
        details: parseResult.errors,
        summary: parseResult.summary,
      });
    }

    return this.analyzeFromRows(userId, {
      rows: parseResult.items.map((item) => ({
        ...item,
        // rate already normalized by CSV parser
      })),
      institutionName,
      institutionType,
      framework,
      period,
    });
  }

  /**
   * Retrieve a previously stored analysis by ID.
   */
  async getAnalysis(userId: string, analysisId: string): Promise<any> {
    const run = await this.prisma.analysisRun.findFirst({
      where: {
        id: analysisId,
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
      throw new NotFoundException(`Analysis ${analysisId} not found`);
    }

    const resultSummary = run.resultSummary;

    return {
      analysisId: run.id,
      status: run.status,
      analysisType: run.analysisType,
      triggeredBy: run.triggeredBy,
      institution: {
        ...run.institution,
        reportingDate: run.institution.reportingDate.toISOString(),
      },
      parameterSnapshot: run.parameterSnapshot,
      result: resultSummary || null,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() || null,
    };
  }

  /**
   * Return PR cooperativa sector benchmarks.
   */
  getBenchmarks(): SectorBenchmarks {
    return PR_COOP_BENCHMARKS;
  }

  /**
   * Return supported regulatory frameworks.
   */
  getFrameworks() {
    return [
      {
        id: 'cossec',
        name: 'COSSEC (PR Cooperativas)',
        description:
          'Corporacion para la Supervision y Seguro de Cooperativas de Puerto Rico. ' +
          '12 regulatory ratios covering capital adequacy, asset quality, liquidity, ' +
          'interest rate risk, and concentration risk.',
        ratioCount: 12,
        supportedInstitutionTypes: ['cooperativa', 'credit_union'],
        region: 'Puerto Rico',
      },
      {
        id: 'ncua',
        name: 'NCUA (US Credit Unions)',
        description:
          'National Credit Union Administration. CAMEL-based examination framework ' +
          'for federally insured credit unions. Uses COSSEC ratios as proxy.',
        ratioCount: 12,
        supportedInstitutionTypes: ['credit_union', 'cooperativa'],
        region: 'United States',
      },
    ];
  }
}
