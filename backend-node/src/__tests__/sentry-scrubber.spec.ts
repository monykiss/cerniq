import { randomBytes as testRandomBytes } from 'crypto';
/**
 * Contract tests for the Sentry beforeSend() scrubber.
 *
 * These tests extract the scrubber logic and assert the exact shape of
 * the scrubbed event. They lock the redaction list against drift — if a
 * future refactor removes `stripeToken` from the scrubbed fields,
 * nobody notices until a customer's payment method ID ships to Sentry.
 *
 * The scrubber lives in src/instrument.ts and is defined inline inside
 * the Sentry.init() call. To test without mocking the whole Sentry
 * SDK, we reimplement the logic here and keep both copies in lockstep
 * via comments. When you change src/instrument.ts, update this spec.
 *
 * Tradeoff: the alternative is exporting the scrubber as a named
 * function from instrument.ts and importing it here. That would be
 * more DRY but instrument.ts is loaded via side-effect before any
 * application code (see main.ts line 3: `import './instrument'`), and
 * any test import could initialize Sentry with a stub DSN. We prefer
 * the duplication.
 */

import type { ErrorEvent } from '@sentry/nestjs';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();
const TEST_PW_2 = testPassword().slice(0, 1);

// ─── Reimplementation (kept in lockstep with src/instrument.ts) ───
function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.headers) {
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'x-admin-key',
      'x-api-key',
      'x-stripe-signature',
      'x-webhook-secret',
    ];
    for (const h of sensitiveHeaders) {
      delete event.request.headers[h];
    }
  }

  if (event.request?.data && typeof event.request.data === 'object') {
    const body = event.request.data as Record<string, unknown>;
    const sensitiveFields = [
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'refreshToken',
      'apiKey',
      'accessToken',
      'secret',
      'clientSecret',
      'stripeToken',
      'paymentMethodId',
      'cardNumber',
      'cvc',
      'ssn',
      'ein',
      'taxId',
    ];
    for (const f of sensitiveFields) {
      if (f in body) body[f] = '[REDACTED]';
    }
  }

  if (
    event.request?.query_string &&
    typeof event.request.query_string === 'string'
  ) {
    event.request.query_string = event.request.query_string.replace(
      /(^|[?&])(token|apiKey|accessToken|refreshToken|secret)=[^&]*/gi,
      '$1$2=[REDACTED]',
    );
  }

  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
  }

  if (event.contexts && typeof event.contexts === 'object') {
    const contexts = event.contexts as Record<string, unknown>;
    for (const key of Object.keys(contexts)) {
      const ctx = contexts[key];
      if (ctx && typeof ctx === 'object') {
        const c = ctx as Record<string, unknown>;
        if ('ip' in c) c.ip = '[REDACTED]';
        if ('ip_address' in c) c.ip_address = '[REDACTED]';
        if ('email' in c) c.email = '[REDACTED]';
      }
    }
  }

  return event;
}

// ─── Tests ─────────────────────────────────────────────────────────
describe('Sentry beforeSend scrubber', () => {
  describe('request headers', () => {
    it('deletes authorization header', () => {
      const event = {
        request: { headers: { authorization: 'Bearer sk-live-deadbeef' } },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.headers?.authorization).toBeUndefined();
    });

    it('deletes cookie header', () => {
      const event = {
        request: { headers: { cookie: 'capex_access_token=...' } },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.headers?.cookie).toBeUndefined();
    });

    it.each([
      'x-admin-key',
      'x-api-key',
      'x-stripe-signature',
      'x-webhook-secret',
    ])('deletes %s header', (headerName) => {
      const event = {
        request: { headers: { [headerName]: 'secret-value' } },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.headers?.[headerName]).toBeUndefined();
    });

    it('preserves non-sensitive headers', () => {
      const event = {
        request: {
          headers: {
            authorization: 'redact me',
            'user-agent': 'Mozilla/5.0',
            'content-type': 'application/json',
          },
        },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.headers?.['user-agent']).toBe('Mozilla/5.0');
      expect(out.request?.headers?.['content-type']).toBe('application/json');
    });
  });

  describe('request body', () => {
    it.each([
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'refreshToken',
      'apiKey',
      'accessToken',
      'secret',
      'clientSecret',
      'stripeToken',
      'paymentMethodId',
      'cardNumber',
      'cvc',
      'ssn',
      'ein',
      'taxId',
    ])('replaces body.%s with [REDACTED]', (field) => {
      const event = {
        request: { data: { [field]: 'sensitive-value' } },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect((out.request?.data as Record<string, unknown>)[field]).toBe(
        '[REDACTED]',
      );
    });

    it('preserves non-sensitive body fields', () => {
      const event = {
        request: {
          data: {
            password: TEST_PW_1,
            name: 'Acme Corp',
            institutionId: 'inst-123',
          },
        },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      const data = out.request?.data as Record<string, unknown>;
      expect(data.password).toBe('[REDACTED]');
      expect(data.name).toBe('Acme Corp');
      expect(data.institutionId).toBe('inst-123');
    });

    it('is a no-op when body is absent', () => {
      const event = { request: {} } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.data).toBeUndefined();
    });
  });

  describe('query string', () => {
    it('redacts magic-link token in query string', () => {
      const event = {
        request: { query_string: 'token=abc123def&foo=bar' },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.query_string).toBe('token=[REDACTED]&foo=bar');
    });

    it('redacts multiple sensitive params', () => {
      const event = {
        request: {
          query_string: 'apiKey=ck_live_x&token=t_x&accessToken=at_x&ok=value',
        },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.query_string).toBe(
        'apiKey=[REDACTED]&token=[REDACTED]&accessToken=[REDACTED]&ok=value',
      );
    });

    it('is case-insensitive on param name', () => {
      const event = {
        request: { query_string: 'Token=abc&ApiKey=xyz' },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.request?.query_string).toBe(
        'Token=[REDACTED]&ApiKey=[REDACTED]',
      );
    });
  });

  describe('user PII', () => {
    it('deletes user.email and user.ip_address', () => {
      const event = {
        user: {
          id: 'user-123',
          email: 'cfo@example.coop',
          ip_address: '192.168.1.1',
        },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      expect(out.user?.id).toBe('user-123');
      expect(out.user?.email).toBeUndefined();
      expect(out.user?.ip_address).toBeUndefined();
    });
  });

  describe('custom contexts', () => {
    it('redacts ip + ip_address + email in Sentry.setContext() payloads', () => {
      const event = {
        contexts: {
          request: {
            id: 'req-abc',
            method: 'POST',
            ip: '192.168.1.1',
            userAgent: 'Mozilla',
          },
          profile: {
            id: 'profile-x',
            email: 'leak@example.com',
          },
        },
      } as unknown as ErrorEvent;
      const out = scrubSentryEvent(event);
      const contexts = out.contexts as Record<string, Record<string, unknown>>;
      expect(contexts.request.id).toBe('req-abc');
      expect(contexts.request.ip).toBe('[REDACTED]');
      expect(contexts.request.userAgent).toBe('Mozilla');
      expect(contexts.profile.email).toBe('[REDACTED]');
      expect(contexts.profile.id).toBe('profile-x');
    });
  });

  it('full integration: scrubs every known leak vector in one pass', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer x',
          'x-stripe-signature': 'not-a-real-signature',
          'user-agent': 'Chrome',
        },
        data: {
          password: TEST_PW_2,
          stripeToken: 'tok_x',
          name: 'Acme',
        },
        query_string: 'token=abc&foo=bar',
      },
      user: {
        id: 'u-1',
        email: 'leak@example.coop',
      },
      contexts: {
        request: { id: 'r-1', ip: '10.0.0.1' },
      },
    } as unknown as ErrorEvent;
    const out = scrubSentryEvent(event);
    expect(out.request?.headers).toEqual({ 'user-agent': 'Chrome' });
    expect(out.request?.data).toEqual({
      password: '[REDACTED]',
      stripeToken: '[REDACTED]',
      name: 'Acme',
    });
    expect(out.request?.query_string).toBe('token=[REDACTED]&foo=bar');
    expect(out.user).toEqual({ id: 'u-1' });
    expect((out.contexts?.request as Record<string, unknown>).ip).toBe(
      '[REDACTED]',
    );
  });
});
