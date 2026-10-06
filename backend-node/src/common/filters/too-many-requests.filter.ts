import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

/**
 * Custom exception filter for 429 Too Many Requests responses.
 * Provides a structured JSON response with retry information
 * and logs rate-limit events for monitoring.
 */
@Catch()
export class TooManyRequestsFilter implements ExceptionFilter {
  private readonly logger = new Logger(TooManyRequestsFilter.name);

  catch(exception: HttpException | Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Only handle 429 errors; re-throw others
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status !== HttpStatus.TOO_MANY_REQUESTS) {
      // Not a rate-limit error — let other filters handle it
      if (exception instanceof HttpException) {
        response.status(status).json(exception.getResponse());
      } else {
        response.status(500).json({ message: 'Internal server error' });
      }
      return;
    }

    const retryAfter = response.getHeader('Retry-After') || '60';

    this.logger.warn(
      `Rate limit exceeded: ${request.method} ${request.originalUrl} from ${request.ip}`,
    );

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down and retry later.',
      retryAfterSeconds: Number(retryAfter),
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }
}
