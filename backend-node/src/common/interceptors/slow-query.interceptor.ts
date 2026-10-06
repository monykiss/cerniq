import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import * as Sentry from '@sentry/nestjs';

const SLOW_THRESHOLD_MS = parseInt(
  process.env.SLOW_REQUEST_THRESHOLD_MS || '3000',
  10,
);

/**
 * Logs and reports any request that takes longer than SLOW_REQUEST_THRESHOLD_MS.
 * Enterprise visibility into performance bottlenecks.
 */
@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger('SlowRequest');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    const route = `${req.method} ${req.url}`;

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - start;
        if (elapsed > SLOW_THRESHOLD_MS) {
          this.logger.warn(
            `Slow request: ${route} took ${elapsed}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`,
          );
          Sentry.captureMessage(`Slow request: ${route} (${elapsed}ms)`, {
            level: 'warning',
            tags: { type: 'slow_request', route: req.url, method: req.method },
            extra: { elapsedMs: elapsed, threshold: SLOW_THRESHOLD_MS },
          });
        }
      }),
    );
  }
}
