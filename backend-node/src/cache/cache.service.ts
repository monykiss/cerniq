import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis caching service for high-performance data storage
 * Provides TTL-based caching for expensive calculations
 */
@Injectable()
export class CacheService implements OnModuleInit {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null;
  private readonly REDIS_URL =
    process.env.REDIS_URL || 'redis://localhost:6379';

  async onModuleInit() {
    try {
      this.redis = new Redis(this.REDIS_URL, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      this.redis.on('connect', () => {
        this.logger.log('✓ Redis connected successfully');
      });

      this.redis.on('error', (err) => {
        this.logger.error('Redis connection error:', err);
      });

      // Test connection
      await this.redis.ping();
    } catch (error) {
      this.logger.warn(
        'Redis not available, running without cache:',
        error.message,
      );
      this.redis = null; // Graceful degradation
    }
  }

  /**
   * Ping Redis to check connectivity (used by readiness probes)
   * @returns true if Redis responds to PING, false otherwise
   */
  async ping(): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;

    try {
      const value = await this.redis.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with TTL (Time To Live)
   * @param key Cache key
   * @param value Value to store (will be JSON stringified)
   * @param ttlSeconds TTL in seconds
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      this.logger.debug(`Cache set: ${key} (TTL: ${ttlSeconds}s)`);
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(key);
      this.logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Delete all keys matching pattern
   * @param pattern Redis pattern (e.g., 'iv-surface:*')
   */
  async deletePattern(pattern: string): Promise<void> {
    if (!this.redis) return;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.debug(
          `Cache deleted ${keys.length} keys matching: ${pattern}`,
        );
      }
    } catch (error) {
      this.logger.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ hits: number; misses: number; keys: number }> {
    if (!this.redis) {
      return { hits: 0, misses: 0, keys: 0 };
    }

    try {
      const info = await this.redis.info('stats');
      const dbSize = await this.redis.dbsize();

      // Parse info string
      const stats = info.split('\r\n').reduce(
        (acc, line) => {
          const [key, value] = line.split(':');
          if (key && value) acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      );

      return {
        hits: parseInt(stats.keyspace_hits || '0'),
        misses: parseInt(stats.keyspace_misses || '0'),
        keys: dbSize,
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error);
      return { hits: 0, misses: 0, keys: 0 };
    }
  }

  /**
   * Get or set pattern - fetch from cache or execute function and cache result
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      this.logger.debug(`Cache HIT: ${key}`);
      return cached;
    }

    // Cache miss - fetch fresh data
    this.logger.debug(`Cache MISS: ${key}`);
    const freshData = await fetchFn();

    // Store in cache
    await this.set(key, freshData, ttlSeconds);

    return freshData;
  }

  /**
   * Flush all keys (use with caution!)
   */
  async flushAll(): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.flushall();
      this.logger.warn('Cache flushed - all keys deleted');
    } catch (error) {
      this.logger.error('Error flushing cache:', error);
    }
  }

  /**
   * Close Redis connection
   */
  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    }
  }
}
