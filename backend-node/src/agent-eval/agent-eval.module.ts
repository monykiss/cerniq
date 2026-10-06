import { Module } from '@nestjs/common';
import { AgentTrustModule } from '../agent-trust/agent-trust.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';
import { AgentEvalController } from './agent-eval.controller';
import { GoldenRunnerService } from './golden-runner.service';
import { RegressionScorerService } from './regression-scorer.service';
import { ReplayRunnerService } from './replay.runner';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// AuthModule provides AuthGuard for class-level auth + JwtService for
// token verification. PrismaModule is required by InstitutionScopeGuard
// (its constructor takes PrismaService). Both added to close the
// CRITICAL unauthenticated body-trust IDOR previously open on POST
// /api/v1/eval/golden and POST /api/v1/eval/replay.
@Module({
  imports: [AgentTrustModule, AuthModule, PrismaModule],
  controllers: [AgentEvalController],
  providers: [
    RegressionScorerService,
    GoldenRunnerService,
    ReplayRunnerService,
    InstitutionScopeGuard,
  ],
  exports: [RegressionScorerService, GoldenRunnerService, ReplayRunnerService],
})
export class AgentEvalModule {}
