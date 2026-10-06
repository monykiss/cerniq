import { ValidationExceptionFilter } from './validation-exception.filter';
import { BadRequestException, ArgumentsHost, HttpStatus } from '@nestjs/common';

function makeHost(url = '/api/test'): {
  host: ArgumentsHost;
  json: jest.Mock;
  status: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('ValidationExceptionFilter', () => {
  let filter: ValidationExceptionFilter;

  beforeEach(() => {
    filter = new ValidationExceptionFilter();
  });

  // ── Array messages (class-validator) ─────────────────────────

  it('formats class-validator errors as 422 with details', () => {
    const { host, json, status } = makeHost();
    const exception = new BadRequestException({
      message: ['email must be an email', 'name should not be empty'],
    });
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'One or more fields failed validation',
          details: expect.arrayContaining([
            expect.objectContaining({ message: 'email must be an email' }),
          ]),
        }),
      }),
    );
  });

  it('returns correct number of detail entries for multiple errors', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException({
      message: ['a is wrong', 'b is wrong', 'c is wrong'],
    });
    filter.catch(exception, host);
    const body = json.mock.calls[0][0];
    expect(body.error.details).toHaveLength(3);
  });

  it('handles empty message array as 422 with zero details', () => {
    const { host, json, status } = makeHost();
    const exception = new BadRequestException({ message: [] });
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json.mock.calls[0][0].error.details).toHaveLength(0);
  });

  // ── camelToReadable (via formatErrors) ───────────────────────

  it('converts camelCase field to readable lowercase', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException({
      message: ['firstName must not be empty'],
    });
    filter.catch(exception, host);
    expect(json.mock.calls[0][0].error.details[0].field).toBe('first name');
  });

  it('handles single-word field names without change', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException({
      message: ['email is required'],
    });
    filter.catch(exception, host);
    expect(json.mock.calls[0][0].error.details[0].field).toBe('email');
  });

  it('handles multi-camelCase words', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException({
      message: ['myLongFieldName must be valid'],
    });
    filter.catch(exception, host);
    expect(json.mock.calls[0][0].error.details[0].field).toBe(
      'my long field name',
    );
  });

  it('handles empty-string message with "unknown" field', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException({ message: [''] });
    filter.catch(exception, host);
    // parts[0] is '' which is falsy => 'unknown'
    // Actually, ''.split(' ')[0] is '' which is falsy
    expect(json.mock.calls[0][0].error.details[0].field).toBe('unknown');
  });

  // ── Non-array messages (plain BadRequest) ────────────────────

  it('passes through string BadRequest as 400', () => {
    const { host, json, status } = makeHost();
    const exception = new BadRequestException('Something went wrong');
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Something went wrong',
        }),
      }),
    );
  });

  it('passes through object with non-array message as 400', () => {
    const { host, json, status } = makeHost();
    const exception = new BadRequestException({
      message: 'Not an array',
    });
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].error.message).toBe('Not an array');
  });

  it('defaults to "Bad request" when message is undefined', () => {
    const { host, json, status } = makeHost();
    const exception = new BadRequestException({ message: undefined });
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].error.message).toBe('Bad request');
  });

  it('defaults to "Bad request" when response has no message property', () => {
    const { host, json, status } = makeHost();
    const exception = new BadRequestException({ foo: 'bar' });
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].error.message).toBe('Bad request');
  });

  // ── Timestamp / Path ─────────────────────────────────────────

  it('includes ISO timestamp in validation-error response', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException({ message: ['x is bad'] });
    filter.catch(exception, host);
    const ts = json.mock.calls[0][0].error.timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('includes ISO timestamp in bad-request response', () => {
    const { host, json } = makeHost();
    const exception = new BadRequestException('oops');
    filter.catch(exception, host);
    const ts = json.mock.calls[0][0].error.timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('includes request URL as path', () => {
    const { host, json } = makeHost('/api/v1/analyze');
    const exception = new BadRequestException('err');
    filter.catch(exception, host);
    expect(json.mock.calls[0][0].error.path).toBe('/api/v1/analyze');
  });
});
