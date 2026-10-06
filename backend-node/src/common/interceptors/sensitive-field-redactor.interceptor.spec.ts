import { randomBytes as testRandomBytes } from 'crypto';
import { of, lastValueFrom } from 'rxjs';
import { SensitiveFieldRedactorInterceptor } from './sensitive-field-redactor.interceptor';
import { CallHandler, ExecutionContext } from '@nestjs/common';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();

describe('SensitiveFieldRedactorInterceptor', () => {
  let interceptor: SensitiveFieldRedactorInterceptor;

  function makeContext(): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({}),
        getNext: () => jest.fn(),
      }),
      getClass: () => Object,
      getHandler: () => jest.fn(),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({}) as any,
      switchToWs: () => ({}) as any,
      getType: () => 'http' as any,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    interceptor = new SensitiveFieldRedactorInterceptor();
  });

  it('should redact password fields', async () => {
    const handler: CallHandler = {
      handle: () =>
        of({ email: 'user@test.com', password: TEST_PW_1, name: 'Test' }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result.password).toBe('[REDACTED]');
    expect(result.email).toBe('user@test.com');
    expect(result.name).toBe('Test');
  });

  it('should redact token fields', async () => {
    const handler: CallHandler = {
      handle: () =>
        of({
          accessToken: 'jwt.token.here',
          refreshToken: 'rt_abc',
          userId: 'u1',
        }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
    expect(result.userId).toBe('u1');
  });

  it('should redact nested sensitive fields', async () => {
    const handler: CallHandler = {
      handle: () =>
        of({
          user: { email: 'a@b.com', passwordHash: 'hashed' },
          billing: { apiSecret: 'not-a-real-secret' },
        }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result.user.passwordHash).toBe('[REDACTED]');
    expect(result.billing.apiSecret).toBe('[REDACTED]');
    expect(result.user.email).toBe('a@b.com');
  });

  it('should redact SSN and tax fields', async () => {
    const handler: CallHandler = {
      handle: () =>
        of({ ssn: '123-45-6789', taxId: 'XX-1234567', name: 'Corp' }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result.ssn).toBe('[REDACTED]');
    expect(result.taxId).toBe('[REDACTED]');
    expect(result.name).toBe('Corp');
  });

  it('should handle arrays', async () => {
    const handler: CallHandler = {
      handle: () =>
        of([
          { id: 1, secret: 'x' },
          { id: 2, secret: 'y' },
        ]),
    };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result[0].secret).toBe('[REDACTED]');
    expect(result[1].secret).toBe('[REDACTED]');
    expect(result[0].id).toBe(1);
  });

  it('should pass through null and primitives', async () => {
    const handler: CallHandler = { handle: () => of(null) };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result).toBeNull();
  });

  it('should pass through primitive values unchanged', async () => {
    const handler: CallHandler = { handle: () => of(42) };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result).toBe(42);
  });

  it('should not redact safe fields', async () => {
    const handler: CallHandler = {
      handle: () =>
        of({ durationGap: 2.1, lcr: 142.5, institution: 'CoopAhorro' }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(makeContext(), handler),
    );
    expect(result.durationGap).toBe(2.1);
    expect(result.lcr).toBe(142.5);
    expect(result.institution).toBe('CoopAhorro');
  });
});
