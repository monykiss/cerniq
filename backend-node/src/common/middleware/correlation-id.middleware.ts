import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Correlation ID middleware for distributed tracing.
 * Generates or propagates a correlation ID through the entire request chain.
 * Sets X-Correlation-ID on both request and response for end-to-end tracing.
 * Different from request ID: correlation ID spans multiple services.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Propagate existing correlation ID or generate a new one
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-trace-id'] as string) ||
      randomUUID();

    // Attach to request for downstream access
    (req as any).correlationId = correlationId;
    req.headers['x-correlation-id'] = correlationId;

    // Echo back in response for client-side debugging
    res.setHeader('X-Correlation-ID', correlationId);

    next();
  }
}
