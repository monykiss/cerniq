import { HttpStatus } from '@nestjs/common';
import { DatabaseConnectionFilter } from './database-connection.filter';

function makeHost(url = '/api/test', method = 'GET') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method, url }),
    }),
  } as any;
  return { host, json, status };
}

describe('DatabaseConnectionFilter', () => {
  let filter: DatabaseConnectionFilter;

  beforeEach(() => {
    filter = new DatabaseConnectionFilter();
  });

  it('returns 503 SERVICE_UNAVAILABLE for initialization errors', () => {
    const { host, status, json } = makeHost('/api/alm/institutions', 'POST');
    const error = { message: 'Prisma client initialization failed' } as any;

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DATABASE_UNAVAILABLE',
          message: expect.stringContaining('temporarily unavailable'),
        }),
      }),
    );
  });

  it('includes timestamp in response', () => {
    const { host, json } = makeHost();
    filter.catch({ message: 'DB error' } as any, host);
    const body = json.mock.calls[0][0];
    expect(body.error.timestamp).toBeDefined();
    expect(new Date(body.error.timestamp).toISOString()).toBe(
      body.error.timestamp,
    );
  });

  it('includes request URL as path', () => {
    const { host, json } = makeHost('/api/organizations/123');
    filter.catch({ message: 'Connection lost' } as any, host);
    const body = json.mock.calls[0][0];
    expect(body.error.path).toBe('/api/organizations/123');
  });

  it('always sets success: false', () => {
    const { host, json } = makeHost();
    filter.catch({ message: 'Rust panic' } as any, host);
    expect(json.mock.calls[0][0].success).toBe(false);
  });

  it('handles errors with empty message', () => {
    const { host, status } = makeHost();
    filter.catch({ message: '' } as any, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('returns retry message', () => {
    const { host, json } = makeHost();
    filter.catch({ message: 'Cannot connect' } as any, host);
    const body = json.mock.calls[0][0];
    expect(body.error.message).toContain('retry');
  });
});
