import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Rejects requests whose URL or query params contain path traversal sequences.
 * Blocks patterns like ../, ..\, %2e%2e, and null bytes.
 */
@Injectable()
export class PathTraversalMiddleware implements NestMiddleware {
  private static readonly DANGEROUS_PATTERNS = [
    /\.\.\//, // ../
    /\.\.\\/, // ..\
    /%2e%2e/i, // URL-encoded ..
    /%252e%252e/i, // double-encoded ..
    /\0/, // null byte
    /%00/, // URL-encoded null byte
  ];

  use(req: Request, _res: Response, next: NextFunction): void {
    const targets = [req.originalUrl, ...Object.values(req.query).map(String)];

    for (const target of targets) {
      for (const pattern of PathTraversalMiddleware.DANGEROUS_PATTERNS) {
        if (pattern.test(target)) {
          throw new BadRequestException('Path traversal detected');
        }
      }
    }

    next();
  }
}
