import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import * as Sentry from '@sentry/nestjs';

/**
 * Distributed correlation interceptor.
 * Propagates X-Request-ID through Sentry breadcrumbs and response headers
 * for end-to-end tracing across frontend → proxy → backend → DB.
 *
 * Fortune 500 requirement: every request must be traceable from
 * the user's browser to the database query and back.
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const requestId = req.headers['x-request-id'] || req.id;
    const startTime = Date.now();

    // Set Sentry context for this request
    if (requestId) {
      Sentry.setTag('request_id', requestId);
      Sentry.setContext('request', {
        id: requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
    }

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        // Add timing headers for client-side performance monitoring
        res.setHeader('X-Response-Time', `${duration}ms`);
        res.setHeader('Server-Timing', `total;dur=${duration}`);
      }),
    );
  }
}
