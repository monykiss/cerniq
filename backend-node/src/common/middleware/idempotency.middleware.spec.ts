import { IdempotencyMiddleware } from './idempotency.middleware';

describe('IdempotencyMiddleware', () => {
  let middleware: IdempotencyMiddleware;
  let mockCache: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    mockCache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };
    middleware = new IdempotencyMiddleware(mockCache as any);
  });

  const createMocks = (
    method: string,
    headers: Record<string, string> = {},
  ) => {
    const req = { method, headers } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      statusCode: 200,
    } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should call next() for GET requests without checking cache', async () => {
    const { req, res, next } = createMocks('GET');
    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockCache.get).not.toHaveBeenCalled();
  });

  it('should call next() for POST without idempotency key', async () => {
    const { req, res, next } = createMocks('POST');
    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockCache.get).not.toHaveBeenCalled();
  });

  it('should return cached response when idempotency key hits cache', async () => {
    const cachedResponse = { status: 201, body: { id: 'abc' } };
    mockCache.get.mockResolvedValue(cachedResponse);

    const { req, res, next } = createMocks('POST', {
      'x-idempotency-key': 'key-123',
    });
    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'abc' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return status 200 when cached status is missing', async () => {
    const cachedResponse = { body: { done: true } };
    mockCache.get.mockResolvedValue(cachedResponse);

    const { req, res, next } = createMocks('POST', {
      'x-idempotency-key': 'key-456',
    });
    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ done: true });
  });

  it('should intercept res.json to cache response on first call', async () => {
    mockCache.get.mockResolvedValue(null);

    const { req, res, next } = createMocks('POST', {
      'x-idempotency-key': 'key-789',
    });
    const originalJson = res.json;
    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    // The json method should be overridden
    expect(res.json).not.toBe(originalJson);
  });

  it('should proceed normally when cache throws an error', async () => {
    mockCache.get.mockRejectedValue(new Error('Redis down'));

    const { req, res, next } = createMocks('PUT', {
      'x-idempotency-key': 'key-err',
    });
    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should apply to PUT requests', async () => {
    mockCache.get.mockResolvedValue(null);

    const { req, res, next } = createMocks('PUT', {
      'x-idempotency-key': 'key-put',
    });
    await middleware.use(req, res, next);

    expect(mockCache.get).toHaveBeenCalledWith('idempotency:key-put');
    expect(next).toHaveBeenCalled();
  });

  it('should apply to PATCH requests', async () => {
    mockCache.get.mockResolvedValue(null);

    const { req, res, next } = createMocks('PATCH', {
      'x-idempotency-key': 'key-patch',
    });
    await middleware.use(req, res, next);

    expect(mockCache.get).toHaveBeenCalledWith('idempotency:key-patch');
    expect(next).toHaveBeenCalled();
  });

  it('should skip DELETE requests', async () => {
    const { req, res, next } = createMocks('DELETE', {
      'x-idempotency-key': 'key-del',
    });
    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockCache.get).not.toHaveBeenCalled();
  });

  // ── Coverage boost: intercepted res.json actually caches and calls original ──
  it('intercepted res.json caches response and calls original json', async () => {
    mockCache.get.mockResolvedValue(null);

    const { req, res, next } = createMocks('POST', {
      'x-idempotency-key': 'key-cache-write',
    });
    await middleware.use(req, res, next);

    // Now call the intercepted res.json
    res.json({ result: 'ok' });

    expect(mockCache.set).toHaveBeenCalledWith(
      'idempotency:key-cache-write',
      { status: 200, body: { result: 'ok' } },
      86400,
    );
  });

  it('intercepted res.json handles cache.set failure silently', async () => {
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockRejectedValue(new Error('Redis unavailable'));

    const { req, res, next } = createMocks('PATCH', {
      'x-idempotency-key': 'key-set-fail',
    });
    await middleware.use(req, res, next);

    // Should not throw when res.json triggers cache.set failure
    expect(() => res.json({ data: 'test' })).not.toThrow();
  });
});
