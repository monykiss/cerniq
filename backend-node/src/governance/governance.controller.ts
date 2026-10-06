/**
 * GovernanceController — REST API for governed scenarios and benchmarks.
 *
 * Routes:
 *   GET  /api/governance/scenarios          — list governed scenarios
 *   GET  /api/governance/scenarios/:id      — single scenario
 *   POST /api/governance/scenarios/:id/approve
 *   POST /api/governance/scenarios/:id/retire
 *   GET  /api/governance/benchmarks         — list governed benchmarks
 *   GET  /api/governance/benchmarks/:id     — single benchmark
 *   POST /api/governance/benchmarks/:id/approve
 *   POST /api/governance/benchmarks/:id/retire
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { GovernedScenarioService } from './governed-scenario.service';
import { GovernedBenchmarkService } from './governed-benchmark.service';
import type {
  ScenarioScope,
  BenchmarkType,
  GovernedEntityStatus,
} from './governance.types';

@Controller('api/governance')
@UseGuards(AuthGuard)
export class GovernanceController {
  constructor(
    private readonly scenarios: GovernedScenarioService,
    private readonly benchmarks: GovernedBenchmarkService,
  ) {}

  // ── Scenarios ──

  @Get('scenarios')
  listScenarios(
    @Query('scope') scope?: ScenarioScope,
    @Query('status') status?: GovernedEntityStatus,
  ) {
    return this.scenarios.list({ scope, status });
  }

  @Get('scenarios/:id')
  getScenario(@Param('id') id: string) {
    return this.scenarios.getById(id);
  }

  @Post('scenarios/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveScenario(
    @Param('id') id: string,
    @Body() body: { approvedBy: string },
  ) {
    return this.scenarios.approve(id, body.approvedBy);
  }

  @Post('scenarios/:id/retire')
  @HttpCode(HttpStatus.OK)
  retireScenario(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.scenarios.retire(id, body.reason);
  }

  // ── Benchmarks ──

  @Get('benchmarks')
  listBenchmarks(
    @Query('benchmarkType') benchmarkType?: BenchmarkType,
    @Query('status') status?: GovernedEntityStatus,
  ) {
    return this.benchmarks.list({ benchmarkType, status });
  }

  @Get('benchmarks/:id')
  getBenchmark(@Param('id') id: string) {
    return this.benchmarks.getById(id);
  }

  @Post('benchmarks/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveBenchmark(
    @Param('id') id: string,
    @Body() body: { approvedBy: string },
  ) {
    return this.benchmarks.approve(id, body.approvedBy);
  }

  @Post('benchmarks/:id/retire')
  @HttpCode(HttpStatus.OK)
  retireBenchmark(@Param('id') id: string) {
    return this.benchmarks.retire(id);
  }
}
