// OpenTelemetry must initialize before other imports
import './telemetry';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // Scrub sensitive data from error reports. Any token/PII that
      // reaches Sentry is a compliance incident — Sentry is a 3rd-party
      // service and events ship to their ingest unencrypted at the app
      // layer (TLS at wire, not field-level). Mirror the Pino redact
      // list in src/app.module.ts so there's only one policy to audit
      // when the auth surface grows.

      // Headers
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

      // Request body (Sentry typed event calls it `data`)
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

      // Query string (magic-link tokens, one-time codes in URLs).
      // `(^|[?&])` matches either the start-of-string OR an existing
      // separator — without the `^|` alternation, the FIRST param
      // would slip through unredacted (query strings don't start with
      // a separator).
      if (
        event.request?.query_string &&
        typeof event.request.query_string === 'string'
      ) {
        event.request.query_string = event.request.query_string.replace(
          /(^|[?&])(token|apiKey|accessToken|refreshToken|secret)=[^&]*/gi,
          '$1$2=[REDACTED]',
        );
      }

      // User PII — keep id for correlation, drop email + ip unless
      // the customer has explicitly consented. Sentry's default user
      // context populates from Express req.user; we scrub on egress.
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }

      // Custom contexts (set via Sentry.setContext). The
      // CorrelationInterceptor (common/interceptors/correlation.interceptor.ts)
      // stashes `req.ip` in a 'request' context for debuggability —
      // strip it on egress since we drop the user's ip_address above.
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
    },
  });
}
