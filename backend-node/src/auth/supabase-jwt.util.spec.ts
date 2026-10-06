import * as jwt from 'jsonwebtoken';
import {
  resetSupabaseJwksCache,
  verifySupabaseAccessToken,
  type SupabaseVerifyEnv,
} from './supabase-jwt.util';

describe('supabase-jwt.util', () => {
  beforeEach(() => {
    resetSupabaseJwksCache();
  });

  it('verifies HS256 tokens with SUPABASE_JWT_SECRET', async () => {
    const secret = 'test-supabase-jwt-secret-at-least-32-chars!!';
    const token = jwt.sign(
      {
        email: 'cfo@example.coop',
        role: 'authenticated',
        org_id: 'org-1',
      },
      secret,
      {
        subject: 'user-supabase-1',
        issuer: 'https://example.supabase.co/auth/v1',
        audience: 'authenticated',
        expiresIn: '1h',
      },
    );

    const env: SupabaseVerifyEnv = {
      jwtSecret: secret,
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
    };
    const result = await verifySupabaseAccessToken(token, env, async () => {
      throw new Error('HTTP fallback should not run');
    });
    expect(result?.method).toBe('hs256');
    expect(result?.userId).toBe('user-supabase-1');
    expect(result?.email).toBe('cfo@example.coop');
    expect(result?.orgId).toBe('org-1');
  });

  it('accepts an array audience: a token audience matching any entry verifies', async () => {
    const secret = 'test-supabase-jwt-secret-at-least-32-chars!!';
    const token = jwt.sign({ role: 'authenticated' }, secret, {
      subject: 'user-arr-aud',
      audience: 'authenticated',
      expiresIn: '1h',
    });
    const env: SupabaseVerifyEnv = {
      jwtSecret: secret,
      audience: ['authenticated', 'service_role'],
    };
    const result = await verifySupabaseAccessToken(token, env, async () => {
      throw new Error('HTTP fallback should not run');
    });
    expect(result?.method).toBe('hs256');
    expect(result?.userId).toBe('user-arr-aud');
  });

  it('an EMPTY audience array does not silently disable the audience check (security)', async () => {
    const secret = 'test-supabase-jwt-secret-at-least-32-chars!!';
    // Token carries an audience; an empty [] audience config must be treated
    // as "no audience constraint applied" — the local verify still succeeds
    // on the token's own claims rather than throwing on an empty tuple. The
    // guard's job is to never let [] become a matching-audience assertion.
    const token = jwt.sign({ role: 'authenticated' }, secret, {
      subject: 'user-empty-aud',
      audience: 'authenticated',
      expiresIn: '1h',
    });
    const env: SupabaseVerifyEnv = { jwtSecret: secret, audience: [] };
    const result = await verifySupabaseAccessToken(token, env, async () => {
      throw new Error('HTTP fallback should not run');
    });
    expect(result?.userId).toBe('user-empty-aud');
  });

  it('falls back to HTTP /auth/v1/user when local verify unavailable', async () => {
    const token = jwt.sign(
      { email: 'a@b.co', role: 'authenticated' },
      'unused-secret-for-unsigned-path',
      { subject: 'http-user', expiresIn: '1h' },
    );

    const env: SupabaseVerifyEnv = {
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
    };
    const result = await verifySupabaseAccessToken(
      token,
      env,
      async () =>
        ({
          ok: true,
          json: async () => ({ id: 'http-user', email: 'a@b.co' }),
        }) as Response,
    );
    expect(result?.method).toBe('http_user');
    expect(result?.userId).toBe('http-user');
  });

  it('returns null when no verification path succeeds', async () => {
    const result = await verifySupabaseAccessToken(
      'not.a.jwt',
      {},
      async () => ({ ok: false }) as Response,
    );
    expect(result).toBeNull();
  });
});
