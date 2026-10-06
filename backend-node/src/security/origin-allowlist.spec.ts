import { isAllowedOrigin, corsOriginCallback } from './origin-allowlist';

describe('origin-allowlist', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isAllowedOrigin', () => {
    it('allows undefined/null origin (same-origin or server-to-server)', () => {
      expect(isAllowedOrigin(undefined)).toBe(true);
      expect(isAllowedOrigin(null)).toBe(true);
    });

    it('allows the configured FRONTEND_URL origin', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      expect(isAllowedOrigin('https://app.example.com')).toBe(true);
    });

    it('does not allow sibling subdomains that are not configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_URL = 'https://app.example.com';
      expect(isAllowedOrigin('https://staging.example.com')).toBe(false);
    });

    it('allows no cross-origin callers in production when nothing is configured', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FRONTEND_URL;
      delete process.env.ALLOWED_ORIGINS;
      delete process.env.CORS_ORIGIN;
      expect(isAllowedOrigin('https://app.example.com')).toBe(false);
    });

    it('allows localhost in non-production', () => {
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
      expect(isAllowedOrigin('http://localhost:3001')).toBe(true);
    });

    it('rejects random external origins', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://evil.com')).toBe(false);
      expect(isAllowedOrigin('https://not-example.com')).toBe(false);
    });

    it('rejects invalid URL formats', () => {
      expect(isAllowedOrigin('not-a-url')).toBe(false);
      expect(isAllowedOrigin('ftp://app.example.com')).toBe(false);
    });

    it('allows origins from FRONTEND_URL env var', () => {
      process.env.FRONTEND_URL = 'https://custom-frontend.example.com';
      expect(isAllowedOrigin('https://custom-frontend.example.com')).toBe(true);
    });

    it('allows origins from ALLOWED_ORIGINS csv', () => {
      process.env.ALLOWED_ORIGINS =
        'https://partner1.com, https://partner2.com';
      expect(isAllowedOrigin('https://partner1.com')).toBe(true);
      expect(isAllowedOrigin('https://partner2.com')).toBe(true);
    });

    it('allows origins from CORS_ORIGIN csv', () => {
      process.env.CORS_ORIGIN = 'https://cors-allowed.com';
      expect(isAllowedOrigin('https://cors-allowed.com')).toBe(true);
    });

    it('allows preview origins when enabled and a pattern is configured', () => {
      process.env.ALLOW_PREVIEW_ORIGINS = 'true';
      process.env.VERCEL_PREVIEW_ORIGIN_REGEX =
        '^https://[a-z0-9-]+-example-team\\.vercel\\.app$';
      expect(isAllowedOrigin('https://my-app-example-team.vercel.app')).toBe(
        true,
      );
    });

    it('allows no preview origins when enabled without a configured pattern', () => {
      process.env.ALLOW_PREVIEW_ORIGINS = 'true';
      delete process.env.VERCEL_PREVIEW_ORIGIN_REGEX;
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://my-app-example-team.vercel.app')).toBe(
        false,
      );
    });

    it('allows no preview origins when the configured pattern is invalid', () => {
      process.env.ALLOW_PREVIEW_ORIGINS = 'true';
      process.env.VERCEL_PREVIEW_ORIGIN_REGEX = '([unclosed';
      process.env.NODE_ENV = 'production';
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(isAllowedOrigin('https://my-app-example-team.vercel.app')).toBe(
        false,
      );
    });

    it('rejects Vercel preview origins when not enabled', () => {
      process.env.ALLOW_PREVIEW_ORIGINS = '';
      process.env.NODE_ENV = 'production';
      // This should not match the preview regex when preview origins are disabled
      // and it's not in the static allowlist
      expect(isAllowedOrigin('https://random-example-team.vercel.app')).toBe(
        false,
      );
    });

    it('normalizes origins by stripping trailing slashes and paths', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      expect(isAllowedOrigin('https://app.example.com/')).toBe(true);
      expect(isAllowedOrigin('https://app.example.com/some/path')).toBe(true);
    });
  });

  describe('corsOriginCallback', () => {
    it('calls callback with null error and true for allowed origins', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      const callback = jest.fn();
      corsOriginCallback('https://app.example.com', callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('calls callback with Error for disallowed origins', () => {
      process.env.NODE_ENV = 'production';
      const callback = jest.fn();
      corsOriginCallback('https://evil.com', callback);
      expect(callback).toHaveBeenCalledWith(expect.any(Error), false);
    });

    it('includes origin in error message', () => {
      process.env.NODE_ENV = 'production';
      const callback = jest.fn();
      corsOriginCallback('https://blocked.com', callback);
      const error = callback.mock.calls[0][0] as Error;
      expect(error.message).toContain('blocked.com');
    });

    it('allows undefined origin (same-origin)', () => {
      const callback = jest.fn();
      corsOriginCallback(undefined, callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });
  });
});
