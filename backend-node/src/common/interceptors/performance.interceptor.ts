import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Enterprise performance tracking interceptor.
 * Records request latency percentiles per route and exposes them
 * via the /health/detailed endpoint for SLA monitoring.
 */

interface RouteMetric {
  count: number;
  totalMs: number;
  maxMs: number;
  latencies: number[]; // Last 100 latencies for percentile calc
}

const MAX_LATENCY_SAMPLES = 100;
const routeMetrics = new Map<string, RouteMetric>();

export function getRouteMetrics(): Array<{
  route: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}> {
  const result: Array<{
    route: string;
    count: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  }> = [];

  for (const [route, metric] of routeMetrics) {
    const sorted = [...metric.latencies].sort((a: number, b: number) => a - b);
    const len = sorted.length;
    result.push({
      route,
      count: metric.count,
      avgMs: Math.round(metric.totalMs / metric.count),
      p50Ms: sorted[Math.floor(len * 0.5)] || 0,
      p95Ms: sorted[Math.floor(len * 0.95)] || 0,
      p99Ms: sorted[Math.floor(len * 0.99)] || 0,
      maxMs: metric.maxMs,
    });
  }

  return result.sort((a: any, b: any) => b.p95Ms - a.p95Ms);
}

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Performance');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();

    const res = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - start;
        res.setHeader('X-Response-Time', `${elapsed}ms`);
        const routeKey = `${req.method} ${req.route?.path || req.url}`;

        let metric = routeMetrics.get(routeKey);
        if (!metric) {
          metric = { count: 0, totalMs: 0, maxMs: 0, latencies: [] };
          routeMetrics.set(routeKey, metric);
        }

        metric.count++;
        metric.totalMs += elapsed;
        metric.maxMs = Math.max(metric.maxMs, elapsed);

        // Ring buffer for percentile calculation
        if (metric.latencies.length >= MAX_LATENCY_SAMPLES) {
          metric.latencies.shift();
        }
        metric.latencies.push(elapsed);
      }),
    );
  }
}
