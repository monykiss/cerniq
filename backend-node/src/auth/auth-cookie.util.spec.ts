/**
 * Tests for auth-cookie.util.ts
 *
 * Because the module captures `isProduction` at the top level via
 * `const isProduction = process.env.NODE_ENV === 'production'`, we must
 * reset the module registry and re-require the file whenever we need to
 * change NODE_ENV. Helper `loadModule()` handles this.
 */

interface CookieUtilModule {
  getAuthCookieOptions: () => {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    domain?: string;
  };
  resolveFrontendUrl: () => string;
  setAuthCookies: (
    res: { cookie: (...args: any[]) => void },
    accessToken: string,
    refreshToken: string,
  ) => void;
  clearAuthCookies: (res: { clearCookie: (...args: any[]) => void }) => void;
}

function loadModule(
  envOverrides: Record<string, string | undefined> = {},
): CookieUtilModule {
  // Apply env overrides before the module evaluates its top-level constants
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();

  return require('./auth-cookie.util');
}

describe('auth-cookie.util', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    // Clear all cookie-related env vars so each test starts clean
    delete process.env.AUTH_COOKIE_SAMESITE;
    delete process.env.AUTH_COOKIE_SECURE;
    delete process.env.AUTH_COOKIE_DOMAIN;
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_URL;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // ---------------------------------------------------------------------------
  // SameSite behaviour
  // ---------------------------------------------------------------------------

  describe('resolveCookieSameSite (via getAuthCookieOptions)', () => {
    it('defaults to lax in development', () => {
      const mod = loadModule({ NODE_ENV: 'development' });
      expect(mod.getAuthCookieOptions().sameSite).toBe('lax');
    });

    it('returns none in production when frontend and backend are on different hosts', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('none');
    });

    it('returns none in production when no BACKEND_URL is set (assumes cross-domain)', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: undefined,
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('none');
    });

    it('returns lax in production when frontend and backend share the same host', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://cerniq.io',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('lax');
    });

    it('honours explicit AUTH_COOKIE_SAMESITE=strict even in cross-domain production', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
        AUTH_COOKIE_SAMESITE: 'strict',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('strict');
    });

    it('honours explicit AUTH_COOKIE_SAMESITE=lax in cross-domain production', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
        AUTH_COOKIE_SAMESITE: 'lax',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('lax');
    });

    it('honours explicit AUTH_COOKIE_SAMESITE=none in development', () => {
      const mod = loadModule({
        NODE_ENV: 'development',
        AUTH_COOKIE_SAMESITE: 'none',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('none');
    });

    it('ignores unrecognised AUTH_COOKIE_SAMESITE values', () => {
      const mod = loadModule({
        NODE_ENV: 'development',
        AUTH_COOKIE_SAMESITE: 'bogus',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('lax');
    });
  });

  // ---------------------------------------------------------------------------
  // BUG-001 regression — config must NOT hardcode SameSite=lax
  // ---------------------------------------------------------------------------
  // The auto-detection in resolveCookieSameSite() is correct, but it is only
  // reachable when AUTH_COOKIE_SAMESITE is left UNSET. In production the deploy
  // configs (.env.production.template, docker-compose.prod.yml) used to set it
  // to `lax`, which short-circuited the auto-detection and made the browser drop
  // the auth cookie on every cerniq.io → api.example.com request (silent login
  // failure). These tests pin the runtime contract the config fix relies on:
  // env var UNSET + cross-domain production MUST yield SameSite=None + Secure.
  describe('BUG-001 regression: cross-domain prod with SAMESITE unset', () => {
    it('yields SameSite=none when the env var is unset (auto-detection reachable)', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
        AUTH_COOKIE_SAMESITE: undefined, // the config fix: leave it unset
      });
      const opts = mod.getAuthCookieOptions();
      expect(opts.sameSite).toBe('none');
      // Browsers reject SameSite=None without Secure — the cookie would be
      // silently dropped, so Secure MUST be forced on regardless of env.
      expect(opts.secure).toBe(true);
    });

    it('an empty-string env var does not count as "set" — still auto-detects none', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
        AUTH_COOKIE_SAMESITE: '', // Railway "unset" can surface as empty string
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('none');
    });

    it('reproduces BUG-001: an explicit lax DOES break cross-domain (kept only as opt-in override)', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
        AUTH_COOKIE_SAMESITE: 'lax', // the defect — now must be a deliberate choice, never a config default
      });
      // This is the broken state. We assert it explicitly so the override path
      // is documented and any future "default to lax" change is caught by the
      // unset-case tests above going red.
      expect(mod.getAuthCookieOptions().sameSite).toBe('lax');
    });
  });

  // ---------------------------------------------------------------------------
  // Secure flag
  // ---------------------------------------------------------------------------

  describe('secure flag', () => {
    it('is true when sameSite is none, even if AUTH_COOKIE_SECURE is false', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://api.example.com',
        AUTH_COOKIE_SECURE: 'false',
      });
      // sameSite should be none (cross-domain production)
      expect(mod.getAuthCookieOptions().sameSite).toBe('none');
      expect(mod.getAuthCookieOptions().secure).toBe(true);
    });

    it('is true when sameSite is none via explicit env var override', () => {
      const mod = loadModule({
        NODE_ENV: 'development',
        AUTH_COOKIE_SAMESITE: 'none',
        AUTH_COOKIE_SECURE: 'false',
      });
      expect(mod.getAuthCookieOptions().secure).toBe(true);
    });

    it('respects AUTH_COOKIE_SECURE in development when sameSite is lax', () => {
      const mod = loadModule({
        NODE_ENV: 'development',
        AUTH_COOKIE_SECURE: 'false',
      });
      expect(mod.getAuthCookieOptions().secure).toBe(false);
    });

    it('defaults to true in production when sameSite is lax', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://cerniq.io',
        BACKEND_URL: 'https://cerniq.io',
      });
      expect(mod.getAuthCookieOptions().sameSite).toBe('lax');
      expect(mod.getAuthCookieOptions().secure).toBe(true);
    });

    it('defaults to false in development when sameSite is lax', () => {
      const mod = loadModule({ NODE_ENV: 'development' });
      expect(mod.getAuthCookieOptions().secure).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveFrontendUrl
  // ---------------------------------------------------------------------------

  describe('resolveFrontendUrl', () => {
    it('uses FRONTEND_URL when set', () => {
      const mod = loadModule({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://staging.example.com/',
      });
      expect(mod.resolveFrontendUrl()).toBe('https://staging.example.com');
    });

    it('falls back to localhost:3001 in development', () => {
      const mod = loadModule({
        NODE_ENV: 'development',
        FRONTEND_URL: undefined,
      });
      expect(mod.resolveFrontendUrl()).toBe('http://localhost:3001');
    });

    it('falls back to https://cerniq.io in production', () => {
      const mod = loadModule({
        NODE_ENV: 'production',
        FRONTEND_URL: undefined,
      });
      expect(mod.resolveFrontendUrl()).toBe('https://cerniq.io');
    });
  });

  // ---------------------------------------------------------------------------
  // setAuthCookies / clearAuthCookies
  // ---------------------------------------------------------------------------

  describe('setAuthCookies', () => {
    it('sets access_token and refresh_token cookies', () => {
      const mod = loadModule({ NODE_ENV: 'development' });
      const cookies: Array<{ name: string; value: string; options: any }> = [];
      const res = {
        cookie: (name: string, value: string, options: any) => {
          cookies.push({ name, value, options });
        },
      };

      mod.setAuthCookies(res, 'at-123', 'rt-456');

      expect(cookies).toHaveLength(2);
      expect(cookies[0].name).toBe('access_token');
      expect(cookies[0].value).toBe('at-123');
      expect(cookies[0].options.maxAge).toBe(24 * 60 * 60 * 1000);
      expect(cookies[1].name).toBe('refresh_token');
      expect(cookies[1].value).toBe('rt-456');
      expect(cookies[1].options.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('clearAuthCookies', () => {
    it('clears both auth cookies', () => {
      const mod = loadModule({ NODE_ENV: 'development' });
      const cleared: string[] = [];
      const res = {
        clearCookie: (name: string) => {
          cleared.push(name);
        },
      };

      mod.clearAuthCookies(res);

      expect(cleared).toEqual(['access_token', 'refresh_token']);
    });
  });
});
