import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Formats class-validator / ValidationPipe errors into
 * human-readable, structured error messages.
 * Groups errors by field and provides actionable feedback.
 */
@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const exceptionResponse = exception.getResponse() as any;

    // Only intercept validation errors from class-validator
    if (
      !exceptionResponse?.message ||
      !Array.isArray(exceptionResponse.message)
    ) {
      response.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: exceptionResponse?.message || 'Bad request',
          timestamp: new Date().toISOString(),
          path: request.url,
        },
      });
      return;
    }

    const formattedErrors = this.formatErrors(exceptionResponse.message);

    response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'One or more fields failed validation',
        details: formattedErrors,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }

  private formatErrors(
    messages: string[],
  ): Array<{ field: string; message: string }> {
    return messages.map((msg) => {
      // class-validator messages often follow pattern: "fieldName constraint message"
      const parts = msg.split(' ');
      const field = parts[0] || 'unknown';
      return {
        field: this.camelToReadable(field),
        message: msg,
      };
    });
  }

  private camelToReadable(str: string): string {
    return str
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .toLowerCase();
  }
}
