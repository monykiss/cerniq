import { of } from 'rxjs';
import { AgentCorrelationInterceptor } from './correlation.interceptor';

const mockReq = (
  headers: Record<string, string | undefined> = {},
  user?: { institutionId?: string },
) => ({
  headers,
  user,
  cerniqCorrelationId: undefined as string | undefined,
});

const mockRes = () => {
  const setHeaders: Record<string, string> = {};
  return {
    setHeader: jest.fn((k: string, v: string) => {
      setHeaders[k] = v;
    }),
    _headers: setHeaders,
  };
};

const mockContext = (
  req: ReturnType<typeof mockReq>,
  res: ReturnType<typeof mockRes>,
) => ({
  switchToHttp: () => ({
    getRequest: () => req,
    getResponse: () => res,
  }),
});

const mockCallHandler = (returnValue: unknown = { data: 'ok' }) => ({
  handle: () => of(returnValue),
});

describe('AgentCorrelationInterceptor', () => {
  let interceptor: AgentCorrelationInterceptor;

  beforeEach(() => {
    interceptor = new AgentCorrelationInterceptor();
  });

  it('generates a correlation ID when none is provided', (done) => {
    const req = mockReq();
    const res = mockRes();
    const ctx = mockContext(req, res) as any;

    interceptor.intercept(ctx, mockCallHandler() as any).subscribe({
      next: () => {
        expect(req.cerniqCorrelationId).toBeDefined();
        expect(res.setHeader).toHaveBeenCalledWith(
          'x-cerniq-correlation-id',
          expect.any(String),
        );
        done();
      },
    });
  });

  it('passes through an existing correlation ID from the request', (done) => {
    const req = mockReq({ 'x-cerniq-correlation-id': 'existing-123' });
    const res = mockRes();
    const ctx = mockContext(req, res) as any;

    interceptor.intercept(ctx, mockCallHandler() as any).subscribe({
      next: () => {
        expect(req.cerniqCorrelationId).toBe('existing-123');
        expect(res.setHeader).toHaveBeenCalledWith(
          'x-cerniq-correlation-id',
          'existing-123',
        );
        done();
      },
    });
  });

  it('does not throw when response has no setHeader (non-HTTP context)', (done) => {
    const req = mockReq();
    const badRes = {
      setHeader: () => {
        throw new Error('not HTTP');
      },
    };
    const ctx = mockContext(req, badRes as any) as any;

    interceptor.intercept(ctx, mockCallHandler() as any).subscribe({
      next: () => {
        expect(req.cerniqCorrelationId).toBeDefined();
        done();
      },
    });
  });

  it('enriches the request with institutionId from headers', (done) => {
    const req = mockReq({ 'x-institution-id': 'inst-abc' });
    const res = mockRes();
    const ctx = mockContext(req, res) as any;

    interceptor.intercept(ctx, mockCallHandler() as any).subscribe({
      next: () => {
        expect(req.cerniqCorrelationId).toBeDefined();
        done();
      },
    });
  });

  it('falls back to user.institutionId from JWT payload', (done) => {
    const req = mockReq({}, { institutionId: 'inst-from-jwt' });
    const res = mockRes();
    const ctx = mockContext(req, res) as any;

    interceptor.intercept(ctx, mockCallHandler() as any).subscribe({
      next: () => {
        expect(req.cerniqCorrelationId).toBeDefined();
        done();
      },
    });
  });
});
