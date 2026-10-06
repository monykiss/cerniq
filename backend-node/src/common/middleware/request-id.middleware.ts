import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Assigns a unique X-Request-ID to every request.
 * Propagated through logs (Pino), Sentry breadcrumbs, and response headers.
 * Enables end-to-end request tracing across frontend → backend → DB.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    req.id = requestId;
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  }
}
