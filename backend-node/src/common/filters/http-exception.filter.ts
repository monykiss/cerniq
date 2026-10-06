import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Response } from 'express';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    path: string;
    /**
     * Request ID for support triage — mirrors `X-Request-ID` response
     * header (set by RequestIdMiddleware). Including in the error body
     * lets customers paste a single error message into a support ticket
     * without having to separately copy the response header. Ops then
     * greps Pino logs: `railway logs | grep <requestId>`.
     */
    requestId?: string;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const obj = exResponse as any;
        message = obj.message || message;
        if (typeof obj.code === 'string' && obj.code.trim()) {
          code = obj.code;
        }
        details = obj.errors || obj.details;
        if (!details) {
          const passthrough = { ...obj };
          delete passthrough.code;
          delete passthrough.message;
          delete passthrough.statusCode;
          if (Object.keys(passthrough).length > 0) {
            details = passthrough;
          }
        }
      }
      if (!code || code === 'INTERNAL_ERROR') {
        code = this.statusToCode(status);
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );
      // Report unhandled errors to Sentry with request context
      Sentry.captureException(exception, {
        extra: { path: request.url, method: request.method },
      });
      // Never leak internal error details to clients in production
      message =
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred. Please try again or contact support.'
          : exception.message;
    }

    // Pull the request ID from either the middleware's set field
    // (`req.id`) or the echo'd header. Absent → omit from payload
    // (won't appear as `"requestId": undefined` in JSON).
    const requestId: string | undefined =
      request.id || request.headers?.['x-request-id'] || undefined;

    const errorResponse: ApiErrorResponse = {
      success: false,
      error: {
        code,
        message: Array.isArray(message) ? message.join('; ') : message,
        details,
        timestamp: new Date().toISOString(),
        path: request.url,
        ...(requestId ? { requestId } : {}),
      },
    };

    response.status(status).json(errorResponse);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return map[status] || 'UNKNOWN_ERROR';
  }
}
