import { Module } from '@nestjs/common';
import { ExamPrepController } from './exam-prep.controller';
import { ExamPrepScoringService } from './exam-prep-scoring.service';
import { EvidencePackageService } from './evidence-package.service';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

/**
 * Exam Prep Module — W3-4
 *
 * Provides COSSEC regulatory exam readiness scoring:
 * - 12-category weighted assessment with bilingual (EN/ES) output
 * - A-F letter grade with compliance thresholds
 * - Evidence package ZIP generation for exam documentation
 * - Assessment history tracking
 *
 * PrismaModule is @Global so it does not need an explicit import.
 * StorageModule is imported at the app level and available for injection.
 * AuthModule is @Global so AuthTenantGuard resolves without explicit import;
 * InstitutionScopeGuard is provided here because AgentApiModule (its home)
 * isn't @Global — mirrors AlmModule's pattern for cross-module reuse.
 */
@Module({
  controllers: [ExamPrepController],
  providers: [
    ExamPrepScoringService,
    EvidencePackageService,
    InstitutionScopeGuard,
  ],
  exports: [ExamPrepScoringService],
})
export class ExamPrepModule {}
