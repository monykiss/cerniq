import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { createHash } from 'crypto';

/**
 * ETag interceptor for API response caching.
 * Generates weak ETags for GET responses and handles If-None-Match.
 * Reduces bandwidth for polling clients (dashboards, mobile apps).
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    // Only apply to GET requests
    if (req.method !== 'GET') return next.handle();

    return next.handle().pipe(
      map((body: any) => {
        if (!body) return body;

        // Generate weak ETag from response body hash
        const json = JSON.stringify(body);
        const hash = createHash('md5').update(json).digest('hex').slice(0, 16);
        const etag = `W/"${hash}"`;

        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache');

        // Check If-None-Match
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch === etag) {
          res.status(304);
          return undefined;
        }

        return body;
      }),
    );
  }
}
