import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  const createMocks = (headers: Record<string, string> = {}) => {
    const req = { headers } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should generate a new correlation ID when none is provided', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);

    expect(req.correlationId).toBeDefined();
    expect(typeof req.correlationId).toBe('string');
    expect(req.correlationId.length).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      req.correlationId,
    );
    expect(next).toHaveBeenCalled();
  });

  it('should propagate existing x-correlation-id header', () => {
    const { req, res, next } = createMocks({
      'x-correlation-id': 'existing-id-123',
    });
    middleware.use(req, res, next);

    expect(req.correlationId).toBe('existing-id-123');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      'existing-id-123',
    );
    expect(next).toHaveBeenCalled();
  });

  it('should propagate existing x-trace-id header as fallback', () => {
    const { req, res, next } = createMocks({
      'x-trace-id': 'trace-456',
    });
    middleware.use(req, res, next);

    expect(req.correlationId).toBe('trace-456');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'trace-456');
  });

  it('should prefer x-correlation-id over x-trace-id', () => {
    const { req, res, next } = createMocks({
      'x-correlation-id': 'corr-id',
      'x-trace-id': 'trace-id',
    });
    middleware.use(req, res, next);

    expect(req.correlationId).toBe('corr-id');
  });

  it('should set the correlation ID on the request headers', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);

    expect(req.headers['x-correlation-id']).toBe(req.correlationId);
  });
});
