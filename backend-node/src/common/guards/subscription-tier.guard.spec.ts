import { SubscriptionTierGuard, RequiresTier } from './subscription-tier.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('SubscriptionTierGuard', () => {
  let guard: SubscriptionTierGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new SubscriptionTierGuard(reflector);
  });

  const createMockContext = (user: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('allows access when no tier requirement is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext({ subscriptionTier: 'free' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when user tier meets requirement', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['professional']);
    const ctx = createMockContext({ subscriptionTier: 'enterprise' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws when user tier is below requirement', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['professional']);
    const ctx = createMockContext({ subscriptionTier: 'free' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws when user has no subscription tier', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['starter']);
    const ctx = createMockContext({});
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('RequiresTier decorator returns a function', () => {
    const decorator = RequiresTier('professional', 'enterprise');
    expect(typeof decorator).toBe('function');
  });
});
