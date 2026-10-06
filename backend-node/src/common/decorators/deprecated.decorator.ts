import { SetMetadata, applyDecorators, UseInterceptors } from '@nestjs/common';
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';

/**
 * @Deprecated decorator for API endpoints.
 * Adds Sunset and Deprecation headers per RFC 8594.
 *
 * Usage:
 *   @Deprecated('2026-06-01', 'Use /api/v2/analysis instead')
 *   @Get('analysis')
 *   async getAnalysis() { ... }
 */
export const DEPRECATION_KEY = 'api_deprecation';

export interface DeprecationMeta {
  sunsetDate: string; // ISO date when the endpoint will be removed
  alternative: string; // What to use instead
}

export function Deprecated(sunsetDate: string, alternative: string) {
  return applyDecorators(
    SetMetadata(DEPRECATION_KEY, { sunsetDate, alternative }),
    UseInterceptors(DeprecationInterceptor),
  );
}

@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const meta = this.reflector.get<DeprecationMeta>(
      DEPRECATION_KEY,
      context.getHandler(),
    );

    if (!meta) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        // RFC 8594: Sunset header
        res.setHeader('Sunset', new Date(meta.sunsetDate).toUTCString());
        // RFC 8594: Deprecation header
        res.setHeader('Deprecation', 'true');
        // Link to alternative
        res.setHeader('Link', `<${meta.alternative}>; rel="successor-version"`);
      }),
    );
  }
}
