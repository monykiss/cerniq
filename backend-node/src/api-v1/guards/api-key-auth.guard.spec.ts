import {
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

// Mock the hashApiKey utility
jest.mock('../../auth/api-key.util', () => ({
  hashApiKey: jest.fn((token: string) => `hashed_${token}`),
}));

function createMockContext(
  headers: Record<string, string> = {},
): ExecutionContext {
  const request: any = {
    headers,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as any;
}

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;
  let mockPrisma: any;
  let mockPlatformAccess: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = {
      apiKey: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockPlatformAccess = {
      evaluateAccess: jest.fn().mockReturnValue({
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
    guard = new ApiKeyAuthGuard(mockPrisma, mockPlatformAccess);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('throws UnauthorizedException when no Authorization header is present', async () => {
    const ctx = createMockContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Missing API key');
  });

  it('throws UnauthorizedException when Authorization header is not Bearer', async () => {
    const ctx = createMockContext({ authorization: 'Basic abc123' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when Bearer token is empty', async () => {
    const ctx = createMockContext({ authorization: 'Bearer ' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('reads token from X-Api-Key header when Authorization is absent (legacy Enterprise convention)', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'enterprise@example.com',
        subscription: { tier: 'standard' },
      },
    });
    const request: any = { headers: { 'x-api-key': 'ck_live_xapikey_path' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request.apiUser.userId).toBe('user-1');
  });

  it('prefers Authorization: Bearer when both Bearer and X-Api-Key are present', async () => {
    const { hashApiKey } = jest.requireMock('../../auth/api-key.util');
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-bearer',
      keyHash: 'hashed_bearer_value',
      keyPrefix: 'ck_live_',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-bearer',
        email: 'bearer@example.com',
        subscription: { tier: 'standard' },
      },
    });
    const request: any = {
      headers: {
        authorization: 'Bearer bearer_value',
        'x-api-key': 'xapikey_value',
      },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    await guard.canActivate(ctx);
    // The hashApiKey mock returns `hashed_${token}`, so verifying the
    // findUnique was called with the Bearer-derived hash proves Bearer won.
    expect(hashApiKey).toHaveBeenCalledWith('bearer_value');
    expect(request.apiUser.userId).toBe('user-bearer');
  });

  it('throws UnauthorizedException when X-Api-Key is empty string', async () => {
    const ctx = createMockContext({ 'x-api-key': '' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Missing API key');
  });

  it('throws UnauthorizedException when API key is not found in database', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue(null);
    const ctx = createMockContext({
      authorization: 'Bearer ck_live_testkey123',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
  });

  it('throws UnauthorizedException when API key has no associated user', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_',
      user: null,
    });
    const ctx = createMockContext({
      authorization: 'Bearer ck_live_testkey123',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when API key has been revoked', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_',
      revokedAt: new Date('2026-01-01'),
      expiresAt: null,
      user: { id: 'user-1', email: 'test@example.com', subscription: null },
    });
    const ctx = createMockContext({
      authorization: 'Bearer ck_live_testkey123',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('revoked');
  });

  it('throws ForbiddenException when API key has expired', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_',
      revokedAt: null,
      expiresAt: new Date('2020-01-01'), // expired in the past
      user: { id: 'user-1', email: 'test@example.com', subscription: null },
    });
    const ctx = createMockContext({
      authorization: 'Bearer ck_live_testkey123',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('expired');
  });

  it('returns true and attaches apiUser for valid API key', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'test@example.com',
        subscription: { tier: 'standard' },
      },
    });

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request.apiUser).toBeDefined();
    expect(request.apiUser.userId).toBe('user-1');
    expect(request.apiUser.email).toBe('test@example.com');
    expect(request.apiUser.apiKeyId).toBe('key-1');
    expect(request.apiUser.tier).toBe('standard');
  });

  it('sets tier to partner when subscription tier is partner', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'partner@example.com',
        subscription: { tier: 'partner' },
      },
    });

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await guard.canActivate(ctx);
    expect(request.apiUser.tier).toBe('partner');
  });

  it('sets tier to partner when subscription tier is annual', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'annual@example.com',
        subscription: { tier: 'annual' },
      },
    });

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await guard.canActivate(ctx);
    expect(request.apiUser.tier).toBe('partner');
  });

  it('sets tier to standard when no subscription exists', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'free@example.com',
        subscription: null,
      },
    });

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await guard.canActivate(ctx);
    expect(request.apiUser.tier).toBe('standard');
  });

  it('attaches request.user for response envelope compatibility', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'test@example.com',
        subscription: { tier: 'standard' },
      },
    });

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await guard.canActivate(ctx);
    expect(request.user).toBeDefined();
    expect(request.user.role).toBe('api_key');
    expect(request.user.authMethod).toBe('api_key');
    expect(request.user.userId).toBe('user-1');
  });

  it('updates lastUsedAt in a fire-and-forget manner', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'test@example.com',
        subscription: null,
      },
    });
    mockPrisma.apiKey.update.mockResolvedValue({});

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await guard.canActivate(ctx);
    expect(mockPrisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('does not throw when lastUsedAt update fails', async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: null,
      user: {
        id: 'user-1',
        email: 'test@example.com',
        subscription: null,
      },
    });
    mockPrisma.apiKey.update.mockRejectedValue(new Error('DB error'));

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    // Should not throw despite update failure
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('allows future expiresAt date', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    mockPrisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      keyHash: 'abc',
      keyPrefix: 'ck_live_test',
      revokedAt: null,
      expiresAt: futureDate,
      user: {
        id: 'user-1',
        email: 'test@example.com',
        subscription: null,
      },
    });

    const request: any = {
      headers: { authorization: 'Bearer ck_live_testkey123' },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
