import {
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { EwsSnapshot } from '@prisma/client';
import { AuthTenantGuard } from '../../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../../agent-api/guards/institution-scope.guard';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { AssetEWSService, type EWSResult } from '../asset-ews.service';
import {
  EwsSnapshotService,
  type EwsCaptureResult,
  type EwsTrendView,
} from './ews-snapshot.service';

/** History page-size ceiling — one year of daily snapshots. */
const MAX_HISTORY_LIMIT = 366;
const DEFAULT_HISTORY_LIMIT = 90;

/**
 * EWS watchlist API (Wave 1, W1.3 — persist + trend + alert).
 *
 * A SEPARATE controller — NOT methods on `AlmController` — so it adds zero
 * positional-constructor slots there (the slot-map trap; CaelController set
 * the precedent).
 *   - GET  :institutionId/ews           → compute the 12-indicator EWS now
 *                                         (on-demand, not persisted).
 *   - GET  :institutionId/ews/history   → persisted daily snapshots, newest
 *                                         first (?limit=, capped at 366).
 *   - GET  :institutionId/ews/trend     → latest snapshot + delta vs prior +
 *                                         the alerts that capture raised.
 *   - POST :institutionId/ews/snapshot  → capture + persist today's snapshot
 *                                         (idempotent per day; audited).
 *
 * Auth: the class-level `AuthTenantGuard` + `InstitutionScopeGuard` stack
 * mirrors `AlmController`/`CaelController` — authentication first, then
 * tenant ownership of `:institutionId`.
 */
@ApiTags('ALM Analysis')
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class EwsController {
  private readonly logger = new Logger(EwsController.name);

  constructor(
    private readonly ews: AssetEWSService,
    private readonly snapshots: EwsSnapshotService,
  ) {}

  @Get(':institutionId/ews')
  @ApiOperation({
    summary: 'Compute the 12-indicator asset-quality EWS (on demand)',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async getCurrent(
    @Param('institutionId') institutionId: string,
  ): Promise<EWSResult> {
    return this.ews.computeEWS(institutionId);
  }

  @Get(':institutionId/ews/history')
  @ApiOperation({
    summary: 'Persisted daily EWS snapshots, newest first',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async getHistory(
    @Param('institutionId') institutionId: string,
    @Query('limit') limitRaw?: string,
  ): Promise<EwsSnapshot[]> {
    return this.snapshots.getHistory(institutionId, this.parseLimit(limitRaw));
  }

  @Get(':institutionId/ews/trend')
  @ApiOperation({
    summary: 'Latest EWS snapshot + trend delta + threshold-crossing alerts',
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async getTrend(
    @Param('institutionId') institutionId: string,
  ): Promise<EwsTrendView> {
    return this.snapshots.getTrend(institutionId);
  }

  @Post(':institutionId/ews/snapshot')
  @AuditAction('ews_snapshot_capture')
  @ApiOperation({
    summary: "Capture + persist today's EWS snapshot (idempotent per day)",
  })
  @ApiParam({ name: 'institutionId', description: 'Institution UUID' })
  async captureSnapshot(
    @Param('institutionId') institutionId: string,
  ): Promise<EwsCaptureResult> {
    this.logger.log(`Manual EWS snapshot capture for ${institutionId}`);
    return this.snapshots.captureSnapshot(institutionId, {
      source: 'manual',
    });
  }

  /**
   * Safe limit parsing (no parseInt — '90abc' must not become 90): invalid
   * or out-of-range input falls back to the default rather than erroring,
   * since a bad page size is a UX nuisance, not a data-integrity issue.
   */
  private parseLimit(raw?: string): number {
    if (raw === undefined || raw.trim() === '') return DEFAULT_HISTORY_LIMIT;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_HISTORY_LIMIT;
    return Math.min(parsed, MAX_HISTORY_LIMIT);
  }
}
