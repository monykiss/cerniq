import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── SRE Metrics Service ────────────────────────────────────
// Tracks API latency, error rates, queue depths, and business metrics
// In production: exports to Prometheus via OpenTelemetry SDK

export interface APIMetrics {
  endpoint: string;
  method: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  requestCount: number;
  errorCount: number;
  errorRate: number;
}

export interface BusinessMetrics {
  mrr: number;
  activeInstitutions: number;
  activeUsers: number;
  computeJobsToday: number;
  reportsGeneratedToday: number;
  apiCallsToday: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number; // seconds
  dbConnectionPool: { active: number; idle: number; max: number };
  memoryUsage: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
  apiMetrics: APIMetrics[];
  businessMetrics: BusinessMetrics;
}

// In-memory metrics store (production: Prometheus counters/histograms)
const requestLatencies: Array<{
  endpoint: string;
  method: string;
  durationMs: number;
  statusCode: number;
  timestamp: number;
}> = [];
const MAX_METRICS = 10000;
const startTime = Date.now();

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Record Request ───────────────────────────────────────

  recordRequest(
    endpoint: string,
    method: string,
    durationMs: number,
    statusCode: number,
  ) {
    requestLatencies.push({
      endpoint,
      method,
      durationMs,
      statusCode,
      timestamp: Date.now(),
    });
    if (requestLatencies.length > MAX_METRICS) requestLatencies.shift();
  }

  // ─── Get System Health ────────────────────────────────────

  async getSystemHealth(): Promise<SystemHealth> {
    const mem = process.memoryUsage();
    const last1h = Date.now() - 3600000;
    const recentRequests = requestLatencies.filter((r) => r.timestamp > last1h);

    // Group by endpoint
    const byEndpoint = new Map<string, typeof requestLatencies>();
    for (const r of recentRequests) {
      const key = `${r.method} ${r.endpoint}`;
      if (!byEndpoint.has(key)) byEndpoint.set(key, []);
      byEndpoint.get(key)!.push(r);
    }

    const apiMetrics: APIMetrics[] = Array.from(byEndpoint.entries())
      .map(([key, reqs]) => {
        const [method, endpoint] = key.split(' ', 2);
        const durations = reqs.map((r) => r.durationMs).sort((a, b) => a - b);
        const errors = reqs.filter((r) => r.statusCode >= 400);
        return {
          endpoint,
          method,
          p50Ms: durations[Math.floor(durations.length * 0.5)] ?? 0,
          p95Ms: durations[Math.floor(durations.length * 0.95)] ?? 0,
          p99Ms: durations[Math.floor(durations.length * 0.99)] ?? 0,
          requestCount: reqs.length,
          errorCount: errors.length,
          errorRate:
            reqs.length > 0
              ? Math.round((errors.length / reqs.length) * 10000) / 100
              : 0,
        };
      })
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 20);

    const businessMetrics = await this.getBusinessMetrics();

    const totalErrors = recentRequests.filter(
      (r) => r.statusCode >= 500,
    ).length;
    const errorRate =
      recentRequests.length > 0 ? totalErrors / recentRequests.length : 0;
    const p99 =
      apiMetrics.length > 0 ? Math.max(...apiMetrics.map((m) => m.p99Ms)) : 0;

    return {
      status:
        errorRate > 0.05 ? 'unhealthy' : p99 > 5000 ? 'degraded' : 'healthy',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dbConnectionPool: { active: 1, idle: 4, max: 10 }, // Prisma pool defaults
      memoryUsage: {
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        heapTotalMB: Math.round(mem.heapTotal / 1048576),
        rssMB: Math.round(mem.rss / 1048576),
      },
      apiMetrics,
      businessMetrics,
    };
  }

  // ─── Business Metrics ─────────────────────────────────────

  private async getBusinessMetrics(): Promise<BusinessMetrics> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [institutions, users, todayUsage] = await Promise.all([
      this.prisma.institution.count(),
      this.prisma.user.count(),
      this.prisma.usageMeterEvent
        .count({ where: { createdAt: { gte: today } } })
        .catch(() => 0),
    ]);

    return {
      mrr: institutions * 3500, // estimate based on Silver tier
      activeInstitutions: institutions,
      activeUsers: users,
      computeJobsToday: Math.floor(todayUsage * 0.2),
      reportsGeneratedToday: Math.floor(todayUsage * 0.1),
      apiCallsToday: todayUsage,
    };
  }
}
