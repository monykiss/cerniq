import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
}

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccessResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // If already wrapped (has success field), pass through
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }

        // If paginated result (has items + total), extract meta
        if (
          data &&
          typeof data === 'object' &&
          'items' in data &&
          'total' in data
        ) {
          return {
            success: true as const,
            data: data.items,
            meta: {
              page: data.page || 1,
              pageSize: data.pageSize || data.items.length,
              total: data.total,
              totalPages:
                data.totalPages ||
                Math.ceil(
                  data.total / (data.pageSize || data.items.length || 1),
                ),
            },
          };
        }

        return {
          success: true as const,
          data,
        };
      }),
    );
  }
}
