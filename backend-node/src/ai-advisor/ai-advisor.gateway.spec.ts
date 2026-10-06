import { ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { AiAdvisorGateway } from './ai-advisor.gateway';
import type { AiAdvisorService } from './ai-advisor.service';
import type { ConversationHistoryService } from './conversation-history.service';
import type { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// Focused security spec for AiAdvisorGateway. Locks the WS hardening
// shipped to close the CRITICAL auth-bypass flagged by audit decision
// 84faea03 (and documented in docs/security/IDOR_RESIDUAL_AUDIT.md):
//
//   1. handleConnection — reject connections without a verifiable JWT.
//      Pre-fix accepted any client claiming `?userId=anyone` in the
//      handshake query. Post-fix verifies via JwtService and populates
//      client.data.user with the canonical (userId, isPlatformAdmin) shape.
//
//   2. handleAsk / handleHistory — defense-in-depth re-check on
//      client.data.user, then InstitutionScopeGuard.verifyOwnership()
//      before invoking streamAsk / getSessionHistory. Same primitive
//      as the HTTP path (e88ae20c). Single source of truth for the
//      ownership contract across HTTP + WS.

type MockSocket = {
  id: string;
  handshake: {
    auth?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, string | undefined>;
  };
  data: any;
  emit: jest.Mock;
  disconnect: jest.Mock;
};

const buildSocket = (
  handshake: MockSocket['handshake'] = { auth: {} },
): MockSocket => ({
  id: 'sock-1',
  handshake,
  data: {},
  emit: jest.fn(),
  disconnect: jest.fn(),
});

describe('AiAdvisorGateway (security)', () => {
  let aiAdvisor: jest.Mocked<Pick<AiAdvisorService, 'streamAsk'>>;
  let conversationHistory: jest.Mocked<
    Pick<ConversationHistoryService, 'getSessionHistory'>
  >;
  let institutionScope: jest.Mocked<
    Pick<InstitutionScopeGuard, 'verifyOwnership'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;
  let gateway: AiAdvisorGateway;

  beforeEach(() => {
    aiAdvisor = {
      streamAsk: jest.fn(async function* () {
        yield { type: 'text', content: 'hello' };
        yield { type: 'done' };
      }),
    } as any;
    conversationHistory = {
      getSessionHistory: jest.fn().mockResolvedValue([{ id: 'm-1' }]),
    } as any;
    institutionScope = {
      verifyOwnership: jest.fn().mockResolvedValue(undefined),
    } as any;
    jwtService = {
      verify: jest.fn().mockReturnValue({ userId: 'user-1' }),
    } as any;
    gateway = new AiAdvisorGateway(
      aiAdvisor as unknown as AiAdvisorService,
      conversationHistory as unknown as ConversationHistoryService,
      institutionScope as unknown as InstitutionScopeGuard,
      jwtService as unknown as JwtService,
    );
  });

  describe('handleConnection (handshake-time JWT verify)', () => {
    it('rejects connections with no token in any source', async () => {
      const sock = buildSocket({ auth: {}, query: {}, headers: {} });
      await gateway.handleConnection(sock as any);

      expect(sock.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHENTICATED',
        message: 'Missing or invalid auth token',
      });
      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('rejects connections when JwtService.verify throws', async () => {
      jwtService.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });
      const sock = buildSocket({ auth: { token: 'expired-token' } });
      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('rejects connections when token payload has no userId/sub', async () => {
      jwtService.verify.mockReturnValueOnce({ email: 'no-id@example.com' });
      const sock = buildSocket({ auth: { token: 'shape-bad-token' } });
      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('accepts a valid token from handshake.auth.token and stores user ctx', async () => {
      jwtService.verify.mockReturnValueOnce({
        userId: 'user-7',
        access: { isPlatformAdmin: false },
      });
      const sock = buildSocket({ auth: { token: 'valid-token' } });
      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).not.toHaveBeenCalled();
      expect(sock.data.user).toEqual({
        userId: 'user-7',
        isPlatformAdmin: false,
      });
    });

    it('accepts token from Bearer Authorization header (legacy carrier)', async () => {
      jwtService.verify.mockReturnValueOnce({ sub: 'user-legacy-shape' });
      const sock = buildSocket({
        auth: {},
        headers: { authorization: 'Bearer header-token' },
      });
      await gateway.handleConnection(sock as any);

      expect(jwtService.verify).toHaveBeenCalledWith('header-token');
      expect(sock.data.user).toEqual({
        userId: 'user-legacy-shape',
        isPlatformAdmin: false,
      });
    });

    it('forwards isPlatformAdmin flag from token access claims', async () => {
      jwtService.verify.mockReturnValueOnce({
        userId: 'master-1',
        access: { isPlatformAdmin: true },
      });
      const sock = buildSocket({ auth: { token: 'master-token' } });
      await gateway.handleConnection(sock as any);

      expect(sock.data.user).toEqual({
        userId: 'master-1',
        isPlatformAdmin: true,
      });
    });
  });

  describe('Supabase token fallback (mirrors AuthGuard.verifySupabaseToken)', () => {
    const ORIGINAL_FETCH = global.fetch;
    const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
    const ORIGINAL_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    beforeEach(() => {
      // Make legacy JWT verification fail so the Supabase branch runs.
      jwtService.verify.mockImplementation(() => {
        throw new Error('not a legacy JWT');
      });
    });

    afterEach(() => {
      global.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
      if (ORIGINAL_SUPABASE_ANON_KEY === undefined)
        delete process.env.SUPABASE_ANON_KEY;
      else process.env.SUPABASE_ANON_KEY = ORIGINAL_SUPABASE_ANON_KEY;
    });

    it('returns null (rejects) when Supabase env vars are missing', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const sock = buildSocket({ auth: { token: 'sb-token' } });
      await gateway.handleConnection(sock as any);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('accepts a valid Supabase token (200 + id) with isPlatformAdmin=false', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co/';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'sb-user-1', email: 'a@b.c' }),
      } as unknown as Response);
      global.fetch = fetchSpy as unknown as typeof fetch;

      const sock = buildSocket({ auth: { token: 'sb-token' } });
      await gateway.handleConnection(sock as any);

      // Trailing slash stripped, /auth/v1/user appended, apikey + Bearer set.
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.supabase.co/auth/v1/user',
        {
          headers: {
            apikey: 'anon-key',
            Authorization: 'Bearer sb-token',
          },
        },
      );
      expect(sock.disconnect).not.toHaveBeenCalled();
      expect(sock.data.user).toEqual({
        userId: 'sb-user-1',
        isPlatformAdmin: false,
      });
    });

    it('falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY when SUPABASE_ANON_KEY is unset', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      delete process.env.SUPABASE_ANON_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'next-anon-key';
      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'sb-user-2' }),
      } as unknown as Response);
      global.fetch = fetchSpy as unknown as typeof fetch;

      try {
        const sock = buildSocket({ auth: { token: 'sb-token' } });
        await gateway.handleConnection(sock as any);

        expect(fetchSpy).toHaveBeenCalledWith(
          'https://example.supabase.co/auth/v1/user',
          {
            headers: {
              apikey: 'next-anon-key',
              Authorization: 'Bearer sb-token',
            },
          },
        );
        expect(sock.data.user).toEqual({
          userId: 'sb-user-2',
          isPlatformAdmin: false,
        });
      } finally {
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      }
    });

    it('rejects when Supabase returns non-200', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as unknown as Response) as unknown as typeof fetch;

      const sock = buildSocket({ auth: { token: 'sb-expired' } });
      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('rejects when Supabase returns 200 but no user id', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'no-id@example.com' }),
      } as unknown as Response) as unknown as typeof fetch;

      const sock = buildSocket({ auth: { token: 'sb-shape-bad' } });
      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('rejects when fetch throws (network error)', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      global.fetch = jest
        .fn()
        .mockRejectedValue(
          new Error('ECONNREFUSED'),
        ) as unknown as typeof fetch;

      const sock = buildSocket({ auth: { token: 'sb-token' } });
      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('legacy JWT wins when valid — Supabase fetch is not called', async () => {
      // Override the failing legacy mock from this describe's beforeEach.
      jwtService.verify.mockReturnValueOnce({ userId: 'legacy-wins' });
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const sock = buildSocket({ auth: { token: 'legacy-token' } });
      await gateway.handleConnection(sock as any);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sock.data.user).toEqual({
        userId: 'legacy-wins',
        isPlatformAdmin: false,
      });
    });
  });

  describe('handleAsk (event)', () => {
    const validPayload = {
      institutionId: 'inst-1',
      question: 'What is my LCR?',
      sessionId: 'sess-1',
      language: 'en' as const,
    };

    const buildAuthedSocket = (userId = 'user-1', isPlatformAdmin = false) => {
      const sock = buildSocket();
      sock.data.user = { userId, isPlatformAdmin };
      return sock;
    };

    it('rejects unauthenticated sockets (defense-in-depth on connect bypass)', async () => {
      const sock = buildSocket();
      await gateway.handleAsk(sock as any, validPayload);

      expect(sock.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHENTICATED',
        message: 'No auth context on this socket',
      });
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(aiAdvisor.streamAsk).not.toHaveBeenCalled();
    });

    it('rejects with INPUT_INVALID on malformed payload', async () => {
      const sock = buildAuthedSocket();
      await gateway.handleAsk(sock as any, { institutionId: 'inst-1' } as any);

      expect(sock.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'INPUT_INVALID' }),
      );
      expect(aiAdvisor.streamAsk).not.toHaveBeenCalled();
    });

    it('runs verifyOwnership BEFORE streamAsk and forwards both args', async () => {
      const sock = buildAuthedSocket();
      await gateway.handleAsk(sock as any, validPayload);

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        false,
      );
      expect(institutionScope.verifyOwnership).toHaveBeenCalledTimes(1);
      expect(aiAdvisor.streamAsk).toHaveBeenCalledTimes(1);
      expect(
        institutionScope.verifyOwnership.mock.invocationCallOrder[0],
      ).toBeLessThan(aiAdvisor.streamAsk.mock.invocationCallOrder[0]);
    });

    it('emits FORBIDDEN and skips streamAsk when verifyOwnership rejects', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );
      const sock = buildAuthedSocket();
      await gateway.handleAsk(sock as any, {
        ...validPayload,
        institutionId: 'someone-elses-inst',
      });

      expect(sock.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
      expect(aiAdvisor.streamAsk).not.toHaveBeenCalled();
    });

    it('forwards platform-admin flag from socket ctx to verifyOwnership', async () => {
      const sock = buildAuthedSocket('master-1', true);
      await gateway.handleAsk(sock as any, validPayload);

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'master-1',
        true,
      );
    });

    it('streams text + done events on the happy path', async () => {
      const sock = buildAuthedSocket();
      await gateway.handleAsk(sock as any, validPayload);

      const events = sock.emit.mock.calls.map((c) => c[0]);
      expect(events).toContain('session');
      expect(events).toContain('chunk');
      expect(events).toContain('done');
    });
  });

  describe('handleHistory (event)', () => {
    const buildAuthedSocket = (userId = 'user-1') => {
      const sock = buildSocket();
      sock.data.user = { userId, isPlatformAdmin: false };
      return sock;
    };

    it('rejects unauthenticated sockets', async () => {
      const sock = buildSocket();
      await gateway.handleHistory(sock as any, {
        institutionId: 'inst-1',
        sessionId: 'sess-1',
      });

      expect(sock.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHENTICATED',
        message: 'No auth context on this socket',
      });
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(conversationHistory.getSessionHistory).not.toHaveBeenCalled();
    });

    it('rejects malformed payload (missing institutionId/sessionId)', async () => {
      const sock = buildAuthedSocket();
      await gateway.handleHistory(sock as any, { sessionId: 'sess-1' } as any);

      expect(sock.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'INPUT_INVALID' }),
      );
      expect(conversationHistory.getSessionHistory).not.toHaveBeenCalled();
    });

    it('runs verifyOwnership BEFORE getSessionHistory and forwards user.userId for privacy filter', async () => {
      const sock = buildAuthedSocket();
      await gateway.handleHistory(sock as any, {
        institutionId: 'inst-1',
        sessionId: 'sess-1',
      });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        false,
      );
      // Locks the intra-institution privacy contract: getSessionHistory's
      // 4th arg (userId) MUST be the authenticated socket user, so the
      // returned messages are filtered to this user even if two users in
      // the same institution share a sessionId.
      expect(conversationHistory.getSessionHistory).toHaveBeenCalledWith(
        'inst-1',
        'sess-1',
        50,
        'user-1',
      );
      expect(
        institutionScope.verifyOwnership.mock.invocationCallOrder[0],
      ).toBeLessThan(
        conversationHistory.getSessionHistory.mock.invocationCallOrder[0],
      );
    });

    it('emits FORBIDDEN and skips getSessionHistory when verifyOwnership rejects', async () => {
      institutionScope.verifyOwnership.mockRejectedValueOnce(
        new ForbiddenException('not authorized for this institution'),
      );
      const sock = buildAuthedSocket();
      await gateway.handleHistory(sock as any, {
        institutionId: 'someone-elses-inst',
        sessionId: 'sess-1',
      });

      expect(sock.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
      expect(conversationHistory.getSessionHistory).not.toHaveBeenCalled();
    });
  });
});
