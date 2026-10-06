import {
  HttpException,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ url: '/api/test', method: 'GET' }),
      }),
    };
  });

  it('handles HttpException with correct status and code', () => {
    filter.catch(new BadRequestException('Invalid input'), mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'BAD_REQUEST' }),
      }),
    );
  });

  it('handles NotFoundException', () => {
    filter.catch(new NotFoundException('Resource not found'), mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    );
  });

  it('handles ForbiddenException', () => {
    filter.catch(new ForbiddenException('Access denied'), mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FORBIDDEN' }),
      }),
    );
  });

  it('returns 500 for unknown errors', () => {
    filter.catch(new Error('DB connection lost'), mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      }),
    );
  });

  it('includes timestamp and path in response', () => {
    filter.catch(new BadRequestException('test'), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.timestamp).toBeDefined();
    expect(body.error.path).toBe('/api/test');
  });

  it('joins array messages', () => {
    filter.catch(
      new BadRequestException({
        message: ['field1 invalid', 'field2 required'],
      }),
      mockHost,
    );
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toContain('field1 invalid');
    expect(body.error.message).toContain('field2 required');
  });

  it('includes details from validation errors', () => {
    filter.catch(
      new BadRequestException({
        message: 'Validation failed',
        errors: [{ field: 'email' }],
      }),
      mockHost,
    );
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.details).toEqual([{ field: 'email' }]);
  });

  it('never leaks internal error messages in production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    filter.catch(new Error('secret internal detail'), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).not.toContain('secret internal detail');
    expect(body.error.message).toContain('unexpected error');
    process.env.NODE_ENV = origEnv;
  });

  it('handles non-Error thrown values', () => {
    filter.catch('string error', mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
  });

  it('shows actual error message in non-production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    filter.catch(new Error('debug detail exposed'), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toContain('debug detail exposed');
    process.env.NODE_ENV = origEnv;
  });

  it('handles HttpException with string response', () => {
    filter.catch(new HttpException('simple string error', 422), mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(422);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toBe('simple string error');
    expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('maps 409 status to CONFLICT code', () => {
    filter.catch(new HttpException('Conflict', 409), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.code).toBe('CONFLICT');
  });

  it('maps 429 status to TOO_MANY_REQUESTS code', () => {
    filter.catch(new HttpException('Too many requests', 429), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('maps 401 status to UNAUTHORIZED code', () => {
    filter.catch(new HttpException('Unauthorized', 401), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('maps unknown status to UNKNOWN_ERROR code', () => {
    filter.catch(new HttpException('Teapot', 418), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.code).toBe('UNKNOWN_ERROR');
  });

  it('handles HttpException with details field in object response', () => {
    filter.catch(
      new HttpException(
        { message: 'Validation', details: { field: 'name' } },
        400,
      ),
      mockHost,
    );
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.details).toEqual({ field: 'name' });
  });

  it('always sets success to false', () => {
    filter.catch(new Error('test'), mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.success).toBe(false);
  });
});
