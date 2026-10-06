import { CacheService } from './cache.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    keys: jest.fn().mockResolvedValue([]),
    info: jest
      .fn()
      .mockResolvedValue('keyspace_hits:100\r\nkeyspace_misses:20'),
    dbsize: jest.fn().mockResolvedValue(50),
    flushall: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn().mockReturnThis(),
  }));
});

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    service = new CacheService();
    await service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('ping returns true when Redis is connected', async () => {
    const result = await service.ping();
    expect(result).toBe(true);
  });

  it('get returns null for missing key', async () => {
    const result = await service.get('nonexistent');
    expect(result).toBeNull();
  });

  it('set stores value with TTL', async () => {
    await service.set('test-key', { data: 'value' }, 60);
    // No error thrown means success
    expect(true).toBe(true);
  });

  it('getOrSet calls fetchFn on cache miss and caches result', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ computed: true });
    const result = await service.getOrSet('miss-key', fetchFn, 300);
    expect(fetchFn).toHaveBeenCalled();
    expect(result).toEqual({ computed: true });
  });

  it('getStats returns hits, misses, and key count', async () => {
    const stats = await service.getStats();
    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('keys');
    expect(stats.keys).toBe(50);
  });

  // ── Coverage boost: getOrSet cache hit, deletePattern, flushAll, exists ──
  describe('getOrSet with cache hit', () => {
    it('returns cached value without calling fetchFn', async () => {
      const redis = (service as any).redis;
      redis.get.mockResolvedValueOnce(JSON.stringify({ cached: true }));

      const fetchFn = jest.fn().mockResolvedValue({ computed: true });
      const result = await service.getOrSet('hit-key', fetchFn, 300);

      expect(fetchFn).not.toHaveBeenCalled();
      expect(result).toEqual({ cached: true });
    });
  });

  describe('deletePattern', () => {
    it('deletes all keys matching a pattern', async () => {
      const redis = (service as any).redis;
      redis.keys.mockResolvedValueOnce(['iv-surface:1', 'iv-surface:2']);
      redis.del.mockResolvedValueOnce(2);

      await service.deletePattern('iv-surface:*');
      expect(redis.keys).toHaveBeenCalledWith('iv-surface:*');
      expect(redis.del).toHaveBeenCalledWith('iv-surface:1', 'iv-surface:2');
    });

    it('does nothing when no keys match', async () => {
      const redis = (service as any).redis;
      redis.keys.mockResolvedValueOnce([]);

      await service.deletePattern('no-match:*');
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('flushAll', () => {
    it('calls redis.flushall', async () => {
      const redis = (service as any).redis;
      redis.flushall.mockResolvedValueOnce('OK');

      await service.flushAll();
      expect(redis.flushall).toHaveBeenCalled();
    });
  });

  describe('exists', () => {
    it('returns true when key exists', async () => {
      const redis = (service as any).redis;
      redis.exists.mockResolvedValueOnce(1);

      const result = await service.exists('some-key');
      expect(result).toBe(true);
    });

    it('returns false when key does not exist', async () => {
      const redis = (service as any).redis;
      redis.exists.mockResolvedValueOnce(0);

      const result = await service.exists('missing-key');
      expect(result).toBe(false);
    });
  });

  describe('graceful degradation when redis is null', () => {
    let nullService: CacheService;

    beforeEach(() => {
      nullService = new CacheService();
      (nullService as any).redis = null;
    });

    it('get returns null', async () => {
      expect(await nullService.get('key')).toBeNull();
    });

    it('set is a no-op', async () => {
      await expect(nullService.set('key', 'val', 60)).resolves.not.toThrow();
    });

    it('deletePattern is a no-op', async () => {
      await expect(nullService.deletePattern('*')).resolves.not.toThrow();
    });

    it('flushAll is a no-op', async () => {
      await expect(nullService.flushAll()).resolves.not.toThrow();
    });

    it('exists returns false', async () => {
      expect(await nullService.exists('key')).toBe(false);
    });

    it('ping returns false', async () => {
      expect(await nullService.ping()).toBe(false);
    });

    it('getOrSet calls fetchFn directly when no redis', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ fresh: true });
      const result = await nullService.getOrSet('key', fetchFn, 60);
      expect(fetchFn).toHaveBeenCalled();
      expect(result).toEqual({ fresh: true });
    });

    it('getStats returns zeros', async () => {
      const stats = await nullService.getStats();
      expect(stats).toEqual({ hits: 0, misses: 0, keys: 0 });
    });

    it('delete is a no-op', async () => {
      await expect(nullService.delete('key')).resolves.not.toThrow();
    });
  });

  describe('error handling', () => {
    it('get returns null on JSON parse error', async () => {
      const redis = (service as any).redis;
      redis.get.mockResolvedValueOnce('not-valid-json{{{');
      const result = await service.get('bad-json');
      expect(result).toBeNull();
    });

    it('set handles Redis write error gracefully', async () => {
      const redis = (service as any).redis;
      redis.setex.mockRejectedValueOnce(new Error('Write failed'));
      await expect(service.set('key', 'val', 60)).resolves.toBeUndefined();
    });

    it('delete handles Redis del error gracefully', async () => {
      const redis = (service as any).redis;
      redis.del.mockRejectedValueOnce(new Error('Del failed'));
      await expect(service.delete('key')).resolves.toBeUndefined();
    });

    it('exists handles Redis error gracefully', async () => {
      const redis = (service as any).redis;
      redis.exists.mockRejectedValueOnce(new Error('Exists failed'));
      expect(await service.exists('key')).toBe(false);
    });

    it('ping returns false on Redis error', async () => {
      const redis = (service as any).redis;
      redis.ping.mockRejectedValueOnce(new Error('timeout'));
      expect(await service.ping()).toBe(false);
    });

    it('deletePattern handles Redis error gracefully', async () => {
      const redis = (service as any).redis;
      redis.keys.mockRejectedValueOnce(new Error('Keys failed'));
      await expect(service.deletePattern('pattern:*')).resolves.toBeUndefined();
    });

    it('getStats handles Redis info error gracefully', async () => {
      const redis = (service as any).redis;
      redis.info.mockRejectedValueOnce(new Error('Info failed'));
      const stats = await service.getStats();
      expect(stats).toEqual({ hits: 0, misses: 0, keys: 0 });
    });

    it('flushAll handles Redis error gracefully', async () => {
      const redis = (service as any).redis;
      redis.flushall.mockRejectedValueOnce(new Error('Flush failed'));
      await expect(service.flushAll()).resolves.toBeUndefined();
    });
  });

  // Coverage: lines 19-20 (retryStrategy), 26 (connect event), 30 (error event)
  describe('onModuleInit', () => {
    it('retryStrategy returns capped delay', () => {
      const Redis = require('ioredis');
      const constructorCall = Redis.mock.calls[Redis.mock.calls.length - 1];
      const options = constructorCall[1];
      expect(options.retryStrategy(1)).toBe(50);
      expect(options.retryStrategy(100)).toBe(2000);
    });

    it('connect and error event handlers are registered and callable', () => {
      const redis = (service as any).redis;
      expect(redis.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(redis.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Actually invoke the callbacks to cover lines 26 and 30
      const connectCall = redis.on.mock.calls.find(
        (c: any) => c[0] === 'connect',
      );
      const errorCall = redis.on.mock.calls.find((c: any) => c[0] === 'error');
      if (connectCall) connectCall[1](); // trigger connect callback
      if (errorCall) errorCall[1](new Error('test error')); // trigger error callback
    });

    it('handles Redis init failure gracefully', async () => {
      const Redis = require('ioredis');
      Redis.mockImplementationOnce(() => {
        throw new Error('Connection refused');
      });
      const failService = new CacheService();
      await failService.onModuleInit();
      expect((failService as any).redis).toBeNull();
    });
  });

  // Coverage: line 101, delete success path
  describe('delete', () => {
    it('deletes a key successfully', async () => {
      const redis = (service as any).redis;
      redis.del.mockResolvedValueOnce(1);
      await service.delete('test-key');
      expect(redis.del).toHaveBeenCalledWith('test-key');
    });
  });

  // Coverage: lines 217-220 (onModuleDestroy)
  describe('onModuleDestroy', () => {
    it('closes redis connection', async () => {
      const redis = (service as any).redis;
      await service.onModuleDestroy();
      expect(redis.quit).toHaveBeenCalled();
    });

    it('does nothing when redis is null', async () => {
      const nullService = new CacheService();
      (nullService as any).redis = null;
      await nullService.onModuleDestroy();
      // No error thrown
      expect(true).toBe(true);
    });
  });
});
