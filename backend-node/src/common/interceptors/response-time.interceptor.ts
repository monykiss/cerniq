import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Adds X-Response-Time header to every response.
 * Measures wall-clock time from request entry to response completion.
 * Useful for client-side performance monitoring and SLA tracking.
 */
@Injectable()
export class ResponseTimeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = process.hrtime.bigint();
    const res = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap(() => {
        const elapsed = process.hrtime.bigint() - start;
        const ms = Number(elapsed) / 1_000_000;
        res.setHeader('X-Response-Time', `${ms.toFixed(2)}ms`);
      }),
    );
  }
}
