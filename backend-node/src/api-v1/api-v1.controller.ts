import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiV1Service } from './api-v1.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiRateLimitGuard } from './guards/api-rate-limit.guard';
import { AnalyzeRequestDto } from './dto/analyze-request.dto';
import {
  AnalysisResultResponseDto,
  BenchmarkResponseDto,
  FrameworkResponseDto,
} from './dto/analyze-response.dto';

// ═══════════════════════════════════════════════════════════════════
//  CERNIQ Public API v1 Controller
//
//  All authenticated endpoints require:
//    Authorization: Bearer <api-key>
//
//  Rate limits:
//    Standard:  100 requests/hour
//    Partner: 1,000 requests/hour
// ═══════════════════════════════════════════════════════════════════

@Controller('api/v1')
@SkipThrottle() // Use our own per-key rate limiter instead of global throttle
export class ApiV1Controller {
  private readonly logger = new Logger(ApiV1Controller.name);

  constructor(private readonly apiV1Service: ApiV1Service) {}

  // ─── Health ──────────────────────────────────────────────────────

  // verify:auth-skip — public API v1 health probe (load balancers + integrators)
  @Get('health')
  @ApiTags('System')
  @ApiOperation({ summary: 'API v1 health check' })
  @ApiResponse({
    status: 200,
    description: 'API is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        version: { type: 'string', example: '1.0.0' },
        timestamp: { type: 'string', example: '2026-03-17T12:00:00.000Z' },
      },
    },
  })
  health() {
    return {
      status: 'ok',
      version: '1.0.0',
      service: 'cerniq-api-v1',
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Frameworks (Public) ─────────────────────────────────────────

  // verify:auth-skip — public reference data (COSSEC/NCUA framework list); no PII
  @Get('frameworks')
  @ApiTags('Reference Data')
  @ApiOperation({
    summary: 'List supported regulatory frameworks',
    description:
      'Returns the list of regulatory frameworks supported by the CERNIQ analysis engine. ' +
      'Currently supports COSSEC (Puerto Rico cooperativas) and NCUA (US credit unions).',
  })
  @ApiResponse({
    status: 200,
    description: 'List of supported frameworks',
    type: [FrameworkResponseDto],
  })
  getFrameworks() {
    return this.apiV1Service.getFrameworks();
  }

  // ─── Benchmarks (Public) ─────────────────────────────────────────

  // verify:auth-skip — public PR cooperativa sector benchmarks (COSSEC Q3 2025); aggregated, no per-institution data
  @Get('benchmarks')
  @ApiTags('Benchmarks')
  @ApiOperation({
    summary: 'Get PR cooperativa sector benchmarks',
    description:
      'Returns Puerto Rico cooperativa sector benchmarks from COSSEC Q3 2025 data. ' +
      'Includes median, 25th, and 75th percentile for 10 key financial ratios.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sector benchmarks',
    type: BenchmarkResponseDto,
  })
  getBenchmarks() {
    return this.apiV1Service.getBenchmarks();
  }

  // ─── Analyze (JSON) ──────────────────────────────────────────────

  @Post('analyze')
  @UseGuards(ApiKeyAuthGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @ApiTags('ALM Analysis')
  @ApiOperation({
    summary: 'Run ALM analysis on balance sheet data',
    description:
      'Submit balance sheet line items as JSON and receive a complete ALM analysis ' +
      'including COSSEC/NCUA compliance ratios, duration gap, NII sensitivity, ' +
      'LCR, exam readiness score, and sector benchmarks. The analysis is persisted ' +
      'and can be retrieved later via GET /api/v1/analyses/:analysisId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analysis complete',
    type: AnalysisResultResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({
    status: 422,
    description: 'Validation failed — check rows and required fields',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async analyze(@Req() req: any, @Body() dto: AnalyzeRequestDto) {
    this.logger.log(
      `[API v1] analyze: ${dto.institutionName} (${dto.rows.length} rows) by ${req.apiUser?.email}`,
    );
    return this.apiV1Service.analyzeFromRows(req.apiUser.userId, dto);
  }

  // ─── Analyze (CSV Upload) ───────────────────────────────────────

  @Post('analyze/csv')
  @UseGuards(ApiKeyAuthGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @ApiTags('ALM Analysis')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Run ALM analysis from CSV upload',
    description:
      'Upload a CSV file with balance sheet data and receive a complete ALM analysis. ' +
      'The CSV must include columns: category, subcategory, name, balance, rate, duration, rateType. ' +
      'Spanish column names are also accepted.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'file',
        'institutionName',
        'institutionType',
        'framework',
        'period',
      ],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file (max 2MB)',
        },
        institutionName: {
          type: 'string',
          example: 'Cooperativa Ejemplo Este',
        },
        institutionType: {
          type: 'string',
          enum: ['cooperativa', 'credit_union', 'bank', 'community_bank'],
          example: 'cooperativa',
        },
        framework: {
          type: 'string',
          enum: ['cossec', 'ncua'],
          example: 'cossec',
        },
        period: { type: 'string', example: 'Q1-2026' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Analysis complete',
    type: AnalysisResultResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid CSV format' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.csv$/i)) {
          return cb(
            new BadRequestException('Only .csv files are accepted'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async analyzeCSV(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      institutionName: string;
      institutionType: string;
      framework: string;
      period: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('No CSV file provided');
    }
    if (
      !body.institutionName ||
      !body.institutionType ||
      !body.framework ||
      !body.period
    ) {
      throw new BadRequestException(
        'Missing required fields: institutionName, institutionType, framework, period',
      );
    }

    this.logger.log(
      `[API v1] analyze/csv: ${body.institutionName} (${file.size} bytes) by ${req.apiUser?.email}`,
    );

    const csvContent = file.buffer.toString('utf-8');
    return this.apiV1Service.analyzeFromCSV(
      req.apiUser.userId,
      csvContent,
      body.institutionName,
      body.institutionType,
      body.framework,
      body.period,
    );
  }

  // ─── Get Analysis by ID ─────────────────────────────────────────

  @Get('analyses/:analysisId')
  @UseGuards(ApiKeyAuthGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @ApiTags('ALM Analysis')
  @ApiOperation({
    summary: 'Retrieve a stored analysis by ID',
    description:
      'Retrieve a previously computed analysis result by its ID. ' +
      'Only analyses created by the API key owner are accessible.',
  })
  @ApiParam({
    name: 'analysisId',
    description: 'Analysis run ID',
    example: 'clxyz123abc',
  })
  @ApiResponse({ status: 200, description: 'Analysis result' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 404, description: 'Analysis not found' })
  async getAnalysis(@Req() req: any, @Param('analysisId') analysisId: string) {
    return this.apiV1Service.getAnalysis(req.apiUser.userId, analysisId);
  }
}
