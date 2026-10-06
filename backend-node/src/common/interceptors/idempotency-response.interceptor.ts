import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Idempotency response interceptor.
 * Caches POST/PUT/PATCH responses by idempotency key (X-Idempotency-Key header).
 * Returns cached response for duplicate requests within the TTL window.
 * Prevents double charges, duplicate records, and race conditions.
 */
@Injectable()
export class IdempotencyResponseInterceptor
  implements NestInterceptor, OnModuleDestroy
{
  private readonly logger = new Logger(IdempotencyResponseInterceptor.name);
  private readonly cache = new Map<
    string,
    { data: any; status: number; expiry: number }
  >();
  private readonly ttlMs: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(ttlMinutes = 60) {
    this.ttlMs = ttlMinutes * 60 * 1000;
    // Cleanup expired entries every 10 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const method = req.method;

    // Only apply to mutating methods
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      return next.handle();
    }

    const idempotencyKey = req.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `${method}:${req.url}:${idempotencyKey}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      this.logger.debug(
        `Returning cached idempotent response for key: ${idempotencyKey}`,
      );
      res.setHeader('X-Idempotent-Replayed', 'true');
      res.status(cached.status);
      return of(cached.data);
    }

    return next.handle().pipe(
      tap((data) => {
        this.cache.set(cacheKey, {
          data,
          status: res.statusCode,
          expiry: Date.now() + this.ttlMs,
        });
      }),
    );
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiry <= now) {
        this.cache.delete(key);
      }
    }
  }
}
