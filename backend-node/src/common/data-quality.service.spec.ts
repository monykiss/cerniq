import {
  DataQualityService,
  DataValidationMiddleware,
} from './data-quality.service';

// ─── DataValidationMiddleware ─────────────────────────────

describe('DataValidationMiddleware', () => {
  let middleware: DataValidationMiddleware;
  let mockReq: any;
  let mockRes: any;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new DataValidationMiddleware();
    mockReq = { params: {}, query: {}, body: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('calls next() when there are no params/query/body to validate', () => {
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── Ticker validation ──

  it('rejects invalid ticker format (lowercase)', () => {
    mockReq.params.ticker = 'abc';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid ticker symbol' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects ticker with more than 5 characters', () => {
    mockReq.params.ticker = 'ABCDEF';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects ticker with numbers', () => {
    mockReq.params.ticker = 'AB1';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('accepts valid ticker symbols', () => {
    mockReq.params.ticker = 'AAPL';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts single-character ticker', () => {
    mockReq.params.ticker = 'X';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── Date validation ──

  it('rejects invalid startDate', () => {
    mockReq.query.startDate = 'not-a-date';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid start date' }),
    );
  });

  it('rejects invalid endDate', () => {
    mockReq.query.endDate = 'bad-date';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid end date' }),
    );
  });

  it('rejects when startDate is after endDate', () => {
    mockReq.query.startDate = '2026-06-01';
    mockReq.query.endDate = '2026-01-01';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid date range' }),
    );
  });

  it('accepts valid date range', () => {
    mockReq.query.startDate = '2026-01-01';
    mockReq.query.endDate = '2026-06-01';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts startDate without endDate', () => {
    mockReq.query.startDate = '2026-01-01';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts endDate without startDate', () => {
    mockReq.query.endDate = '2026-06-01';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── Confidence level ──

  it('rejects non-numeric confidenceLevel', () => {
    mockReq.query.confidenceLevel = 'abc';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid confidence level' }),
    );
  });

  it('rejects confidenceLevel = 0', () => {
    mockReq.query.confidenceLevel = '0';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects confidenceLevel = 1', () => {
    mockReq.query.confidenceLevel = '1';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects confidenceLevel > 1', () => {
    mockReq.query.confidenceLevel = '1.5';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('accepts valid confidenceLevel', () => {
    mockReq.query.confidenceLevel = '0.95';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── Horizon ──

  it('rejects non-numeric horizon', () => {
    mockReq.query.horizon = 'abc';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid horizon' }),
    );
  });

  it('rejects horizon = 0', () => {
    mockReq.query.horizon = '0';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects horizon > 365', () => {
    mockReq.query.horizon = '400';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('accepts horizon = 1', () => {
    mockReq.query.horizon = '1';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts horizon = 365', () => {
    mockReq.query.horizon = '365';
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── Positions validation ──

  it('rejects positions that are not an array', () => {
    mockReq.body.positions = 'not-array';
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid positions' }),
    );
  });

  it('rejects position without ticker', () => {
    mockReq.body.positions = [{ quantity: 10, price: 100 }];
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Each position must have a valid ticker',
      }),
    );
  });

  it('rejects position with non-string ticker', () => {
    mockReq.body.positions = [{ ticker: 123, quantity: 10, price: 100 }];
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects position with non-positive quantity', () => {
    mockReq.body.positions = [{ ticker: 'AAPL', quantity: 0, price: 100 }];
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Quantity must be a positive number',
      }),
    );
  });

  it('rejects position with non-number quantity', () => {
    mockReq.body.positions = [{ ticker: 'AAPL', quantity: 'ten', price: 100 }];
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('rejects position with non-positive price', () => {
    mockReq.body.positions = [{ ticker: 'AAPL', quantity: 10, price: -5 }];
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Price must be a positive number' }),
    );
  });

  it('rejects position with non-number price', () => {
    mockReq.body.positions = [
      { ticker: 'AAPL', quantity: 10, price: 'hundred' },
    ];
    middleware.use(mockReq, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('accepts valid positions', () => {
    mockReq.body.positions = [
      { ticker: 'AAPL', quantity: 10, price: 150 },
      { ticker: 'GOOG', quantity: 5, price: 2800 },
    ];
    middleware.use(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── DataQualityService ───────────────────────────────────

describe('DataQualityService', () => {
  let service: DataQualityService;

  beforeEach(() => {
    service = new DataQualityService();
  });

  // ── recordMetric / getMetrics ──

  describe('recordMetric', () => {
    it('creates a new metric for an unknown source', () => {
      service.recordMetric('yahoo', { successfulRequests: 1 });
      const m = service.getMetrics('yahoo') as any;
      expect(m).toBeDefined();
      expect(m.totalRequests).toBe(1);
      expect(m.source).toBe('yahoo');
    });

    it('increments totalRequests on subsequent calls', () => {
      service.recordMetric('yahoo', { successfulRequests: 1 });
      service.recordMetric('yahoo', { successfulRequests: 2 });
      service.recordMetric('yahoo', { failedRequests: 1 });
      const m = service.getMetrics('yahoo') as any;
      expect(m.totalRequests).toBe(3);
    });

    it('merges partial metric data with existing', () => {
      service.recordMetric('fred', { avgLatencyMs: 100 });
      service.recordMetric('fred', { avgLatencyMs: 200 });
      const m = service.getMetrics('fred') as any;
      expect(m.avgLatencyMs).toBe(200);
    });
  });

  describe('getMetrics', () => {
    it('returns undefined for an unknown source', () => {
      expect(service.getMetrics('nonexistent')).toBeUndefined();
    });

    it('returns the full map when no source is specified', () => {
      service.recordMetric('a', {});
      service.recordMetric('b', {});
      const all = service.getMetrics() as Map<string, any>;
      expect(all).toBeInstanceOf(Map);
      expect(all.size).toBe(2);
    });
  });

  // ── validatePriceData ──

  describe('validatePriceData', () => {
    it('returns 100% quality for all valid points', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 101 },
        { date: '2026-01-03', close: 102 },
      ]);
      expect(report.qualityScore).toBe(100);
      expect(report.validPoints).toBe(3);
      expect(report.invalidPoints).toBe(0);
      expect(report.totalPoints).toBe(3);
      expect(report.issues).toHaveLength(0);
    });

    it('detects null close price', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: null },
      ]);
      expect(report.invalidPoints).toBe(1);
      expect(report.qualityScore).toBe(50);
      expect(report.issues[0]).toContain('Missing close price');
    });

    it('detects undefined close price', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02' },
      ]);
      expect(report.invalidPoints).toBe(1);
      expect(report.issues[0]).toContain('Missing close price');
    });

    it('detects negative prices', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: -5 },
      ]);
      expect(report.invalidPoints).toBe(1);
      expect(report.issues[0]).toContain('Negative price');
    });

    it('flags extreme price movements (>50%) but does not mark as invalid', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 200 }, // 100% jump
      ]);
      expect(report.validPoints).toBe(2); // both valid
      expect(report.invalidPoints).toBe(0);
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.issues[0]).toContain('Extreme price movement');
    });

    it('does not flag moderate price movements (<= 50%)', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 130 }, // 30% — OK
      ]);
      expect(report.issues).toHaveLength(0);
    });

    it('returns 0 quality score for empty data', () => {
      const report = service.validatePriceData([]);
      expect(report.qualityScore).toBe(0);
      expect(report.totalPoints).toBe(0);
    });

    it('limits issues to first 10', () => {
      const data = Array.from({ length: 15 }, (_, i) => ({
        date: `2026-01-${i + 1}`,
        close: null,
      }));
      const report = service.validatePriceData(data);
      expect(report.issues.length).toBe(10);
    });

    it('includes timestamp in report', () => {
      const report = service.validatePriceData([
        { date: '2026-01-01', close: 50 },
      ]);
      expect(report.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── getHealthStatus ──

  describe('getHealthStatus', () => {
    it('returns "healthy" with no metrics', () => {
      const status = service.getHealthStatus();
      expect(status.status).toBe('healthy');
      expect(status.message).toContain('No metrics');
    });

    it('returns "healthy" when success rate >= 99%', () => {
      service.recordMetric('src1', {
        successfulRequests: 99,
        totalRequests: 0,
      });
      // After recordMetric, totalRequests is 1 from increment logic.
      // We need to set up the metric map directly for precise control.
      (service as any).qualityMetrics.set('src1', {
        source: 'src1',
        totalRequests: 100,
        successfulRequests: 100,
        failedRequests: 0,
        avgLatencyMs: 50,
        lastUpdated: new Date(),
      });
      const status = service.getHealthStatus();
      expect(status.status).toBe('healthy');
    });

    it('returns "degraded" when success rate is 95-99%', () => {
      (service as any).qualityMetrics.set('src1', {
        source: 'src1',
        totalRequests: 100,
        successfulRequests: 97,
        failedRequests: 3,
        avgLatencyMs: 50,
        lastUpdated: new Date(),
      });
      const status = service.getHealthStatus();
      expect(status.status).toBe('degraded');
    });

    it('returns "unhealthy" when success rate < 95%', () => {
      (service as any).qualityMetrics.set('src1', {
        source: 'src1',
        totalRequests: 100,
        successfulRequests: 90,
        failedRequests: 10,
        avgLatencyMs: 50,
        lastUpdated: new Date(),
      });
      const status = service.getHealthStatus();
      expect(status.status).toBe('unhealthy');
    });

    it('includes correct details in health status', () => {
      (service as any).qualityMetrics.set('a', {
        source: 'a',
        totalRequests: 50,
        successfulRequests: 50,
        failedRequests: 0,
        avgLatencyMs: 100,
        lastUpdated: new Date(),
      });
      (service as any).qualityMetrics.set('b', {
        source: 'b',
        totalRequests: 50,
        successfulRequests: 50,
        failedRequests: 0,
        avgLatencyMs: 200,
        lastUpdated: new Date(),
      });
      const status = service.getHealthStatus();
      expect(status.details.totalSources).toBe(2);
      expect(status.details.totalRequests).toBe(100);
      expect(status.details.successRate).toBe(100);
      expect(status.details.avgLatency).toBe(150);
    });
  });
});
