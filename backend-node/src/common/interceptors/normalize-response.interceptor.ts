import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Response normalization interceptor for API consistency.
 * Wraps all successful responses in a standard envelope:
 * { success: true, data: <response>, timestamp: <ISO string> }
 *
 * Skips wrapping if the response already has the envelope structure.
 */
@Injectable()
export class NormalizeResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // Skip if already wrapped
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }

        // Skip for null/undefined (e.g., 204 No Content)
        if (data === null || data === undefined) {
          return data;
        }

        return {
          success: true,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
