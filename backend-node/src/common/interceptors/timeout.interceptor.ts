import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * Request timeout interceptor.
 * Default: 30s for normal requests.
 * Compute-heavy endpoints (Monte Carlo, stress testing) get 120s.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const COMPUTE_TIMEOUT_MS = 120_000;

const COMPUTE_PATTERNS = [
  '/monte-carlo/',
  '/stress-test',
  '/stress-v2/',
  '/cvar-optimize',
  '/cecl/',
  '/black-litterman',
  '/portfolio-var',
];

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const url = req.url || '';

    const isCompute = COMPUTE_PATTERNS.some((p: string) => url.includes(p));
    const ms = isCompute ? COMPUTE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    return next.handle().pipe(
      timeout(ms),
      catchError((err: any) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                `Request timed out after ${ms / 1000}s. For compute-heavy operations, consider reducing input parameters.`,
              ),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
