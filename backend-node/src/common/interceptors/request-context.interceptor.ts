import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request context using AsyncLocalStorage.
 * Makes request metadata (user, request ID, tenant) available
 * anywhere in the call stack without explicit parameter passing.
 */

export interface RequestContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
  method: string;
  path: string;
  startTime: number;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context from anywhere in the call stack.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();

    const ctx: RequestContext = {
      requestId: req.headers['x-request-id'] || req.id || crypto.randomUUID(),
      userId: req.user?.id,
      tenantId: req.user?.organizationId || req.headers['x-tenant-id'],
      method: req.method,
      path: req.url,
      startTime: Date.now(),
    };

    return new Observable((subscriber) => {
      requestContextStorage.run(ctx, () => {
        const innerSubscription = next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });

        return () => innerSubscription.unsubscribe();
      });
    });
  }
}
