import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentEvalController, GOLDEN_CASES } from './agent-eval.controller';
import type { GoldenRunnerService } from './golden-runner.service';
import type { ReplayRunnerService } from './replay.runner';
import type { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// Focused security spec for AgentEvalController. Locks the contract
// shipped to close a CRITICAL pre-fix vulnerability: the controller
// previously had ZERO @UseGuards, accepting body.institutionId and
// triggering expensive LLM scoring without any auth check. Both POST
// /api/v1/eval/golden and POST /api/v1/eval/replay are now protected
// by class-level AuthGuard (mocked away here — Nest's testing override
// is exercised at integration level) plus a per-handler
// InstitutionScopeGuard.verifyOwnership() call against the
// body-supplied institutionId. Same multi-context primitive pattern as
// ai-advisor.controller.ts:ask() (e88ae20c) and the WS gateway
// (b2a64c25).

describe('AgentEvalController (security)', () => {
  let goldenRunner: jest.Mocked<Pick<GoldenRunnerService, 'run'>>;
  let replayRunner: jest.Mocked<Pick<ReplayRunnerService, 'replay'>>;
  let institutionScope: jest.Mocked<
    Pick<InstitutionScopeGuard, 'verifyOwnership'>
  >;
  let controller: AgentEvalController;

  // Real GoldenCase shape isn't exposed publicly; the spec only needs
  // a non-empty array to bypass the early-return in runGolden. Cast
  // to `any` since GoldenCase is module-internal.
  const fakeGoldenCases: any[] = [{ id: 'gc-1', agentType: 'CFO_COPILOT' }];

  beforeEach(() => {
    goldenRunner = {
      run: jest.fn().mockResolvedValue({
        cases: 1,
        pass: 1,
        fail: 0,
        warn: 0,
        regression: false,
      }),
    } as any;
    replayRunner = {
      replay: jest.fn().mockReturnValue({
        runId: 'r1',
        pass: true,
        violations: [],
      }),
    } as any;
    institutionScope = {
      verifyOwnership: jest.fn().mockResolvedValue(undefined),
    } as any;
    controller = new AgentEvalController(
      goldenRunner as unknown as GoldenRunnerService,
      replayRunner as unknown as ReplayRunnerService,
      institutionScope as unknown as InstitutionScopeGuard,
      fakeGoldenCases,
    );
  });

  describe('POST /eval/golden', () => {
    const validBody = { institutionId: 'inst-1' };

    it('verifies ownership BEFORE invoking goldenRunner.run', async () => {
      await controller.runGolden(validBody, { user: { userId: 'user-1' } });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        false,
      );
      expect(institutionScope.verifyOwnership).toHaveBeenCalledTimes(1);
      expect(goldenRunner.run).toHaveBeenCalledTimes(1);
      expect(
        institutionScope.verifyOwnership.mock.invocationCallOrder[0],
      ).toBeLessThan(goldenRunner.run.mock.invocationCallOrder[0]);
    });

    it('propagates Forbidden when verifyOwnership rejects, never calling runner', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );
      await expect(
        controller.runGolden(
          { institutionId: 'attacker-target' },
          { user: { userId: 'user-1' } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(goldenRunner.run).not.toHaveBeenCalled();
    });

    it('propagates NotFound when verifyOwnership 404s', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new NotFoundException('institution not found'),
      );
      await expect(
        controller.runGolden(
          { institutionId: 'missing' },
          { user: { userId: 'user-1' } },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(goldenRunner.run).not.toHaveBeenCalled();
    });

    it('forwards platform-admin flag to verifyOwnership', async () => {
      await controller.runGolden(validBody, {
        user: { userId: 'master-1', access: { isPlatformAdmin: true } },
      });
      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'master-1',
        true,
      );
    });
  });

  describe('POST /eval/replay', () => {
    const validBody = {
      runId: 'run-1',
      institutionId: 'inst-1',
      agentType: 'CFO_COPILOT',
      narrative: 'n',
      output: {},
      trace: [],
      computeMs: 1,
    };

    it('verifies ownership BEFORE invoking replayRunner.replay', async () => {
      await controller.replay(validBody, { user: { userId: 'user-1' } });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        false,
      );
      expect(replayRunner.replay).toHaveBeenCalledTimes(1);
      expect(
        institutionScope.verifyOwnership.mock.invocationCallOrder[0],
      ).toBeLessThan(replayRunner.replay.mock.invocationCallOrder[0]);
    });

    it('propagates Forbidden when verifyOwnership rejects, never calling replay', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized'),
      );
      await expect(
        controller.replay(
          { ...validBody, institutionId: 'attacker-target' },
          { user: { userId: 'user-1' } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(replayRunner.replay).not.toHaveBeenCalled();
    });

    it('uses GOLDEN_CASES symbol export (regression lock)', () => {
      // Sanity: GOLDEN_CASES is the DI token used in AppModule. If this
      // export is removed or renamed, the agent-eval test harness breaks
      // silently. Lock the symbol existence here.
      expect(GOLDEN_CASES).toEqual(expect.any(Symbol));
    });
  });
});
