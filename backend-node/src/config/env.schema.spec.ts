import { randomBytes } from 'crypto';
import { validateEnv } from './env.schema';

describe('env.schema', () => {
  // Production-only secrets, generated per run.
  const PROD_SECRETS = {
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    API_KEY_PEPPER: randomBytes(32).toString('hex'),
    ANTHROPIC_API_KEY: randomBytes(16).toString('hex'),
  };

  const VALID_ENV = {
    JWT_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgresql://localhost:5432/test',
    NODE_ENV: 'test',
    PORT: '4000',
  };

  let originalEnv: NodeJS.ProcessEnv;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    originalEnv = { ...process.env };
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('accepts a valid minimal env', () => {
    Object.assign(process.env, VALID_ENV);
    const env = validateEnv();
    expect(env.JWT_SECRET).toBe(VALID_ENV.JWT_SECRET);
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.PORT).toBe(4000); // transformed to number
  });

  it('exits on missing JWT_SECRET', () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_SECRET: undefined });
    delete process.env.JWT_SECRET;
    expect(() => validateEnv()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when JWT_SECRET is too short', () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_SECRET: 'short' });
    expect(() => validateEnv()).toThrow('process.exit called');
  });

  it('exits on missing DATABASE_URL', () => {
    Object.assign(process.env, { ...VALID_ENV, DATABASE_URL: undefined });
    delete process.env.DATABASE_URL;
    expect(() => validateEnv()).toThrow('process.exit called');
  });

  it('defaults PORT to 4000 when not set', () => {
    const env2 = { ...VALID_ENV };
    delete (env2 as any).PORT;
    Object.assign(process.env, env2);
    delete process.env.PORT;
    const env = validateEnv();
    expect(env.PORT).toBe(4000);
  });

  it('defaults NODE_ENV to development when not set', () => {
    const env2 = { ...VALID_ENV };
    delete (env2 as any).NODE_ENV;
    Object.assign(process.env, env2);
    delete process.env.NODE_ENV;
    const env = validateEnv();
    expect(env.NODE_ENV).toBe('development');
  });

  it('allows all optional fields to be absent', () => {
    // Explicitly unset optional env vars that the CI runner may inject
    // (e.g. REDIS_URL from service containers) so the "absent" assertion
    // reflects the schema's behavior, not the environment that runs it.
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.REDIS_URL;
    Object.assign(process.env, VALID_ENV);
    const env = validateEnv();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('parses THROTTLE_TTL and THROTTLE_LIMIT as numbers', () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      THROTTLE_TTL: '60',
      THROTTLE_LIMIT: '100',
    });
    const env = validateEnv();
    expect(env.THROTTLE_TTL).toBe(60);
    expect(env.THROTTLE_LIMIT).toBe(100);
  });

  it('rejects invalid NODE_ENV value', () => {
    Object.assign(process.env, { ...VALID_ENV, NODE_ENV: 'staging' });
    expect(() => validateEnv()).toThrow('process.exit called');
  });

  // ── Wave-03 agent runtime vars ────────────────────────────────────
  // Each var maps to a concrete production dependency (scheduler kill-
  // switch, queue concurrency, token budget, cost circuit-breaker,
  // audit retention, SSE keepalive, Anthropic beta header).
  describe('agent runtime env vars', () => {
    it('parses AGENT_WORKER_CONCURRENCY as a bounded integer', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AGENT_WORKER_CONCURRENCY: '8',
      });
      const env = validateEnv();
      expect(env.AGENT_WORKER_CONCURRENCY).toBe(8);
    });

    it('rejects AGENT_WORKER_CONCURRENCY below 1', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AGENT_WORKER_CONCURRENCY: '0',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('rejects AGENT_WORKER_CONCURRENCY above 50', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AGENT_WORKER_CONCURRENCY: '51',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('parses MAX_AGENT_TOKENS as a positive integer', () => {
      Object.assign(process.env, { ...VALID_ENV, MAX_AGENT_TOKENS: '4096' });
      const env = validateEnv();
      expect(env.MAX_AGENT_TOKENS).toBe(4096);
    });

    it('accepts LLM_COST_ALERT_THRESHOLD_USD of 0 (alert on anything)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_COST_ALERT_THRESHOLD_USD: '0',
      });
      const env = validateEnv();
      expect(env.LLM_COST_ALERT_THRESHOLD_USD).toBe(0);
    });

    it('rejects negative LLM_COST_ALERT_THRESHOLD_USD', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_COST_ALERT_THRESHOLD_USD: '-1',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('parses LLM_COST_CAP_USD_CENTS as a positive integer', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_COST_CAP_USD_CENTS: '10000',
      });
      const env = validateEnv();
      expect(env.LLM_COST_CAP_USD_CENTS).toBe(10000);
    });

    it('rejects LLM_COST_CAP_USD_CENTS=0 (zero cap would block all runs)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_COST_CAP_USD_CENTS: '0',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('rejects non-numeric LLM_COST_CAP_USD_CENTS (no silent-disable-on-typo)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_COST_CAP_USD_CENTS: 'abc',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('parses AUDIT_LOG_RETENTION_DAYS (7y=2555 default lives in code)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AUDIT_LOG_RETENTION_DAYS: '2555',
      });
      const env = validateEnv();
      expect(env.AUDIT_LOG_RETENTION_DAYS).toBe(2555);
    });

    it('rejects SSE_HEARTBEAT_INTERVAL_MS below 100ms', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        SSE_HEARTBEAT_INTERVAL_MS: '50',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts AGENT_SCHEDULER_DISABLED only in canonical truthy/falsy form', () => {
      for (const v of ['true', 'false', '1', '0']) {
        Object.assign(process.env, {
          ...VALID_ENV,
          AGENT_SCHEDULER_DISABLED: v,
        });
        const env = validateEnv();
        expect(env.AGENT_SCHEDULER_DISABLED).toBe(v);
      }
    });

    it('rejects AGENT_SCHEDULER_DISABLED=yes (avoids truthy ambiguity)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AGENT_SCHEDULER_DISABLED: 'yes',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts ANTHROPIC_BETA_HEADER as an arbitrary string', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        ANTHROPIC_BETA_HEADER: 'prompt-caching-2024-07-31',
      });
      const env = validateEnv();
      expect(env.ANTHROPIC_BETA_HEADER).toBe('prompt-caching-2024-07-31');
    });

    it('parses AGENT_RUN_TIMEOUT_MS as an integer ≥ 1000ms', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AGENT_RUN_TIMEOUT_MS: '300000',
      });
      const env = validateEnv();
      expect(env.AGENT_RUN_TIMEOUT_MS).toBe(300000);
    });

    it('rejects AGENT_RUN_TIMEOUT_MS below 1000ms (too aggressive to be useful)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        AGENT_RUN_TIMEOUT_MS: '500',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts CECL_MACRO_OVERLAY_MODE only as the pinned enum', () => {
      for (const v of ['derived', 'hardcoded']) {
        Object.assign(process.env, {
          ...VALID_ENV,
          CECL_MACRO_OVERLAY_MODE: v,
        });
        const env = validateEnv();
        expect(env.CECL_MACRO_OVERLAY_MODE).toBe(v);
      }
    });

    it('rejects CECL_MACRO_OVERLAY_MODE=off (avoids ambiguous kill-switch strings)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        CECL_MACRO_OVERLAY_MODE: 'off',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('parses PR_MACRO_STALENESS_DAYS as an integer in [1, 730]', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        PR_MACRO_STALENESS_DAYS: '90',
      });
      const env = validateEnv();
      expect(env.PR_MACRO_STALENESS_DAYS).toBe(90);
    });

    it('rejects PR_MACRO_STALENESS_DAYS=0 (a zero threshold means always-stale noise)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        PR_MACRO_STALENESS_DAYS: '0',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts EWS_SCHEDULER_DISABLED only in canonical truthy/falsy form', () => {
      for (const v of ['true', 'false', '1', '0']) {
        Object.assign(process.env, {
          ...VALID_ENV,
          EWS_SCHEDULER_DISABLED: v,
        });
        const env = validateEnv();
        expect(env.EWS_SCHEDULER_DISABLED).toBe(v);
      }
    });

    it('rejects EWS_SCHEDULER_DISABLED=off (avoids truthy ambiguity)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        EWS_SCHEDULER_DISABLED: 'off',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts FRED_API_KEY as an arbitrary string (round-trip: treasury-rates + pr-macro-feed)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        FRED_API_KEY: 'fred-test-key',
      });
      const env = validateEnv();
      expect(env.FRED_API_KEY).toBe('fred-test-key');
    });

    it('parses CACHE_AI_TTL_SECONDS as a positive integer', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        CACHE_AI_TTL_SECONDS: '7200',
      });
      const env = validateEnv();
      expect(env.CACHE_AI_TTL_SECONDS).toBe(7200);
    });

    it('rejects CACHE_AI_TTL_SECONDS=0 (no-TTL leak guard)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        CACHE_AI_TTL_SECONDS: '0',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('parses LLM pricing overrides as nonnegative numbers', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_INPUT_USD_PER_MILLION_TOKENS: '12.5',
        LLM_OUTPUT_USD_PER_MILLION_TOKENS: '60',
      });
      const env = validateEnv();
      expect(env.LLM_INPUT_USD_PER_MILLION_TOKENS).toBe(12.5);
      expect(env.LLM_OUTPUT_USD_PER_MILLION_TOKENS).toBe(60);
    });

    it('rejects negative LLM pricing (operator typo guard)', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        LLM_INPUT_USD_PER_MILLION_TOKENS: '-1',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });
  });

  // ── Production refinement: agent runtime requires ANTHROPIC_API_KEY ─
  describe('production boot-guard', () => {
    it('rejects production deploy without ANTHROPIC_API_KEY', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
      });
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts production deploy with all required secrets set', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
      });
      const env = validateEnv();
      expect(env.NODE_ENV).toBe('production');
      expect(env.ANTHROPIC_API_KEY).toBe(PROD_SECRETS.ANTHROPIC_API_KEY);
    });

    it('fails closed in production without DATA_ENCRYPTION_KEY', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
      });
      delete process.env.DATA_ENCRYPTION_KEY;
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('fails closed in production with a malformed DATA_ENCRYPTION_KEY', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
        DATA_ENCRYPTION_KEY: 'not-hex',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('fails closed in production without API_KEY_PEPPER', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        ...PROD_SECRETS,
        NODE_ENV: 'production',
      });
      delete process.env.API_KEY_PEPPER;
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('does not require ANTHROPIC_API_KEY in development or test', () => {
      delete process.env.ANTHROPIC_API_KEY;
      Object.assign(process.env, {
        ...VALID_ENV,
        NODE_ENV: 'development',
      });
      expect(() => validateEnv()).not.toThrow();
      Object.assign(process.env, {
        ...VALID_ENV,
        NODE_ENV: 'test',
      });
      expect(() => validateEnv()).not.toThrow();
    });
  });

  // ── URL-typed vars (fail fast on Railway typos) ──────────────────
  describe('URL validation', () => {
    it('accepts a well-formed FRONTEND_URL', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        FRONTEND_URL: 'https://cerniq.io',
      });
      const env = validateEnv();
      expect(env.FRONTEND_URL).toBe('https://cerniq.io');
    });

    it('rejects a malformed FRONTEND_URL', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        FRONTEND_URL: 'cerniq.io', // missing scheme
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });

    it('accepts GOOGLE_CALLBACK_URL / GITHUB_CALLBACK_URL URLs', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        GOOGLE_CALLBACK_URL: 'https://api.example.com/api/auth/google/callback',
        GITHUB_CALLBACK_URL: 'https://api.example.com/api/auth/github/callback',
      });
      const env = validateEnv();
      expect(env.GOOGLE_CALLBACK_URL).toContain('google/callback');
      expect(env.GITHUB_CALLBACK_URL).toContain('github/callback');
    });

    it('accepts an email-formatted OPS_NOTIFY_EMAIL', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        OPS_NOTIFY_EMAIL: 'ops@example.com',
      });
      const env = validateEnv();
      expect(env.OPS_NOTIFY_EMAIL).toBe('ops@example.com');
    });

    it('rejects a non-email OPS_NOTIFY_EMAIL', () => {
      Object.assign(process.env, {
        ...VALID_ENV,
        OPS_NOTIFY_EMAIL: 'not-an-email',
      });
      expect(() => validateEnv()).toThrow('process.exit called');
    });
  });
});
