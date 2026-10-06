import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PlatformAccessService } from './platform-access.service';

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fakesig';

describe('AuthGuard', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function createContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  function createGuard(overrides?: {
    jwtService?: JwtService;
    prisma?: PrismaService;
    authService?: AuthService;
    reflector?: Reflector;
    platformAccess?: PlatformAccessService;
  }) {
    const jwtService =
      overrides?.jwtService ||
      ({
        decode: jest.fn(),
        verify: jest.fn(),
      } as unknown as JwtService);

    const prisma =
      overrides?.prisma ||
      ({
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: 'authenticated' }),
        },
        apiKey: {
          findUnique: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
        // Org-context fallback: the guard resolves the workspace a session
        // user OWNS when no x-organization-id header is present. Default to
        // none so these cases keep exercising the header/token paths.
        workspace: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaService);

    const authService =
      overrides?.authService ||
      ({
        resolveApplicationUser: jest
          .fn()
          .mockImplementation(
            async ({
              authUserId,
              email,
            }: {
              authUserId: string;
              email?: string | null;
            }) => ({
              id: authUserId,
              email: email || 'user@cerniq.io',
              role: 'authenticated',
            }),
          ),
      } as unknown as AuthService);

    const reflector =
      overrides?.reflector ||
      ({
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector);

    const platformAccess =
      overrides?.platformAccess ||
      ({
        getAccessForUser: jest.fn().mockResolvedValue({
          platformAccessAllowed: true,
          isPlatformAdmin: false,
          isPaid: true,
          effectiveTier: 'monthly',
          effectiveStatus: 'active',
          reason: 'paid',
        }),
        buildForbiddenPayload: jest.fn(),
      } as unknown as PlatformAccessService);

    return {
      guard: new AuthGuard(
        authService,
        jwtService,
        prisma,
        reflector,
        platformAccess,
      ),
      jwtService,
      prisma,
      authService,
      reflector,
      platformAccess,
    };
  }

  it('accepts CERNIQ legacy access tokens even when Supabase is configured', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'supabase-anon-key';
    process.env.AUTH_ALLOW_LEGACY = 'false';

    const jwtService = {
      decode: jest.fn().mockReturnValue({ type: 'access' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-123',
        email: 'operator@cerniq.io',
        type: 'access',
      }),
    } as unknown as JwtService;

    const authService = {
      resolveApplicationUser: jest.fn().mockResolvedValue({
        id: 'user-123',
        email: 'operator@cerniq.io',
        role: 'OWNER',
      }),
    } as unknown as AuthService;

    const platformAccess = {
      getAccessForUser: jest.fn().mockResolvedValue({
        platformAccessAllowed: true,
        isPlatformAdmin: false,
        isPaid: true,
        effectiveTier: 'monthly',
        effectiveStatus: 'active',
        reason: 'paid',
      }),
      buildForbiddenPayload: jest.fn(),
    } as unknown as PlatformAccessService;

    const { guard } = createGuard({
      jwtService,
      authService,
      platformAccess,
      prisma: {} as PrismaService,
    });

    const fetchSpy = jest.spyOn(global, 'fetch');
    const request: Record<string, unknown> = {
      cookies: { access_token: FAKE_JWT },
      headers: {},
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(authService.resolveApplicationUser).toHaveBeenCalled();
    expect(platformAccess.getAccessForUser).toHaveBeenCalledWith(
      'user-123',
      undefined,
      'OWNER',
    );
    expect(request.user).toMatchObject({
      userId: 'user-123',
      email: 'operator@cerniq.io',
      authMethod: 'token',
    });
  });

  it('elevates the platform admin account to OWNER when access is granted by bypass', async () => {
    const jwtService = {
      decode: jest.fn().mockReturnValue({ type: 'access' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-admin',
        email: 'operator@example.com',
        type: 'access',
      }),
    } as unknown as JwtService;

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'VIEWER' }),
      },
    } as unknown as PrismaService;

    const authService = {
      resolveApplicationUser: jest.fn().mockResolvedValue({
        id: 'user-admin',
        email: 'operator@example.com',
        role: 'VIEWER',
      }),
    } as unknown as AuthService;

    const platformAccess = {
      getAccessForUser: jest.fn().mockResolvedValue({
        platformAccessAllowed: true,
        isPlatformAdmin: true,
        isPaid: false,
        effectiveTier: 'free',
        effectiveStatus: null,
        reason: 'platform_admin',
      }),
      buildForbiddenPayload: jest.fn(),
    } as unknown as PlatformAccessService;

    const { guard } = createGuard({
      jwtService,
      prisma,
      authService,
      platformAccess,
    });

    const request: Record<string, unknown> = {
      cookies: { access_token: FAKE_JWT },
      headers: {},
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(platformAccess.getAccessForUser).toHaveBeenCalledWith(
      'user-admin',
      undefined,
      'VIEWER',
    );
    expect(request.user).toMatchObject({
      userId: 'user-admin',
      email: 'operator@example.com',
      role: 'OWNER',
    });
  });

  describe('org membership bypass (KLYTICS_REQUIRE_ORG)', () => {
    function setup(platformAdmin: unknown) {
      process.env.KLYTICS_REQUIRE_ORG = 'true';
      const jwtService = {
        decode: jest.fn().mockReturnValue({ type: 'access' }),
        verify: jest.fn().mockReturnValue({
          sub: 'user-1',
          email: 'member@example.com',
          type: 'access',
        }),
      } as unknown as JwtService;
      const prisma = {
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ role: 'VIEWER', platformAdmin }),
        },
        workspace: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const { guard } = createGuard({ jwtService, prisma });
      const request: Record<string, unknown> = {
        cookies: { access_token: FAKE_JWT },
        headers: {},
        method: 'GET',
      };
      return { guard, request, prisma };
    }

    it('denies a non-admin without org context, regardless of email', async () => {
      const { guard, request } = setup(false);
      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        'Org membership or entitlement check failed',
      );
    });

    it('allows a user whose persisted platformAdmin flag is true', async () => {
      const { guard, request, prisma } = setup(true);
      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { platformAdmin: true },
      });
    });

    it('fails closed when the platform-admin lookup errors', async () => {
      const { guard, request, prisma } = setup(true);
      (prisma.user.findUnique as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );
      await expect(guard.canActivate(createContext(request))).rejects.toThrow(
        'Org membership or entitlement check failed',
      );
    });
  });

  it('throws UnauthorizedException when no token and no API key', async () => {
    const { guard } = createGuard();

    const request: Record<string, unknown> = {
      cookies: {},
      headers: {},
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('extracts Bearer token from Authorization header', async () => {
    const jwtService = {
      decode: jest.fn().mockReturnValue({ type: 'access' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-456',
        email: 'test@cerniq.io',
        type: 'access',
      }),
    } as unknown as JwtService;

    const { guard } = createGuard({
      jwtService,
      prisma: {} as PrismaService,
    });

    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${FAKE_JWT}` },
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith(FAKE_JWT);
  });

  it('sets X-API-Key-Expires-In-Days header when key expires within 14 days', async () => {
    const expiresInDays = 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

    const prisma = {
      apiKey: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'key-1',
          keyHash: 'hash',
          keyPrefix: 'ck_live_',
          revokedAt: null,
          expiresAt,
          user: { id: 'user-key', email: 'apiuser@test.com' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;

    const { guard } = createGuard({
      prisma,
    });

    const responseHeaders: Record<string, string> = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-api-key': 'ck_live_test_key_value' },
          method: 'GET',
        }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => {
            responseHeaders[name] = value;
          },
        }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(responseHeaders['X-API-Key-Expires-In-Days']).toBeDefined();
    expect(responseHeaders.Warning).toContain('API key expires');
  });

  it('throws ForbiddenException for non-GET API key requests', async () => {
    const prisma = {
      apiKey: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'key-2',
          keyHash: 'hash',
          keyPrefix: 'ck_live_',
          revokedAt: null,
          expiresAt: null,
          user: { id: 'user-key', email: 'apiuser@test.com' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;

    const { guard } = createGuard({ prisma });

    const request: Record<string, unknown> = {
      headers: { 'x-api-key': 'ck_live_test_key' },
      method: 'POST',
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      'API keys are read-only',
    );
  });

  it('rejects revoked API keys', async () => {
    const prisma = {
      apiKey: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'key-3',
          keyHash: 'hash',
          keyPrefix: 'ck_live_',
          revokedAt: new Date(),
          expiresAt: null,
          user: { id: 'user-key', email: 'apiuser@test.com' },
        }),
      },
    } as unknown as PrismaService;

    const { guard } = createGuard({ prisma });

    const request: Record<string, unknown> = {
      headers: { 'x-api-key': 'ck_live_revoked_key' },
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('rejects expired API keys', async () => {
    const prisma = {
      apiKey: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'key-4',
          keyHash: 'hash',
          keyPrefix: 'ck_live_',
          revokedAt: null,
          expiresAt: new Date('2020-01-01'),
          user: { id: 'user-key', email: 'apiuser@test.com' },
        }),
      },
    } as unknown as PrismaService;

    const { guard } = createGuard({ prisma });

    const request: Record<string, unknown> = {
      headers: { 'x-api-key': 'ck_live_expired_key' },
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('enforces org access when KLYTICS_REQUIRE_ORG is true', async () => {
    process.env.KLYTICS_REQUIRE_ORG = 'true';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';

    const jwtService = {
      decode: jest.fn().mockReturnValue({ type: 'access' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-org-test',
        email: 'org@test.com',
        type: 'access',
      }),
    } as unknown as JwtService;

    const authService = {
      resolveApplicationUser: jest.fn().mockResolvedValue({
        id: 'user-org-test',
        email: 'org@test.com',
        role: 'authenticated',
      }),
    } as unknown as AuthService;

    const { guard } = createGuard({
      jwtService,
      authService,
    });

    const request: Record<string, unknown> = {
      cookies: { access_token: FAKE_JWT },
      headers: {},
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow();

    delete process.env.KLYTICS_REQUIRE_ORG;
  });

  it('falls back to legacy token when allowLegacy is true', async () => {
    process.env.AUTH_ALLOW_LEGACY = 'true';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';

    const jwtService = {
      decode: jest.fn().mockReturnValue({ some: 'claim' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-legacy',
        email: 'legacy@test.com',
      }),
    } as unknown as JwtService;

    const authService = {
      resolveApplicationUser: jest.fn().mockResolvedValue({
        id: 'user-legacy',
        email: 'legacy@test.com',
        role: 'authenticated',
      }),
    } as unknown as AuthService;

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
    } as Response);

    const { guard } = createGuard({
      jwtService,
      authService,
    });

    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${FAKE_JWT}` },
      method: 'GET',
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect((request.user as any).userId).toBe('user-legacy');

    fetchSpy.mockRestore();
    delete process.env.AUTH_ALLOW_LEGACY;
  });

  it('preserves the provisioned role when token auth already resolved one', async () => {
    const jwtService = {
      decode: jest.fn().mockReturnValue({ type: 'access' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-db-role',
        email: 'role@test.com',
        type: 'access',
      }),
    } as unknown as JwtService;

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'admin' }) },
    } as unknown as PrismaService;

    const authService = {
      resolveApplicationUser: jest.fn().mockResolvedValue({
        id: 'user-db-role',
        email: 'role@test.com',
        role: undefined,
      }),
    } as unknown as AuthService;

    const { guard } = createGuard({
      jwtService,
      prisma,
      authService,
    });

    const request: Record<string, unknown> = {
      cookies: { access_token: FAKE_JWT },
      headers: {},
      method: 'GET',
    };

    await guard.canActivate(createContext(request));
    expect((request.user as any).role).toBe('authenticated');
  });

  it('falls back to token role when DB lookup fails', async () => {
    const jwtService = {
      decode: jest.fn().mockReturnValue({ type: 'access' }),
      verify: jest.fn().mockReturnValue({
        sub: 'user-db-err',
        email: 'err@test.com',
        type: 'access',
        role: 'analyst',
      }),
    } as unknown as JwtService;

    const prisma = {
      user: { findUnique: jest.fn().mockRejectedValue(new Error('DB down')) },
    } as unknown as PrismaService;

    const authService = {
      resolveApplicationUser: jest.fn().mockResolvedValue({
        id: 'user-db-err',
        email: 'err@test.com',
        role: undefined,
      }),
    } as unknown as AuthService;

    const { guard } = createGuard({
      jwtService,
      prisma,
      authService,
    });

    const request: Record<string, unknown> = {
      cookies: { access_token: FAKE_JWT },
      headers: {},
      method: 'GET',
    };

    await guard.canActivate(createContext(request));
    expect((request.user as any).role).toBe('analyst');
  });
});
