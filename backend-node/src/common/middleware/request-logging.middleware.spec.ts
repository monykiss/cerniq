import { RequestLoggingMiddleware } from './request-logging.middleware';

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;

  beforeEach(() => {
    middleware = new RequestLoggingMiddleware();
  });

  const createMocks = (url: string, overrides: Record<string, any> = {}) => {
    const req = {
      method: 'GET',
      url,
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent', 'x-request-id': 'req-1' },
      user: undefined,
      ...overrides,
    } as any;
    let finishCallback: (() => void) | null = null;
    const res = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
      }),
    } as any;
    const next = jest.fn();
    return { req, res, next, triggerFinish: () => finishCallback?.() };
  };

  it('should call next()', () => {
    const { req, res, next } = createMocks('/api/test');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should register a finish event listener on response', () => {
    const { req, res, next } = createMocks('/api/test');
    middleware.use(req, res, next);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should not throw when finish fires for normal endpoints', () => {
    const { req, res, next, triggerFinish } = createMocks('/api/test');
    middleware.use(req, res, next);
    expect(() => triggerFinish()).not.toThrow();
  });

  it('should skip logging for /health endpoint', () => {
    const logSpy = jest.spyOn(middleware['logger'], 'log');
    const { req, res, next, triggerFinish } = createMocks('/health');
    middleware.use(req, res, next);
    triggerFinish();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('should skip logging for /ready endpoint', () => {
    const logSpy = jest.spyOn(middleware['logger'], 'log');
    const { req, res, next, triggerFinish } = createMocks('/ready');
    middleware.use(req, res, next);
    triggerFinish();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('should log for non-health endpoints', () => {
    const logSpy = jest.spyOn(middleware['logger'], 'log');
    const { req, res, next, triggerFinish } = createMocks('/api/users');
    middleware.use(req, res, next);
    triggerFinish();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'api_access',
        method: 'GET',
        url: '/api/users',
      }),
    );
  });

  it('should extract userId from req.user when present', () => {
    const logSpy = jest.spyOn(middleware['logger'], 'log');
    const { req, res, next, triggerFinish } = createMocks('/api/data', {
      user: { userId: 'user-123', orgId: 'org-456' },
    });
    middleware.use(req, res, next);
    triggerFinish();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        orgId: 'org-456',
      }),
    );
  });

  it('should default userId to anonymous when no user', () => {
    const logSpy = jest.spyOn(middleware['logger'], 'log');
    const { req, res, next, triggerFinish } = createMocks('/api/data');
    middleware.use(req, res, next);
    triggerFinish();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'anonymous',
      }),
    );
  });
});
