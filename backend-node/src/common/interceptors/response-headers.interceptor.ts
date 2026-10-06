import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Enterprise response headers interceptor.
 * Adds standard headers required by Fortune 500 API consumers:
 * - X-Content-Type-Options: nosniff (prevent MIME sniffing)
 * - X-Frame-Options: DENY (prevent clickjacking)
 * - X-Powered-By: removed (hide tech stack)
 * - X-Request-Start: timestamp for client-side latency calculation
 */
@Injectable()
export class ResponseHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse();

    // Remove X-Powered-By (Express default reveals "Express")
    res.removeHeader('X-Powered-By');

    // Add enterprise headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-Start', `t=${Date.now()}`);

    return next.handle();
  }
}
