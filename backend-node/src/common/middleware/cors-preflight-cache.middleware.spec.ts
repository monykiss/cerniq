import { CorsPreflightCacheMiddleware } from './cors-preflight-cache.middleware';

describe('CorsPreflightCacheMiddleware', () => {
  let middleware: CorsPreflightCacheMiddleware;

  beforeEach(() => {
    middleware = new CorsPreflightCacheMiddleware();
  });

  const createMocks = (method: string) => {
    const req = { method } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should set Access-Control-Max-Age header for OPTIONS requests', () => {
    const { req, res, next } = createMocks('OPTIONS');
    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Access-Control-Max-Age',
      '3600',
    );
    expect(next).toHaveBeenCalled();
  });

  it('should not set Access-Control-Max-Age header for GET requests', () => {
    const { req, res, next } = createMocks('GET');
    middleware.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('should not set Access-Control-Max-Age header for POST requests', () => {
    const { req, res, next } = createMocks('POST');
    middleware.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('should always call next()', () => {
    const { req, res, next } = createMocks('OPTIONS');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();

    const mocks2 = createMocks('PUT');
    middleware.use(mocks2.req, mocks2.res, mocks2.next);
    expect(mocks2.next).toHaveBeenCalled();
  });
});
