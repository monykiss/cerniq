import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap, catchError } from 'rxjs';

interface RequestMetric {
  route: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  timestamp: number;
}

const metrics: RequestMetric[] = [];
const MAX_METRICS = 5000;

export function getMetricsSummary(): {
  totalRequests: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  slowestRoutes: Array<{ route: string; avgMs: number; count: number }>;
} {
  const last1h = Date.now() - 3600000;
  const recent = metrics.filter((m) => m.timestamp > last1h);
  if (recent.length === 0)
    return {
      totalRequests: 0,
      errorRate: 0,
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0,
      slowestRoutes: [],
    };

  const latencies = recent.map((m) => m.latencyMs).sort((a, b) => a - b);
  const errors = recent.filter((m) => m.statusCode >= 400).length;

  const byRoute = new Map<string, { total: number; sumMs: number }>();
  for (const m of recent) {
    const key = `${m.method} ${m.route}`;
    if (!byRoute.has(key)) byRoute.set(key, { total: 0, sumMs: 0 });
    const e = byRoute.get(key)!;
    e.total++;
    e.sumMs += m.latencyMs;
  }

  return {
    totalRequests: recent.length,
    errorRate: +(errors / recent.length).toFixed(4),
    latencyP50: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    latencyP95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    latencyP99: latencies[Math.floor(latencies.length * 0.99)] ?? 0,
    slowestRoutes: Array.from(byRoute.entries())
      .map(([route, { total, sumMs }]) => ({
        route,
        avgMs: Math.round(sumMs / total),
        count: total,
      }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 10),
  };
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const start = Date.now();
    const route = req.route?.path ?? req.path ?? 'unknown';
    const method = req.method;

    return next.handle().pipe(
      tap(() => this.record(route, method, res.statusCode, Date.now() - start)),
      catchError((err) => {
        this.record(route, method, err.status ?? 500, Date.now() - start);
        throw err;
      }),
    );
  }

  private record(
    route: string,
    method: string,
    statusCode: number,
    latencyMs: number,
  ) {
    metrics.push({
      route,
      method,
      statusCode,
      latencyMs,
      timestamp: Date.now(),
    });
    if (metrics.length > MAX_METRICS) metrics.shift();
  }
}
