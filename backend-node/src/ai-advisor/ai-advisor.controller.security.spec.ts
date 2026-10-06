import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiAdvisorController } from './ai-advisor.controller';
import type { AiAdvisorService } from './ai-advisor.service';
import type { ConversationHistoryService } from './conversation-history.service';
import type { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// Focused security spec for AiAdvisorController. Locks the contract that
// closes the two IDORs documented in docs/security/IDOR_RESIDUAL_AUDIT.md:
//
//   1. POST /ask — body-supplied institutionId is verified via
//      InstitutionScopeGuard.verifyOwnership() before the LLM call. The
//      class-level guard passes through (no :institutionId in URL); the
//      explicit verifyOwnership() call is the second-layer enforcement.
//
//   2. DELETE /sessions/:sessionId — userId from auth context is passed
//      to ConversationHistoryService.deleteSession() so the deleteMany
//      filter scopes by (sessionId, userId). Cross-user delete attempts
//      collapse to the same 404 as missing sessions (anti-enumeration).
//
// Direct-construction style mirrors close.controller.spec.ts and
// alm.controller.spec.ts — bypasses NestJS DI to keep the spec fast and
// the dependency wiring obvious. Reflection-on-decorators is exercised
// by peer's verify-institution-scope-guard.mjs, not duplicated here.

describe('AiAdvisorController (security)', () => {
  let aiAdvisor: jest.Mocked<Pick<AiAdvisorService, 'ask'>>;
  let conversationHistory: jest.Mocked<
    Pick<
      ConversationHistoryService,
      'deleteSession' | 'listSessions' | 'getSessionHistory'
    >
  >;
  let institutionScope: jest.Mocked<
    Pick<InstitutionScopeGuard, 'verifyOwnership'>
  >;
  let controller: AiAdvisorController;

  beforeEach(() => {
    aiAdvisor = {
      ask: jest.fn().mockResolvedValue({
        content: 'ok',
        modelId: 'm',
        tokenCount: 0,
        almModulesReferenced: [],
        sessionId: 'sess-1',
      }),
    } as any;
    conversationHistory = {
      deleteSession: jest.fn().mockResolvedValue(undefined),
      listSessions: jest.fn().mockResolvedValue([]),
      getSessionHistory: jest.fn().mockResolvedValue([]),
    } as any;
    institutionScope = {
      verifyOwnership: jest.fn().mockResolvedValue(undefined),
    } as any;
    controller = new AiAdvisorController(
      aiAdvisor as unknown as AiAdvisorService,
      conversationHistory as unknown as ConversationHistoryService,
      institutionScope as unknown as InstitutionScopeGuard,
    );
  });

  describe('POST /ask', () => {
    const validBody = {
      institutionId: 'inst-1',
      question: 'What is my LCR?',
      sessionId: 'sess-1',
      language: 'en' as const,
    };

    it('verifies ownership BEFORE invoking the LLM service', async () => {
      await controller.ask(validBody, { user: { userId: 'user-1' } });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        false,
      );
      expect(institutionScope.verifyOwnership).toHaveBeenCalledTimes(1);
      expect(aiAdvisor.ask).toHaveBeenCalledTimes(1);
      // Ordering check: verifyOwnership's invocation order must precede
      // ask()'s. jest tracks invocationCallOrder globally across mocks.
      expect(
        institutionScope.verifyOwnership.mock.invocationCallOrder[0],
      ).toBeLessThan(aiAdvisor.ask.mock.invocationCallOrder[0]);
    });

    it('propagates Forbidden when verifyOwnership rejects, never calling the LLM', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );

      await expect(
        controller.ask(
          { ...validBody, institutionId: 'someone-elses-inst' },
          { user: { userId: 'user-1' } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(aiAdvisor.ask).not.toHaveBeenCalled();
    });

    it('propagates NotFound when verifyOwnership rejects on missing institution', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new NotFoundException('institution not found'),
      );

      await expect(
        controller.ask(
          { ...validBody, institutionId: 'missing' },
          { user: { userId: 'user-1' } },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(aiAdvisor.ask).not.toHaveBeenCalled();
    });

    it('forwards the platform-admin bypass flag to verifyOwnership', async () => {
      await controller.ask(validBody, {
        user: { userId: 'master-1', access: { isPlatformAdmin: true } },
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'master-1',
        true,
      );
    });

    it('reads userId from `userId` first, falling back to `id`/`sub` for legacy JWT shapes', async () => {
      // Defensive userId-extraction order: AuthGuard canonically sets
      // req.user.userId (per InstitutionScopeGuard's own reads). Fallback
      // to id/sub keeps legacy JWT carriers working.
      await controller.ask(validBody, { user: { userId: 'fresh-shape' } });
      expect(institutionScope.verifyOwnership).toHaveBeenLastCalledWith(
        'inst-1',
        'fresh-shape',
        false,
      );

      await controller.ask(validBody, { user: { id: 'legacy-id-shape' } });
      expect(institutionScope.verifyOwnership).toHaveBeenLastCalledWith(
        'inst-1',
        'legacy-id-shape',
        false,
      );

      await controller.ask(validBody, { user: { sub: 'legacy-sub-shape' } });
      expect(institutionScope.verifyOwnership).toHaveBeenLastCalledWith(
        'inst-1',
        'legacy-sub-shape',
        false,
      );
    });
  });

  describe('GET /sessions/:institutionId/:sessionId', () => {
    it('forwards req.user.userId to getSessionHistory for intra-institution privacy', async () => {
      // Locks the privacy contract: even within an institution the caller
      // is authorized for, getSessionHistory must filter by userId so two
      // users in the same institution sharing a sessionId can't read each
      // other's conversation history.
      await controller.getSessionHistory(
        { institutionId: 'inst-1', sessionId: 'sess-1' },
        { user: { userId: 'user-1' } },
      );

      expect(conversationHistory.getSessionHistory).toHaveBeenCalledWith(
        'inst-1',
        'sess-1',
        50,
        'user-1',
      );
    });

    it('reads userId via the wider chain (userId → id → sub)', async () => {
      await controller.getSessionHistory(
        { institutionId: 'inst-1', sessionId: 'sess-1' },
        { user: { sub: 'legacy-sub' } },
      );

      expect(conversationHistory.getSessionHistory).toHaveBeenLastCalledWith(
        'inst-1',
        'sess-1',
        50,
        'legacy-sub',
      );
    });
  });

  describe('DELETE /sessions/:sessionId', () => {
    it('passes userId to deleteSession so cross-user deletes are filtered', async () => {
      // userId chain now widened to userId-first (this commit), so the
      // canonical post-AuthGuard field is read first.
      await controller.deleteSession(
        { sessionId: 'sess-1' },
        { user: { userId: 'user-1' } },
      );

      expect(conversationHistory.deleteSession).toHaveBeenCalledWith(
        'sess-1',
        'user-1',
      );
    });

    it('falls back through `id` then `sub` for legacy JWT shapes', async () => {
      await controller.deleteSession(
        { sessionId: 'sess-1' },
        { user: { id: 'legacy-id' } },
      );
      expect(conversationHistory.deleteSession).toHaveBeenLastCalledWith(
        'sess-1',
        'legacy-id',
      );

      await controller.deleteSession(
        { sessionId: 'sess-2' },
        { user: { sub: 'legacy-sub' } },
      );
      expect(conversationHistory.deleteSession).toHaveBeenLastCalledWith(
        'sess-2',
        'legacy-sub',
      );
    });

    it('propagates the service-level NotFound when (sessionId, userId) matches zero rows', async () => {
      // Anti-enumeration: service returns 404 whether the session is
      // missing or owned by another user — controller just bubbles.
      conversationHistory.deleteSession.mockRejectedValueOnce(
        new NotFoundException('Session sess-1 not found'),
      );

      await expect(
        controller.deleteSession(
          { sessionId: 'sess-1' },
          { user: { userId: 'attacker' } },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
