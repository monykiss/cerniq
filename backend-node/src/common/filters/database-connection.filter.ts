import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Catch Prisma connection and initialization errors.
 * Returns a 503 Service Unavailable when the database is unreachable,
 * providing clear operational signals for load balancers and monitoring.
 */
@Catch(
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class DatabaseConnectionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseConnectionFilter.name);

  catch(
    exception:
      | Prisma.PrismaClientInitializationError
      | Prisma.PrismaClientRustPanicError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    this.logger.error(
      `Database connection error on ${request.method} ${request.url}: ${exception.message}`,
    );

    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message:
          'The service is temporarily unavailable. Please retry shortly.',
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }
}
