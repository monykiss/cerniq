import { of, lastValueFrom } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { CallHandler, ExecutionContext } from '@nestjs/common';

describe('ResponseEnvelopeInterceptor', () => {
  let interceptor: ResponseEnvelopeInterceptor<any>;
  const ctx = {} as ExecutionContext;

  beforeEach(() => {
    interceptor = new ResponseEnvelopeInterceptor();
  });

  it('wraps plain data in success envelope', async () => {
    const handler: CallHandler = { handle: () => of({ name: 'Test' }) };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ success: true, data: { name: 'Test' } });
  });

  it('wraps arrays', async () => {
    const handler: CallHandler = { handle: () => of([1, 2, 3]) };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ success: true, data: [1, 2, 3] });
  });

  it('wraps null', async () => {
    const handler: CallHandler = { handle: () => of(null) };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ success: true, data: null });
  });

  it('passes through already-wrapped responses', async () => {
    const wrapped = { success: true, data: { id: 1 } };
    const handler: CallHandler = { handle: () => of(wrapped) };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual(wrapped);
  });

  it('extracts paginated results into data + meta', async () => {
    const paginated = {
      items: [{ id: 1 }, { id: 2 }],
      total: 10,
      page: 2,
      pageSize: 2,
    };
    const handler: CallHandler = { handle: () => of(paginated) };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 2,
      total: 10,
      totalPages: 5,
    });
  });

  it('calculates totalPages from total and pageSize', async () => {
    const paginated = { items: [{ id: 1 }], total: 25, pageSize: 10 };
    const handler: CallHandler = { handle: () => of(paginated) };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result.meta!.totalPages).toBe(3); // ceil(25/10)
  });

  it('wraps primitive values', async () => {
    const handler: CallHandler = { handle: () => of('hello') };
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ success: true, data: 'hello' });
  });
});
