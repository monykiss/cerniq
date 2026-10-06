import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EnterpriseController } from './enterprise.controller';
import { ApiKeyAuthGuard } from '../api-v1/guards/api-key-auth.guard';
import type { EnterpriseBatchService } from './enterprise-batch.service';
import type { WebhookDeliveryService } from './webhook-delivery.service';
import type { OrgMembershipGuard } from '../common/guards/org-membership.guard';

// Post-migration controller spec (commit 97e588da scaffold +
// migration #1 of 1 in this lane). The 5 admin-key behavior tests
// that used to exist on `controller.method('wrong-key')` are deleted —
// guards run at HTTP layer and direct method invocation bypasses them,
// so those tests no longer prove auth. Replaced with (a) the structural
// reflection lock guaranteeing `ApiKeyAuthGuard` is wired at class level,
// and (b) handler-delegation tests that exercise the post-guard happy
// path. The guard's own behavior (Bearer vs X-Api-Key, hash mismatch,
// revoked/expired keys, etc.) is covered by the 19-case suite in
// `api-v1/guards/api-key-auth.guard.spec.ts`.

describe('EnterpriseController', () => {
  // ─── Structural lock ───────────────────────────────────────────────────

  it('has ApiKeyAuthGuard wired at class level (reflection lock)', () => {
    // NestJS stores @UseGuards under '__guards__' metadata key.
    // The structural lock is the regression detector for "someone
    // dropped the decorator" — behavior-only tests would not detect
    // that because direct method invocation never goes through guards.
    const guards =
      Reflect.getMetadata('__guards__', EnterpriseController) ?? [];
    const names = guards.map((g: { name?: string }) => g?.name ?? String(g));
    expect(names).toContain('ApiKeyAuthGuard');
  });

  // ─── Handler delegation ────────────────────────────────────────────────

  let controller: EnterpriseController;
  let batchService: jest.Mocked<
    Pick<EnterpriseBatchService, 'createBatch' | 'getBatch' | 'cancelBatch'>
  >;
  let webhookService: jest.Mocked<
    Pick<WebhookDeliveryService, 'getDeliveryLog'>
  >;
  let orgMembership: jest.Mocked<Pick<OrgMembershipGuard, 'verifyMembership'>>;

  // A request shape with the same `apiUser` the guard would attach in prod.
  const authedReq = {
    apiUser: {
      userId: 'user-enterprise-1',
      email: 'enterprise@example.com',
      apiKeyId: 'key-1',
      keyPrefix: 'ck_live_',
      tier: 'partner' as const,
    },
    user: {
      access: { isPlatformAdmin: false },
    },
  };
  const platformAdminReq = {
    ...authedReq,
    user: { access: { isPlatformAdmin: true } },
  };

  beforeEach(() => {
    batchService = {
      createBatch: jest.fn(),
      getBatch: jest.fn(),
      cancelBatch: jest.fn(),
    };
    webhookService = {
      getDeliveryLog: jest.fn(),
    };
    orgMembership = {
      verifyMembership: jest.fn().mockResolvedValue(undefined),
    };
    controller = new EnterpriseController(
      batchService as unknown as EnterpriseBatchService,
      webhookService as unknown as WebhookDeliveryService,
      orgMembership as unknown as OrgMembershipGuard,
    );
  });

  // Proper RFC-4122 v4 UUIDs (Zod 4's `.uuid()` rejects placeholders like
  // `batch-1` and even `11111111-1111-1111-1111-111111111111` because the
  // variant digit must be 8/9/a/b — see 6b73eb24 §Zod-4-footgun).
  const UUID_BATCH = '8e8a7c7e-1234-4abc-9def-0123456789ab';
  const UUID_BATCH_2 = '9f9b8d8f-2345-4bcd-aef0-1234567890ac';
  const UUID_BATCH_3 = '0a0c9e9d-3456-4cde-bf01-23456789ab0d';
  const UUID_BATCH_4 = '1b1d0f0e-4567-4def-8012-3456789abcd0';
  const UUID_INST_1 = 'aaaaaaaa-1111-4111-8111-111111111111';
  const UUID_INST_2 = 'bbbbbbbb-2222-4222-9222-222222222222';
  const UUID_ORG = '550e8400-e29b-41d4-a716-446655440000';

  describe('POST /reports/bulk (createBatch)', () => {
    const validBody = {
      organizationId: UUID_ORG,
      batchType: 'BULK_REPORT' as const,
      priority: 'NORMAL' as const,
      institutionIds: [UUID_INST_1, UUID_INST_2],
      outputFormat: 'PDF' as const,
    };

    it('delegates to batchService.createBatch with resolved userId in requestedBy (fixes pre-migration raw-key leak)', async () => {
      const now = new Date();
      batchService.createBatch.mockResolvedValue({
        id: 'batch-1',
        status: 'PENDING',
        totalItems: 2,
        createdAt: now,
        // Other fields not asserted in this delegation test.
      } as never);

      await controller.createBatch(authedReq, validBody);

      // The pre-migration controller passed `requestedBy: apiKey` (the
      // raw API key string). This assertion locks the fix: the resolved
      // userId from the guard's apiUser context must flow through.
      expect(batchService.createBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedBy: 'user-enterprise-1',
        }),
      );
      // And critically NOT the raw apiKey or any value resembling one.
      expect(batchService.createBatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          requestedBy: expect.stringMatching(/^(ck_live_|sk-|Bearer\s)/),
        }),
      );
    });

    it('throws BadRequestException when body fails Zod validation', async () => {
      await expect(
        controller.createBatch(authedReq, { not: 'a valid batch body' }),
      ).rejects.toThrow(BadRequestException);
      expect(batchService.createBatch).not.toHaveBeenCalled();
      // Membership check should NOT fire on a malformed body — Zod
      // validation must short-circuit the auth-ordering layer.
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
    });

    it('verifies org membership BEFORE invoking batchService.createBatch (IDOR closure ordering)', async () => {
      // Mock invocationCallOrder captures call order on a per-mock basis.
      // The intent: a Forbidden from membership must skip batch creation,
      // which is only guaranteed if verifyMembership runs strictly before
      // createBatch. The ordering assertion catches a future refactor
      // that accidentally reverses the two.
      const now = new Date();
      batchService.createBatch.mockResolvedValue({
        id: 'batch-ordering',
        status: 'PENDING',
        totalItems: 2,
        createdAt: now,
      } as never);

      await controller.createBatch(authedReq, validBody);

      expect(orgMembership.verifyMembership).toHaveBeenCalledTimes(1);
      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        UUID_ORG,
        'user-enterprise-1',
        false,
      );
      const memOrder =
        orgMembership.verifyMembership.mock.invocationCallOrder[0];
      const batchOrder = batchService.createBatch.mock.invocationCallOrder[0];
      expect(memOrder).toBeLessThan(batchOrder);
    });

    it('propagates ForbiddenException from verifyMembership and skips batch creation', async () => {
      orgMembership.verifyMembership.mockRejectedValue(
        new ForbiddenException('not authorized for this organization'),
      );

      await expect(
        controller.createBatch(authedReq, validBody),
      ).rejects.toThrow(ForbiddenException);
      // The bug-fix lock: a denied membership check MUST NOT create the
      // batch. Without this assertion, a Forbidden could bubble up while
      // the side effect (batch row insert) still landed.
      expect(batchService.createBatch).not.toHaveBeenCalled();
    });

    it('forwards isPlatformAdmin=true when the request carries platform-admin access (platform override)', async () => {
      const now = new Date();
      batchService.createBatch.mockResolvedValue({
        id: 'batch-master',
        status: 'PENDING',
        totalItems: 2,
        createdAt: now,
      } as never);

      await controller.createBatch(platformAdminReq, validBody);

      // The guard internally fast-paths on isPlatformAdmin=true; the
      // controller's responsibility is just to forward the flag honestly.
      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        UUID_ORG,
        'user-enterprise-1',
        true,
      );
    });
  });

  // Shared fixture for the 4 batchId-routes — each uses assertBatchAccess()
  // which pre-fetches the batch and runs verifyMembership(batch.organizationId,
  // ...). The mock batch carries UUID_ORG so the membership check fires
  // against the same org the request body uses elsewhere.
  const stubBatch = (overrides: Record<string, unknown> = {}) => ({
    id: 'batch-fixture',
    organizationId: UUID_ORG,
    status: 'COMPLETED',
    batchType: 'BULK_REPORT',
    priority: 'NORMAL',
    totalItems: 5,
    completedItems: 5,
    failedItems: 0,
    progressPercent: 100,
    estimatedCompletionAt: null,
    outputFormat: 'PDF',
    errorLog: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  });

  describe('GET /reports/batch/:batchId (getBatch)', () => {
    it('delegates to batchService.getBatch with parsed batchId (and reads batch.id back in response)', async () => {
      batchService.getBatch.mockResolvedValue(
        stubBatch({ id: 'batch-42' }) as never,
      );

      const result = await controller.getBatch(authedReq, {
        batchId: UUID_BATCH,
      });

      expect(batchService.getBatch).toHaveBeenCalledWith(UUID_BATCH);
      expect(result.batchId).toBe('batch-42');
      expect(result.status).toBe('COMPLETED');
    });

    it('verifies org membership against the batch.organizationId BEFORE returning (IDOR closure)', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);

      await controller.getBatch(authedReq, { batchId: UUID_BATCH });

      // assertBatchAccess fetches the batch first; verifyMembership runs
      // on the BATCH's organizationId, NOT a user-supplied org. That's
      // the entire IDOR fix: even a guessed batchId is gated by the
      // batch's real org membership.
      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        UUID_ORG,
        'user-enterprise-1',
        false,
      );
      const fetchOrder = batchService.getBatch.mock.invocationCallOrder[0];
      const memOrder =
        orgMembership.verifyMembership.mock.invocationCallOrder[0];
      expect(fetchOrder).toBeLessThan(memOrder);
    });

    it('propagates Forbidden from verifyMembership and does NOT leak the batch back to the caller', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      orgMembership.verifyMembership.mockRejectedValue(
        new ForbiddenException('not authorized for this organization'),
      );

      await expect(
        controller.getBatch(authedReq, { batchId: UUID_BATCH }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('GET /reports/batch/:batchId/status (getBatchStatus)', () => {
    it('returns the lightweight polling shape', async () => {
      batchService.getBatch.mockResolvedValue(
        stubBatch({
          id: 'batch-7',
          status: 'PROCESSING',
          progressPercent: 60,
          completedItems: 3,
          failedItems: 0,
          totalItems: 5,
          estimatedCompletionAt: null,
          completedAt: null,
        }) as never,
      );

      const result = await controller.getBatchStatus(authedReq, {
        batchId: UUID_BATCH_2,
      });

      expect(result).toEqual({
        batchId: 'batch-7',
        status: 'PROCESSING',
        progressPercent: 60,
        completedItems: 3,
        failedItems: 0,
        totalItems: 5,
        estimatedCompletionAt: null,
      });
      expect(result).not.toHaveProperty('outputFormat');
      expect(result).not.toHaveProperty('errorLog');
    });

    it('runs verifyMembership on batch.organizationId before returning the polling shape', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);

      await controller.getBatchStatus(authedReq, { batchId: UUID_BATCH_2 });

      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        UUID_ORG,
        'user-enterprise-1',
        false,
      );
    });

    it('Forbidden membership skips even the lightweight read', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      orgMembership.verifyMembership.mockRejectedValue(
        new ForbiddenException('not authorized'),
      );

      await expect(
        controller.getBatchStatus(authedReq, { batchId: UUID_BATCH_2 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('DELETE /reports/batch/:batchId (cancelBatch)', () => {
    it('delegates to batchService.cancelBatch (after passing membership)', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      batchService.cancelBatch.mockResolvedValue(undefined as never);

      const result = await controller.cancelBatch(authedReq, {
        batchId: UUID_BATCH_3,
      });

      expect(batchService.cancelBatch).toHaveBeenCalledWith(UUID_BATCH_3);
      expect(result).toBeUndefined();
    });

    it('runs verifyMembership BEFORE cancelBatch (the side-effect order lock)', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      batchService.cancelBatch.mockResolvedValue(undefined as never);

      await controller.cancelBatch(authedReq, { batchId: UUID_BATCH_3 });

      const memOrder =
        orgMembership.verifyMembership.mock.invocationCallOrder[0];
      const cancelOrder = batchService.cancelBatch.mock.invocationCallOrder[0];
      expect(memOrder).toBeLessThan(cancelOrder);
    });

    it('Forbidden membership must NOT cancel the batch (bug-fix lock)', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      orgMembership.verifyMembership.mockRejectedValue(
        new ForbiddenException('not authorized'),
      );

      await expect(
        controller.cancelBatch(authedReq, { batchId: UUID_BATCH_3 }),
      ).rejects.toThrow(ForbiddenException);
      // Critical: the cancel side effect must not run when membership
      // denies. Without this assertion, a Forbidden could bubble up
      // while the state-change still committed.
      expect(batchService.cancelBatch).not.toHaveBeenCalled();
    });

    it('NotFound from batchService.getBatch propagates as 404 (anti-enumeration: UUIDs are unguessable, so the 404/403 distinction is acceptable)', async () => {
      batchService.getBatch.mockRejectedValue(
        new NotFoundException('Batch not found'),
      );

      await expect(
        controller.cancelBatch(authedReq, { batchId: UUID_BATCH_3 }),
      ).rejects.toThrow(NotFoundException);
      // Membership check never reached when batch lookup failed first.
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
      expect(batchService.cancelBatch).not.toHaveBeenCalled();
    });
  });

  describe('GET /webhooks/:batchId (getWebhookLog)', () => {
    it('shapes webhook delivery log entries (after passing membership)', async () => {
      const now = new Date('2026-05-16T00:00:00Z');
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      webhookService.getDeliveryLog.mockResolvedValue([
        {
          id: 'log-1',
          event: 'batch.completed',
          attempt: 1,
          maxAttempts: 3,
          status: 'DELIVERED',
          httpStatus: 200,
          error: null,
          createdAt: now,
          deliveredAt: now,
          nextRetryAt: null,
        },
      ] as never);

      const result = await controller.getWebhookLog(authedReq, {
        batchId: UUID_BATCH_4,
      });

      expect(webhookService.getDeliveryLog).toHaveBeenCalledWith(UUID_BATCH_4);
      expect(result.batchId).toBe(UUID_BATCH_4);
      expect(result.deliveries).toHaveLength(1);
      expect(result.deliveries[0].createdAt).toBe(now.toISOString());
      expect(result.deliveries[0].deliveredAt).toBe(now.toISOString());
      expect(result.deliveries[0].nextRetryAt).toBeNull();
    });

    it('Forbidden membership must NOT read the webhook log (information-leak lock)', async () => {
      batchService.getBatch.mockResolvedValue(stubBatch() as never);
      orgMembership.verifyMembership.mockRejectedValue(
        new ForbiddenException('not authorized'),
      );

      await expect(
        controller.getWebhookLog(authedReq, { batchId: UUID_BATCH_4 }),
      ).rejects.toThrow(ForbiddenException);
      // Critical: webhook URLs + HTTP status codes are sensitive — a
      // denied user must not learn them via the response.
      expect(webhookService.getDeliveryLog).not.toHaveBeenCalled();
    });
  });
});

// Suppress unused import warning if Jest tree-shakes the type-only one.
void ApiKeyAuthGuard;
