import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AuthModule } from '../auth/auth.module';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { AgentTrustController } from './agent-trust.controller';
import { AgentTrustService } from './agent-trust.service';
import { HedgeLanguageDetector } from './hedge-language.detector';
import { NumberCitationValidator } from './number-citation.validator';
import { OutputSchemaValidator } from './output-schema.validator';
import { PiiRedactorService } from './pii-redactor.service';
import { PromptInjectionShield } from './prompt-injection.shield';

// PrismaModule + AuthModule imports + InstitutionScopeGuard provider land
// here so AgentTrustController can call institutionScope.verifyOwnership()
// before invoking the trust evaluator. Closes AUTH_COVERAGE_AUDIT gap #2:
// POST /api/v1/trust/validate previously accepted institutionId+runId in
// body with no @UseGuards stack and trusted both. Mirror of e88ae20c /
// 4f9e2728's ai-advisor module wiring.
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AgentTrustController],
  providers: [
    NumberCitationValidator,
    PiiRedactorService,
    PromptInjectionShield,
    HedgeLanguageDetector,
    OutputSchemaValidator,
    AgentTrustService,
    InstitutionScopeGuard,
  ],
  exports: [
    AgentTrustService,
    NumberCitationValidator,
    PiiRedactorService,
    PromptInjectionShield,
    HedgeLanguageDetector,
    OutputSchemaValidator,
  ],
})
export class AgentTrustModule {}
