import {
  Injectable,
  CanActivate,
  ExecutionContext,
  PayloadTooLargeException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Per-endpoint payload size guard.
 * Use @MaxPayloadSize(bytes) decorator to override the global 10MB limit.
 *
 * Usage:
 *   @MaxPayloadSize(50 * 1024 * 1024) // 50MB for CSV uploads
 *   @Post('upload')
 *   async uploadCSV(@Body() body: any) { ... }
 */
export const MAX_PAYLOAD_KEY = 'max_payload_bytes';
export const MaxPayloadSize = (bytes: number) =>
  SetMetadata(MAX_PAYLOAD_KEY, bytes);

@Injectable()
export class PayloadSizeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const maxBytes = this.reflector.get<number>(
      MAX_PAYLOAD_KEY,
      context.getHandler(),
    );

    if (!maxBytes) return true; // No limit specified, use global default

    const request = context.switchToHttp().getRequest();
    const contentLength = parseInt(
      request.headers['content-length'] || '0',
      10,
    );

    if (contentLength > maxBytes) {
      const maxMB = (maxBytes / (1024 * 1024)).toFixed(1);
      throw new PayloadTooLargeException(
        `Request body (${(contentLength / (1024 * 1024)).toFixed(1)}MB) exceeds the ${maxMB}MB limit for this endpoint`,
      );
    }

    return true;
  }
}
