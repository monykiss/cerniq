import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';

/**
 * Idempotency key middleware for mutation endpoints.
 * Clients send X-Idempotency-Key header; we cache the response for 24h.
 * Prevents duplicate billing charges, duplicate report generation, etc.
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Idempotency');
  private readonly TTL_SECONDS = 86400; // 24 hours

  constructor(private readonly cache: CacheService) {}

  async use(req: any, res: any, next: () => void) {
    // Only apply to POST/PUT/PATCH (mutations)
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return next(); // No key = no idempotency protection
    }

    const cacheKey = `idempotency:${idempotencyKey}`;

    try {
      const cached = await this.cache.get<{ status: number; body: any }>(
        cacheKey,
      );
      if (cached) {
        this.logger.log(`Idempotency hit: ${idempotencyKey}`);
        res.status(cached.status || 200).json(cached.body);
        return;
      }
    } catch {
      // Cache miss or error — proceed normally
    }

    // Intercept the response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Cache the response
      this.cache
        .set(cacheKey, { status: res.statusCode, body }, this.TTL_SECONDS)
        .catch(() => {});
      return originalJson(body);
    };

    next();
  }
}
