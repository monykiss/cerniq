import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AgentsController } from './agents.controller';
import type { AgentRunnerService } from './runner/agent-runner.service';
import type { AgentRunService } from './runner/agent-run.service';
import type { AgentAuditService } from './runner/agent-audit.service';
import type { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import type { OrgMembershipGuard } from '../common/guards/org-membership.guard';

// Locks the contract closing AUTH_COVERAGE_AUDIT gap #1:
//
//   1. POST /agents/run — body-supplied `institutionId` is verified via
//      InstitutionScopeGuard.verifyOwnership() BEFORE the runner is
//      invoked; body-supplied `organizationId` is verified via
//      OrgMembershipGuard.verifyMembership() BEFORE the runner is invoked.
//      Both ordering checks use jest.mock.invocationCallOrder so future
//      reordering is caught even if both calls succeed.
//
//   2. GET /agents/runs/:runId + .../audit — the run row's tenancy keys
//      are dispatched into verifyOwnership / verifyMembership. A run with
//      neither key collapses to NotFound (anti-leak: never reveal that an
//      unattributed run exists to an authenticated tenant user).
//
//   3. TENANCY_REQUIRED — bodies with neither institutionId nor
//      organizationId fail at the controller boundary with 400 before any
//      authorization or runner work happens.
//
// Direct-construction style mirrors ai-advisor.controller.security.spec.ts —
// bypasses NestJS DI, keeps the wiring obvious, no PrismaService needed.

describe('AgentsController (security)', () => {
  let runner: jest.Mocked<Pick<AgentRunnerService, 'run'>>;
  let runs: jest.Mocked<Pick<AgentRunService, 'getById'>>;
  let audit: jest.Mocked<Pick<AgentAuditService, 'listForRun' | 'verifyChain'>>;
  let institutionScope: jest.Mocked<
    Pick<InstitutionScopeGuard, 'verifyOwnership'>
  >;
  let orgMembership: jest.Mocked<Pick<OrgMembershipGuard, 'verifyMembership'>>;
  let controller: AgentsController;

  const validBody = {
    agentId: 'ALM_DECISION' as const,
    institutionId: 'inst-1',
    organizationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    triggerKind: 'API' as const,
    input: {},
  };

  beforeEach(() => {
    runner = {
      run: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    } as any;
    runs = {
      getById: jest.fn().mockResolvedValue(null),
    } as any;
    audit = {
      listForRun: jest.fn().mockResolvedValue([]),
      verifyChain: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    institutionScope = {
      verifyOwnership: jest.fn().mockResolvedValue(undefined),
    } as any;
    orgMembership = {
      verifyMembership: jest.fn().mockResolvedValue(undefined),
    } as any;

    controller = new AgentsController(
      runner as unknown as AgentRunnerService,
      runs as unknown as AgentRunService,
      audit as unknown as AgentAuditService,
      institutionScope as unknown as InstitutionScopeGuard,
      orgMembership as unknown as OrgMembershipGuard,
    );
  });

  describe('POST /agents/run', () => {
    it('verifies BOTH ownership and membership BEFORE invoking the runner', async () => {
      await controller.run(validBody, { user: { userId: 'u1' } });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'u1',
        false,
      );
      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        'u1',
        false,
      );
      expect(runner.run).toHaveBeenCalledTimes(1);

      // Ordering: BOTH verification calls precede runner.run, regardless
      // of their relative order to each other. jest's invocationCallOrder
      // is a global monotonic counter shared across mocks.
      const ownershipOrder =
        institutionScope.verifyOwnership.mock.invocationCallOrder[0];
      const membershipOrder =
        orgMembership.verifyMembership.mock.invocationCallOrder[0];
      const runnerOrder = runner.run.mock.invocationCallOrder[0];
      expect(ownershipOrder).toBeLessThan(runnerOrder);
      expect(membershipOrder).toBeLessThan(runnerOrder);
    });

    it('skips verifyOwnership when only organizationId is present', async () => {
      await controller.run(
        { ...validBody, institutionId: undefined },
        { user: { userId: 'u1' } },
      );
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(orgMembership.verifyMembership).toHaveBeenCalledTimes(1);
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it('skips verifyMembership when only institutionId is present', async () => {
      await controller.run(
        { ...validBody, organizationId: undefined },
        { user: { userId: 'u1' } },
      );
      expect(institutionScope.verifyOwnership).toHaveBeenCalledTimes(1);
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it('rejects with TENANCY_REQUIRED when both keys are absent — runner never invoked', async () => {
      await expect(
        controller.run(
          { ...validBody, institutionId: undefined, organizationId: undefined },
          { user: { userId: 'u1' } },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
      expect(runner.run).not.toHaveBeenCalled();
    });

    it('propagates Forbidden from verifyOwnership and never calls the runner', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );

      await expect(
        controller.run(
          { ...validBody, institutionId: 'someone-elses-inst' },
          { user: { userId: 'u1' } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(runner.run).not.toHaveBeenCalled();
    });

    it('propagates Forbidden from verifyMembership and never calls the runner', async () => {
      orgMembership.verifyMembership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this organization'),
      );

      await expect(
        controller.run(
          {
            ...validBody,
            organizationId: '12345678-1234-4abc-9def-fedcba987654',
          },
          { user: { userId: 'u1' } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(runner.run).not.toHaveBeenCalled();
    });

    it('forwards the platform-admin bypass flag to both kernel primitives', async () => {
      await controller.run(validBody, {
        user: { userId: 'master-1', access: { isPlatformAdmin: true } },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'master-1',
        true,
      );
      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        'master-1',
        true,
      );
    });

    it('reads userId from userId → id → sub (legacy JWT shapes)', async () => {
      await controller.run(validBody, { user: { userId: 'fresh' } });
      expect(institutionScope.verifyOwnership).toHaveBeenLastCalledWith(
        'inst-1',
        'fresh',
        false,
      );

      await controller.run(validBody, { user: { id: 'legacy-id' } });
      expect(institutionScope.verifyOwnership).toHaveBeenLastCalledWith(
        'inst-1',
        'legacy-id',
        false,
      );

      await controller.run(validBody, { user: { sub: 'legacy-sub' } });
      expect(institutionScope.verifyOwnership).toHaveBeenLastCalledWith(
        'inst-1',
        'legacy-sub',
        false,
      );
    });

    it('returns BadRequest on Zod failure without touching auth or runner', async () => {
      await expect(
        controller.run(
          { agentId: 'NOT_A_REAL_AGENT', institutionId: 'inst-1' },
          { user: { userId: 'u1' } },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
      expect(runner.run).not.toHaveBeenCalled();
    });
  });

  describe('GET /agents/runs/:runId', () => {
    it('returns NotFound when the run does not exist (no ownership check leaked)', async () => {
      runs.getById.mockResolvedValueOnce(null);
      await expect(
        controller.getRun('missing', { user: { userId: 'u1' } }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
    });

    it('verifies ownership against the run row’s institutionId', async () => {
      runs.getById.mockResolvedValueOnce({
        id: 'run-1',
        institutionId: 'inst-1',
        organizationId: null,
      });

      const result = await controller.getRun('run-1', {
        user: { userId: 'u1' },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'u1',
        false,
      );
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'run-1' });
    });

    it('verifies membership against the run row’s organizationId', async () => {
      runs.getById.mockResolvedValueOnce({
        id: 'run-1',
        institutionId: null,
        organizationId: 'org-9',
      });

      await controller.getRun('run-1', { user: { userId: 'u1' } });

      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(orgMembership.verifyMembership).toHaveBeenCalledWith(
        'org-9',
        'u1',
        false,
      );
    });

    it('propagates Forbidden when verifyOwnership rejects on the run row', async () => {
      runs.getById.mockResolvedValueOnce({
        id: 'run-1',
        institutionId: 'inst-other',
      });
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );

      await expect(
        controller.getRun('run-1', { user: { userId: 'u1' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('collapses tenantless runs to NotFound (anti-leak)', async () => {
      runs.getById.mockResolvedValueOnce({
        id: 'run-1',
        institutionId: null,
        organizationId: null,
      });

      await expect(
        controller.getRun('run-1', { user: { userId: 'u1' } }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(orgMembership.verifyMembership).not.toHaveBeenCalled();
    });
  });

  describe('GET /agents/runs/:runId/audit', () => {
    it('runs ownership check BEFORE fetching audit chain (no work leaks for unauthorized callers)', async () => {
      runs.getById.mockResolvedValueOnce({
        id: 'run-1',
        institutionId: 'inst-other',
      });
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );

      await expect(
        controller.getAudit('run-1', { user: { userId: 'u1' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // verifyChain is the expensive step (hash-chain replay) — it must
      // not run when the caller is unauthorized.
      expect(audit.verifyChain).not.toHaveBeenCalled();
      expect(audit.listForRun).not.toHaveBeenCalled();
    });

    it('returns the chain when ownership matches', async () => {
      runs.getById.mockResolvedValueOnce({
        id: 'run-1',
        institutionId: 'inst-1',
      });

      const result = await controller.getAudit('run-1', {
        user: { userId: 'u1' },
      });

      expect(audit.listForRun).toHaveBeenCalledWith('run-1');
      expect(audit.verifyChain).toHaveBeenCalledWith('run-1');
      expect(result).toMatchObject({
        run: { id: 'run-1' },
        chain: { ok: true },
      });
    });

    it('NotFound when run is missing (audit chain not fetched)', async () => {
      runs.getById.mockResolvedValueOnce(null);
      await expect(
        controller.getAudit('missing', { user: { userId: 'u1' } }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.verifyChain).not.toHaveBeenCalled();
    });
  });
});
