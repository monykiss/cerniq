import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Sets appropriate Cache-Control headers based on endpoint type.
 * - GET /health, /ready: no-cache (always fresh)
 * - GET /api/v1/docs: 1 hour cache (Swagger UI)
 * - GET /api/market-data: 60s cache (market data freshness)
 * - Other GET: private, no-cache (default for authenticated APIs)
 * - Mutations: no-store
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap(() => {
        if (req.method !== 'GET') {
          res.setHeader('Cache-Control', 'no-store');
          return;
        }

        const url = req.url || '';
        if (url.includes('/health') || url.includes('/ready')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (url.includes('/api/v1/docs')) {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (url.includes('/market-data')) {
          res.setHeader('Cache-Control', 'private, max-age=60');
        } else {
          res.setHeader('Cache-Control', 'private, no-cache');
        }
      }),
    );
  }
}
