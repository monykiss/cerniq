/**
 * Supabase JWT verification — JWKS (preferred) → HS256 secret → HTTP /auth/v1/user.
 *
 * Pure helpers so AuthGuard and WebSocket gateways share one path.
 * Uses `jsonwebtoken` + Node `crypto` only (no ESM jose / jwks-rsa).
 */
import { createPublicKey } from 'crypto';
import * as jwt from 'jsonwebtoken';

export type SupabaseVerifyResult = {
  userId: string;
  email?: string;
  role: string;
  claims: Record<string, unknown>;
  orgId: string | null;
  method: 'jwks' | 'hs256' | 'http_user';
};

export type SupabaseVerifyEnv = {
  supabaseUrl?: string;
  anonKey?: string;
  jwksUrl?: string;
  jwtSecret?: string;
  issuer?: string;
  audience?: string | string[];
};

type FetchLike = typeof fetch;

type Jwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
};

type JwksCacheEntry = { keys: Jwk[]; fetchedAt: number };

const jwksCache = new Map<string, JwksCacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000;

function trim(value: string | undefined): string {
  return (value || '').trim();
}

export function readSupabaseVerifyEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseVerifyEnv {
  return {
    supabaseUrl: trim(env.SUPABASE_URL).replace(/\/$/, '') || undefined,
    anonKey:
      trim(env.SUPABASE_ANON_KEY) ||
      trim(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
      undefined,
    jwksUrl: trim(env.SUPABASE_JWKS_URL) || undefined,
    jwtSecret: trim(env.SUPABASE_JWT_SECRET) || undefined,
    issuer: trim(env.SUPABASE_JWT_ISSUER) || undefined,
    audience: trim(env.SUPABASE_JWT_AUDIENCE) || undefined,
  };
}

function defaultJwksUrl(supabaseUrl: string | undefined): string | undefined {
  if (!supabaseUrl) return undefined;
  return `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
}

/** Test hook — clears JWKS cache between specs. */
export function resetSupabaseJwksCache(): void {
  jwksCache.clear();
}

function roleFromClaims(claims: Record<string, unknown>): string {
  if (typeof claims.role === 'string') return claims.role;
  if (Array.isArray(claims.roles) && typeof claims.roles[0] === 'string') {
    return claims.roles[0];
  }
  return 'authenticated';
}

function orgFromClaims(claims: Record<string, unknown>): string | null {
  if (typeof claims.org_id === 'string') return claims.org_id;
  if (typeof claims.tenant_id === 'string') return claims.tenant_id;
  return null;
}

function resultFromClaims(
  claims: jwt.JwtPayload,
  method: SupabaseVerifyResult['method'],
): SupabaseVerifyResult | null {
  const userId = typeof claims.sub === 'string' ? claims.sub : null;
  if (!userId) return null;
  const record = { ...claims } as Record<string, unknown>;
  return {
    userId,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    role: roleFromClaims(record),
    claims: record,
    orgId: orgFromClaims(record),
    method,
  };
}

function verifyOpts(env: SupabaseVerifyEnv): jwt.VerifyOptions {
  const opts: jwt.VerifyOptions = {};
  if (env.issuer) opts.issuer = env.issuer;
  // jsonwebtoken's VerifyOptions.audience wants a string or a NON-EMPTY tuple,
  // not a plain string[]. Config only ever yields a single string today, but
  // support the array form honestly: skip an empty array (verifying against
  // "no audience" would silently disable the check) and narrow a populated one.
  const aud = env.audience;
  if (aud) {
    if (Array.isArray(aud)) {
      // type-rationale: length-checked above, so the tuple assertion is sound
      if (aud.length > 0) opts.audience = aud as [string, ...string[]];
    } else {
      opts.audience = aud;
    }
  }
  return opts;
}

async function loadJwks(jwksUrl: string, fetchImpl: FetchLike): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const response = await fetchImpl(jwksUrl);
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(jwksUrl, { keys, fetchedAt: Date.now() });
  return keys;
}

async function verifyWithJwks(
  token: string,
  jwksUrl: string,
  env: SupabaseVerifyEnv,
  fetchImpl: FetchLike,
): Promise<SupabaseVerifyResult | null> {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      return null;
    }
    const keys = await loadJwks(jwksUrl, fetchImpl);
    const jwk = keys.find((k) => k.kid === decoded.header.kid);
    if (!jwk) return null;
    const keyObject = createPublicKey({ key: jwk, format: 'jwk' });
    const claims = jwt.verify(token, keyObject, verifyOpts(env));
    if (!claims || typeof claims === 'string') return null;
    return resultFromClaims(claims, 'jwks');
  } catch {
    return null;
  }
}

function verifyWithHs256(
  token: string,
  env: SupabaseVerifyEnv,
): SupabaseVerifyResult | null {
  if (!env.jwtSecret) return null;
  try {
    const claims = jwt.verify(token, env.jwtSecret, verifyOpts(env));
    if (!claims || typeof claims === 'string') return null;
    return resultFromClaims(claims, 'hs256');
  } catch {
    return null;
  }
}

async function verifyViaHttpUser(
  token: string,
  env: SupabaseVerifyEnv,
  fetchImpl: FetchLike,
): Promise<SupabaseVerifyResult | null> {
  if (!env.supabaseUrl || !env.anonKey) return null;
  try {
    const response = await fetchImpl(`${env.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { id?: string; email?: string };
    if (!user?.id) return null;
    const decoded = jwt.decode(token);
    const claims =
      decoded && typeof decoded === 'object'
        ? ({ ...decoded } as Record<string, unknown>)
        : {};
    return {
      userId: user.id,
      email:
        user.email ||
        (typeof claims.email === 'string' ? claims.email : undefined),
      role: roleFromClaims(claims),
      claims,
      orgId: orgFromClaims(claims),
      method: 'http_user',
    };
  } catch {
    return null;
  }
}

/**
 * Verify a Supabase access token.
 * Order: JWKS → HS256 secret → HTTP /auth/v1/user.
 */
export async function verifySupabaseAccessToken(
  token: string,
  env: SupabaseVerifyEnv = readSupabaseVerifyEnv(),
  fetchImpl: FetchLike = fetch,
): Promise<SupabaseVerifyResult | null> {
  if (!token || typeof token !== 'string') return null;

  const jwksUrl = env.jwksUrl || defaultJwksUrl(env.supabaseUrl);
  if (jwksUrl) {
    const viaJwks = await verifyWithJwks(token, jwksUrl, env, fetchImpl);
    if (viaJwks) return viaJwks;
  }

  const viaHs = verifyWithHs256(token, env);
  if (viaHs) return viaHs;

  return verifyViaHttpUser(token, env, fetchImpl);
}
