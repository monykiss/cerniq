import { Module } from '@nestjs/common';
import { SOC2EvidenceService } from './soc2-evidence.service';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceController } from './compliance.controller';

@Module({
  controllers: [ComplianceController],
  providers: [SOC2EvidenceService, ComplianceReportService],
  exports: [SOC2EvidenceService, ComplianceReportService],
})
export class ComplianceModule {}
