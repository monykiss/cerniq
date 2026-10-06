import { PrismaExceptionFilter } from './prisma-exception.filter';
import { ArgumentsHost, HttpStatus } from '@nestjs/common';

function makeHost(url = '/api/users'): {
  host: ArgumentsHost;
  json: jest.Mock;
  status: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

function makePrismaError(
  code: string,
  message = 'Prisma error',
  meta?: Record<string, unknown>,
) {
  return { code, message, meta: meta ?? {} } as any;
}

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
  });

  // ── P2002: Unique constraint ─────────────────────────────────

  it('maps P2002 with target fields to 409 CONFLICT with joined field names', () => {
    const { host, json, status } = makeHost();
    const error = makePrismaError('P2002', 'Unique constraint failed', {
      target: ['email', 'orgId'],
    });
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this email, orgId already exists',
        }),
      }),
    );
  });

  it('maps P2002 with single target field', () => {
    const { host, json, status } = makeHost();
    const error = makePrismaError('P2002', 'Unique constraint failed', {
      target: ['slug'],
    });
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = json.mock.calls[0][0];
    expect(body.error.message).toBe('A record with this slug already exists');
  });

  it('maps P2002 without target meta to fallback "field"', () => {
    const { host, json, status } = makeHost();
    const error = makePrismaError('P2002', 'Unique constraint failed', {});
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = json.mock.calls[0][0];
    expect(body.error.message).toBe('A record with this field already exists');
  });

  it('maps P2002 with undefined meta to fallback "field"', () => {
    const { host, json } = makeHost();
    const error = { code: 'P2002', message: 'err', meta: undefined } as any;
    filter.catch(error, host);
    const body = json.mock.calls[0][0];
    expect(body.error.message).toBe('A record with this field already exists');
  });

  // ── P2025: Not found ─────────────────────────────────────────

  it('maps P2025 to 404 NOT_FOUND', () => {
    const { host, json, status } = makeHost();
    filter.catch(makePrismaError('P2025'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('The requested record was not found');
  });

  // ── P2003: Foreign key violation ─────────────────────────────

  it('maps P2003 to 400 BAD_REQUEST with FOREIGN_KEY_VIOLATION', () => {
    const { host, json, status } = makeHost();
    filter.catch(makePrismaError('P2003'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('FOREIGN_KEY_VIOLATION');
    expect(body.error.message).toBe('Referenced record does not exist');
  });

  // ── P2014: Relation violation ────────────────────────────────

  it('maps P2014 to 400 BAD_REQUEST with RELATION_VIOLATION', () => {
    const { host, json, status } = makeHost();
    filter.catch(makePrismaError('P2014'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('RELATION_VIOLATION');
    expect(body.error.message).toBe(
      'This change would violate a required relation',
    );
  });

  // ── Unknown / default ────────────────────────────────────────

  it('maps unknown codes to 500 DATABASE_ERROR', () => {
    const { host, json, status } = makeHost();
    filter.catch(makePrismaError('P9999'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('DATABASE_ERROR');
    expect(body.error.message).toBe('A database error occurred');
  });

  it('maps P2001 (not a handled code) to 500', () => {
    const { host, status } = makeHost();
    filter.catch(makePrismaError('P2001'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  // ── Response shape ───────────────────────────────────────────

  it('includes ISO timestamp in response', () => {
    const { host, json } = makeHost();
    filter.catch(makePrismaError('P2025'), host);
    const body = json.mock.calls[0][0];
    expect(body.error.timestamp).toBeDefined();
    expect(new Date(body.error.timestamp).toISOString()).toBe(
      body.error.timestamp,
    );
  });

  it('includes correct path from request url', () => {
    const { host, json } = makeHost('/api/organizations/123');
    filter.catch(makePrismaError('P2025'), host);
    const body = json.mock.calls[0][0];
    expect(body.error.path).toBe('/api/organizations/123');
  });

  it('always sets success: false', () => {
    const { host, json } = makeHost();
    filter.catch(makePrismaError('P2003'), host);
    expect(json.mock.calls[0][0].success).toBe(false);
  });
});
