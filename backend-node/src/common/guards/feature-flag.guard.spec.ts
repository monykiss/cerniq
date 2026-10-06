import { FeatureFlagGuard } from './feature-flag.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

describe('FeatureFlagGuard', () => {
  let guard: FeatureFlagGuard;
  let reflector: Reflector;
  const OLD_ENV = process.env;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new FeatureFlagGuard(reflector);
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createMockContext = (): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext;

  it('allows access when no feature flag metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when the feature flag is enabled', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('NEW_DASHBOARD');
    process.env.FEATURE_NEW_DASHBOARD = 'true';
    const ctx = createMockContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when the feature flag is disabled', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('NEW_DASHBOARD');
    process.env.FEATURE_NEW_DASHBOARD = 'false';
    const ctx = createMockContext();
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('treats missing env var as disabled', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SOME_FLAG');
    delete process.env.FEATURE_SOME_FLAG;
    const ctx = createMockContext();
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
