import { ValidationExceptionFilter } from './validation-exception.filter';
import { BadRequestException, HttpStatus } from '@nestjs/common';

describe('ValidationExceptionFilter (enhanced)', () => {
  let filter: ValidationExceptionFilter;
  let mockResponse: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new ValidationExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ url: '/api/institutions' }),
      }),
    };
  });

  it('formats class-validator errors as 422 UNPROCESSABLE_ENTITY', () => {
    const exception = new BadRequestException({
      message: ['name should not be empty', 'email must be an email'],
    });
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });

  it('returns VALIDATION_ERROR code for array messages', () => {
    const exception = new BadRequestException({
      message: ['field is required'],
    });
    filter.catch(exception, mockHost);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      }),
    );
  });

  it('includes details array with field and message', () => {
    const exception = new BadRequestException({
      message: ['email must be an email'],
    });
    filter.catch(exception, mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'email must be an email' }),
      ]),
    );
  });

  it('passes non-validation BadRequests as 400 BAD_REQUEST', () => {
    const exception = new BadRequestException('Invalid input data');
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'BAD_REQUEST' }),
      }),
    );
  });

  it('includes path in error response', () => {
    const exception = new BadRequestException({
      message: ['test error'],
    });
    filter.catch(exception, mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.path).toBe('/api/institutions');
  });

  it('converts camelCase field names to readable format', () => {
    const exception = new BadRequestException({
      message: ['institutionName should not be empty'],
    });
    filter.catch(exception, mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    const detail = body.error.details[0];
    expect(detail.field).toContain('institution');
  });

  it('includes timestamp in response', () => {
    const exception = new BadRequestException({
      message: ['test error'],
    });
    filter.catch(exception, mockHost);
    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.timestamp).toBeDefined();
  });

  it('handles BadRequestException with object message (not array)', () => {
    const exception = new BadRequestException({
      message: 'simple string message',
    });
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });
});
