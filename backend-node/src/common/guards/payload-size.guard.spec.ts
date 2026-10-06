import { PayloadSizeGuard, MaxPayloadSize } from './payload-size.guard';
import { PayloadTooLargeException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

describe('PayloadSizeGuard', () => {
  let guard: PayloadSizeGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PayloadSizeGuard(reflector);
  });

  const createMockContext = (contentLength: string = '0'): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'content-length': contentLength },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow when no max payload metadata is set', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const ctx = createMockContext('10000000'); // 10MB
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow when content-length is within limit', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(50 * 1024 * 1024); // 50MB
    const ctx = createMockContext(String(10 * 1024 * 1024)); // 10MB
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw PayloadTooLargeException when content-length exceeds limit', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(1 * 1024 * 1024); // 1MB
    const ctx = createMockContext(String(5 * 1024 * 1024)); // 5MB
    expect(() => guard.canActivate(ctx)).toThrow(PayloadTooLargeException);
  });

  it('should allow when content-length equals the limit', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(1024);
    const ctx = createMockContext('1024');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow when content-length header is missing', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(1024);
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should include size info in exception message', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(1 * 1024 * 1024); // 1MB
    const ctx = createMockContext(String(2 * 1024 * 1024)); // 2MB
    try {
      guard.canActivate(ctx);
      fail('Expected exception');
    } catch (e: any) {
      expect(e.message).toContain('1.0MB');
      expect(e.message).toContain('2.0MB');
    }
  });

  it('MaxPayloadSize decorator returns a function', () => {
    const decorator = MaxPayloadSize(1024);
    expect(typeof decorator).toBe('function');
  });
});
