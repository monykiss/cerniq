import { UnauthorizedException } from '@nestjs/common';
import { AdminKeyGuard } from './admin-key.guard';

// Direct-construction spec — no NestJS DI bootstrapping. Locks the
// fail-closed contract that the inline `verifyAdmin(adminKey)` helper
// from app.controller.ts:763 + market-data.controller.ts:253 carried
// for years across 11 routes. Migration of those call sites to
// `@UseGuards(AdminKeyGuard)` is a separate sweep (Phase A scaffold).
//
// The "no oracle leak" property is the security-critical invariant: an
// attacker probing the admin surface gets the SAME 401 response for
// (a) missing header, (b) wrong-length header, (c) wrong-content
// header, and (d) ADMIN_KEY env unset — so they can't enumerate
// configuration state via response-message differentiation. Locked
// explicitly as the last test case.

function makeContext(headers: Record<string, unknown>): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  };
}

describe('AdminKeyGuard', () => {
  let guard: AdminKeyGuard;
  let envBackup: string | undefined;

  beforeEach(() => {
    guard = new AdminKeyGuard();
    envBackup = process.env.ADMIN_KEY;
  });

  afterEach(() => {
    if (envBackup === undefined) {
      delete process.env.ADMIN_KEY;
    } else {
      process.env.ADMIN_KEY = envBackup;
    }
  });

  it('returns true when x-admin-key matches process.env.ADMIN_KEY exactly', () => {
    process.env.ADMIN_KEY = 'secret-test-key';
    expect(
      guard.canActivate(makeContext({ 'x-admin-key': 'secret-test-key' })),
    ).toBe(true);
  });

  it('throws Unauthorized when x-admin-key header is missing', () => {
    process.env.ADMIN_KEY = 'secret-test-key';
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when x-admin-key header is empty string', () => {
    process.env.ADMIN_KEY = 'secret-test-key';
    expect(() => guard.canActivate(makeContext({ 'x-admin-key': '' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when ADMIN_KEY env var is not set', () => {
    delete process.env.ADMIN_KEY;
    expect(() =>
      guard.canActivate(makeContext({ 'x-admin-key': 'any-key' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when header is wrong same-length value', () => {
    process.env.ADMIN_KEY = 'aaa';
    expect(() =>
      guard.canActivate(makeContext({ 'x-admin-key': 'bbb' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when header is shorter than env key (length-mismatch path, NOT timingSafeEqual)', () => {
    // Locks the short-circuit. node:crypto.timingSafeEqual THROWS on
    // unequal-length buffers — would crash to 500 if we hit it. The
    // explicit `a.length !== b.length` check must fire first.
    process.env.ADMIN_KEY = 'longer-admin-key';
    expect(() =>
      guard.canActivate(makeContext({ 'x-admin-key': 'short' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when header is longer than env key (length-mismatch path)', () => {
    process.env.ADMIN_KEY = 'short';
    expect(() =>
      guard.canActivate(makeContext({ 'x-admin-key': 'longer-than-env-key' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when header is a non-string value (e.g. array)', () => {
    process.env.ADMIN_KEY = 'aaa';
    expect(() =>
      guard.canActivate(makeContext({ 'x-admin-key': ['aaa'] as any })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when context has no request headers at all', () => {
    process.env.ADMIN_KEY = 'aaa';
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as any;
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('emits the SAME error message across all five failure modes — no oracle leak', () => {
    process.env.ADMIN_KEY = 'aaa';

    const captures: string[] = [];
    const capture = (fn: () => void) => {
      try {
        fn();
      } catch (e: any) {
        captures.push(e.message);
      }
    };

    capture(() => guard.canActivate(makeContext({})));
    capture(() => guard.canActivate(makeContext({ 'x-admin-key': '' })));
    capture(() => guard.canActivate(makeContext({ 'x-admin-key': 'bb' })));
    capture(() => guard.canActivate(makeContext({ 'x-admin-key': 'bbbb' })));
    capture(() => guard.canActivate(makeContext({ 'x-admin-key': 'bbb' })));

    delete process.env.ADMIN_KEY;
    capture(() => guard.canActivate(makeContext({ 'x-admin-key': 'any' })));

    expect(captures).toHaveLength(6);
    expect(captures.every((m) => m === 'Invalid admin key')).toBe(true);
  });
});
