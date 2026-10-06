import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

// ── Public decorator ─────────────────────────────────────────────────
import { IS_PUBLIC_KEY, Public } from './public.decorator';

// ── Roles decorator ──────────────────────────────────────────────────
import { ROLES_KEY, Roles } from './roles.decorator';

// ── CacheKey + CacheTtl from cache-key.decorator ─────────────────────
import {
  CACHE_KEY_METADATA,
  CACHE_TTL_METADATA,
  CacheKey,
  CacheTtl,
} from './cache-key.decorator';

// ── CacheTTL + NoCache from cache-ttl.decorator ──────────────────────
import { CACHE_TTL_KEY, CacheTTL, NoCache } from './cache-ttl.decorator';

// ── AuditAction + SkipAuditLog ───────────────────────────────────────
import {
  AUDIT_ACTION_KEY,
  SKIP_AUDIT_LOG_KEY,
  AuditAction,
  SkipAuditLog,
} from './audit-action.decorator';

// ── ApiVersion + DeprecatedInVersion ─────────────────────────────────
import {
  API_VERSION_KEY,
  DEPRECATED_VERSION_KEY,
  ApiVersion,
  DeprecatedInVersion,
} from './api-version.decorator';

// ── RateLimitTier ────────────────────────────────────────────────────
import {
  RATE_LIMIT_TIER_KEY,
  RateLimitTier,
} from './rate-limit-tier.decorator';

// ── RequiredPermissions + Permissions ────────────────────────────────
import {
  PERMISSIONS_KEY,
  RequiredPermissions,
  Permissions,
} from './required-permissions.decorator';

// ── ThrottleBy + presets ─────────────────────────────────────────────
import {
  THROTTLE_KEY,
  ThrottleBy,
  ThrottleStrict,
  ThrottleModerate,
  ThrottleRelaxed,
} from './throttle-by.decorator';

// ── LogExecution ─────────────────────────────────────────────────────
import { LogExecution } from './log-execution.decorator';

// ── Deprecated ───────────────────────────────────────────────────────
import { DEPRECATION_KEY, Deprecated } from './deprecated.decorator';

// ── ApiPagination ────────────────────────────────────────────────────
import { ApiPagination } from './api-pagination.decorator';

// Helper to extract metadata set by a decorator on a test class method.
function getMetadata(key: string, decorator: MethodDecorator): any {
  class TestClass {
    @(decorator as any)
    handler() {}
  }
  return Reflect.getMetadata(key, TestClass.prototype.handler);
}

function getMetadataFromClassDecorator(
  key: string,
  decorator: ClassDecorator,
): any {
  @(decorator as any)
  class TestClass {}
  return Reflect.getMetadata(key, TestClass);
}

describe('Decorators', () => {
  // ── @Public ──────────────────────────────────────────────────────

  describe('@Public', () => {
    it('sets IS_PUBLIC_KEY metadata to true', () => {
      const meta = getMetadata(IS_PUBLIC_KEY, Public());
      expect(meta).toBe(true);
    });
  });

  // ── @Roles ─────────────────────────────────────────────────────

  describe('@Roles', () => {
    it('sets ROLES_KEY metadata with provided roles', () => {
      const meta = getMetadata(ROLES_KEY, Roles('admin', 'analyst'));
      expect(meta).toEqual(['admin', 'analyst']);
    });

    it('works with a single role', () => {
      const meta = getMetadata(ROLES_KEY, Roles('admin'));
      expect(meta).toEqual(['admin']);
    });

    it('works with no roles', () => {
      const meta = getMetadata(ROLES_KEY, Roles());
      expect(meta).toEqual([]);
    });
  });

  // ── @CacheKey + @CacheTtl (from cache-key.decorator) ──────────

  describe('@CacheKey', () => {
    it('sets CACHE_KEY_METADATA to provided key', () => {
      const meta = getMetadata(
        CACHE_KEY_METADATA,
        CacheKey('portfolio:summary'),
      );
      expect(meta).toBe('portfolio:summary');
    });
  });

  describe('@CacheTtl', () => {
    it('sets CACHE_TTL_METADATA to provided seconds', () => {
      const meta = getMetadata(CACHE_TTL_METADATA, CacheTtl(300));
      expect(meta).toBe(300);
    });
  });

  // ── @CacheTTL + @NoCache (from cache-ttl.decorator) ────────────

  describe('@CacheTTL', () => {
    it('sets CACHE_TTL_KEY to provided seconds', () => {
      const meta = getMetadata(CACHE_TTL_KEY, CacheTTL(600));
      expect(meta).toBe(600);
    });
  });

  describe('@NoCache', () => {
    it('sets CACHE_TTL_KEY to 0', () => {
      const meta = getMetadata(CACHE_TTL_KEY, NoCache());
      expect(meta).toBe(0);
    });
  });

  // ── @AuditAction + @SkipAuditLog ──────────────────────────────

  describe('@AuditAction', () => {
    it('sets AUDIT_ACTION_KEY to provided action name', () => {
      const meta = getMetadata(
        AUDIT_ACTION_KEY,
        AuditAction('GENERATE_REPORT'),
      );
      expect(meta).toBe('GENERATE_REPORT');
    });
  });

  describe('@SkipAuditLog', () => {
    it('sets SKIP_AUDIT_LOG_KEY to true', () => {
      const meta = getMetadata(SKIP_AUDIT_LOG_KEY, SkipAuditLog());
      expect(meta).toBe(true);
    });
  });

  // ── @ApiVersion + @DeprecatedInVersion ─────────────────────────

  describe('@ApiVersion', () => {
    it('sets API_VERSION_KEY with version strings', () => {
      const meta = getMetadata(API_VERSION_KEY, ApiVersion('1', '2'));
      expect(meta).toEqual(['1', '2']);
    });

    it('works with single version', () => {
      const meta = getMetadata(API_VERSION_KEY, ApiVersion('2'));
      expect(meta).toEqual(['2']);
    });
  });

  describe('@DeprecatedInVersion', () => {
    it('sets DEPRECATED_VERSION_KEY with version and sunset', () => {
      const meta = getMetadata(
        DEPRECATED_VERSION_KEY,
        DeprecatedInVersion('1', '2026-06-01'),
      );
      expect(meta).toEqual({ version: '1', sunset: '2026-06-01' });
    });

    it('works without sunset date', () => {
      const meta = getMetadata(
        DEPRECATED_VERSION_KEY,
        DeprecatedInVersion('1'),
      );
      expect(meta).toEqual({ version: '1', sunset: undefined });
    });
  });

  // ── @RateLimitTier ─────────────────────────────────────────────

  describe('@RateLimitTier', () => {
    it('sets RATE_LIMIT_TIER_KEY for free tier', () => {
      const meta = getMetadata(RATE_LIMIT_TIER_KEY, RateLimitTier('free'));
      expect(meta).toBe('free');
    });

    it('sets RATE_LIMIT_TIER_KEY for compute tier', () => {
      const meta = getMetadata(RATE_LIMIT_TIER_KEY, RateLimitTier('compute'));
      expect(meta).toBe('compute');
    });

    it('sets RATE_LIMIT_TIER_KEY for unlimited tier', () => {
      const meta = getMetadata(RATE_LIMIT_TIER_KEY, RateLimitTier('unlimited'));
      expect(meta).toBe('unlimited');
    });
  });

  // ── @RequiredPermissions ───────────────────────────────────────

  describe('@RequiredPermissions', () => {
    it('sets PERMISSIONS_KEY with provided permissions', () => {
      const meta = getMetadata(
        PERMISSIONS_KEY,
        RequiredPermissions('portfolio:read', 'portfolio:write'),
      );
      expect(meta).toEqual(['portfolio:read', 'portfolio:write']);
    });

    it('works with Permissions constants', () => {
      const meta = getMetadata(
        PERMISSIONS_KEY,
        RequiredPermissions(
          Permissions.REPORT_GENERATE,
          Permissions.REPORT_EXPORT,
        ),
      );
      expect(meta).toEqual(['report:generate', 'report:export']);
    });
  });

  describe('Permissions constants', () => {
    it('has all expected permission strings', () => {
      expect(Permissions.PORTFOLIO_READ).toBe('portfolio:read');
      expect(Permissions.PORTFOLIO_WRITE).toBe('portfolio:write');
      expect(Permissions.PORTFOLIO_DELETE).toBe('portfolio:delete');
      expect(Permissions.REPORT_READ).toBe('report:read');
      expect(Permissions.REPORT_GENERATE).toBe('report:generate');
      expect(Permissions.REPORT_EXPORT).toBe('report:export');
      expect(Permissions.ADMIN_USERS).toBe('admin:users');
      expect(Permissions.ADMIN_BILLING).toBe('admin:billing');
      expect(Permissions.ADMIN_SETTINGS).toBe('admin:settings');
      expect(Permissions.RISK_READ).toBe('risk:read');
      expect(Permissions.RISK_CONFIGURE).toBe('risk:configure');
      expect(Permissions.COMPLIANCE_READ).toBe('compliance:read');
      expect(Permissions.COMPLIANCE_MANAGE).toBe('compliance:manage');
    });
  });

  // ── @ThrottleBy + presets ──────────────────────────────────────

  describe('@ThrottleBy', () => {
    it('sets THROTTLE_KEY with full config', () => {
      const config = {
        key: 'report-export',
        limit: 5,
        windowSec: 3600,
        by: 'user' as const,
      };
      const meta = getMetadata(THROTTLE_KEY, ThrottleBy(config));
      expect(meta).toEqual(config);
    });
  });

  describe('@ThrottleStrict', () => {
    it('creates strict throttle (5 req / hour, by user)', () => {
      const meta = getMetadata(THROTTLE_KEY, ThrottleStrict('monte-carlo'));
      expect(meta).toEqual({
        key: 'monte-carlo',
        limit: 5,
        windowSec: 3600,
        by: 'user',
      });
    });
  });

  describe('@ThrottleModerate', () => {
    it('creates moderate throttle (30 req / minute, by user)', () => {
      const meta = getMetadata(THROTTLE_KEY, ThrottleModerate('analysis'));
      expect(meta).toEqual({
        key: 'analysis',
        limit: 30,
        windowSec: 60,
        by: 'user',
      });
    });
  });

  describe('@ThrottleRelaxed', () => {
    it('creates relaxed throttle (200 req / minute, by ip)', () => {
      const meta = getMetadata(THROTTLE_KEY, ThrottleRelaxed('health'));
      expect(meta).toEqual({
        key: 'health',
        limit: 200,
        windowSec: 60,
        by: 'ip',
      });
    });
  });

  // ── @LogExecution ──────────────────────────────────────────────

  describe('@LogExecution', () => {
    it('wraps method and returns result', async () => {
      class TestService {
        @LogExecution()
        async doWork(val: number) {
          return val * 2;
        }
      }

      const svc = new TestService();
      const result = await svc.doWork(5);
      expect(result).toBe(10);
    });

    it('wraps method and propagates errors', async () => {
      class TestService {
        @LogExecution('CustomContext')
        async failingWork() {
          throw new Error('Something went wrong');
        }
      }

      const svc = new TestService();
      await expect(svc.failingWork()).rejects.toThrow('Something went wrong');
    });

    it('works with zero args', async () => {
      class TestService {
        @LogExecution()
        async noArgs() {
          return 'done';
        }
      }

      const svc = new TestService();
      const result = await svc.noArgs();
      expect(result).toBe('done');
    });
  });

  // ── @Deprecated (interceptor-based) ────────────────────────────

  describe('@Deprecated', () => {
    it('sets DEPRECATION_KEY metadata', () => {
      const meta = getMetadata(
        DEPRECATION_KEY,
        Deprecated('2026-06-01', '/api/v2/analysis'),
      );
      expect(meta).toEqual({
        sunsetDate: '2026-06-01',
        alternative: '/api/v2/analysis',
      });
    });
  });

  // ── @ApiPagination ─────────────────────────────────────────────

  describe('@ApiPagination', () => {
    it('is a function that returns a decorator', () => {
      expect(typeof ApiPagination).toBe('function');
      const decorator = ApiPagination();
      expect(typeof decorator).toBe('function');
    });

    it('can be applied to a method without error', () => {
      expect(() => {
        class TestController {
          @ApiPagination()
          list() {}
        }
        // Decorator applied successfully
        expect(TestController).toBeDefined();
      }).not.toThrow();
    });
  });
});
