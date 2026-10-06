import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ServiceUnavailableException,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { CacheService } from './cache/cache.service';
import { AuthGuard } from './auth/auth.guard';
import { AdminKeyGuard } from './auth/admin-key.guard';
import { EmailService } from './email/email.service';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { DemoRequestDto } from './dto/demo-request.dto';
import { ReportStorageService } from './pipeline/report-storage.service';
import type { Response } from 'express';

function shouldExposeDetailedHealth(): boolean {
  const raw = (process.env.HEALTH_DETAILS_PUBLIC || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  return process.env.NODE_ENV !== 'production';
}

const BYTES_PER_MB = 1048576;
const CGROUP_MEMORY_LIMIT_PATHS = [
  '/sys/fs/cgroup/memory.max',
  '/sys/fs/cgroup/memory/memory.limit_in_bytes',
];
const UNBOUNDED_MEMORY_THRESHOLD = 1n << 60n;

export interface HealthMemorySnapshot {
  source: 'container' | 'heap';
  primaryPercent: number;
  heapPercent: number | null;
  rssPercent: number | null;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  limitMB: number | null;
}

function toMegabytes(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

function toPercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }
  if (denominator <= 0) {
    return null;
  }
  return +((numerator / denominator) * 100).toFixed(1);
}

function parseContainerMemoryLimit(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'max') {
    return null;
  }

  try {
    const bytes = BigInt(trimmed);
    if (bytes <= 0n || bytes >= UNBOUNDED_MEMORY_THRESHOLD) {
      return null;
    }
    return Number(bytes);
  } catch {
    return null;
  }
}

// Cache container memory limit at module load — cgroup limits don't change at runtime
let _cachedMemoryLimit: number | null | undefined;

/** @internal Reset cached cgroup limit — only for testing */
export function _resetCachedMemoryLimit(): void {
  _cachedMemoryLimit = undefined;
}

function readContainerMemoryLimitBytes(): number | null {
  if (_cachedMemoryLimit !== undefined) return _cachedMemoryLimit;
  for (const p of CGROUP_MEMORY_LIMIT_PATHS) {
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = parseContainerMemoryLimit(raw);
      if (parsed !== null) {
        _cachedMemoryLimit = parsed;
        return parsed;
      }
    } catch {
      // Best-effort only. Local dev and some hosts will not expose cgroups.
    }
  }
  _cachedMemoryLimit = null;
  return null;
}

export function getHealthMemorySnapshot(
  mem: NodeJS.MemoryUsage = process.memoryUsage(),
): HealthMemorySnapshot {
  const limitBytes = readContainerMemoryLimitBytes();
  const heapPercent = toPercent(mem.heapUsed, mem.heapTotal);
  const rssPercent =
    limitBytes !== null ? toPercent(mem.rss, limitBytes) : null;
  const source: HealthMemorySnapshot['source'] =
    rssPercent !== null ? 'container' : 'heap';
  const primaryPercent =
    source === 'container' ? (rssPercent ?? 0) : (heapPercent ?? 0);

  return {
    source,
    primaryPercent,
    heapPercent,
    rssPercent,
    heapUsedMB: toMegabytes(mem.heapUsed),
    heapTotalMB: toMegabytes(mem.heapTotal),
    rssMB: toMegabytes(mem.rss),
    limitMB: limitBytes !== null ? toMegabytes(limitBytes) : null,
  };
}

// Event loop delay histogram — started once at module load for /metrics
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

// Active request counter — incremented/decremented by middleware or interceptor
let _activeRequestCount = 0;
export function incrementActiveRequests(): void {
  _activeRequestCount++;
}
export function decrementActiveRequests(): void {
  _activeRequestCount--;
}
export function getActiveRequestCount(): number {
  return _activeRequestCount;
}

function isDependencyDegraded(status: string | undefined): boolean {
  return status === 'degraded' || status === 'down' || status === 'unhealthy';
}

/** Services whose degradation marks the platform as degraded. */
const CORE_HEALTH_KEYS = new Set(['api', 'database', 'cache']);

export function determineOverallHealthStatus(params: {
  dbConnected: boolean;
  checks: Record<string, string>;
  memory: HealthMemorySnapshot;
}): 'ok' | 'degraded' | 'down' {
  if (!params.dbConnected) {
    return 'down';
  }

  const memoryThreshold =
    params.memory.source === 'container'
      ? params.memory.primaryPercent >= 90
      : params.memory.primaryPercent >= 95;

  // Only core services (api, database, cache) determine overall health.
  // Any non-core check is informational — its failure must not mark the
  // platform degraded for load balancers.
  const coreDegraded = Object.entries(params.checks).some(
    ([key, status]) =>
      CORE_HEALTH_KEYS.has(key) && isDependencyDegraded(status),
  );

  if (memoryThreshold || coreDegraded) {
    return 'degraded';
  }

  return 'ok';
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly emailService: EmailService,
    private readonly reportStorage: ReportStorageService,
  ) {}

  private async isCacheReachable(): Promise<boolean> {
    try {
      return await this.cacheService.ping();
    } catch {
      return false;
    }
  }

  // verify:auth-skip — public demo-request capture from marketing site; throttled 5/min/IP
  @Post('api/demo-request')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.CREATED)
  async submitDemoRequest(@Body() body: DemoRequestDto) {
    const record = await this.prisma.demoRequest.create({
      data: {
        email: body.email,
        name: body.name,
        institutionName: body.institutionName,
        institutionType: body.institutionType,
        totalAssets: body.totalAssets,
        message: body.message,
      },
    });

    // Send email notifications (fire-and-forget)
    this.emailService.sendDemoRequestNotification(body).catch(() => {});
    this.emailService
      .sendDemoConfirmation({ name: body.name, email: body.email })
      .catch(() => {});

    // Auto-create prospect from demo request
    try {
      await this.prisma.prospect.create({
        data: {
          name: body.name || body.email,
          email: body.email,
          company: body.institutionName || null,
          role: null,
          stage: 'lead',
          source: 'demo_request',
          notes: body.message || null,
        },
      });
    } catch {
      // Non-critical — don't fail the demo request if prospect creation fails
    }

    return { id: record.id, message: 'Demo request received' };
  }

  // verify:auth-skip — root index; service banner string only
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Graceful shutdown: return 503 during drain period so load balancers stop routing
  private static shuttingDown = false;
  static markShuttingDown() {
    AppController.shuttingDown = true;
  }

  // verify:auth-skip — public health probe for load balancers + uptime monitors
  @Get('health')
  @SkipThrottle()
  async getHealth() {
    if (AppController.shuttingDown) {
      throw new ServiceUnavailableException('Instance is draining connections');
    }
    const checks: Record<string, string> = { api: 'up' };

    // Check DB
    let dbConnected = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
      dbConnected = false;
    }

    checks.cache = (await this.isCacheReachable()) ? 'up' : 'degraded';
    checks.reportStorage = this.reportStorage.isCloudConfigured
      ? 'up'
      : 'degraded';

    const memory = getHealthMemorySnapshot();
    const status = determineOverallHealthStatus({
      dbConnected,
      checks,
      memory,
    });

    // Connection-pool metrics (pg.Pool)
    const poolStats = this.prisma.getPoolStats();

    return {
      status,
      db: dbConnected ? 'connected' : 'error',
      memoryPercent: memory.primaryPercent,
      memorySource: memory.source,
      memory: {
        heapUsedMB: memory.heapUsedMB,
        heapTotalMB: memory.heapTotalMB,
        rssMB: memory.rssMB,
        limitMB: memory.limitMB,
        heapPercent: memory.heapPercent,
        rssPercent: memory.rssPercent,
      },
      ...(poolStats && {
        connectionPool: {
          totalConnections: poolStats.totalCount,
          idleConnections: poolStats.idleCount,
          waitingRequests: poolStats.waitingCount,
          maxSize: poolStats.maxSize,
        },
      }),
      version: '2.0.0',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      services: checks,
    };
  }

  // verify:auth-skip — Kubernetes-style readiness probe; 200 when accepting traffic, 503 during shutdown
  @Get('ready')
  @SkipThrottle()
  async getReady(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};

    // 1. Database check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }

    // 2. Cache (Redis) check
    try {
      const pong = await this.cacheService.ping();
      checks.cache = pong ? 'ok' : 'fail';
    } catch {
      checks.cache = 'fail';
    }

    // 3. Shutdown check — is the app still accepting connections?
    checks.shutdown = AppController.shuttingDown ? 'fail' : 'ok';

    const ready = Object.values(checks).every((v) => v === 'ok');

    if (!ready) {
      res.status(503);
    }

    return {
      ready,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  // verify:auth-skip — Kubernetes liveness probe; minimal-payload alive-check
  @Get('health/live')
  @SkipThrottle()
  getLiveness() {
    return {
      status: 'alive',
      pid: process.pid,
      uptime: Math.round(process.uptime()),
    };
  }

  @Get('metrics')
  @SkipThrottle()
  @UseGuards(AdminKeyGuard)
  async getMetrics() {
    const mem = process.memoryUsage();

    // Event loop lag from perf_hooks histogram
    const eventLoopLag = {
      minMs: +(eventLoopHistogram.min / 1e6).toFixed(2),
      maxMs: +(eventLoopHistogram.max / 1e6).toFixed(2),
      meanMs: +(eventLoopHistogram.mean / 1e6).toFixed(2),
      p50Ms: +(eventLoopHistogram.percentile(50) / 1e6).toFixed(2),
      p99Ms: +(eventLoopHistogram.percentile(99) / 1e6).toFixed(2),
    };

    // Connection pool stats from pg.Pool
    const pgPoolStats = this.prisma.getPoolStats();
    const connectionPool: Record<string, unknown> = pgPoolStats
      ? {
          total: pgPoolStats.totalCount,
          idle: pgPoolStats.idleCount,
          waiting: pgPoolStats.waitingCount,
          max: pgPoolStats.maxSize,
        }
      : { active: 0, idle: 0, max: 10 };

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        heapTotalMB: Math.round(mem.heapTotal / 1048576),
        rssMB: Math.round(mem.rss / 1048576),
        externalMB: Math.round(mem.external / 1048576),
      },
      eventLoopLag,
      activeRequests: getActiveRequestCount(),
      connectionPool,
    };
  }

  @Get('api/admin/webhook-delivery-logs')
  @SkipThrottle()
  @UseGuards(AdminKeyGuard)
  async getWebhookDeliveryLogs() {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      take: 100,
      orderBy: { failureCount: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        lastDeliveredAt: true,
        failureCount: true,
        createdAt: true,
        institutionId: true,
      },
    });

    const active = subscriptions.filter((s: any) => s.isActive);
    const failing = subscriptions.filter((s: any) => s.failureCount > 0);
    const disabled = subscriptions.filter((s: any) => !s.isActive);

    return {
      total: subscriptions.length,
      active: active.length,
      failing: failing.length,
      disabled: disabled.length,
      subscriptions,
    };
  }

  // verify:auth-skip — detailed health (dependencies, pool stats); env-gated to dev/staging unless HEALTH_DETAILS_PUBLIC=1
  @Get('health/detailed')
  @SkipThrottle()
  async getHealthDetailed() {
    if (!shouldExposeDetailedHealth()) {
      throw new NotFoundException();
    }

    const services: Record<string, { status: string; latencyMs: number }> = {};

    // DB check with timing
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      services.database = { status: 'up', latencyMs: Date.now() - dbStart };
    } catch {
      services.database = { status: 'down', latencyMs: Date.now() - dbStart };
    }

    // Cache check with timing
    const redisStart = Date.now();
    services.cache = {
      status: (await this.isCacheReachable()) ? 'up' : 'degraded',
      latencyMs: Date.now() - redisStart,
    };

    const memory = getHealthMemorySnapshot();

    // Core services (DB, cache) determine overall health. Any non-core
    // check is informational only and must not drag the platform to
    // "degraded" for load balancers or uptime monitors.
    const coreServices = ['database', 'cache'] as const;
    const allCoreUp = coreServices.every((key) => {
      const s = services[key];
      return s && (s.status === 'up' || s.status === 'healthy');
    });

    const detailedPoolStats = this.prisma.getPoolStats();

    return {
      status: allCoreUp ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      uptime: process.uptime(),
      memory,
      ...(detailedPoolStats && {
        connectionPool: {
          totalConnections: detailedPoolStats.totalCount,
          idleConnections: detailedPoolStats.idleCount,
          waitingRequests: detailedPoolStats.waitingCount,
          maxSize: detailedPoolStats.maxSize,
        },
      }),
      services,
    };
  }

  @Get('api/admin/demo-requests')
  @UseGuards(AdminKeyGuard)
  async getDemoRequests() {
    return this.prisma.demoRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Delete('api/admin/demo-data')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  async resetDemoData() {
    await this.prisma.balanceSheetItem.deleteMany({});
    await this.prisma.interestRateScenario.deleteMany({});
    await this.prisma.liquidityPosition.deleteMany({});
    await this.prisma.institution.deleteMany({});
    return { message: 'Demo data cleared' };
  }

  @Get('api/admin/stats')
  @UseGuards(AdminKeyGuard)
  async getAdminStats() {
    const [demoRequests, institutions, users, prospects] = await Promise.all([
      this.prisma.demoRequest.count(),
      this.prisma.institution.count(),
      this.prisma.user.count(),
      this.prisma.prospect.count(),
    ]);
    const recentUsers = await this.prisma.user.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    return { demoRequests, institutions, users, recentUsers, prospects };
  }

  // --- Workspace Endpoints ---

  @Get('api/workspaces')
  @UseGuards(AuthGuard)
  async getWorkspaces(@Req() req: any) {
    return this.prisma.workspace.findMany({
      where: { ownerId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('api/workspaces')
  @UseGuards(AuthGuard)
  async createWorkspace(@Req() req: any, @Body() body: { name: string }) {
    return this.prisma.workspace.create({
      data: {
        name: body.name || 'My Workspace',
        ownerId: req.user.userId,
      },
    });
  }

  // verify:auth-skip — public service banner (name, version, env, uptime, endpoint catalog)
  @Get('api/status')
  @SkipThrottle()
  getStatus() {
    return {
      name: 'CERNIQ API',
      version: '2.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      endpoints: {
        realtime: '/pipeline (WebSocket)',
      },
    };
  }

  @Get('api/admin/ops')
  @UseGuards(AdminKeyGuard)
  async getAdminOps() {
    const [recentJobs, activeSubscriptions, totalAnalysisRuns] =
      await Promise.all([
        this.prisma.reportJob.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            institutionName: true,
            status: true,
            createdAt: true,
            completedAt: true,
            errorMessage: true,
            triggeredBy: true,
          },
        }),
        this.prisma.subscription.count({ where: { status: 'active' } }),
        this.prisma.analysisRun.count(),
      ]);

    // Import performance metrics
    const {
      getRouteMetrics,
    } = require('./common/interceptors/performance.interceptor');
    const performanceMetrics = getRouteMetrics().slice(0, 20); // Top 20 slowest routes

    return {
      recentJobs,
      activeSubscriptions,
      totalAnalysisRuns,
      performanceMetrics,
    };
  }
}
