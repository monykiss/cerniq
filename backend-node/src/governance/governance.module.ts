/**
 * GovernanceModule — FAANG Audit P1 items #2 and #3.
 *
 * Provides governed scenario library and governed benchmark datasets
 * with full lifecycle (DRAFT → APPROVED → RETIRED).
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { GovernedScenarioService } from './governed-scenario.service';
import { GovernedBenchmarkService } from './governed-benchmark.service';
import { GovernanceController } from './governance.controller';
import { GovernanceSeeder } from './governance.seeder';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [
    GovernedScenarioService,
    GovernedBenchmarkService,
    GovernanceSeeder,
    PrismaService,
    AuthGuard,
  ],
  controllers: [GovernanceController],
  exports: [GovernedScenarioService, GovernedBenchmarkService],
})
export class GovernanceModule {}
