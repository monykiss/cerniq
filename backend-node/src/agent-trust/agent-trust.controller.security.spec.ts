import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgentTrustController } from './agent-trust.controller';
import type { AgentTrustService } from './agent-trust.service';
import type { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// Focused security spec for AgentTrustController. Locks the contract that
// closes AUTH_COVERAGE_AUDIT.md gap #2:
//
//   POST /api/v1/trust/validate accepts {institutionId, runId, ...} in the
//   body and previously had ZERO auth (docstring claimed "Protected by
//   AuthGuard in production added at AppModule level" — aspirational; no
//   such global guard exists). Closure: class-level @UseGuards(AuthGuard)
//   forces authentication, and the handler re-runs
//   InstitutionScopeGuard.verifyOwnership() against the body-supplied
//   institutionId before invoking the trust evaluator. Same shape as
//   ai-advisor's POST /ask (closed in e88ae20c / 4f9e2728).
//
// Direct-construction style mirrors ai-advisor.controller.security.spec.ts
// — bypasses NestJS DI to keep the spec fast and the dependency wiring
// obvious. Reflection-on-decorators is exercised by
// verify-institution-scope-guard.mjs (R2 + body-IDOR-skip detection), not
// duplicated here.

describe('AgentTrustController (security)', () => {
  let trust: jest.Mocked<Pick<AgentTrustService, 'evaluate'>>;
  let institutionScope: jest.Mocked<
    Pick<InstitutionScopeGuard, 'verifyOwnership'>
  >;
  let controller: AgentTrustController;

  const validBody = {
    agentType: 'ALM_DECISION',
    runId: 'run-1',
    institutionId: 'inst-1',
    agentText: 'baseline LCR is 1.18',
    agentOutput: { lcr: 1.18 },
    trace: [],
  };

  beforeEach(() => {
    trust = {
      evaluate: jest.fn().mockReturnValue({
        passed: true,
        score: 1.0,
        violations: [],
      } as any),
    } as any;
    institutionScope = {
      verifyOwnership: jest.fn().mockResolvedValue(undefined),
    } as any;
    controller = new AgentTrustController(
      trust as unknown as AgentTrustService,
      institutionScope as unknown as InstitutionScopeGuard,
    );
  });

  describe('POST /validate', () => {
    it('verifies ownership BEFORE invoking the trust evaluator', async () => {
      await controller.validate(validBody, { user: { userId: 'user-1' } });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        false,
      );
      expect(institutionScope.verifyOwnership).toHaveBeenCalledTimes(1);
      expect(trust.evaluate).toHaveBeenCalledTimes(1);
      // Ordering check: verifyOwnership's invocation order must precede
      // evaluate()'s. jest tracks invocationCallOrder globally across
      // mocks — locks the second-layer enforcement above the service call.
      expect(
        institutionScope.verifyOwnership.mock.invocationCallOrder[0],
      ).toBeLessThan(trust.evaluate.mock.invocationCallOrder[0]);
    });

    it('propagates Forbidden when verifyOwnership rejects, never calling evaluate', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );

      await expect(
        controller.validate(
          { ...validBody, institutionId: 'someone-elses-inst' },
          { user: { userId: 'user-1' } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(trust.evaluate).not.toHaveBeenCalled();
    });

    it('reads userId from the canonical req.user.userId field', async () => {
      await controller.validate(validBody, {
        user: { userId: 'canonical', id: 'legacy-id', sub: 'jwt-sub' },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'canonical',
        false,
      );
    });

    it('falls through req.user.id when userId absent', async () => {
      await controller.validate(validBody, {
        user: { id: 'legacy-id', sub: 'jwt-sub' },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'legacy-id',
        false,
      );
    });

    it('falls through req.user.sub when userId+id absent', async () => {
      await controller.validate(validBody, {
        user: { sub: 'jwt-sub' },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'jwt-sub',
        false,
      );
    });

    it('forwards isPlatformAdmin from req.user.access.isPlatformAdmin for the bypass path', async () => {
      await controller.validate(validBody, {
        user: { userId: 'admin-1', access: { isPlatformAdmin: true } },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'admin-1',
        true,
      );
    });

    it('rejects with BadRequest on malformed body before any auth check', async () => {
      await expect(
        controller.validate({ runId: 'r' }, { user: { userId: 'user-1' } }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(trust.evaluate).not.toHaveBeenCalled();
    });
  });
});
