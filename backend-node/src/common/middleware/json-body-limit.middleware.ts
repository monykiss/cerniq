import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * JSON body size limiter middleware.
 * Rejects requests with JSON bodies exceeding a configurable size limit.
 * Acts as an early rejection layer before the full body is parsed.
 * Complements the PayloadSizeGuard by rejecting at the middleware level.
 */
@Injectable()
export class JsonBodyLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(JsonBodyLimitMiddleware.name);
  private readonly maxBodySizeBytes: number;

  constructor() {
    const limitKB = parseInt(process.env.MAX_JSON_BODY_KB || '1024', 10);
    this.maxBodySizeBytes = limitKB * 1024;
  }

  use(req: Request, res: Response, next: NextFunction) {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const contentType = req.headers['content-type'] || '';

    if (
      contentType.includes('application/json') &&
      contentLength > this.maxBodySizeBytes
    ) {
      this.logger.warn(
        `Rejected oversized JSON body: ${contentLength} bytes from ${req.ip} on ${req.method} ${req.url}`,
      );
      res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${this.maxBodySizeBytes / 1024}KB`,
          timestamp: new Date().toISOString(),
          path: req.url,
        },
      });
      return;
    }

    next();
  }
}
