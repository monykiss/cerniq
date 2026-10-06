import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma.service';
import { CacheService } from '../../cache/cache.service';

interface DependencyStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  version: string;
  dependencies: DependencyStatus[];
  pool?: { total: number; idle: number; waiting: number; max: number } | null;
}

@Controller('api/v1/health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
    @Optional() @Inject(CacheService) private readonly cache?: CacheService,
  ) {}

  // verify:auth-skip — liveness probe; intentionally public (load balancers, uptime checks)
  @Get()
  @SkipThrottle()
  async check(): Promise<HealthResponse> {
    const dependencies: DependencyStatus[] = [
      await this.checkDependency('database', async () => {
        if (!this.prisma) return false;
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      await this.checkDependency('cache', async () => {
        if (!this.cache) return false;
        return (this.cache as any).ping
          ? await (this.cache as any).ping()
          : true;
      }),
    ];

    const allHealthy = dependencies.every(
      (d: DependencyStatus) => d.status === 'healthy',
    );
    const anyUnhealthy = dependencies.some(
      (d: DependencyStatus) => d.status === 'unhealthy',
    );

    const pool =
      (this.prisma?.getPoolStats?.() as HealthResponse['pool']) || null;

    return {
      status: anyUnhealthy ? 'unhealthy' : allHealthy ? 'ok' : 'degraded',
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? '1.0.0',
      dependencies,
      pool,
    };
  }

  private async checkDependency(
    name: string,
    probe: () => Promise<boolean>,
  ): Promise<DependencyStatus> {
    const start = performance.now();
    try {
      await probe();
      return {
        name,
        status: 'healthy',
        latencyMs: Math.round(performance.now() - start),
      };
    } catch {
      return {
        name,
        status: 'unhealthy',
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }
}
