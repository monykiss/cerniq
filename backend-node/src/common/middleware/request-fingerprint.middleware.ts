import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

/**
 * Request fingerprint middleware for bot detection.
 * Generates a SHA-256 hash from browser characteristics
 * (User-Agent, Accept-Language, Accept-Encoding) and attaches
 * it to the request for downstream bot detection and analytics.
 */
@Injectable()
export class RequestFingerprintMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.headers['accept'] || '',
      req.ip || '',
    ];

    const fingerprint = createHash('sha256')
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16);

    (req as any).fingerprint = fingerprint;
    next();
  }
}
