/**
 * Zod-based environment variable validation schema.
 *
 * Replaces the manual string checks in main.ts with a typed schema
 * that validates at startup. Every env var the app reads is declared
 * here with its type, constraints, and default values.
 *
 * Usage:
 *   import { validateEnv, type Env } from './config/env.schema';
 *   const env = validateEnv();
 */
import { z } from 'zod';

const envSchema = z
  .object({
    // ── Required (fatal if missing) ──────────────────────────────────
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // ── Node/NestJS ──────────────────────────────────────────────────
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z
      .string()
      .default('4000')
      .transform(Number)
      .pipe(z.number().int().min(1).max(65535)),

    // ── Auth ─────────────────────────────────────────────────────────
    ADMIN_KEY: z.string().optional(),
    SUPABASE_URL: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_JWT_SECRET: z.string().optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    SUPABASE_JWT_ISSUER: z.string().optional(),
    SUPABASE_JWT_AUDIENCE: z.string().optional(),
    AUTH_ALLOW_LEGACY: z.string().optional(),
    AUTH_LEGACY_DEPRECATION_WARN: z.string().optional(),
    // Phase 4 legacy sunset: when truthy, the Nest password mint
    // (register/login/refresh) stops issuing legacy HS256 tokens and returns
    // 410 Gone directing clients to Supabase session auth. Default unset =
    // current behavior. Flip to true only after Supabase login is live in prod.
    AUTH_DISABLE_LEGACY_MINT: z.string().optional(),
    KLYTICS_APP_ID: z.string().optional(),
    KLYTICS_REQUIRE_ORG: z.string().optional(),
    KLYTICS_REQUIRE_ENTITLEMENT: z.string().optional(),

    // ── OAuth ───────────────────────────────────────���────────────────
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GITHUB_REDIRECT_URI: z.string().optional(),
    // Consumed by oauth-config.util.ts; must be a well-formed URL.
    GOOGLE_CALLBACK_URL: z.string().url().optional(),
    GITHUB_CALLBACK_URL: z.string().url().optional(),
    // Cookie domain for cross-subdomain auth (e.g. `.cerniq.io`).
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    // Canonical frontend origin. Consumed by auth-cookie, oauth-config,
    // origin-allowlist, pipeline.worker, portal demo-seat, and the alert
    // notifier deep-link. A typo here (today) silently breaks magic
    // links and SameSite cookies — hence strict URL validation.
    FRONTEND_URL: z.string().url().optional(),

    // ── Billing ──────────────────────────────────────────────────────
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ONE_TIME: z.string().optional(),
    STRIPE_PRICE_MONTHLY: z.string().optional(),
    STRIPE_PRICE_ANNUAL: z.string().optional(),
    STRIPE_PRICE_PARTNER: z.string().optional(),

    // ── Email ────────────────────────────────────────────────────────
    RESEND_API_KEY: z.string().optional(),
    // Sender for transactional auth emails. No built-in default: when unset,
    // password-reset / magic-link emails are not sent.
    EMAIL_FROM: z.string().optional(),
    // Optional Reply-To for transactional auth emails.
    EMAIL_REPLY_TO: z.string().email().optional(),
    // Operator inbox for internal alerts and Reply-To on customer emails.
    // Internal alerts are skipped when unset.
    OPS_NOTIFY_EMAIL: z.string().email().optional(),

    // ── Security ─────────────────────────────────────────────────────
    DATA_ENCRYPTION_KEY: z.string().optional(),
    ALLOW_PREVIEW_ORIGINS: z.enum(['true', 'false', '1', '0']).optional(),
    VERCEL_PREVIEW_ORIGIN_REGEX: z.string().optional(),

    // ── Email ── (domain override for Resend sender addresses)
    EMAIL_FROM_DOMAIN: z.string().optional(),
    API_KEY_PEPPER: z
      .string()
      .min(32, 'API_KEY_PEPPER must be at least 32 characters')
      .optional(),
    ALLOWED_ORIGINS: z.string().optional(),

    // ── AI / LLM ─────────────────────────────────────────────────────
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // Forwarded verbatim to the Anthropic client for opt-in beta features.
    ANTHROPIC_BETA_HEADER: z.string().optional(),
    // Token-pricing calibration for the cost circuit breaker. Defaults
    // match the public Anthropic list price for claude-opus-4-6
    // ($15 input / $75 output per million tokens). Operators on a
    // negotiated enterprise rate should override both. The breaker is
    // conservative by default — it will trip earlier than necessary
    // for customers on discounted rates, which is the safe direction.
    LLM_INPUT_USD_PER_MILLION_TOKENS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().nonnegative().optional()),
    LLM_OUTPUT_USD_PER_MILLION_TOKENS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().nonnegative().optional()),

    // ── Agent runtime (Wave-03) ──────────────────────────────────────
    // Per-institution LLM worker concurrency. Defaults live in the queue
    // module; this just validates the override.
    AGENT_WORKER_CONCURRENCY: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(1).max(50).optional()),
    // Per-run output token cap. Values <1 would create silent no-ops.
    MAX_AGENT_TOKENS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(1).optional()),
    // Cost circuit breaker threshold in USD. `0` is legal ("alert on
    // anything") so we use nonnegative, not positive.
    LLM_COST_ALERT_THRESHOLD_USD: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().nonnegative().optional()),
    // Legacy/precise form of the cost cap, expressed in integer cents.
    // `AgentCostCircuitBreakerService` prefers this when set for exact
    // integer math; otherwise it falls back to LLM_COST_ALERT_THRESHOLD_USD
    // (from `.env.example`) multiplied by 100. Validation prevents the
    // silent-disable-on-typo path where `parseInt('abc',10)` returned NaN.
    LLM_COST_CAP_USD_CENTS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(1).optional()),
    // Retention window for agent_audit_logs and audit_logs. Default lives
    // in the service layer (2555 = 7 years, matches security claim page).
    AUDIT_LOG_RETENTION_DAYS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().positive().optional()),
    // SSE keepalive interval. Lower bound is 100ms to avoid accidental
    // busy-loop heartbeats.
    SSE_HEARTBEAT_INTERVAL_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(100).optional()),
    // Kill switch for the scheduler (maps to AgentSchedulerService
    // truthy check). Accepts only the canonical truthy/falsy strings.
    AGENT_SCHEDULER_DISABLED: z.enum(['true', 'false', '1', '0']).optional(),
    // Wall-clock deadline per agent run. Enforced by AgentRunnerService
    // via a run-scoped AbortController. Default 300_000ms (5 min) matches
    // the Vercel Fluid Compute default.
    AGENT_RUN_TIMEOUT_MS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(1000).optional()),

    // ── PR macro overlay (Wave 1, W1.2) ──────────────────────────────
    // FRED API key — consumed by treasury-rates.service.ts (yield curve)
    // and pr-macro-feed.service.ts (PRURN unemployment refresh). Was read
    // by treasury-rates since before the round-trip rule; declared here to
    // close that latent gap (every process.env read gets a schema entry).
    FRED_API_KEY: z.string().optional(),
    // Ops kill switch for the data-derived CECL PR overlay. 'derived'
    // (default when unset) uses MacroOverlayService.deriveCurrentOverlay;
    // 'hardcoded' falls back to the legacy inline constants. Interpreted
    // by a single helper: src/alm/macro-overlay-config.util.ts.
    CECL_MACRO_OVERLAY_MODE: z.enum(['derived', 'hardcoded']).optional(),
    // Days after the committed macro snapshot's compiledAsOf before the
    // feed emits a STALE_SNAPSHOT WARNING gap. Default 120 (quarterly
    // refresh cadence + slack) via resolveMacroStalenessDays().
    PR_MACRO_STALENESS_DAYS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(1).max(730).optional()),
    // Kill switch for the daily EWS snapshot cron (W1.3). Separate from
    // AGENT_SCHEDULER_DISABLED — different blast radius. Interpreted by
    // src/alm/ews/ews-scheduler-flag.util.ts only.
    EWS_SCHEDULER_DISABLED: z.enum(['true', 'false', '1', '0']).optional(),

    // ── Cache ────────────────────────────────────────────────────────
    // Default TTL for AI response cache entries. `parseInt` on bad input
    // previously yielded NaN, which ioredis interprets as "no TTL" —
    // silently leaking cache keys forever.
    CACHE_AI_TTL_SECONDS: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(1).optional()),

    // ── Storage ──────────────────────────────────────────────────────
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_S3_REGION: z.string().optional(),
    AWS_S3_ENDPOINT: z.string().optional(),
    // Migration-compat alias — StorageService reads AWS_S3_REGION
    // first, falls back to AWS_REGION. Kept in the schema so legacy
    // deploys that set the generic AWS_REGION don't fail validation.
    AWS_REGION: z.string().optional(),
    // Presigned-URL replay window in seconds. Range [60, 604800] per
    // S3 constraints; default 300 in code. Prevents the
    // parseInt(NaN) → SDK-default-900s silent widening.
    S3_PRESIGNED_URL_EXPIRY: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().min(60).max(604800).optional()),

    // ── Cache ────────────────────────────────────────────────────────
    REDIS_URL: z.string().optional(),

    // ── Observability ────────────────────────────────────────────────
    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .optional(),

    // ���─ Deploy context ───────────────────────────────────────────────
    RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
    RAILWAY_ENVIRONMENT: z.string().optional(),

    // ── Rate limiting ────────────────────────────────────────────────
    THROTTLE_TTL: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().positive().optional()),
    THROTTLE_LIMIT: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().positive().optional()),
  })
  .superRefine((env, ctx) => {
    // Production boot-guard: the agent runtime is the headline product,
    // so missing ANTHROPIC_API_KEY in production is never a soft-warn.
    // Before this refinement the LlmBridgeService accepted an empty
    // string and failed on first tool-use with an opaque auth error at
    // runtime. Fail fast at the boundary instead.
    // Production boot-guard for secrets that protect data at rest and API
    // keys. Missing values are a startup failure, never a silent downgrade
    // (no plaintext fallback, no default pepper).
    if (env.NODE_ENV === 'production') {
      if (
        !env.DATA_ENCRYPTION_KEY ||
        !/^[0-9a-f]{64}$/i.test(env.DATA_ENCRYPTION_KEY)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATA_ENCRYPTION_KEY'],
          message:
            'DATA_ENCRYPTION_KEY (64 hex chars / 32 bytes) is required in production',
        });
      }
      if (!env.API_KEY_PEPPER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_KEY_PEPPER'],
          message: 'API_KEY_PEPPER is required in production',
        });
      }
    }
    if (env.NODE_ENV === 'production' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message:
          'ANTHROPIC_API_KEY is required in production — the agent runtime will not function without it',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validate and return typed environment variables.
 * Throws a formatted error listing all validation failures.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `  ${i.path.join('.')}: ${i.message}`,
    );
    const msg = [
      '',
      '╔══════════════════════════════���═══════════════╗',
      '║  CERNIQ — Environment Validation Failed      ║',
      '╚══════════════════════════════════════════════╝',
      '',
      ...issues,
      '',
      'Fix the above environment variables and restart.',
      '',
    ].join('\n');

    console.error(msg);
    process.exit(1);
  }

  return result.data;
}
