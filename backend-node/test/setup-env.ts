/**
 * E2E test environment setup.
 * Must run BEFORE any application modules are imported.
 *
 * Secrets are generated per run when not supplied by the environment, so no
 * fixed secret-shaped literal is committed.
 */
import { randomBytes } from 'crypto';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || randomBytes(32).toString('hex');
process.env.ADMIN_KEY =
  process.env.ADMIN_KEY || randomBytes(24).toString('hex');
process.env.NODE_ENV = 'test';
process.env.API_KEY_PEPPER =
  process.env.API_KEY_PEPPER || randomBytes(32).toString('hex');
// Suppress Sentry in tests
process.env.SENTRY_DSN = '';
// Suppress OpenTelemetry noise
process.env.OTEL_SDK_DISABLED = 'true';
