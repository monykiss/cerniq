import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Logger,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  EnterpriseBatchService,
  type EnterpriseBatchWithProgress,
} from './enterprise-batch.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import {
  ApiKeyAuthGuard,
  type ApiKeyUser,
} from '../api-v1/guards/api-key-auth.guard';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import {
  CreateBatchBodySchema,
  BatchIdParamSchema,
  parseOrThrow,
} from './enterprise.dto';

interface AuthedRequest {
  apiUser: ApiKeyUser;
  user?: {
    access?: { isPlatformAdmin?: boolean };
  };
}

/**
 * Enterprise API Controller — $2,500/mo tier.
 * Provides bulk report generation, batch management, and webhook delivery logs.
 *
 * Authentication: `@UseGuards(ApiKeyAuthGuard)` at class level. The guard
 * reads the API key from either `Authorization: Bearer <api-key>` (Public
 * API v1 convention, preferred) or `X-Api-Key: <api-key>` (legacy
 * Enterprise convention, supported for backward compatibility — see
 * `api-v1/guards/api-key-auth.guard.ts` extractApiKey()). Pre-migration
 * (`97e588da` and earlier) this controller used an inline
 * `validateApiKey()` helper that (a) hashed keys with plain SHA-256 while
 * the rest of the system uses HMAC-with-pepper (`hashApiKey()` from
 * `auth/api-key.util.ts`), so real customer-issued keys never matched
 * any stored hash, and (b) passed the raw API key into `requestedBy` for
 * the bulk-batch record. The guard fixes both: canonical HMAC hash means
 * real keys authenticate, and `req.apiUser.userId` is populated for
 * `requestedBy` lineage. AUTH_COVERAGE_AUDIT.md Pattern #4 closure.
 */
@Controller('api/v1/enterprise')
@UseGuards(ApiKeyAuthGuard)
export class EnterpriseController {
  private readonly logger = new Logger(EnterpriseController.name);

  constructor(
    private readonly batchService: EnterpriseBatchService,
    private readonly webhookService: WebhookDeliveryService,
    private readonly orgMembership: OrgMembershipGuard,
  ) {}

  // ─── POST /api/v1/enterprise/reports/bulk ───────────────────────────────

  @Post('reports/bulk')
  @HttpCode(HttpStatus.CREATED)
  async createBatch(@Req() req: AuthedRequest, @Body() body: unknown) {
    let dto;
    try {
      dto = parseOrThrow(CreateBatchBodySchema, body);
    } catch (err: any) {
      throw new BadRequestException(err.issues ?? err.message);
    }

    // IDOR closure (follow-up to e602c1d7 auth migration). The dto carries
    // a body-supplied `organizationId`; without this check, any caller
    // with a valid Enterprise API key could submit batches against any
    // org they could guess or learn (the API key authenticates the user,
    // but the user is not implicitly authorized for every org). Mirrors
    // the agents.controller closure pattern (commit 6b73eb24 §3) — the
    // primitive throws `ForbiddenException` on non-membership and
    // fail-closes on Prisma errors.
    await this.orgMembership.verifyMembership(
      dto.organizationId,
      req.apiUser.userId,
      req.user?.access?.isPlatformAdmin === true,
    );

    const batch = await this.batchService.createBatch({
      ...dto,
      // Guard populates req.apiUser with the resolved user — `userId` is
      // the canonical identity, replacing the pre-migration
      // `requestedBy: apiKey` raw-key leak (97e588da §latent-bug).
      requestedBy: req.apiUser.userId,
    });

    this.logger.log({
      msg: 'Bulk report batch created',
      batchId: batch.id,
      organizationId: dto.organizationId,
    });

    return {
      batchId: batch.id,
      status: batch.status,
      totalItems: batch.totalItems,
      createdAt: batch.createdAt.toISOString(),
      _links: {
        status: `/api/v1/enterprise/reports/batch/${batch.id}/status`,
        details: `/api/v1/enterprise/reports/batch/${batch.id}`,
        cancel: `/api/v1/enterprise/reports/batch/${batch.id}`,
      },
    };
  }

  // ─── Auth helper for batchId routes ─────────────────────────────────────
  //
  // Closes the IDOR follow-up flagged in ff1ce9e4 §"Out of scope". The 4
  // batchId-based routes (getBatch, getBatchStatus, cancelBatch,
  // getWebhookLog) accept a UUID without checking that the caller belongs
  // to the batch's owning organization. Unguessable UUIDs help, but the
  // IDs leak via logs, webhook URLs, and the createBatch response — once
  // an ID is known, any valid Enterprise key could read/cancel it.
  //
  // The helper fetches the batch (NotFoundException from
  // batchService.getBatch propagates as 404), then runs verifyMembership
  // on the batch's organizationId. Forbidden from verifyMembership
  // propagates as 403 to the caller. Returns the batch so callers that
  // already need it (getBatch, getBatchStatus) avoid the second fetch.
  //
  // Anti-enumeration note: we keep the 404-vs-403 distinction rather
  // than collapsing both to 404. The batchId is a v4 UUID — the side
  // channel ("does this ID exist?") leaks effectively zero information
  // because brute-forcing UUIDs is infeasible.
  private async assertBatchAccess(
    batchId: string,
    req: AuthedRequest,
  ): Promise<EnterpriseBatchWithProgress> {
    const batch = await this.batchService.getBatch(batchId);
    await this.orgMembership.verifyMembership(
      batch.organizationId,
      req.apiUser.userId,
      req.user?.access?.isPlatformAdmin === true,
    );
    return batch;
  }

  // ─── GET /api/v1/enterprise/reports/batch/:batchId ──────────────────────

  @Get('reports/batch/:batchId')
  async getBatch(@Req() req: AuthedRequest, @Param() params: unknown) {
    const { batchId } = parseOrThrow(BatchIdParamSchema, params);
    const batch = await this.assertBatchAccess(batchId, req);

    return {
      batchId: batch.id,
      status: batch.status,
      batchType: batch.batchType,
      priority: batch.priority,
      totalItems: batch.totalItems,
      completedItems: batch.completedItems,
      failedItems: batch.failedItems,
      progressPercent: batch.progressPercent,
      estimatedCompletionAt: batch.estimatedCompletionAt ?? null,
      outputFormat: batch.outputFormat,
      errorLog: batch.errorLog,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
      completedAt: batch.completedAt?.toISOString() ?? null,
    };
  }

  // ─── GET /api/v1/enterprise/reports/batch/:batchId/status ───────────────
  // Lightweight polling endpoint — returns only status fields.

  @Get('reports/batch/:batchId/status')
  async getBatchStatus(@Req() req: AuthedRequest, @Param() params: unknown) {
    const { batchId } = parseOrThrow(BatchIdParamSchema, params);
    const batch = await this.assertBatchAccess(batchId, req);

    return {
      batchId: batch.id,
      status: batch.status,
      progressPercent: batch.progressPercent,
      completedItems: batch.completedItems,
      failedItems: batch.failedItems,
      totalItems: batch.totalItems,
      estimatedCompletionAt: batch.estimatedCompletionAt ?? null,
    };
  }

  // ─── DELETE /api/v1/enterprise/reports/batch/:batchId ───────────────────

  @Delete('reports/batch/:batchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelBatch(@Req() req: AuthedRequest, @Param() params: unknown) {
    const { batchId } = parseOrThrow(BatchIdParamSchema, params);
    await this.assertBatchAccess(batchId, req);
    await this.batchService.cancelBatch(batchId);
  }

  // ─── GET /api/v1/enterprise/webhooks/:batchId ───────────────────────────

  @Get('webhooks/:batchId')
  async getWebhookLog(@Req() req: AuthedRequest, @Param() params: unknown) {
    const { batchId } = parseOrThrow(BatchIdParamSchema, params);
    await this.assertBatchAccess(batchId, req);
    const logs = await this.webhookService.getDeliveryLog(batchId);

    return {
      batchId,
      deliveries: logs.map((log) => ({
        id: log.id,
        event: log.event,
        attempt: log.attempt,
        maxAttempts: log.maxAttempts,
        status: log.status,
        httpStatus: log.httpStatus,
        error: log.error,
        createdAt: log.createdAt.toISOString(),
        deliveredAt: log.deliveredAt?.toISOString() ?? null,
        nextRetryAt: log.nextRetryAt?.toISOString() ?? null,
      })),
    };
  }
}
