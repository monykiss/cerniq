import { HttpException, HttpStatus } from '@nestjs/common';
import { TooManyRequestsFilter } from './too-many-requests.filter';

function makeHost(url = '/api/test') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const getHeader = jest.fn().mockReturnValue('60');
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, getHeader }),
      getRequest: () => ({ method: 'GET', originalUrl: url, ip: '127.0.0.1' }),
    }),
  } as any;
  return { host, json, status, getHeader };
}

describe('TooManyRequestsFilter', () => {
  let filter: TooManyRequestsFilter;

  beforeEach(() => {
    filter = new TooManyRequestsFilter();
  });

  // ── 429 rate limit response ─────────────────────────────────

  it('returns 429 structured response for rate limit errors', () => {
    const { host, status, json } = makeHost('/api/alm/analysis');
    const exception = new HttpException(
      'Too Many Requests',
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        error: 'Too Many Requests',
        message: expect.stringContaining('Rate limit exceeded'),
        retryAfterSeconds: 60,
        path: '/api/alm/analysis',
      }),
    );
  });

  it('includes timestamp in 429 response', () => {
    const { host, json } = makeHost();
    const exception = new HttpException(
      'Too Many Requests',
      HttpStatus.TOO_MANY_REQUESTS,
    );
    filter.catch(exception, host);
    const body = json.mock.calls[0][0];
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('uses Retry-After header value as retryAfterSeconds', () => {
    const { host, json, getHeader } = makeHost();
    getHeader.mockReturnValue('120');
    const exception = new HttpException(
      'Too Many',
      HttpStatus.TOO_MANY_REQUESTS,
    );
    filter.catch(exception, host);
    expect(json.mock.calls[0][0].retryAfterSeconds).toBe(120);
  });

  it('defaults retryAfterSeconds to 60 when header missing', () => {
    const { host, json, getHeader } = makeHost();
    getHeader.mockReturnValue(undefined);
    const exception = new HttpException(
      'Too Many',
      HttpStatus.TOO_MANY_REQUESTS,
    );
    filter.catch(exception, host);
    expect(json.mock.calls[0][0].retryAfterSeconds).toBe(60);
  });

  // ── Pass-through for non-429 errors ─────────────────────────

  it('passes through HttpException with non-429 status', () => {
    const { host, status, json } = makeHost();
    const exception = new HttpException(
      { message: 'Bad request' },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bad request' }),
    );
  });

  it('passes through 404 HttpException', () => {
    const { host, status } = makeHost();
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('passes through 500 for plain Error objects', () => {
    const { host, status, json } = makeHost();
    const error = new Error('Something broke');
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error' }),
    );
  });

  it('returns 500 for non-HttpException errors (string thrown)', () => {
    const { host, status, json } = makeHost();
    filter.catch('random string error' as any, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error' }),
    );
  });
});
