import { JsonBodyLimitMiddleware } from './json-body-limit.middleware';

describe('JsonBodyLimitMiddleware', () => {
  let middleware: JsonBodyLimitMiddleware;
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.MAX_JSON_BODY_KB;
    middleware = new JsonBodyLimitMiddleware();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createMocks = (headers: Record<string, string> = {}) => {
    const req = {
      headers,
      method: 'POST',
      url: '/api/test',
      ip: '127.0.0.1',
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should call next() when content-length is within limit', () => {
    const { req, res, next } = createMocks({
      'content-type': 'application/json',
      'content-length': '1024', // 1KB
    });
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should reject oversized JSON body with 413', () => {
    const { req, res, next } = createMocks({
      'content-type': 'application/json',
      'content-length': String(2 * 1024 * 1024), // 2MB, exceeds default 1024KB
    });
    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'PAYLOAD_TOO_LARGE',
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() for non-JSON content types', () => {
    const { req, res, next } = createMocks({
      'content-type': 'text/plain',
      'content-length': String(10 * 1024 * 1024), // 10MB
    });
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should call next() when no content-length header is present', () => {
    const { req, res, next } = createMocks({
      'content-type': 'application/json',
    });
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should call next() when no content-type header is present', () => {
    const { req, res, next } = createMocks({
      'content-length': String(10 * 1024 * 1024),
    });
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should use custom limit from MAX_JSON_BODY_KB env var', () => {
    process.env.MAX_JSON_BODY_KB = '10'; // 10KB limit
    const customMiddleware = new JsonBodyLimitMiddleware();

    const { req, res, next } = createMocks({
      'content-type': 'application/json',
      'content-length': String(20 * 1024), // 20KB
    });
    customMiddleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });
});
