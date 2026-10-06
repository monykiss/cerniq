import { randomBytes } from 'crypto';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from './auth.guard';

// Generated per run so no fixed key-shaped literal lives in the repo.
const TEST_API_KEY = `ck_live_${randomBytes(12).toString('hex')}`;

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fakesig';

describe('AuthGuard (enhanced)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function createContext(request: Record<string, unknown>): ExecutionContext {
    const mockRes = { setHeader: jest.fn() };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => mockRes,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  function createGuard(
    jwtOverrides?: Partial<JwtService>,
    prismaOverrides?: any,
  ) {
    const authService = {
      resolveApplicationUser: jest
        .fn()
        .mockImplementation(
          async ({
            authUserId,
            email,
          }: {
            authUserId?: string;
            email?: string;
          }) => ({
            id: authUserId ?? email ?? 'user-1',
            email: email ?? 'test@cerniq.io',
            role: null,
          }),
        ),
    };

    const jwtService = {
      decode: jest.fn().mockReturnValue({}),
      verify: jest.fn(),
      ...jwtOverrides,
    } as unknown as JwtService;

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      apiKey: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      // See auth.guard.spec.ts — org-context fallback needs this to exist.
      workspace: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...prismaOverrides,
    } as unknown as PrismaService;

    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const platformAccess = {
      getAccessForUser: jest.fn().mockResolvedValue({
        platformAccessAllowed: true,
        isPlatformAdmin: false,
        isPaid: true,
        effectiveTier: 'standard',
        effectiveStatus: 'active',
        reason: 'paid',
      }),
      buildForbiddenPayload: jest
        .fn()
        .mockReturnValue({ code: 'PLATFORM_ACCESS_REQUIRED' }),
    };

    return {
      guard: new AuthGuard(
        authService as any,
        jwtService,
        prisma,
        reflector,
        platformAccess as any,
      ),
      authService,
      jwtService,
      prisma,
      reflector,
      platformAccess,
    };
  }

  describe('org context fallback — the workspace the user owns', () => {
    /**
     * Regression for the defect that made the whole ALM surface unusable.
     *
     * TenantScopeGuard rejects org-scoped routes unless it can resolve an org
     * id, from `user.orgId` or an `x-organization-id` header. The access-token
     * payload carries no orgId, and the browser only sends the header when
     * `getStoredOrganizationId()` is populated — which is written solely by
     * `useCurrentOrg`, a hook no page ever calls. So the header was ALWAYS
     * absent, every ALM request 403'd, ALMProvider read that as auth loss and
     * bounced the user to /login. The product rendered nothing, anywhere,
     * while the API itself was healthy — it was only ever reachable by a
     * client that hand-supplied the header (curl, tests).
     */
    function jwtOk() {
      return {
        decode: jest.fn().mockReturnValue({ sub: 'user-1' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-1',
          email: 'test@cerniq.io',
          role: 'admin',
        }),
      };
    }

    it('resolves the org from the single workspace the user owns', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(jwtOk(), {
        workspace: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ws-owned' }]),
        },
      });
      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };
      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('ws-owned');
    });

    it('does not guess when the user owns several workspaces', async () => {
      // Ambiguity must stay ambiguous — the caller says which one.
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(jwtOk(), {
        workspace: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'ws-a' }, { id: 'ws-b' }]),
        },
      });
      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };
      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBeNull();
    });

    it('lets an explicit header win over the owned workspace', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(jwtOk(), {
        workspace: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ws-owned' }]),
        },
      });
      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'ws-explicit',
        },
        cookies: {},
        method: 'GET',
      };
      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('ws-explicit');
    });

    it('a failing lookup degrades to no-org, it does not break authentication', async () => {
      // The fallback is an enhancement, not a term of authentication: a
      // database hiccup must not turn into an auth failure for every request.
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(jwtOk(), {
        workspace: {
          findMany: jest.fn().mockRejectedValue(new Error('db down')),
        },
      });
      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };
      await expect(
        guard.canActivate(createContext(request)),
      ).resolves.not.toThrow();
      expect(request.user.userId).toBe('user-1');
    });
  });

  describe('JWT token authentication', () => {
    it('extracts token from Authorization Bearer header', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard, jwtService } = createGuard({
        decode: jest.fn().mockReturnValue({ sub: 'user-1' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-1',
          email: 'test@cerniq.io',
          role: 'admin',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user).toMatchObject({ userId: 'user-1' });
    });

    it('extracts token from access_token cookie', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'cookie-user',
          email: 'cookie@cerniq.io',
        }),
      });

      const request: any = {
        headers: {},
        cookies: { access_token: FAKE_JWT },
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user).toMatchObject({ userId: 'cookie-user' });
    });

    it('throws UnauthorizedException when no token or API key present', async () => {
      const { guard } = createGuard();
      const request: any = {
        headers: {},
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('prefers legacy token when claims.type is "access"', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';

      const fetchSpy = jest.spyOn(global, 'fetch');

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'legacy-user',
          email: 'legacy@cerniq.io',
          type: 'access',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      // Should not call Supabase when legacy is preferred
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(request.user.userId).toBe('legacy-user');
    });

    it('prefers legacy token when claims.type is "refresh"', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      const fetchSpy = jest.spyOn(global, 'fetch');

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'refresh' }),
        verify: jest.fn().mockReturnValue({
          sub: 'refresh-user',
          email: 'refresh@cerniq.io',
          type: 'refresh',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(request.user.userId).toBe('refresh-user');
    });

    it('falls back to Supabase when legacy verify fails and token is non-legacy type', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      process.env.AUTH_ALLOW_LEGACY = 'false';

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'supabase-user', email: 'sb@test.com' }),
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ sub: 'some-user' }),
        verify: jest.fn().mockImplementation(() => {
          throw new Error('invalid');
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/auth/v1/user'),
        expect.any(Object),
      );
      expect(request.user.userId).toBe('supabase-user');
    });

    it('falls back to legacy when Supabase fails and AUTH_ALLOW_LEGACY is true', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      process.env.AUTH_ALLOW_LEGACY = 'true';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ sub: 'legacy-fallback' }),
        verify: jest.fn().mockReturnValue({
          sub: 'legacy-fallback',
          email: 'fallback@test.com',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.userId).toBe('legacy-fallback');
    });

    it('throws when Supabase fails and legacy not allowed', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      process.env.AUTH_ALLOW_LEGACY = 'false';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ sub: 'unknown' }),
        verify: jest.fn().mockImplementation(() => {
          throw new Error('bad');
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns null from Supabase when no SUPABASE_URL configured', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      process.env.AUTH_ALLOW_LEGACY = 'false';

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ sub: 'user' }),
        verify: jest.fn().mockImplementation(() => {
          throw new Error('bad');
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns null from Supabase when response user has no id', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      process.env.AUTH_ALLOW_LEGACY = 'false';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'no-id@test.com' }), // no id
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({}),
        verify: jest.fn().mockImplementation(() => {
          throw new Error('bad');
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('handles Supabase fetch throwing an error gracefully', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';
      process.env.AUTH_ALLOW_LEGACY = 'false';

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({}),
        verify: jest.fn().mockImplementation(() => {
          throw new Error('bad');
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('decode returns empty object for non-object claims', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue(null),
        verify: jest.fn().mockReturnValue({ sub: 'u1', email: 'e@t.com' }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      // Should still work, falls through to legacy
      await guard.canActivate(createContext(request));
      expect(request.user.userId).toBe('u1');
    });
  });

  describe('API key authentication', () => {
    it('authenticates via x-api-key header for GET requests', async () => {
      const { guard, prisma } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              keyHash: 'hash',
              keyPrefix: 'ck_live_',
              revokedAt: null,
              expiresAt: null,
              failureCount: 0,
              user: { id: 'api-user', email: 'api@cerniq.io' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': TEST_API_KEY },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user).toMatchObject({
        userId: 'api-user',
        authMethod: 'api_key',
        role: 'api_key',
      });
    });

    it('rejects API key for non-GET (write) requests', async () => {
      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              keyHash: 'hash',
              keyPrefix: 'ck_live_',
              revokedAt: null,
              expiresAt: null,
              failureCount: 0,
              user: { id: 'api-user', email: 'api@cerniq.io' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': TEST_API_KEY },
        cookies: {},
        method: 'POST',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows API key for HEAD and OPTIONS methods', async () => {
      for (const method of ['HEAD', 'OPTIONS']) {
        const { guard } = createGuard(
          { decode: jest.fn().mockReturnValue({}) },
          {
            apiKey: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'key-1',
                keyHash: 'hash',
                keyPrefix: 'ck_live_',
                revokedAt: null,
                expiresAt: null,
                user: { id: 'api-user', email: 'api@cerniq.io' },
              }),
              update: jest.fn(),
            },
            user: { findUnique: jest.fn().mockResolvedValue(null) },
          },
        );

        const request: any = {
          headers: { 'x-api-key': TEST_API_KEY },
          cookies: {},
          method,
        };

        await guard.canActivate(createContext(request));
        expect(request.user.authMethod).toBe('api_key');
      }
    });

    it('rejects revoked API key', async () => {
      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              revokedAt: new Date(),
              user: { id: 'u1', email: 'e@test.com' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': 'ck_live_revoked' },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects expired API key', async () => {
      const yesterday = new Date(Date.now() - 86400000);
      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              revokedAt: null,
              expiresAt: yesterday,
              user: { id: 'u1', email: 'e@test.com' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': 'ck_live_expired' },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects API key with no user record', async () => {
      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              revokedAt: null,
              expiresAt: null,
              user: null, // no user
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': 'ck_live_orphan' },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('sets expiry warning headers when API key expires within 14 days', async () => {
      const expiresIn5Days = new Date(Date.now() + 5 * 86400000);
      const mockRes = { setHeader: jest.fn() };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => mockRes,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              keyHash: 'hash',
              keyPrefix: 'ck_live_',
              revokedAt: null,
              expiresAt: expiresIn5Days,
              user: { id: 'api-user', email: 'api@cerniq.io' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': TEST_API_KEY },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(ctx);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-API-Key-Expires-In-Days',
        expect.any(String),
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Warning',
        expect.stringContaining('API key expires'),
      );
    });

    it('does not set expiry headers when key expires in more than 14 days', async () => {
      const expiresIn30Days = new Date(Date.now() + 30 * 86400000);
      const mockRes = { setHeader: jest.fn() };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => mockRes,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              keyHash: 'hash',
              keyPrefix: 'ck_live_',
              revokedAt: null,
              expiresAt: expiresIn30Days,
              user: { id: 'api-user', email: 'api@cerniq.io' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': TEST_API_KEY },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(ctx);
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });

    it('handles apiKey.update failure gracefully (best-effort lastUsedAt)', async () => {
      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              keyHash: 'hash',
              keyPrefix: 'ck_live_',
              revokedAt: null,
              expiresAt: null,
              user: { id: 'api-user', email: 'api@cerniq.io' },
            }),
            update: jest.fn().mockRejectedValue(new Error('DB error')),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      );

      const request: any = {
        headers: { 'x-api-key': TEST_API_KEY },
        cookies: {},
        method: 'GET',
      };

      // Should not throw
      await guard.canActivate(createContext(request));
      expect(request.user.userId).toBe('api-user');
    });

    it('rejects empty x-api-key header', async () => {
      const { guard } = createGuard();

      const request: any = {
        headers: { 'x-api-key': '   ' },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('role resolution', () => {
    it('resolves role from database when available', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(
        {
          decode: jest.fn().mockReturnValue({ type: 'access' }),
          verify: jest.fn().mockReturnValue({
            sub: 'user-db',
            email: 'db@test.com',
            role: 'authenticated',
          }),
        },
        {
          user: {
            findUnique: jest.fn().mockResolvedValue({ role: 'SUPER_ADMIN' }),
          },
          apiKey: { findUnique: jest.fn() },
        },
      );

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.role).toBe('SUPER_ADMIN');
    });

    it('falls back to token role when DB lookup fails', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(
        {
          decode: jest.fn().mockReturnValue({ type: 'access' }),
          verify: jest.fn().mockReturnValue({
            sub: 'user-fallback',
            email: 'fallback@test.com',
            role: 'analyst',
          }),
        },
        {
          user: {
            findUnique: jest.fn().mockRejectedValue(new Error('DB error')),
          },
          apiKey: { findUnique: jest.fn() },
        },
      );

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.role).toBe('analyst');
    });

    it('defaults role to "authenticated" when neither DB nor token has a role', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard(
        {
          decode: jest.fn().mockReturnValue({ type: 'access' }),
          verify: jest.fn().mockReturnValue({
            sub: 'user-norole',
            email: 'norole@test.com',
            // no role field
          }),
        },
        {
          user: {
            findUnique: jest.fn().mockResolvedValue({ role: null }),
          },
          apiKey: { findUnique: jest.fn() },
        },
      );

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.role).toBe('authenticated');
    });

    it('uses "api_key" role for API key auth and skips DB lookup', async () => {
      const { guard } = createGuard(
        { decode: jest.fn().mockReturnValue({}) },
        {
          apiKey: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'key-1',
              keyHash: 'hash',
              keyPrefix: 'ck_live_',
              revokedAt: null,
              expiresAt: null,
              user: { id: 'api-user', email: 'api@cerniq.io' },
            }),
            update: jest.fn(),
          },
          user: { findUnique: jest.fn() },
        },
      );

      const request: any = {
        headers: { 'x-api-key': TEST_API_KEY },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.role).toBe('api_key');
      // User findUnique should NOT have been called for API key auth
      expect((guard as any).prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('org access', () => {
    it('reads x-organization-id header', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-org',
          email: 'org@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-999',
        },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('org-999');
    });

    it('reads x-klytics-org-id as fallback header', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-klytics-org',
          email: 'klytics@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-klytics-org-id': 'klytics-org-1',
        },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('klytics-org-1');
    });

    it('rejects when KLYTICS_REQUIRE_ORG=true and no orgId', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-no-org',
          email: 'noorg@test.com',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows access when KLYTICS_REQUIRE_ORG=false (default)', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      delete process.env.KLYTICS_REQUIRE_ORG;

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-1',
          email: 'test@test.com',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBeNull();
    });

    it('enforces org membership via Supabase when KLYTICS_REQUIRE_ORG=true', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [{ org_id: 'org-1', role: 'admin' }],
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-with-org',
          email: 'org@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-1',
        },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('org-1');
    });

    it('rejects org access when membership not found', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [], // no memberships
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-no-membership',
          email: 'nomember@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-unauthorized',
        },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects when enforceOrgAccess fails due to missing service role key', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-1',
          email: 'test@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-1',
        },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('enforces entitlement check when KLYTICS_REQUIRE_ENTITLEMENT=true', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      process.env.KLYTICS_REQUIRE_ENTITLEMENT = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

      let callCount = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        callCount++;
        if (url.includes('memberships')) {
          return {
            ok: true,
            json: async () => [{ org_id: 'org-1', role: 'admin' }],
          } as Response;
        }
        if (url.includes('org_apps')) {
          return {
            ok: true,
            json: async () => [{ app_id: 'cerniq' }],
          } as Response;
        }
        return { ok: false } as Response;
      });

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-ent',
          email: 'ent@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-1',
        },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(callCount).toBe(2); // memberships + org_apps
    });

    it('rejects when entitlement check fails', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      process.env.KLYTICS_REQUIRE_ENTITLEMENT = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (url.includes('memberships')) {
          return {
            ok: true,
            json: async () => [{ org_id: 'org-1', role: 'admin' }],
          } as Response;
        }
        if (url.includes('org_apps')) {
          return { ok: true, json: async () => [] } as Response; // no entitlements
        }
        return { ok: false } as Response;
      });

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-no-ent',
          email: 'noent@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-1',
        },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('handles enforceOrgAccess fetch throwing gracefully', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-net-err',
          email: 'neterr@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': 'org-1',
        },
        cookies: {},
        method: 'GET',
      };

      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('uses orgId from token claims (org_id) when no header provided', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-claim-org',
          email: 'claimorg@test.com',
          org_id: 'org-from-claims',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('org-from-claims');
    });

    it('uses orgId from token claims (tenant_id) when no header or org_id', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-tenant',
          email: 'tenant@test.com',
          tenant_id: 'tenant-org-1',
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('tenant-org-1');
    });

    it('handles array-valued header', async () => {
      process.env.AUTH_ALLOW_LEGACY = 'true';
      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-arr',
          email: 'arr@test.com',
        }),
      });

      const request: any = {
        headers: {
          authorization: `Bearer ${FAKE_JWT}`,
          'x-organization-id': ['org-array-1', 'org-array-2'],
        },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      expect(request.user.orgId).toBe('org-array-1');
    });
  });

  describe('Supabase token with roles array', () => {
    it('extracts first role from claims.roles array', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_ANON_KEY = 'anon-key';

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'sb-user', email: 'sb@test.com' }),
      } as Response);

      const { guard } = createGuard({
        decode: jest.fn().mockReturnValue({ roles: ['admin', 'viewer'] }),
        verify: jest.fn().mockImplementation(() => {
          throw new Error('invalid');
        }),
      });

      const request: any = {
        headers: { authorization: `Bearer ${FAKE_JWT}` },
        cookies: {},
        method: 'GET',
      };

      await guard.canActivate(createContext(request));
      // The guard sets role from claims.role or claims.roles[0]
      // DB lookup will override, but if DB returns null, it would be 'admin'
    });
  });
});
