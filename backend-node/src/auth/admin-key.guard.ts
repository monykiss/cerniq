import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * AdminKeyGuard — guards admin routes via the `x-admin-key` request
 * header compared against `process.env.ADMIN_KEY` using a timing-safe
 * constant-time comparison.
 *
 * Centralizes the inline `verifyAdmin(adminKey)` pattern previously
 * duplicated as a private helper in `app.controller.ts` (10 routes —
 * see `verifyAdmin` at app.controller.ts:763) and as an inline block in
 * `market-data.controller.ts:253` (1 route, `clear-cache`). Total 11
 * routes across the legacy admin surface. AUTH_COVERAGE_AUDIT.md §
 * "Recommended Primitive-Consolidation Work" item #1.
 *
 * Functional contract (preserves the existing behavior byte-for-byte):
 *
 *   - Missing `x-admin-key` header                    → 401
 *   - Empty `x-admin-key`                             → 401
 *   - `process.env.ADMIN_KEY` not set                 → 401
 *   - Header length ≠ env length                      → 401
 *   - Constant-time content mismatch                  → 401
 *
 * All four failure cases use the same message ("Invalid admin key") so
 * an attacker cannot distinguish "no key configured" from "wrong key
 * supplied" via the response body — matches the existing helpers.
 *
 * Applied via `@UseGuards(AdminKeyGuard)` at class or method level. No
 * controller-side header extraction or env lookup needed at call sites.
 * Registered in `@Global() AuthModule` providers + exports so callers
 * import only the symbol — no per-module DI wiring.
 *
 * Phase A scaffold: this file ships the guard + spec only. Call-site
 * migration (replacing `this.verifyAdmin(adminKey)` inside handlers with
 * `@UseGuards(AdminKeyGuard)` on the decorator stack) is a separate
 * sweep — same Phase-A pattern peer-2 used for `verify-auth-coverage
 * .mjs`. Once migrations land, the inline helpers in `app.controller.ts`
 * and `market-data.controller.ts` can be deleted and the future
 * `verify-auth-coverage.mjs` linter can enforce that admin routes carry
 * `AdminKeyGuard` in their `@UseGuards` decorator.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const headerKey = req?.headers?.['x-admin-key'];

    if (typeof headerKey !== 'string' || headerKey.length === 0) {
      throw new UnauthorizedException('Invalid admin key');
    }

    const envKey = process.env.ADMIN_KEY;
    if (!envKey) {
      throw new UnauthorizedException('Invalid admin key');
    }

    const a = Buffer.from(headerKey);
    const b = Buffer.from(envKey);

    // Length-mismatch must short-circuit BEFORE `timingSafeEqual` —
    // that function throws on unequal-length buffers, which would crash
    // the request with a 500 instead of returning a clean 401.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid admin key');
    }

    return true;
  }
}
