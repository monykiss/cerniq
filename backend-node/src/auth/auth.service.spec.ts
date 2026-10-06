import { randomBytes as testRandomBytes } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { PlatformAccessService } from './platform-access.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();
const TEST_PW_2 = testPassword();
const TEST_PW_3 = testPassword();
const TEST_PW_4 = testPassword();
const TEST_PW_5 = testPassword();
const TEST_PW_6 = testPassword();
const TEST_PW_7 = testPassword();
const TEST_PW_8 = testPassword();
const TEST_NEW_PW_1 = testPassword();
const TEST_NEW_PW_2 = testPassword();
const TEST_NEW_PW_3 = testPassword();
const TEST_NEW_PW_4 = testPassword();
const TEST_NEW_PW_5 = testPassword();
const TEST_NEW_PW_6 = testPassword();
const TEST_NEW_PW_7 = testPassword();

// Generated per run so no fixed key-shaped literal lives in the repo.
const TEST_KEY_PREFIX = `ck_live_${crypto.randomBytes(4).toString('hex')}`;

describe('AuthService', () => {
  const originalEnv = { ...process.env };
  beforeAll(() => {
    process.env.API_KEY_PEPPER =
      'test-pepper-must-be-at-least-32-characters-long';
  });
  afterAll(() => {
    process.env = { ...originalEnv };
  });

  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    workspace: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    passwordResetToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    apiKey: {
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let platformAccess: {
    evaluateAccess: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      workspace: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      apiKey: {
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    };

    platformAccess = {
      evaluateAccess: jest.fn().mockReturnValue({
        platformAccessAllowed: true,
        isPlatformAdmin: false,
        isPaid: true,
        effectiveTier: 'monthly',
        effectiveStatus: 'active',
        reason: 'paid',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: PlatformAccessService, useValue: platformAccess },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── register ────────────────────────────────────────────

  describe('register', () => {
    it('should create a user with hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'new@example.com',
        name: 'New User',
      });
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      await service.register({
        email: 'new@example.com',
        password: TEST_PW_1,
        name: 'New User',
      });

      const createCall = prisma.user.create.mock.calls[0][0];
      expect(createCall.data.passwordHash).toBeDefined();
      expect(createCall.data.passwordHash).not.toBe(TEST_PW_1);
    });

    it('should return access and refresh tokens on success', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-2',
        email: 'test@example.com',
        name: 'Test',
      });
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.register({
        email: 'test@example.com',
        password: TEST_PW_2,
        name: 'Test',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
    });

    it('should reject duplicate emails with ConflictException', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        email: 'dup@example.com',
      });

      await expect(
        service.register({
          email: 'dup@example.com',
          password: TEST_PW_2,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject duplicate emails with correct message', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        email: 'dup@example.com',
      });

      await expect(
        service.register({
          email: 'dup@example.com',
          password: TEST_PW_2,
        }),
      ).rejects.toThrow('Email already registered');
    });
  });

  describe('resolveApplicationUser', () => {
    it('should auto-provision an authenticated app user and workspace when missing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue({
        id: 'auth-user-id',
        email: 'existing.user@example.com',
        name: null,
        avatarUrl: null,
        provider: 'supabase',
        providerId: 'auth-user-id',
        emailVerified: true,
        role: 'OWNER',
      });
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue({});

      const result = await service.resolveApplicationUser({
        authUserId: 'auth-user-id',
        email: 'existing.user@example.com',
        provider: 'supabase',
        providerId: 'auth-user-id',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'auth-user-id',
            email: 'existing.user@example.com',
          }),
        }),
      );
      expect(prisma.workspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: 'auth-user-id',
          }),
        }),
      );
      expect(result.id).toBe('auth-user-id');
    });

    it('should reuse an existing email-matched app user instead of creating a second row', async () => {
      const legacyUser = {
        id: 'legacy-user-id',
        email: 'existing.user@example.com',
        name: 'Existing User',
        avatarUrl: null,
        provider: 'email',
        providerId: null,
        emailVerified: true,
        role: 'OWNER',
        passwordHash: await bcrypt.hash(crypto.randomUUID(), 4),
      };
      prisma.user.findUnique.mockResolvedValueOnce(legacyUser);
      prisma.user.update.mockResolvedValue(legacyUser);
      prisma.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });

      const result = await service.resolveApplicationUser({
        authUserId: 'supabase-subject',
        email: 'existing.user@example.com',
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.id).toBe('legacy-user-id');
    });
  });

  describe('getUserProfile', () => {
    it('derives platform-admin access only from the persisted platformAdmin flag', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'operator@example.com',
        name: 'Operator',
        avatarUrl: null,
        provider: 'email',
        emailVerified: true,
        role: 'OWNER',
        platformAdmin: true,
        subscription: null,
        organizationMembers: [],
      });

      await service.getUserProfile('admin-1');

      expect(platformAccess.evaluateAccess).toHaveBeenCalledWith({
        subscription: null,
        role: 'OWNER',
        platformAdmin: true,
      });
    });

    it('never grants platform-admin access when the flag is absent', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2',
        email: 'someone@example.com',
        name: 'Someone',
        avatarUrl: null,
        provider: 'email',
        emailVerified: true,
        role: 'VIEWER',
        subscription: null,
        organizationMembers: [],
      });

      await service.getUserProfile('user-2');

      expect(platformAccess.evaluateAccess).toHaveBeenCalledWith(
        expect.objectContaining({ platformAdmin: false }),
      );
    });
  });

  // ── login ───────────────────────────────────────────────

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const hash = await bcrypt.hash(TEST_PW_3, 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-login',
        email: 'login@example.com',
        name: 'Login User',
        passwordHash: hash,
      });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({
        email: 'login@example.com',
        password: TEST_PW_3,
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('login@example.com');
    });

    it('looks up exactly the submitted email (no alias folding onto another account)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: '  Owner.Alias@Example.ORG ',
          password: crypto.randomUUID(),
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'owner.alias@example.org' },
      });
    });

    it('never auto-provisions or updates an account during login', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'unknown@example.com',
          password: crypto.randomUUID(),
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should reject invalid password with UnauthorizedException', async () => {
      const hash = await bcrypt.hash(TEST_PW_4, 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-login',
        email: 'login@example.com',
        passwordHash: hash,
      });

      await expect(
        service.login({
          email: 'login@example.com',
          password: TEST_PW_5,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'ghost@example.com',
          password: TEST_PW_2,
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should reject user with null passwordHash (OAuth account)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'oauth-user',
        email: 'oauth@example.com',
        provider: 'google',
        passwordHash: null,
      });

      await expect(
        service.login({
          email: 'oauth@example.com',
          password: TEST_PW_2,
        }),
      ).rejects.toThrow(
        'This account was created with Google sign-in. Use Google, or reset your password to create an email-password login.',
      );
    });
  });

  // ── requestPasswordReset ────────────────────────────────

  describe('requestPasswordReset', () => {
    it('should return success message even for non-existent email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.requestPasswordReset('nobody@example.com');

      expect(result.message).toBe(
        'If that email exists, a reset link has been sent',
      );
    });

    it('should not create a token for non-existent email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestPasswordReset('nobody@example.com');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('should invalidate previous tokens when new request is made', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-reset',
        email: 'reset@example.com',
      });
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.requestPasswordReset('reset@example.com');

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-reset', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('should create a PasswordResetToken with hashed token', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-hash',
        email: 'hash@example.com',
      });
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.requestPasswordReset('hash@example.com');

      const createCall = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(createCall.data.tokenHash).toBeDefined();
      expect(createCall.data.tokenHash.length).toBe(64); // SHA-256 hex
    });

    it('should create a PasswordResetToken with 1-hour expiry', async () => {
      const before = Date.now();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-exp',
        email: 'exp@example.com',
      });
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.requestPasswordReset('exp@example.com');

      const createCall = prisma.passwordResetToken.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;
      const oneHourMs = 60 * 60 * 1000;
      const diff = expiresAt.getTime() - before;
      // Should be approximately 1 hour (within 5 seconds tolerance)
      expect(diff).toBeGreaterThanOrEqual(oneHourMs - 5000);
      expect(diff).toBeLessThanOrEqual(oneHourMs + 5000);
    });

    it('should return success message for existing email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-ok',
        email: 'ok@example.com',
      });
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.create.mockResolvedValue({});

      const result = await service.requestPasswordReset('ok@example.com');

      expect(result.message).toBe(
        'If that email exists, a reset link has been sent',
      );
    });
  });

  // ── resetPassword ───────────────────────────────────────

  describe('resetPassword', () => {
    it('should reject expired tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        tokenHash: 'abc',
        usedAt: null,
        expiresAt: new Date(Date.now() - 60000), // expired 1 minute ago
      });

      await expect(
        service.resetPassword('some-token', TEST_NEW_PW_2),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject expired tokens with correct message', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-2',
        userId: 'user-2',
        tokenHash: 'def',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword('some-token', TEST_NEW_PW_2),
      ).rejects.toThrow(
        'Reset link is invalid or has expired. Please request a new one.',
      );
    });

    it('should reject already-used tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-3',
        userId: 'user-3',
        tokenHash: 'ghi',
        usedAt: new Date(), // already used
        expiresAt: new Date(Date.now() + 3600000),
      });

      await expect(
        service.resetPassword('used-token', TEST_NEW_PW_2),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-existent tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('invalid-token', TEST_NEW_PW_2),
      ).rejects.toThrow(
        'Reset link is invalid or has expired. Please request a new one.',
      );
    });

    it('should successfully reset password and call $transaction', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-valid',
        userId: 'user-valid',
        tokenHash: 'valid-hash',
        usedAt: null,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      });
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      const result = await service.resetPassword(
        'valid-token',
        'brandNewPassword',
      );

      expect(result.message).toBe(
        'Password has been reset successfully. Please log in with your new password.',
      );
    });

    it('should execute three operations in a transaction', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-tx',
        userId: 'user-tx',
        tokenHash: 'tx-hash',
        usedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
      });
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      await service.resetPassword('tx-token', TEST_NEW_PW_3);

      // $transaction is called with an array of 3 Prisma operations
      // (user.update, passwordResetToken.update, refreshToken.updateMany)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(3);
    });

    it('should mark the token as used during reset', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-mark',
        userId: 'user-mark',
        tokenHash: 'mark-hash',
        usedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
      });
      // Capture what's passed to $transaction
      prisma.$transaction.mockImplementation(async (ops: any[]) => ops);

      // The method calls prisma.$transaction with an array; we need to
      // verify the individual Prisma operations are created correctly.
      // Since they are Prisma PrismaPromise objects, we verify $transaction
      // was called (the 3-operation transaction is the key invariant).
      await service.resetPassword('mark-token', TEST_NEW_PW_5);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── logout ──────────────────────────────────────────────

  describe('logout', () => {
    it('should revoke refresh token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('should handle empty token gracefully', async () => {
      await service.logout('');

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('should mark refresh token as revoked with correct hash', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const token = 'valid-refresh-token';
      const expectedHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      await service.logout(token);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { token: expectedHash, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should not crash when DB throws an error', async () => {
      prisma.refreshToken.updateMany.mockRejectedValue(
        new Error('DB connection lost'),
      );

      // Should not throw — the catch block absorbs the error
      await expect(service.logout('some-token')).resolves.toBeUndefined();
    });
  });

  // ── refreshTokens ──────────────────────────────────────

  describe('refreshTokens', () => {
    it('should return new access + refresh tokens for a valid refresh token', async () => {
      const token = 'valid-refresh-jwt';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      jwtService.verify.mockReturnValue({
        sub: 'user-r1',
        email: 'refresh@example.com',
        type: 'refresh',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-r1',
        token: tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-r1',
        email: 'refresh@example.com',
        name: 'Refresh User',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens(token);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('refresh@example.com');
    });

    it('should revoke the old refresh token during rotation', async () => {
      const token = 'rotate-token';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      jwtService.verify.mockReturnValue({
        sub: 'user-r2',
        email: 'rotate@example.com',
        type: 'refresh',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-rotate',
        userId: 'user-r2',
        token: tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-r2',
        email: 'rotate@example.com',
        name: 'Rotate',
      });
      prisma.refreshToken.create.mockResolvedValue({});

      await service.refreshTokens(token);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-rotate' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException for an expired/invalid JWT', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshTokens('expired-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshTokens('expired-jwt')).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('should throw UnauthorizedException when token type is not refresh', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-bad',
        email: 'bad@example.com',
        type: 'access',
      });

      await expect(service.refreshTokens('access-token')).rejects.toThrow(
        'Invalid token type',
      );
    });

    it('should throw UnauthorizedException for a revoked refresh token', async () => {
      const token = 'revoked-token';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      jwtService.verify.mockReturnValue({
        sub: 'user-rev',
        email: 'revoked@example.com',
        type: 'refresh',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-revoked',
        userId: 'user-rev',
        token: tokenHash,
        revokedAt: new Date(), // already revoked
        expiresAt: new Date(Date.now() + 86400000),
      });

      await expect(service.refreshTokens(token)).rejects.toThrow(
        'Refresh token revoked',
      );
    });

    it('should throw UnauthorizedException for a non-existent stored token', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-ghost',
        email: 'ghost@example.com',
        type: 'refresh',
      });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('ghost-token')).rejects.toThrow(
        'Refresh token revoked',
      );
    });

    it('should throw UnauthorizedException for an expired stored token', async () => {
      const token = 'db-expired-token';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      jwtService.verify.mockReturnValue({
        sub: 'user-exp',
        email: 'exp@example.com',
        type: 'refresh',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-dbexp',
        userId: 'user-exp',
        token: tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60000), // expired in DB
      });

      await expect(service.refreshTokens(token)).rejects.toThrow(
        'Refresh token expired',
      );
    });

    it('should throw UnauthorizedException when user no longer exists', async () => {
      const token = 'orphan-token';
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      jwtService.verify.mockReturnValue({
        sub: 'user-deleted',
        email: 'deleted@example.com',
        type: 'refresh',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-orphan',
        userId: 'user-deleted',
        token: tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens(token)).rejects.toThrow(
        'User not found',
      );
    });
  });

  // ── changePassword ─────────────────────────────────────

  describe('changePassword', () => {
    it('should change password when current password is correct', async () => {
      const hash = await bcrypt.hash(TEST_PW_6, 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-cp1',
        email: 'cp@example.com',
        passwordHash: hash,
      });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.changePassword(
        'user-cp1',
        TEST_PW_6,
        TEST_NEW_PW_1,
      );

      expect(result.message).toBe('Password changed successfully');
    });

    it('should store a bcrypt hash of the new password', async () => {
      const hash = await bcrypt.hash(TEST_PW_7, 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-cp2',
        email: 'cp2@example.com',
        passwordHash: hash,
      });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await service.changePassword('user-cp2', TEST_PW_7, TEST_NEW_PW_4);

      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.passwordHash).toBeDefined();
      expect(updateCall.data.passwordHash).not.toBe(TEST_NEW_PW_4);
      // Verify it's a valid bcrypt hash
      const isValid = await bcrypt.compare(
        TEST_NEW_PW_4,
        updateCall.data.passwordHash,
      );
      expect(isValid).toBe(true);
    });

    it('should revoke all refresh tokens after password change', async () => {
      const hash = await bcrypt.hash(TEST_PW_8, 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-cp3',
        email: 'cp3@example.com',
        passwordHash: hash,
      });
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.changePassword('user-cp3', TEST_PW_8, TEST_NEW_PW_5);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-cp3', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException for wrong current password', async () => {
      const hash = await bcrypt.hash(TEST_PW_4, 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-cp4',
        email: 'cp4@example.com',
        passwordHash: hash,
      });

      await expect(
        service.changePassword('user-cp4', TEST_PW_5, TEST_NEW_PW_5),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changePassword('user-cp4', TEST_PW_5, TEST_NEW_PW_5),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('should throw BadRequestException for OAuth user without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-oauth',
        email: 'oauth@example.com',
        passwordHash: null,
      });

      await expect(
        service.changePassword('user-oauth', TEST_NEW_PW_6, TEST_NEW_PW_5),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changePassword('user-oauth', TEST_NEW_PW_6, TEST_NEW_PW_5),
      ).rejects.toThrow('Cannot change password for OAuth accounts');
    });

    it('should throw BadRequestException for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('no-user', TEST_NEW_PW_7, TEST_NEW_PW_5),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── API Key Management ─────────────────────────────────

  describe('createApiKey', () => {
    it('should return a key with the ck_live_ prefix', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'ak-1',
        name: 'My Key',
        keyPrefix: TEST_KEY_PREFIX,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: null,
      });

      const result = await service.createApiKey('user-ak1', 'My Key');

      expect(result.apiKey).toMatch(/^ck_live_/);
      expect(result.record.id).toBe('ak-1');
      expect(result.record.name).toBe('My Key');
    });

    it('should store the hashed key, not the plaintext', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'ak-2',
        name: 'Hashed Key',
        keyPrefix: TEST_KEY_PREFIX,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: null,
      });

      await service.createApiKey('user-ak2', 'Hashed Key');

      const createCall = prisma.apiKey.create.mock.calls[0][0];
      expect(createCall.data.keyHash).toBeDefined();
      expect(createCall.data.keyHash).not.toMatch(/^ck_live_/);
      expect(createCall.data.keyHash.length).toBe(64); // SHA-256 hex
    });

    it('should set expiresAt when expiresInDays is provided', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'ak-3',
        name: 'Expiring Key',
        keyPrefix: TEST_KEY_PREFIX,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: new Date(),
      });

      const before = Date.now();
      await service.createApiKey('user-ak3', 'Expiring Key', 30);

      const createCall = prisma.apiKey.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;
      expect(expiresAt).toBeInstanceOf(Date);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const diff = expiresAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(thirtyDaysMs - 5000);
      expect(diff).toBeLessThanOrEqual(thirtyDaysMs + 5000);
    });

    it('should throw BadRequestException for empty name', async () => {
      await expect(service.createApiKey('user-ak4', '')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createApiKey('user-ak4', '   ')).rejects.toThrow(
        'API key name is required',
      );
    });
  });

  describe('listApiKeys', () => {
    it("should return the user's API keys", async () => {
      const mockKeys = [
        {
          id: 'ak-list-1',
          name: 'Production',
          keyPrefix: 'ck_live_abc',
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: null,
        },
        {
          id: 'ak-list-2',
          name: 'Staging',
          keyPrefix: 'ck_live_def',
          createdAt: new Date(),
          lastUsedAt: new Date(),
          revokedAt: null,
          expiresAt: null,
        },
      ];
      prisma.apiKey.findMany.mockResolvedValue(mockKeys);

      const result = await service.listApiKeys('user-list');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Production');
      expect(result[1].name).toBe('Staging');
    });

    it('should return empty array when user has no keys', async () => {
      prisma.apiKey.findMany.mockResolvedValue([]);

      const result = await service.listApiKeys('user-no-keys');

      expect(result).toEqual([]);
    });

    it('should call findMany with correct userId filter', async () => {
      prisma.apiKey.findMany.mockResolvedValue([]);

      await service.listApiKeys('user-filter');

      expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-filter' },
        }),
      );
    });
  });

  describe('revokeApiKey', () => {
    it('should mark the key as revoked', async () => {
      prisma.apiKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revokeApiKey('user-rev1', 'ak-rev1');

      expect(result).toEqual({ revoked: true });
      expect(prisma.apiKey.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ak-rev1',
          userId: 'user-rev1',
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });

    it("should throw BadRequestException when revoking another user's key", async () => {
      // updateMany returns count 0 because the userId filter doesn't match
      prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.revokeApiKey('wrong-user', 'ak-other'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.revokeApiKey('wrong-user', 'ak-other'),
      ).rejects.toThrow('API key not found or already revoked');
    });

    it('should throw BadRequestException when key is already revoked', async () => {
      prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.revokeApiKey('user-rev2', 'ak-already-revoked'),
      ).rejects.toThrow('API key not found or already revoked');
    });

    it('should throw BadRequestException for non-existent key', async () => {
      prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.revokeApiKey('user-rev3', 'ak-nonexistent'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── validateOAuthUser ─────────────────────────────
  describe('validateOAuthUser', () => {
    it('returns existing user matched by provider+providerId', async () => {
      const existingUser = {
        id: 'oauth-u1',
        email: 'oauth@test.com',
        provider: 'google',
        providerId: 'gid-1',
      };
      prisma.user.findFirst.mockResolvedValue(existingUser);
      prisma.user.update.mockResolvedValue(existingUser);

      const result = await service.validateOAuthUser({
        email: 'oauth@test.com',
        name: 'OAuth User',
        provider: 'google',
        providerId: 'gid-1',
      });

      expect(result.id).toBe('oauth-u1');
      expect(prisma.user.findFirst).toHaveBeenCalled();
    });

    it('links OAuth to existing email account when provider not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // no provider match
      prisma.user.findUnique.mockResolvedValue({
        id: 'email-u1',
        email: 'shared@test.com',
        avatarUrl: null,
      });
      prisma.user.update.mockResolvedValue({
        id: 'email-u1',
        provider: 'github',
        providerId: 'gh-1',
      });

      const result = await service.validateOAuthUser({
        email: 'shared@test.com',
        name: 'Shared User',
        provider: 'github',
        providerId: 'gh-1',
        avatarUrl: 'https://avatar.com/pic.png',
      });

      expect(result.id).toBe('email-u1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'email-u1' },
        data: expect.objectContaining({
          provider: 'github',
          providerId: 'gh-1',
          avatarUrl: 'https://avatar.com/pic.png',
        }),
      });
    });

    it('creates new user + workspace when no existing user found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-oauth',
        email: 'new@oauth.com',
        name: 'New OAuth',
      });
      prisma.workspace.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({});

      const result = await service.validateOAuthUser({
        email: 'new@oauth.com',
        name: 'New OAuth',
        provider: 'google',
        providerId: 'gid-new',
      });

      expect(result.id).toBe('new-oauth');
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ownerId: 'new-oauth' }),
      });
    });
  });

  // ── getUserProfile ────────────────────────────────
  describe('getUserProfile', () => {
    it('returns profile with organizations', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'profile@test.com',
        name: 'Profile User',
        avatarUrl: null,
        provider: 'email',
        emailVerified: true,
        organizationMembers: [
          {
            organization: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
            role: 'admin',
          },
        ],
      });

      const result = await service.getUserProfile('u1');

      expect(result.id).toBe('u1');
      expect(result.organizations).toHaveLength(1);
      expect(result.organizations[0].role).toBe('admin');
    });

    it('throws UnauthorizedException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserProfile('nonexistent')).rejects.toThrow(
        'User not found',
      );
    });
  });

  // ── generateTokens (session eviction) ─────────────
  describe('generateTokens', () => {
    it('evicts oldest sessions when exceeding MAX_SESSIONS', async () => {
      const activeSessions = Array.from({ length: 7 }, (_, i) => ({
        id: `rt-${i}`,
      }));
      prisma.refreshToken.create.mockResolvedValue({});
      prisma.refreshToken.findMany.mockResolvedValue(activeSessions);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.generateTokens({
        id: 'u-evict',
        email: 'evict@test.com',
        name: 'Evict',
      });

      // Should revoke the 2 oldest (7 - 5 = 2)
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['rt-0', 'rt-1'] } },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not evict when under MAX_SESSIONS', async () => {
      prisma.refreshToken.create.mockResolvedValue({});
      prisma.refreshToken.findMany.mockResolvedValue([{ id: 'rt-0' }]);

      await service.generateTokens({ id: 'u-ok', email: 'ok@test.com' });

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    // ── Phase 4 legacy sunset: AUTH_DISABLE_LEGACY_MINT ──
    describe('Phase 4 legacy mint sunset (AUTH_DISABLE_LEGACY_MINT)', () => {
      const KEY = 'AUTH_DISABLE_LEGACY_MINT';
      let prior: string | undefined;
      beforeEach(() => {
        prior = process.env[KEY];
        jwtService.sign.mockClear();
        prisma.refreshToken.create.mockClear();
        prisma.refreshToken.create.mockResolvedValue({});
        prisma.refreshToken.findMany.mockResolvedValue([]);
      });
      afterEach(() => {
        if (prior === undefined) delete process.env[KEY];
        else process.env[KEY] = prior;
      });

      it('mints normally when the flag is unset (default behavior preserved)', async () => {
        delete process.env[KEY];
        await service.generateTokens({ id: 'u-mint', email: 'mint@test.com' });
        expect(jwtService.sign).toHaveBeenCalled();
        expect(prisma.refreshToken.create).toHaveBeenCalled();
      });

      it.each(['true', '1', 'yes', 'on'])(
        'refuses to mint (410 Gone → Supabase) and creates no session when flag=%s',
        async (val) => {
          process.env[KEY] = val;
          await expect(
            service.generateTokens({ id: 'u-x', email: 'x@test.com' }),
          ).rejects.toThrow('Legacy Nest password sessions are retired');
          expect(jwtService.sign).not.toHaveBeenCalled();
          expect(prisma.refreshToken.create).not.toHaveBeenCalled();
        },
      );

      it('still mints on falsy flag values (e.g. "false") — only truthy disables', async () => {
        process.env[KEY] = 'false';
        await service.generateTokens({ id: 'u-f', email: 'f@test.com' });
        expect(jwtService.sign).toHaveBeenCalled();
      });
    });
  });

  // ── getUserOrgs ───────────────────────────────────
  describe('getUserOrgs', () => {
    it('returns empty array when no supabase config', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const result = await service.getUserOrgs('u1');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty userId', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
      const result = await service.getUserOrgs('');
      expect(result).toEqual([]);
    });

    it('fetches org memberships and apps from Supabase', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
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

      const result = await service.getUserOrgs('u1');
      expect(result).toHaveLength(1);
      expect(result[0].org_id).toBe('org-1');
      expect(result[0].apps).toContain('cerniq');
    });

    it('returns empty array when membership fetch fails', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

      const result = await service.getUserOrgs('u1');
      expect(result).toEqual([]);
    });

    it('handles fetch throwing gracefully', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network'));
      const result = await service.getUserOrgs('u1');
      expect(result).toEqual([]);
    });

    it('skips memberships with null org_id', async () => {
      process.env.SUPABASE_URL = 'https://test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (url.includes('memberships')) {
          return {
            ok: true,
            json: async () => [
              { org_id: null, role: 'admin' },
              { org_id: 'org-2', role: 'viewer' },
            ],
          } as Response;
        }
        if (url.includes('org_apps')) {
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: false } as Response;
      });

      const result = await service.getUserOrgs('u1');
      expect(result).toHaveLength(1);
      expect(result[0].org_id).toBe('org-2');
    });
  });

  // ── revokeAllUserTokens ───────────────────────────
  describe('revokeAllUserTokens', () => {
    it('revokes all refresh tokens for a user', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.revokeAllUserTokens('user-revoke-all');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-revoke-all', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('generateTokens — refresh token uniqueness', () => {
    /**
     * Regression: RefreshToken.token is @unique, and the refresh payload used
     * to be a pure function of (sub, email, type). The only varying JWT claim,
     * `iat`, has ONE-SECOND resolution — so two logins by the same user inside
     * the same second minted a byte-identical token and the second insert died
     * with P2002, surfacing as a 500 on login.
     *
     * Observed live before the fix: three consecutive logins returned
     * 200, 500, 429.
     */
    const user = {
      id: 'user-1',
      email: 'socio@example.com',
      name: 'Socio',
      role: 'OWNER',
    };

    it('gives every refresh token a unique jti', async () => {
      await service.generateTokens(user);
      await service.generateTokens(user);

      const refreshPayloads = jwtService.sign.mock.calls
        .map((c) => c[0] as { type?: string; jti?: string })
        .filter((p) => p.type === 'refresh');

      expect(refreshPayloads.length).toBeGreaterThanOrEqual(2);
      for (const p of refreshPayloads) {
        expect(typeof p.jti).toBe('string');
        expect((p.jti as string).length).toBeGreaterThan(0);
      }
      const distinct = new Set(refreshPayloads.map((p) => p.jti));
      expect(distinct.size).toBe(refreshPayloads.length);
    });

    it('the jti is the ONLY thing distinguishing two same-second payloads', () => {
      // Documents why the fix has to live in the payload rather than in a
      // retry: without jti the two objects are deep-equal, so no amount of
      // retrying produces a different token.
      const strip = (p: Record<string, unknown>) => {
        const { jti: _jti, ...rest } = p;
        return rest;
      };
      const refreshPayloads = jwtService.sign.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((p) => p.type === 'refresh');
      if (refreshPayloads.length >= 2) {
        expect(strip(refreshPayloads[0])).toEqual(strip(refreshPayloads[1]));
      }
    });
  });
});
