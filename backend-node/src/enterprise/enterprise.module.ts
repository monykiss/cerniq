import { Module } from '@nestjs/common';
import { EnterpriseBatchService } from './enterprise-batch.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { EnterpriseController } from './enterprise.controller';
import { ApiKeyAuthGuard } from '../api-v1/guards/api-key-auth.guard';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';

/**
 * Enterprise Module — W3-7
 *
 * Provides the Enterprise tier ($2,500/mo) API surface:
 * - Bulk report generation with batch management
 * - Webhook delivery with HMAC-SHA256 signatures and retry logic
 * - API key authentication via `ApiKeyAuthGuard` (Authorization: Bearer
 *   OR X-Api-Key — the guard supports both; see commit 97e588da)
 * - Org-membership IDOR check on body-supplied organizationId via
 *   `OrgMembershipGuard.verifyMembership()` (follow-up commit after
 *   e602c1d7, mirrors agents.controller closure 6b73eb24)
 *
 * `ApiKeyAuthGuard` is registered here because @UseGuards() requires the
 * guard class to be resolvable in the consuming module's DI scope.
 * `OrgMembershipGuard` is also registered as a provider because it is
 * consumed as a service (verifyMembership is the public primitive),
 * not as a guard via @UseGuards — same registration shape AgentsModule
 * uses (commit 6b73eb24 §2). All guard deps — PrismaService (@Global),
 * PlatformAccessService (@Global AuthModule.exports) — are globally
 * available, so no module imports section change.
 */
@Module({
  controllers: [EnterpriseController],
  providers: [
    EnterpriseBatchService,
    WebhookDeliveryService,
    ApiKeyAuthGuard,
    OrgMembershipGuard,
  ],
  exports: [EnterpriseBatchService],
})
export class EnterpriseModule {}
