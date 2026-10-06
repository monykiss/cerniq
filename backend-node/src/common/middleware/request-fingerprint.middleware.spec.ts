import { RequestFingerprintMiddleware } from './request-fingerprint.middleware';

describe('RequestFingerprintMiddleware', () => {
  let middleware: RequestFingerprintMiddleware;

  beforeEach(() => {
    middleware = new RequestFingerprintMiddleware();
  });

  const createMocks = (headers: Record<string, string> = {}, ip?: string) => {
    const req = { headers, ip } as any;
    const res = {} as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should generate a fingerprint and attach it to the request', () => {
    const { req, res, next } = createMocks(
      {
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'en-US',
        'accept-encoding': 'gzip',
        accept: 'text/html',
      },
      '127.0.0.1',
    );
    middleware.use(req, res, next);

    expect(req.fingerprint).toBeDefined();
    expect(typeof req.fingerprint).toBe('string');
    expect(req.fingerprint.length).toBe(16);
    expect(next).toHaveBeenCalled();
  });

  it('should produce consistent fingerprints for identical requests', () => {
    const headers = {
      'user-agent': 'Mozilla/5.0',
      'accept-language': 'en-US',
      'accept-encoding': 'gzip',
      accept: 'text/html',
    };

    const mocks1 = createMocks(headers, '10.0.0.1');
    middleware.use(mocks1.req, mocks1.res, mocks1.next);

    const mocks2 = createMocks(headers, '10.0.0.1');
    middleware.use(mocks2.req, mocks2.res, mocks2.next);

    expect(mocks1.req.fingerprint).toBe(mocks2.req.fingerprint);
  });

  it('should produce different fingerprints for different user agents', () => {
    const mocks1 = createMocks({ 'user-agent': 'Chrome/100' }, '10.0.0.1');
    middleware.use(mocks1.req, mocks1.res, mocks1.next);

    const mocks2 = createMocks({ 'user-agent': 'Firefox/100' }, '10.0.0.1');
    middleware.use(mocks2.req, mocks2.res, mocks2.next);

    expect(mocks1.req.fingerprint).not.toBe(mocks2.req.fingerprint);
  });

  it('should handle missing headers gracefully', () => {
    const { req, res, next } = createMocks({});
    middleware.use(req, res, next);

    expect(req.fingerprint).toBeDefined();
    expect(req.fingerprint.length).toBe(16);
    expect(next).toHaveBeenCalled();
  });

  it('should produce different fingerprints for different IPs', () => {
    const headers = { 'user-agent': 'Same Agent' };
    const mocks1 = createMocks(headers, '10.0.0.1');
    middleware.use(mocks1.req, mocks1.res, mocks1.next);

    const mocks2 = createMocks(headers, '10.0.0.2');
    middleware.use(mocks2.req, mocks2.res, mocks2.next);

    expect(mocks1.req.fingerprint).not.toBe(mocks2.req.fingerprint);
  });
});
