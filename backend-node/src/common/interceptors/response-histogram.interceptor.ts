import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

/**
 * Collects response time samples in histogram buckets (p50/p95/p99).
 * Exposes stats via getStats() for /metrics or health endpoints.
 */
@Injectable()
export class ResponseHistogramInterceptor implements NestInterceptor {
  private static readonly BUCKETS = [
    10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
  ];
  private readonly logger = new Logger(ResponseHistogramInterceptor.name);
  private samples: number[] = [];
  private bucketCounts: Map<number, number> = new Map(
    ResponseHistogramInterceptor.BUCKETS.map((b) => [b, 0]),
  );

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const req = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      tap(() => {
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        this.record(ms);

        if (ms > 2000) {
          this.logger.warn(
            `Slow request: ${req.method} ${req.originalUrl} ${ms.toFixed(0)}ms`,
          );
        }
      }),
    );
  }

  private record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > 10_000) this.samples.shift();

    for (const bucket of ResponseHistogramInterceptor.BUCKETS) {
      if (ms <= bucket) {
        this.bucketCounts.set(bucket, (this.bucketCounts.get(bucket) ?? 0) + 1);
        break;
      }
    }
  }

  getStats(): { p50: number; p95: number; p99: number; count: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const len = sorted.length;
    return {
      p50: len > 0 ? sorted[Math.floor(len * 0.5)] : 0,
      p95: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
      p99: len > 0 ? sorted[Math.floor(len * 0.99)] : 0,
      count: len,
    };
  }
}
