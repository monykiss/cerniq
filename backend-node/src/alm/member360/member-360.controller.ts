import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { MemberLifecycleStage } from '@prisma/client';
import { AuthTenantGuard } from '../../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../../agent-api/guards/institution-scope.guard';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import {
  Member360Service,
  type MemberDirectoryResult,
  type MemberProfile,
} from './member-360.service';

const MAX_SEED_COUNT = 250;
const DEFAULT_SEED_COUNT = 50;

interface SeedDemoBody {
  count?: number;
}

/**
 * Member 360 API (Wave 3 / Layer 3 — fixture-first slice).
 *
 * A SEPARATE controller — not methods on `AlmController` — following the
 * `EwsController`/`LoanTapeController` precedent so it adds zero positional
 * constructor slots to `AlmController` (the slot-map trap, Handbook §10.2).
 *   - GET  :institutionId/members              → paginated directory
 *   - GET  :institutionId/members/:memberId    → the 360 profile
 *   - POST :institutionId/members/seed-demo    → generate fixture member book
 *
 * Auth: class-level `AuthTenantGuard` + `InstitutionScopeGuard`, same stack
 * as every other institution-scoped ALM controller.
 */
@ApiTags('ALM Analysis')
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class Member360Controller {
  private readonly logger = new Logger(Member360Controller.name);

  constructor(private readonly member360: Member360Service) {}

  @Get(':institutionId/members')
  @ApiOperation({
    summary: 'Paginated Member 360 directory for an institution',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async listMembers(
    @Param('institutionId') institutionId: string,
    @Query('stage') stageRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<MemberDirectoryResult> {
    return this.member360.listMembers(institutionId, {
      stage: this.parseStage(stageRaw),
      page: this.parsePositiveInt(pageRaw),
      pageSize: this.parsePositiveInt(pageSizeRaw),
    });
  }

  @Get(':institutionId/members/:memberId')
  @ApiOperation({ summary: 'Single-member 360 profile' })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  @ApiParam({ name: 'memberId', description: 'Member UUID' })
  async getMemberProfile(
    @Param('institutionId') institutionId: string,
    @Param('memberId') memberId: string,
  ): Promise<MemberProfile> {
    return this.member360.getMemberProfile(institutionId, memberId);
  }

  @Post(':institutionId/members/seed-demo')
  @AuditAction('member360_seed_demo')
  @ApiOperation({
    summary:
      'Generate a deterministic fixture member book for demos/sales (refuses if real member data already exists)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async seedDemo(
    @Param('institutionId') institutionId: string,
    @Body() body: SeedDemoBody,
  ) {
    const count = this.clampSeedCount(body?.count);
    this.logger.log(
      `Member 360 demo seed requested for ${institutionId}, count=${count}`,
    );
    return this.member360.seedDemoMembers(institutionId, count);
  }

  /** No parseInt (per the EwsController precedent — 'stage'+garbage would
   * silently coerce) — Number() + Number.isInteger() catches malformed input
   * so a bad query param falls back to "no filter" instead of lying. */
  private parsePositiveInt(raw?: string): number | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) return undefined;
    return parsed;
  }

  private parseStage(raw?: string): MemberLifecycleStage | undefined {
    if (!raw) return undefined;
    const upper = raw.toUpperCase();
    return (Object.values(MemberLifecycleStage) as string[]).includes(upper)
      ? (upper as MemberLifecycleStage)
      : undefined;
  }

  private clampSeedCount(raw?: number): number {
    if (raw === undefined || !Number.isFinite(raw) || raw < 1) {
      return DEFAULT_SEED_COUNT;
    }
    return Math.min(MAX_SEED_COUNT, Math.floor(raw));
  }
}
