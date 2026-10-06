import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import * as Sentry from '@sentry/nestjs';
import pg from 'pg';

const { PrismaClient } = require('@prisma/client');

/** Queries exceeding this threshold are logged as warnings. */
const SLOW_QUERY_WARN_MS = parseInt(
  process.env.SLOW_QUERY_WARN_MS || '500',
  10,
);
/** Queries exceeding this threshold are logged as errors and reported to Sentry. */
const SLOW_QUERY_ERROR_MS = parseInt(
  process.env.SLOW_QUERY_ERROR_MS || '2000',
  10,
);

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxSize: number;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('PrismaService');

  /**
   * Underlying pg.Pool instance — exposed so health checks can read
   * connection-pool metrics without coupling to the adapter internals.
   */
  private _pool: pg.Pool | null = null;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      const poolSize = parseInt(process.env.DATABASE_POOL_SIZE || '20', 10);
      const pool = new pg.Pool({
        connectionString,
        max: poolSize,
        idleTimeoutMillis: 30_000, // Close idle connections after 30s
        connectionTimeoutMillis: 5_000, // Fail fast if pool is saturated
      });
      const adapter = new PrismaPg(pool);
      super({ adapter });
      this._pool = pool;
      return;
    }

    // Allow unit tests to import services without requiring a live DB URL.
    super();
  }

  async onModuleInit() {
    if (!process.env.DATABASE_URL) {
      return;
    }
    await this.$connect();
    this.installQueryLogging();
  }

  async onModuleDestroy() {
    if (!process.env.DATABASE_URL) {
      return;
    }
    await this.$disconnect();
  }

  // ---------------------------------------------------------------------------
  // Connection-pool health metrics
  // ---------------------------------------------------------------------------

  /**
   * Returns a snapshot of the pg connection-pool counters.
   * Returns `null` when no pool is available (e.g. in unit-test mode).
   */
  getPoolStats(): PoolStats | null {
    if (!this._pool) {
      return null;
    }
    return {
      totalCount: this._pool.totalCount,
      idleCount: this._pool.idleCount,
      waitingCount: this._pool.waitingCount,
      maxSize: this._pool.options.max ?? 10,
    };
  }

  // ---------------------------------------------------------------------------
  // Slow-query logging middleware (Prisma 7 $extends API)
  // ---------------------------------------------------------------------------

  /**
   * Wraps every Prisma operation with timing instrumentation.
   *
   * Prisma 7 removed the legacy `$use` middleware in favour of `$extends`.
   * Because `$extends` returns a *new* client instance we cannot use it
   * directly on a class that `extends PrismaClient`.  Instead we
   * monkey-patch the internal `_request` method which every model operation
   * flows through — this is the officially-documented escape hatch for
   * NestJS services that extend PrismaClient.
   */
  private installQueryLogging(): void {
    const originalRequest = (this as any)._request.bind(this);
    const logger = this.logger;

    (this as any)._request = async function (internalParams: any) {
      const model: string | undefined = internalParams.model;
      const action: string | undefined = internalParams.action;
      const label = model ? `${model}.${action}` : (action ?? 'unknown');

      const start = Date.now();
      try {
        return await originalRequest(internalParams);
      } finally {
        const duration = Date.now() - start;

        if (duration > SLOW_QUERY_ERROR_MS) {
          logger.error(`Slow query: ${label} took ${duration}ms`);
          Sentry.captureMessage(`Slow DB query: ${label} (${duration}ms)`, {
            level: 'warning',
            tags: {
              type: 'slow_query',
              model: model ?? 'n/a',
              action: action ?? 'n/a',
            },
            extra: { durationMs: duration, threshold: SLOW_QUERY_ERROR_MS },
          });
        } else if (duration > SLOW_QUERY_WARN_MS) {
          logger.warn(`Slow query: ${label} took ${duration}ms`);
        }
      }
    };
  }
}
