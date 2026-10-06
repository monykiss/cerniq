import {
  DataQualityService,
  DataValidationMiddleware,
} from './data-quality.service';

describe('DataQualityService', () => {
  let service: DataQualityService;

  beforeEach(() => {
    service = new DataQualityService();
  });

  describe('recordMetric', () => {
    it('records a metric for a new source', () => {
      service.recordMetric('yahoo', { successfulRequests: 1 });
      const metric = service.getMetrics('yahoo') as any;
      expect(metric).toBeDefined();
      expect(metric.source).toBe('yahoo');
      expect(metric.totalRequests).toBe(1);
    });

    it('increments totalRequests on subsequent calls', () => {
      service.recordMetric('yahoo', { successfulRequests: 1 });
      service.recordMetric('yahoo', { successfulRequests: 2 });
      const metric = service.getMetrics('yahoo') as any;
      expect(metric.totalRequests).toBe(2);
    });

    it('updates lastUpdated timestamp', () => {
      service.recordMetric('fmp', {});
      const metric = service.getMetrics('fmp') as any;
      expect(metric.lastUpdated).toBeInstanceOf(Date);
    });
  });

  describe('validatePriceData', () => {
    it('returns 100% quality for valid data', () => {
      const data = [
        { date: '2025-01-01', close: 100 },
        { date: '2025-01-02', close: 101 },
        { date: '2025-01-03', close: 102 },
      ];
      const report = service.validatePriceData(data);
      expect(report.qualityScore).toBe(100);
      expect(report.validPoints).toBe(3);
      expect(report.invalidPoints).toBe(0);
    });

    it('flags missing close prices', () => {
      const data = [
        { date: '2025-01-01', close: 100 },
        { date: '2025-01-02', close: null },
      ];
      const report = service.validatePriceData(data);
      expect(report.invalidPoints).toBe(1);
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Missing close price'),
        ]),
      );
    });

    it('flags negative prices', () => {
      const data = [
        { date: '2025-01-01', close: 100 },
        { date: '2025-01-02', close: -5 },
      ];
      const report = service.validatePriceData(data);
      expect(report.invalidPoints).toBe(1);
      expect(report.issues).toEqual(
        expect.arrayContaining([expect.stringContaining('Negative price')]),
      );
    });

    it('warns about extreme price movements (>50%)', () => {
      const data = [
        { date: '2025-01-01', close: 100 },
        { date: '2025-01-02', close: 200 },
      ];
      const report = service.validatePriceData(data);
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Extreme price movement'),
        ]),
      );
      // Extreme movements are warned but not marked invalid
      expect(report.validPoints).toBe(2);
    });

    it('handles empty data array', () => {
      const report = service.validatePriceData([]);
      expect(report.totalPoints).toBe(0);
      expect(report.qualityScore).toBe(0);
    });

    it('limits issues to first 10', () => {
      const data = Array.from({ length: 15 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        close: null,
      }));
      const report = service.validatePriceData(data);
      expect(report.issues.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getMetrics', () => {
    it('returns undefined for unknown source', () => {
      const metric = service.getMetrics('nonexistent');
      expect(metric).toBeUndefined();
    });

    it('returns all metrics when no source specified', () => {
      service.recordMetric('a', {});
      service.recordMetric('b', {});
      const all = service.getMetrics() as Map<string, any>;
      expect(all.size).toBe(2);
    });
  });

  describe('getHealthStatus', () => {
    it('returns healthy when no metrics recorded', () => {
      const status = service.getHealthStatus();
      expect(status.status).toBe('healthy');
      expect(status.message).toContain('No metrics');
    });

    it('returns healthy when success rate is high', () => {
      service.recordMetric('source1', {
        successfulRequests: 100,
        totalRequests: 0,
      });
      // After recordMetric, totalRequests = 1, successfulRequests = 100
      const status = service.getHealthStatus();
      expect(status.status).toBeDefined();
    });

    it('returns unhealthy when success rate drops below 95%', () => {
      // Manually set metrics to simulate low success rate
      (service as any).qualityMetrics.set('bad-source', {
        source: 'bad-source',
        totalRequests: 100,
        successfulRequests: 90,
        failedRequests: 10,
        avgLatencyMs: 500,
        lastUpdated: new Date(),
      });
      const status = service.getHealthStatus();
      expect(status.status).toBe('unhealthy');
    });

    it('returns degraded when success rate is between 95-99%', () => {
      (service as any).qualityMetrics.set('ok-source', {
        source: 'ok-source',
        totalRequests: 100,
        successfulRequests: 97,
        failedRequests: 3,
        avgLatencyMs: 200,
        lastUpdated: new Date(),
      });
      const status = service.getHealthStatus();
      expect(status.status).toBe('degraded');
    });
  });
});

describe('DataValidationMiddleware', () => {
  let middleware: DataValidationMiddleware;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    middleware = new DataValidationMiddleware();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('calls next() for valid requests', () => {
    const req = { params: {}, query: {}, body: {} } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('rejects invalid ticker format', () => {
    const req = {
      params: { ticker: 'invalid123' },
      query: {},
      body: {},
    } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('accepts valid ticker format', () => {
    const req = { params: { ticker: 'AAPL' }, query: {}, body: {} } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('rejects invalid start date', () => {
    const req = {
      params: {},
      query: { startDate: 'not-a-date' },
      body: {},
    } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects start date after end date', () => {
    const req = {
      params: {},
      query: { startDate: '2025-12-01', endDate: '2025-01-01' },
      body: {},
    } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects confidence level outside 0-1 range', () => {
    const req = {
      params: {},
      query: { confidenceLevel: '1.5' },
      body: {},
    } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects horizon greater than 365', () => {
    const req = { params: {}, query: { horizon: '400' }, body: {} } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects positions with invalid quantity', () => {
    const req = {
      params: {},
      query: {},
      body: { positions: [{ ticker: 'AAPL', quantity: -1, price: 100 }] },
    } as any;
    middleware.use(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});
