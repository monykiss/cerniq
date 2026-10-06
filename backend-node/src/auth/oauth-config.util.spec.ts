import {
  getGoogleOAuthWarnings,
  resolveGithubCallbackUrl,
  resolveGoogleCallbackUrl,
} from './oauth-config.util';

describe('oauth-config.util', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.BACKEND_URL;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('resolveGoogleCallbackUrl', () => {
    it('uses the configured Google callback URL', () => {
      process.env.GOOGLE_CALLBACK_URL = 'https://custom.example.com/callback/';

      expect(resolveGoogleCallbackUrl()).toBe(
        'https://custom.example.com/callback',
      );
    });

    it('derives the callback from BACKEND_URL when not configured', () => {
      delete process.env.GOOGLE_CALLBACK_URL;
      process.env.BACKEND_URL = 'https://api.example.com/';

      expect(resolveGoogleCallbackUrl()).toBe(
        'https://api.example.com/api/auth/google/callback',
      );
    });

    it('falls back to the local API origin when nothing is configured', () => {
      delete process.env.GOOGLE_CALLBACK_URL;

      expect(resolveGoogleCallbackUrl()).toBe(
        'http://localhost:3000/api/auth/google/callback',
      );
    });
  });

  describe('resolveGithubCallbackUrl', () => {
    it('derives the callback from BACKEND_URL when not configured', () => {
      delete process.env.GITHUB_CALLBACK_URL;
      process.env.BACKEND_URL = 'https://api.example.com';

      expect(resolveGithubCallbackUrl()).toBe(
        'https://api.example.com/api/auth/github/callback',
      );
    });
  });

  describe('getGoogleOAuthWarnings', () => {
    it('returns no warnings outside production', () => {
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_CLIENT_ID = 'client-id';

      expect(getGoogleOAuthWarnings()).toEqual([]);
    });

    it('returns no warnings when Google OAuth is entirely disabled', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CALLBACK_URL;
      delete process.env.FRONTEND_URL;

      expect(getGoogleOAuthWarnings()).toEqual([]);
    });

    it('warns when production Google OAuth is partially configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.GOOGLE_CLIENT_ID = 'client-id';
      process.env.GOOGLE_CALLBACK_URL =
        'http://api.example.com/api/auth/google/callback';
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.FRONTEND_URL;

      expect(getGoogleOAuthWarnings()).toEqual(
        expect.arrayContaining([
          'GOOGLE_CLIENT_SECRET not set — Google OAuth callback exchange will fail in production.',
          'GOOGLE_CALLBACK_URL is "http://api.example.com/api/auth/google/callback" — production callbacks must use https.',
          'FRONTEND_URL not set — post-login redirects cannot target the web app.',
        ]),
      );
    });
  });
});
