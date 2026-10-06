import { SecurityHeadersMiddleware } from './security-headers.middleware';

describe('SecurityHeadersMiddleware', () => {
  let middleware: SecurityHeadersMiddleware;

  beforeEach(() => {
    middleware = new SecurityHeadersMiddleware();
  });

  const createMocks = () => {
    const req = {} as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should call next()', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should set Strict-Transport-Security header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('should set X-Content-Type-Options header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
  });

  it('should set X-Frame-Options header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
  });

  it('should set X-XSS-Protection header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-XSS-Protection',
      '1; mode=block',
    );
  });

  it('should set Referrer-Policy header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Referrer-Policy',
      'strict-origin-when-cross-origin',
    );
  });

  it('should set Permissions-Policy header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(self)',
    );
  });

  it('should set X-DNS-Prefetch-Control header', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-DNS-Prefetch-Control', 'off');
  });

  it('should set all 7 security headers', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);
    expect(res.setHeader).toHaveBeenCalledTimes(7);
  });
});
