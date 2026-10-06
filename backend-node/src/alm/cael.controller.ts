import {
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { AuditAction } from '../common/decorators/audit-action.decorator';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { CECLService } from './cecl.service';
import {
  CaelComplianceService,
  type CaelComplianceResult,
} from './cael-compliance.service';
import { CaelArtifactService } from './cael-artifact.service';
import type { ArtifactRecord } from './reports/report-artifact.service';

/**
 * CAEL Compliance API (Wave 1, W1.1 Slice 2 — dispatch + persistence).
 *
 * Exposes the three quarterly CAEL filings (Reglamento 7790 incurred-loss,
 * CAEL-with-CECL, CAEL Piloto) for one institution over the authenticated ALM
 * surface. A SEPARATE controller — NOT a method on `AlmController` — so it adds
 * zero positional-constructor slots there (the slot-map trap).
 *   - GET  :institutionId/cael           → compute the three filings (JSON).
 *   - POST :institutionId/cael/artifact  → persist them as an immutable,
 *                                          checksummed `CAEL_JSON` ReportArtifact.
 *
 * Auth: the class-level `AuthTenantGuard` + `InstitutionScopeGuard` stack mirrors
 * `AlmController` — authentication first, then tenant ownership of `:institutionId`.
 */
@ApiTags('ALM Analysis')
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class CaelController {
  private readonly logger = new Logger(CaelController.name);

  constructor(
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly cecl: CECLService,
    private readonly cael: CaelComplianceService,
    private readonly caelArtifact: CaelArtifactService,
  ) {}

  /**
   * Compute the three quarterly CAEL variants for an institution. The allowance
   * basis differs per variant — incurred-loss (Reg 8665) for 7790, lifetime WARM
   * for the CECL variant, none for Piloto — which is the reason COSSEC mandates
   * the parallel filings. D1 gaps (asset-quality unavailable, provisional bands)
   * ride along on each result; nothing is fabricated.
   */
  @Get(':institutionId/cael')
  @ApiOperation({
    summary: 'Compute the three quarterly CAEL compliance filings',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async getCaelCompliance(
    @Param('institutionId') institutionId: string,
  ): Promise<CaelComplianceResult[]> {
    this.logger.log(`CAEL compliance filings for institution ${institutionId}`);
    return this.computeVariants(institutionId);
  }

  /**
   * Generate and PERSIST the three CAEL filings as an immutable, SHA-256
   * checksummed `CAEL_JSON` ReportArtifact (model-lineage + data-gaps stamped).
   * Append-only — an auditor can re-checksum the stored filing and trace it back.
   */
  @Post(':institutionId/cael/artifact')
  @AuditAction('cael_artifact_generate')
  @ApiOperation({
    summary: 'Generate + persist the CAEL filings as a governed artifact',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async generateCaelArtifact(
    @Param('institutionId') institutionId: string,
  ): Promise<ArtifactRecord> {
    this.logger.log(
      `CAEL artifact generation for institution ${institutionId}`,
    );
    const results = await this.computeVariants(institutionId);
    return this.caelArtifact.persistFiling({ institutionId, results });
  }

  /** Run the engines + evaluate the three CAEL variants. Shared by both routes. */
  private async computeVariants(
    institutionId: string,
  ): Promise<CaelComplianceResult[]> {
    const cossec = await this.almEnterprise.getCOSSECCompliance(institutionId);
    const incurred = await this.cecl.getCECLAnalysis(
      institutionId,
      'incurredloss',
    );
    const warm = await this.cecl.getCECLAnalysis(institutionId, 'warm');

    return [
      this.cael.evaluateCaelCompliance(
        this.cael.caelInputsFromEngines('reg7790', cossec.summary, incurred),
      ),
      this.cael.evaluateCaelCompliance(
        this.cael.caelInputsFromEngines('cecl', cossec.summary, warm),
      ),
      this.cael.evaluateCaelCompliance(
        this.cael.caelInputsFromEngines('piloto', cossec.summary, null),
      ),
    ];
  }
}
