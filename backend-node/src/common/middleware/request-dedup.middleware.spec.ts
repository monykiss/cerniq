import { RequestDeduplicationMiddleware } from './request-dedup.middleware';

describe('RequestDeduplicationMiddleware', () => {
  let middleware: RequestDeduplicationMiddleware;

  beforeEach(() => {
    middleware = new RequestDeduplicationMiddleware();
  });

  const createMocks = (
    method: string,
    originalUrl: string,
    headers: Record<string, string> = {},
  ) => {
    const req = { method, originalUrl, headers } as any;
    const res = { on: jest.fn() } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should call next() for GET requests', () => {
    const { req, res, next } = createMocks('GET', '/api/data');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should call next() for non-GET requests without dedup', () => {
    const { req, res, next } = createMocks('POST', '/api/data');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should skip dedup for POST requests', () => {
    const { req, res, next } = createMocks('POST', '/api/data');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
  });

  it('should register a finish listener for GET requests', () => {
    const { req, res, next } = createMocks('GET', '/api/data');
    middleware.use(req, res, next);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should call next for duplicate GET requests (non-blocking)', () => {
    const { req, res, next } = createMocks('GET', '/api/data', {
      authorization: 'Bearer token123',
    });
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();

    // Second identical request
    const mocks2 = createMocks('GET', '/api/data', {
      authorization: 'Bearer token123',
    });
    middleware.use(mocks2.req, mocks2.res, mocks2.next);
    expect(mocks2.next).toHaveBeenCalled();
  });

  it('should not register finish listener for duplicate inflight GET', () => {
    const { req, res, next } = createMocks('GET', '/api/data');
    middleware.use(req, res, next);

    const mocks2 = createMocks('GET', '/api/data');
    middleware.use(mocks2.req, mocks2.res, mocks2.next);
    // Second request should not register a new finish listener
    // (the inflight map already has the key)
    expect(mocks2.res.on).not.toHaveBeenCalled();
  });

  it('should skip dedup for PUT requests', () => {
    const { req, res, next } = createMocks('PUT', '/api/data');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
  });

  it('should use anonymous key when no authorization header', () => {
    const { req, res, next } = createMocks('GET', '/api/users');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should clean up inflight entry when response finishes', () => {
    let finishCb: (() => void) | undefined = () => {};
    const res = {
      on: jest.fn((event: string, cb: () => void) => {
        finishCb = cb;
      }),
    };
    const req = {
      method: 'GET',
      originalUrl: '/api/finish-test',
      headers: {},
    } as any;
    const next = jest.fn();

    middleware.use(req, res as any, next);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

    // Trigger finish
    finishCb?.();

    // New request to same URL should create a new inflight entry
    const res2 = { on: jest.fn() } as any;
    const next2 = jest.fn();
    middleware.use(req, res2, next2);
    expect(res2.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should clean up via TTL timeout', () => {
    jest.useFakeTimers();
    const res = { on: jest.fn() } as any;
    const req = {
      method: 'GET',
      originalUrl: '/api/ttl-test',
      headers: {},
    } as any;
    const next = jest.fn();

    middleware.use(req, res, next);

    // Advance past TTL (5000ms)
    jest.advanceTimersByTime(6000);

    // New request should create a new entry
    const res2 = { on: jest.fn() } as any;
    const next2 = jest.fn();
    middleware.use(req, res2, next2);
    expect(res2.on).toHaveBeenCalledWith('finish', expect.any(Function));

    jest.useRealTimers();
  });

  it('should handle different methods (DELETE, PATCH, OPTIONS)', () => {
    for (const method of ['DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      const { req, res, next } = createMocks(method, '/api/data');
      middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.on).not.toHaveBeenCalled();
    }
  });

  it('should generate different keys for different auth headers', () => {
    const {
      req: req1,
      res: res1,
      next: next1,
    } = createMocks('GET', '/api/data', {
      authorization: 'Bearer token-A',
    });
    middleware.use(req1, res1, next1);

    const {
      req: req2,
      res: res2,
      next: next2,
    } = createMocks('GET', '/api/data', {
      authorization: 'Bearer token-B',
    });
    middleware.use(req2, res2, next2);

    // Both should get their own inflight entry
    expect(res1.on).toHaveBeenCalled();
    expect(res2.on).toHaveBeenCalled();
  });
});
