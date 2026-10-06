import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Logger,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { InstitutionScopeGuard } from '../../agent-api/guards/institution-scope.guard';
import { ReportArtifactService } from './report-artifact.service';

@ApiTags('Report Artifacts')
@ApiBearerAuth('BearerAuth')
@Controller('api/report-artifacts')
@UseGuards(AuthGuard, InstitutionScopeGuard, RolesGuard)
export class ReportArtifactController {
  private readonly logger = new Logger(ReportArtifactController.name);

  constructor(private readonly artifactService: ReportArtifactService) {}

  @Get('institution/:institutionId')
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({
    summary: 'List report artifacts for an institution',
    description:
      'Returns immutable artifact records sorted by generation date (newest first).',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiResponse({ status: 200, description: 'Artifact list' })
  async listForInstitution(
    @Param('institutionId') institutionId: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.artifactService.listForInstitution(institutionId, take);
  }

  @Get('run/:analysisRunId')
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({
    summary: 'List artifacts produced by a specific analysis run',
  })
  @ApiParam({ name: 'analysisRunId', description: 'AnalysisRun UUID' })
  @ApiResponse({ status: 200, description: 'Artifact list for run' })
  async listForAnalysisRun(@Param('analysisRunId') analysisRunId: string) {
    return this.artifactService.listForAnalysisRun(analysisRunId);
  }

  @Get(':id')
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({ summary: 'Get artifact by ID' })
  @ApiParam({ name: 'id', description: 'Artifact UUID' })
  @ApiResponse({ status: 200, description: 'Artifact record' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getById(@Param('id') id: string) {
    return this.artifactService.getById(id);
  }

  @Get('checksum/:checksum')
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({
    summary: 'Look up artifact by content checksum',
    description:
      'Given a SHA-256 checksum, returns the artifact record that matches. ' +
      'Use this to verify whether a distributed PDF was produced by CerniQ.',
  })
  @ApiParam({
    name: 'checksum',
    description: 'SHA-256 checksum (sha256:<hex>)',
    example: 'sha256:abc123...',
  })
  @ApiResponse({ status: 200, description: 'Artifact record or null' })
  async findByChecksum(@Param('checksum') checksum: string) {
    const artifact = await this.artifactService.findByChecksum(checksum);
    return { found: !!artifact, artifact };
  }

  @Post('verify/:id')
  @Roles('OWNER', 'ANALYST')
  @ApiOperation({
    summary: 'Verify artifact integrity',
    description:
      'Accepts a base64-encoded content buffer and verifies its SHA-256 ' +
      'against the stored checksum. Returns valid=true if they match.',
  })
  @ApiParam({ name: 'id', description: 'Artifact UUID' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  @ApiResponse({ status: 400, description: 'Missing content' })
  @ApiResponse({ status: 404, description: 'Artifact not found' })
  async verify(
    @Param('id') id: string,
    @Body() body: { contentBase64: string },
  ) {
    if (!body.contentBase64) {
      throw new BadRequestException('contentBase64 is required');
    }
    const content = Buffer.from(body.contentBase64, 'base64');
    return this.artifactService.verify(id, content);
  }
}
