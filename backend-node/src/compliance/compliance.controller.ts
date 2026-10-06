import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { ComplianceReportService } from './compliance-report.service';
import { AdminKeyGuard } from '../auth/admin-key.guard';

// Migration #2 of 6 (after f323b3fb / jobs/admin.controller pilot):
// drops the inline `verifyAdmin(headerKey)` helper in favor of the
// canonical `AdminKeyGuard` class. AuthModule is `@Global()` (peer
// 6b317c44), so no module-level import is needed — NestJS resolves
// AdminKeyGuard from the global provider registry. Observable behavior
// is identical: 401 `Invalid admin key` on missing/empty/mismatched
// `x-admin-key`, constant-time compare against `process.env.ADMIN_KEY`.
// Four remaining controllers (app.controller, audit, cossec-ingest,
// sample-report) follow as their own focused commits.
@Controller('api/admin/compliance')
@UseGuards(AdminKeyGuard)
export class ComplianceController {
  private readonly logger = new Logger(ComplianceController.name);

  constructor(private readonly reportService: ComplianceReportService) {}

  /**
   * GET /api/admin/compliance/soc2-evidence
   *
   * Returns a comprehensive SOC 2 Type II evidence package.
   * Protected by ADMIN_KEY header — only internal tooling and
   * auditors with the key can access this endpoint (enforced by
   * `AdminKeyGuard` at class level).
   */
  @Get('soc2-evidence')
  async getSOC2Evidence() {
    this.logger.log('SOC 2 evidence report requested');

    const report = await this.reportService.generateSOC2Evidence();

    return {
      ok: true,
      data: report,
    };
  }
}
