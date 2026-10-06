import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Caches CORS preflight (OPTIONS) responses for 1 hour.
 * Reduces round-trips for cross-origin API calls from the frontend.
 */
@Injectable()
export class CorsPreflightCacheMiddleware implements NestMiddleware {
  private static readonly MAX_AGE_SECONDS = 3600; // 1 hour

  use(req: Request, res: Response, next: NextFunction): void {
    if (req.method === 'OPTIONS') {
      res.setHeader(
        'Access-Control-Max-Age',
        String(CorsPreflightCacheMiddleware.MAX_AGE_SECONDS),
      );
    }
    next();
  }
}
