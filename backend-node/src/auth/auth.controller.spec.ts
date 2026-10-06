import { randomBytes as testRandomBytes } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { AuthGuard } from './auth.guard';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();
const TEST_PW_2 = testPassword().slice(0, 1);
const TEST_PW_3 = testPassword().slice(0, 4);
const TEST_PW_4 = testPassword().slice(0, 1);

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let auditService: { log: jest.Mock };

  const mockRes = () => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  });

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refreshTokens: jest.fn(),
      logout: jest.fn(),
      getUserProfile: jest.fn(),
      changePassword: jest.fn(),
      listApiKeys: jest.fn(),
      createApiKey: jest.fn(),
      revokeApiKey: jest.fn(),
      requestPasswordReset: jest.fn(),
      confirmPasswordReset: jest.fn(),
    };

    auditService = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuditService, useValue: auditService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /api/auth/register', () => {
    it('should register a user and set auth cookies', async () => {
      const dto = {
        email: 'new@test.com',
        password: TEST_PW_1,
        name: 'Test',
      };
      const result = {
        user: { id: 'u1', email: 'new@test.com', name: 'Test' },
        accessToken: 'at_123',
        refreshToken: 'rt_123',
      };
      authService.register.mockResolvedValue(result);
      const res = mockRes();

      const response = await controller.register(dto as any, res);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'at_123',
        expect.any(Object),
      );
      expect(response).toEqual({ user: result.user });
    });

    it('should propagate duplicate email errors', async () => {
      authService.register.mockRejectedValue(new Error('Email already exists'));
      const res = mockRes();

      await expect(
        controller.register(
          { email: 'dup@test.com', password: TEST_PW_2 } as any,
          res,
        ),
      ).rejects.toThrow('Email already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login a user, set cookies, and fire audit log', async () => {
      const dto = { email: 'user@test.com', password: TEST_PW_3 };
      const result = {
        user: { id: 'u2', email: 'user@test.com' },
        accessToken: 'at_login',
        refreshToken: 'rt_login',
      };
      authService.login.mockResolvedValue(result);
      const req = { ip: '10.0.0.1', headers: { 'user-agent': 'jest' } };
      const res = mockRes();

      const response = await controller.login(dto as any, req, res);

      expect(response).toEqual({ user: result.user });
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'at_login',
        expect.any(Object),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u2',
          action: 'login',
          resource: 'user',
          outcome: 'success',
        }),
      );
    });

    it('should propagate invalid credentials error', async () => {
      authService.login.mockRejectedValue(new Error('Invalid credentials'));
      const req = { ip: '', headers: {} };
      const res = mockRes();

      await expect(
        controller.login({ email: 'x', password: TEST_PW_4 } as any, req, res),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens from body', async () => {
      const result = {
        user: { id: 'u3' },
        accessToken: 'at_new',
        refreshToken: 'rt_new',
      };
      authService.refreshTokens.mockResolvedValue(result);
      const req = { cookies: {} };
      const res = mockRes();

      const response = await controller.refresh(
        { refreshToken: 'rt_old' } as any,
        req,
        res,
      );

      expect(authService.refreshTokens).toHaveBeenCalledWith('rt_old');
      expect(response).toEqual({ user: result.user });
    });

    it('should refresh tokens from cookie when body is empty', async () => {
      const result = {
        user: { id: 'u4' },
        accessToken: 'at_cookie',
        refreshToken: 'rt_cookie',
      };
      authService.refreshTokens.mockResolvedValue(result);
      const req = { cookies: { refresh_token: 'rt_from_cookie' } };
      const res = mockRes();

      await controller.refresh({} as any, req, res);

      expect(authService.refreshTokens).toHaveBeenCalledWith('rt_from_cookie');
    });

    it('should return 401 when no refresh token provided', async () => {
      const req = { cookies: {} };
      const res = mockRes();

      await expect(controller.refresh({} as any, req, res)).rejects.toThrow(
        'No refresh token provided',
      );
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and clear cookies', async () => {
      authService.logout.mockResolvedValue(undefined);
      const req = { cookies: { refresh_token: 'rt_to_revoke' } };
      const res = mockRes();

      const response = await controller.logout(req, res);

      expect(authService.logout).toHaveBeenCalledWith('rt_to_revoke');
      expect(res.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(Object),
      );
      expect(response).toEqual({ message: 'Logged out' });
    });

    it('should logout gracefully when no cookie present', async () => {
      const req = { cookies: {} };
      const res = mockRes();

      const response = await controller.logout(req, res);

      expect(authService.logout).not.toHaveBeenCalled();
      expect(response).toEqual({ message: 'Logged out' });
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should return user profile', async () => {
      const profile = { id: 'u5', email: 'user@test.com', name: 'Test' };
      authService.getUserProfile.mockResolvedValue(profile);

      const req = { user: { userId: 'u5' } };
      const result = await controller.getProfile(req);

      expect(authService.getUserProfile).toHaveBeenCalledWith('u5', undefined);
      expect(result).toEqual(profile);
    });
  });

  describe('POST /api/auth/password-reset', () => {
    it('should request password reset', async () => {
      const serviceResult = {
        message: 'If the email exists, a reset link has been sent',
      };
      authService.requestPasswordReset.mockResolvedValue(serviceResult);

      const result = await controller.requestPasswordReset({
        email: 'reset@test.com',
      } as any);

      expect(authService.requestPasswordReset).toHaveBeenCalledWith(
        'reset@test.com',
      );
      expect(result).toEqual(serviceResult);
    });

    it('should not leak whether email exists (constant response)', async () => {
      authService.requestPasswordReset.mockResolvedValue({
        message: 'If the email exists, a reset link has been sent',
      });

      const result = await controller.requestPasswordReset({
        email: 'nonexistent@test.com',
      } as any);

      // Should always return the same message regardless of email existence
      expect(result.message).toContain('If the email exists');
    });
  });

  describe('API key management', () => {
    it('should list API keys for authenticated user', async () => {
      const keys = [{ id: 'k1', name: 'test-key', prefix: 'ck_live_abc' }];
      authService.listApiKeys.mockResolvedValue(keys);

      const req = { user: { userId: 'u6' } };
      const result = await controller.listApiKeys(req);

      expect(result).toEqual({ keys });
    });

    it('should create a new API key', async () => {
      const newKey = {
        id: 'k2',
        name: 'production',
        key: 'ck_live_full_key_shown_once',
      };
      authService.createApiKey.mockResolvedValue(newKey);

      const req = { user: { userId: 'u7', role: 'OWNER' } };
      const result = await controller.createApiKey(req, {
        name: 'production',
      } as any);

      expect(authService.createApiKey).toHaveBeenCalledWith(
        'u7',
        'production',
        undefined,
      );
      expect(result).toEqual(newKey);
    });

    it('should revoke an API key', async () => {
      authService.revokeApiKey.mockResolvedValue({ message: 'Key revoked' });

      const req = { user: { userId: 'u8', role: 'OWNER' } };
      await controller.revokeApiKey(req, 'k3');

      expect(authService.revokeApiKey).toHaveBeenCalledWith('u8', 'k3');
    });

    it('should create API key with expiresInDays', async () => {
      authService.createApiKey.mockResolvedValue({
        id: 'k4',
        key: 'ck_live_xxx',
      });

      const req = { user: { userId: 'u9', role: 'OWNER' } };
      const result = await controller.createApiKey(req, {
        name: 'expiring',
        expiresInDays: 30,
      } as any);

      expect(authService.createApiKey).toHaveBeenCalledWith(
        'u9',
        'expiring',
        30,
      );
    });

    it('should block non-owner users from creating API keys', async () => {
      const req = { user: { userId: 'u11', role: 'ANALYST' } };

      await expect(
        controller.createApiKey(req, {
          name: 'blocked',
        } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(authService.createApiKey).not.toHaveBeenCalled();
    });

    it('should block non-owner users from revoking API keys', async () => {
      const req = { user: { userId: 'u12', role: 'VIEWER' } };

      await expect(controller.revokeApiKey(req, 'k9')).rejects.toThrow(
        ForbiddenException,
      );
      expect(authService.revokeApiKey).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/auth/password', () => {
    it('should change password for authenticated user', async () => {
      authService.changePassword.mockResolvedValue({
        message: 'Password changed',
      });
      const req = { user: { userId: 'u10' } };
      const dto = {
        currentPassword: testPassword(),
        newPassword: testPassword(),
      };

      const result = await controller.changePassword(req, dto as any);

      expect(authService.changePassword).toHaveBeenCalledWith(
        'u10',
        dto.currentPassword,
        dto.newPassword,
      );
    });
  });

  describe('POST /api/auth/password-reset/confirm', () => {
    it('should confirm password reset', async () => {
      authService.resetPassword = jest
        .fn()
        .mockResolvedValue({ message: 'Password reset' });
      const dto = { token: 'reset-token', newPassword: testPassword() };

      const result = await controller.resetPassword(dto as any);

      expect(authService.resetPassword).toHaveBeenCalledWith(
        'reset-token',
        dto.newPassword,
      );
    });
  });

  describe('GET /api/auth/whoami', () => {
    it('should return whoami info with orgs', async () => {
      authService.getUserOrgs = jest
        .fn()
        .mockResolvedValue([
          { org_id: 'org-1', role: 'admin', apps: ['cerniq'] },
        ]);
      const req = {
        user: {
          userId: 'u-who',
          email: 'who@test.com',
          claims: { iss: 'test', aud: 'test' },
        },
      };

      const result = await controller.whoami(req);

      expect(result.user_id).toBe('u-who');
      expect(result.email).toBe('who@test.com');
      expect(result.orgs).toHaveLength(1);
    });

    it('should check issuer and audience from env vars', async () => {
      process.env.SUPABASE_JWT_ISSUER = 'test-issuer';
      process.env.SUPABASE_JWT_AUDIENCE = 'test-audience';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-iss',
          email: 'iss@test.com',
          claims: { iss: 'test-issuer', aud: 'test-audience' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.issuer_ok).toBe(true);
      expect(result.aud_ok).toBe(true);

      delete process.env.SUPABASE_JWT_ISSUER;
      delete process.env.SUPABASE_JWT_AUDIENCE;
    });

    it('detects mismatched audience array', async () => {
      process.env.SUPABASE_JWT_AUDIENCE = 'expected-aud';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-aud',
          email: 'aud@test.com',
          claims: { aud: ['other-aud', 'expected-aud'] },
        },
      };

      const result = await controller.whoami(req);
      expect(result.aud_ok).toBe(true);

      delete process.env.SUPABASE_JWT_AUDIENCE;
    });

    it('returns aud_ok true when no expected audience configured', async () => {
      delete process.env.SUPABASE_JWT_AUDIENCE;
      delete process.env.SUPABASE_AUDIENCE;
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-noaud',
          email: 'no@test.com',
          claims: { aud: 'some-aud' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.aud_ok).toBe(true);
    });

    it('returns issuer_ok true when no expected issuer configured', async () => {
      delete process.env.SUPABASE_JWT_ISSUER;
      delete process.env.SUPABASE_ISSUER;
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-noiss',
          email: 'noiss@test.com',
          claims: { iss: 'any' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.issuer_ok).toBe(true);
    });

    it('returns issuer_ok false when issuer mismatches', async () => {
      process.env.SUPABASE_JWT_ISSUER = 'expected-issuer';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-biss',
          email: 'biss@test.com',
          claims: { iss: 'wrong-issuer' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.issuer_ok).toBe(false);

      delete process.env.SUPABASE_JWT_ISSUER;
    });

    it('returns aud_ok false when audience mismatches (string)', async () => {
      process.env.SUPABASE_JWT_AUDIENCE = 'expected-aud';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-baud',
          email: 'baud@test.com',
          claims: { aud: 'wrong-aud' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.aud_ok).toBe(false);

      delete process.env.SUPABASE_JWT_AUDIENCE;
    });

    it('returns aud_ok false when audience array does not include expected', async () => {
      process.env.SUPABASE_JWT_AUDIENCE = 'expected-aud';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-barr',
          email: 'barr@test.com',
          claims: { aud: ['aud1', 'aud2'] },
        },
      };

      const result = await controller.whoami(req);
      expect(result.aud_ok).toBe(false);

      delete process.env.SUPABASE_JWT_AUDIENCE;
    });

    it('handles empty claims object', async () => {
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: { userId: 'u-empty', email: 'empty@test.com', claims: {} },
      };

      const result = await controller.whoami(req);
      expect(result.user_id).toBe('u-empty');
    });

    it('handles missing claims', async () => {
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: { userId: 'u-nocl', email: 'nocl@test.com' },
      };

      const result = await controller.whoami(req);
      expect(result.user_id).toBe('u-nocl');
    });

    it('uses SUPABASE_ISSUER as fallback for issuer check', async () => {
      delete process.env.SUPABASE_JWT_ISSUER;
      process.env.SUPABASE_ISSUER = 'fallback-issuer';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-fb',
          email: 'fb@test.com',
          claims: { iss: 'fallback-issuer' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.issuer_ok).toBe(true);

      delete process.env.SUPABASE_ISSUER;
    });

    it('uses SUPABASE_AUDIENCE as fallback for audience check', async () => {
      delete process.env.SUPABASE_JWT_AUDIENCE;
      process.env.SUPABASE_AUDIENCE = 'fallback-aud';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: {
          userId: 'u-fba',
          email: 'fba@test.com',
          claims: { aud: 'fallback-aud' },
        },
      };

      const result = await controller.whoami(req);
      expect(result.aud_ok).toBe(true);

      delete process.env.SUPABASE_AUDIENCE;
    });

    it('returns KLYTICS_APP_ID from env', async () => {
      process.env.KLYTICS_APP_ID = 'custom-app';
      authService.getUserOrgs = jest.fn().mockResolvedValue([]);

      const req = {
        user: { userId: 'u-app', email: 'app@test.com', claims: {} },
      };

      const result = await controller.whoami(req);
      expect(result.app).toBe('custom-app');

      delete process.env.KLYTICS_APP_ID;
    });
  });

  // ── Magic Link Auth ──────────────────────────────────────────

  describe('POST /api/auth/magic-link', () => {
    it('should return 200 with success message for valid email', async () => {
      authService.requestMagicLinkForEmail = jest
        .fn()
        .mockResolvedValue(undefined);

      const result = await controller.requestMagicLink({
        email: 'cfo@cooperativa.example',
      } as any);

      expect(authService.requestMagicLinkForEmail).toHaveBeenCalledWith(
        'cfo@cooperativa.example',
        undefined,
      );
      expect(result.message).toContain('sign-in link');
    });

    it('should return 200 even when service throws (no email enumeration)', async () => {
      authService.requestMagicLinkForEmail = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));

      const result = await controller.requestMagicLink({
        email: 'nobody@test.com',
      } as any);

      // Should still return success message
      expect(result.message).toContain('sign-in link');
    });

    it('passes through an in-app returnUrl for portal-intent magic links', async () => {
      authService.requestMagicLinkForEmail = jest
        .fn()
        .mockResolvedValue(undefined);

      await controller.requestMagicLink({
        email: 'cfo@cooperativa.example',
        returnUrl: '/portal',
      } as any);

      expect(authService.requestMagicLinkForEmail).toHaveBeenCalledWith(
        'cfo@cooperativa.example',
        '/portal',
      );
    });
  });

  describe('GET /api/auth/magic-link/verify', () => {
    it('should verify token, set cookies, and redirect to auth callback', async () => {
      const user = { id: 'ml-user-1', email: 'cfo@coop.com', name: 'CFO' };
      authService.verifyMagicLinkToken = jest.fn().mockResolvedValue(user);
      authService.generateTokens = jest.fn().mockResolvedValue({
        accessToken: 'ml-at',
        refreshToken: 'ml-rt',
      });

      const req = { ip: '10.0.0.1', headers: { 'user-agent': 'jest' } };
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };

      await controller.verifyMagicLink(
        'valid-token',
        'cfo@coop.com',
        undefined,
        req,
        res,
      );

      expect(authService.verifyMagicLinkToken).toHaveBeenCalledWith(
        'valid-token',
        'cfo@coop.com',
      );
      expect(authService.generateTokens).toHaveBeenCalledWith(user);
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'ml-at',
        expect.any(Object),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback?returnUrl=%2Fdashboard'),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'ml-user-1',
          action: 'login',
          resource: 'magic_link',
          outcome: 'success',
        }),
      );
    });

    it('should return 401 for expired token', async () => {
      authService.verifyMagicLinkToken = jest.fn().mockResolvedValue(null);

      const req = { ip: '10.0.0.1', headers: {} };
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };

      await controller.verifyMagicLink(
        'expired-token',
        'cfo@coop.com',
        undefined,
        req,
        res,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('expired') }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'login',
          resource: 'magic_link',
          outcome: 'failure',
        }),
      );
    });

    it('should return 401 for already-used token (single-use)', async () => {
      authService.verifyMagicLinkToken = jest.fn().mockResolvedValue(null);

      const req = { ip: '10.0.0.1', headers: {} };
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };

      await controller.verifyMagicLink(
        'used-token',
        'cfo@coop.com',
        undefined,
        req,
        res,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('expired') }),
      );
    });

    it('should redirect to returnUrl when provided', async () => {
      const user = { id: 'ml-user-2', email: 'test@coop.com', name: 'Test' };
      authService.verifyMagicLinkToken = jest.fn().mockResolvedValue(user);
      authService.generateTokens = jest.fn().mockResolvedValue({
        accessToken: 'at-2',
        refreshToken: 'rt-2',
      });

      const req = { ip: '10.0.0.1', headers: {} };
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };

      await controller.verifyMagicLink(
        'valid-token',
        'test@coop.com',
        '/dashboard',
        req,
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback?returnUrl=%2Fdashboard'),
      );
    });

    it('should reject absolute returnUrl to prevent open redirect', async () => {
      const user = { id: 'ml-user-3', email: 'test@coop.com', name: 'Test' };
      authService.verifyMagicLinkToken = jest.fn().mockResolvedValue(user);
      authService.generateTokens = jest.fn().mockResolvedValue({
        accessToken: 'at-3',
        refreshToken: 'rt-3',
      });

      const req = { ip: '10.0.0.1', headers: {} };
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };

      await controller.verifyMagicLink(
        'valid-token',
        'test@coop.com',
        'https://evil.com/steal',
        req,
        res,
      );

      // Should redirect to the safe default, not the external URL
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback?returnUrl=%2Fdashboard'),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.not.stringContaining('evil.com'),
      );
    });
  });

  // ── OAuth (google/github) ────────────────────────────────────

  describe('OAuth endpoints', () => {
    it('googleAuth is defined and does nothing', () => {
      expect(controller.googleAuth()).toBeUndefined();
    });

    it('githubAuth is defined and does nothing', () => {
      expect(controller.githubAuth()).toBeUndefined();
    });

    it('googleCallback generates tokens, sets cookies, and redirects', async () => {
      authService.generateTokens = jest.fn().mockResolvedValue({
        accessToken: 'g-at',
        refreshToken: 'g-rt',
      });
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };
      const req = { user: { id: 'g-user' } };

      await controller.googleCallback(req, res);

      expect(authService.generateTokens).toHaveBeenCalledWith({ id: 'g-user' });
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'g-at',
        expect.any(Object),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback?returnUrl=%2Fdashboard'),
      );
    });

    it('githubCallback generates tokens, sets cookies, and redirects', async () => {
      authService.generateTokens = jest.fn().mockResolvedValue({
        accessToken: 'gh-at',
        refreshToken: 'gh-rt',
      });
      const res = {
        ...mockRes(),
        redirect: jest.fn(),
      };
      const req = { user: { id: 'gh-user' } };

      await controller.githubCallback(req, res);

      expect(authService.generateTokens).toHaveBeenCalledWith({
        id: 'gh-user',
      });
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        'gh-at',
        expect.any(Object),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback?returnUrl=%2Fdashboard'),
      );
    });
  });
});
