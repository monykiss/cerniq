import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Response time histogram with configurable buckets.
 * Tracks per-route response times for percentile monitoring (p50/p95/p99).
 * Differs from ResponseHistogramInterceptor by supporting per-route breakdown.
 */
@Injectable()
export class ResponseTimeHistogramInterceptor implements NestInterceptor {
  private static readonly DEFAULT_BUCKETS = [
    5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
  ];

  private readonly logger = new Logger(ResponseTimeHistogramInterceptor.name);
  private readonly routeHistograms = new Map<
    string,
    { samples: number[]; bucketCounts: Map<number, number> }
  >();

  constructor(
    private readonly buckets = ResponseTimeHistogramInterceptor.DEFAULT_BUCKETS,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = process.hrtime.bigint();
    const req = context.switchToHttp().getRequest();
    const routeKey = `${req.method} ${req.route?.path || req.url}`;

    return next.handle().pipe(
      tap(() => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        this.record(routeKey, durationMs);
      }),
    );
  }

  private record(routeKey: string, ms: number): void {
    if (!this.routeHistograms.has(routeKey)) {
      this.routeHistograms.set(routeKey, {
        samples: [],
        bucketCounts: new Map(this.buckets.map((b) => [b, 0])),
      });
    }

    const histogram = this.routeHistograms.get(routeKey)!;
    histogram.samples.push(ms);

    // Cap samples to prevent memory growth
    if (histogram.samples.length > 5000) {
      histogram.samples = histogram.samples.slice(-2500);
    }

    for (const bucket of this.buckets) {
      if (ms <= bucket) {
        histogram.bucketCounts.set(
          bucket,
          (histogram.bucketCounts.get(bucket) ?? 0) + 1,
        );
        break;
      }
    }
  }

  /**
   * Get percentile stats for a specific route or all routes.
   */
  getStats(
    routeKey?: string,
  ): Record<string, { p50: number; p95: number; p99: number; count: number }> {
    const result: Record<
      string,
      { p50: number; p95: number; p99: number; count: number }
    > = {};

    const entries = routeKey
      ? [[routeKey, this.routeHistograms.get(routeKey)] as const]
      : [...this.routeHistograms.entries()];

    for (const [key, histogram] of entries) {
      if (!histogram) continue;
      const sorted = [...histogram.samples].sort((a, b) => a - b);
      const len = sorted.length;
      result[key] = {
        p50: len > 0 ? sorted[Math.floor(len * 0.5)] : 0,
        p95: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
        p99: len > 0 ? sorted[Math.floor(len * 0.99)] : 0,
        count: len,
      };
    }

    return result;
  }
}
