import { PathTraversalMiddleware } from './path-traversal.middleware';
import { BadRequestException } from '@nestjs/common';

describe('PathTraversalMiddleware', () => {
  let middleware: PathTraversalMiddleware;

  beforeEach(() => {
    middleware = new PathTraversalMiddleware();
  });

  const createMocks = (
    originalUrl: string,
    query: Record<string, string> = {},
  ) => {
    const req = { originalUrl, query } as any;
    const res = {} as any;
    const next = jest.fn();
    return { req, res, next };
  };

  it('should call next() for safe URLs', () => {
    const { req, res, next } = createMocks('/api/users/123');
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should throw BadRequestException for ../ in URL', () => {
    const { req, res, next } = createMocks('/api/../etc/passwd');
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
    expect(() => middleware.use(req, res, next)).toThrow(
      'Path traversal detected',
    );
  });

  it('should throw BadRequestException for ..\\ in URL', () => {
    const { req, res, next } = createMocks('/api/..\\etc\\passwd');
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
  });

  it('should throw BadRequestException for URL-encoded ..', () => {
    const { req, res, next } = createMocks('/api/%2e%2e/etc/passwd');
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
  });

  it('should throw BadRequestException for double-encoded ..', () => {
    const { req, res, next } = createMocks('/api/%252e%252e/etc/passwd');
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
  });

  it('should throw BadRequestException for null byte in URL', () => {
    const { req, res, next } = createMocks('/api/file%00.txt');
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
  });

  it('should throw BadRequestException for path traversal in query params', () => {
    const { req, res, next } = createMocks('/api/search', {
      path: '../etc/passwd',
    });
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
  });

  it('should allow safe query params', () => {
    const { req, res, next } = createMocks('/api/search', {
      q: 'hello world',
      page: '1',
    });
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should throw for null byte in query params', () => {
    const { req, res, next } = createMocks('/api/search', {
      file: 'test%00.txt',
    });
    expect(() => middleware.use(req, res, next)).toThrow(BadRequestException);
  });
});
