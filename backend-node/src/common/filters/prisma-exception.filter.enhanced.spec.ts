import { PrismaExceptionFilter } from './prisma-exception.filter';
import { ArgumentsHost, HttpStatus } from '@nestjs/common';

describe('PrismaExceptionFilter (enhanced)', () => {
  let filter: PrismaExceptionFilter;
  let mockResponse: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ method: 'POST', url: '/api/test' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('maps P2002 to 409 CONFLICT with field names', () => {
    const exception = {
      code: 'P2002',
      message: 'Unique constraint failed on the fields: (`email`)',
      meta: { target: ['email'] },
    };
    filter.catch(exception as any, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DUPLICATE_ENTRY',
          message: expect.stringContaining('email'),
        }),
      }),
    );
  });

  it('maps P2025 to 404 NOT_FOUND', () => {
    const exception = { code: 'P2025', message: 'Record not found', meta: {} };
    filter.catch(exception as any, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    );
  });

  it('maps P2003 to 400 FOREIGN_KEY_VIOLATION', () => {
    const exception = {
      code: 'P2003',
      message: 'Foreign key constraint failed',
      meta: {},
    };
    filter.catch(exception as any, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FOREIGN_KEY_VIOLATION' }),
      }),
    );
  });

  it('maps P2014 to 400 RELATION_VIOLATION', () => {
    const exception = {
      code: 'P2014',
      message: 'Required relation violation',
      meta: {},
    };
    filter.catch(exception as any, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'RELATION_VIOLATION' }),
      }),
    );
  });

  it('maps unknown Prisma codes to 500 DATABASE_ERROR', () => {
    const exception = { code: 'P9999', message: 'Unknown error', meta: {} };
    filter.catch(exception as any, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'DATABASE_ERROR' }),
      }),
    );
  });

  it('includes timestamp and path in response', () => {
    const exception = { code: 'P2025', message: 'Not found', meta: {} };
    filter.catch(exception as any, mockHost);
    const responseBody = mockResponse.json.mock.calls[0][0];
    expect(responseBody.error.timestamp).toBeDefined();
    expect(responseBody.error.path).toBe('/api/test');
  });

  it('handles P2002 with multiple target fields', () => {
    const exception = {
      code: 'P2002',
      message: 'Unique constraint',
      meta: { target: ['org_id', 'email'] },
    };
    filter.catch(exception as any, mockHost);
    const responseBody = mockResponse.json.mock.calls[0][0];
    expect(responseBody.error.message).toContain('org_id, email');
  });

  it('handles P2002 with missing meta target gracefully', () => {
    const exception = {
      code: 'P2002',
      message: 'Unique constraint',
      meta: {},
    };
    filter.catch(exception as any, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const responseBody = mockResponse.json.mock.calls[0][0];
    expect(responseBody.error.message).toContain('field');
  });
});
