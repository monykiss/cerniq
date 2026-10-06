import { ApiVersionMiddleware } from './api-version.middleware';

describe('ApiVersionMiddleware', () => {
  let middleware: ApiVersionMiddleware;

  beforeEach(() => {
    middleware = new ApiVersionMiddleware();
  });

  const createMocks = (headers: Record<string, string> = {}) => {
    const req = { headers } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should set X-API-Version header on response', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '1.0');
  });

  it('should set X-Supported-Versions header on response', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-Supported-Versions', '1.0');
  });

  it('should call next()', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should default to current version when no Accept-Version header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '1.0');
    expect(next).toHaveBeenCalled();
  });

  it('should accept supported version without warning', () => {
    const { req, res, next } = createMocks({ 'accept-version': '1.0' });
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '1.0');
    expect(next).toHaveBeenCalled();
  });

  it('should still call next for unsupported version requests', () => {
    const { req, res, next } = createMocks({ 'accept-version': '2.0' });
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', '1.0');
  });
});
