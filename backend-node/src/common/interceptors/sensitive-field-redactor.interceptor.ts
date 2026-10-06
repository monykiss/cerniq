import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Automatically redact sensitive fields from API responses.
 * Prevents accidental leakage of passwords, tokens, secrets, and SSNs
 * in API responses regardless of what the service layer returns.
 */
@Injectable()
export class SensitiveFieldRedactorInterceptor implements NestInterceptor {
  private readonly sensitivePatterns = [
    'password',
    'secret',
    'token',
    'ssn',
    'socialSecurity',
    'taxId',
    'creditCard',
    'cvv',
    'pin',
    'refreshToken',
    'accessToken',
    'apiSecret',
    'privateKey',
  ];

  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => this.redact(data)));
  }

  private redact(value: any, seen: WeakSet<object> = new WeakSet()): any {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, seen));
    }

    if (typeof value === 'object' && !(value instanceof Date)) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);

      const result: any = {};
      for (const [key, val] of Object.entries(value)) {
        if (this.isSensitiveKey(key)) {
          result[key] = '[REDACTED]';
        } else if (typeof val === 'object' && val !== null) {
          result[key] = this.redact(val, seen);
        } else {
          result[key] = val;
        }
      }
      return result;
    }

    return value;
  }

  private isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return this.sensitivePatterns.some((pattern) =>
      lowerKey.includes(pattern.toLowerCase()),
    );
  }
}
