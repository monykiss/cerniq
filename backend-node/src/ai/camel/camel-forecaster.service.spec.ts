import { CamelForecasterService } from './camel-forecaster.service';

describe('CamelForecasterService', () => {
  let service: CamelForecasterService;

  const mockPrisma = {
    boardReport: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CamelForecasterService(mockPrisma as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('forecastForInstitution', () => {
    it('should return forecasts for all 5 CAMEL dimensions', async () => {
      mockPrisma.boardReport.findMany.mockResolvedValue([]);

      const forecasts = await service.forecastForInstitution('inst-123');
      expect(forecasts).toHaveLength(5);

      const dimensions = forecasts.map((f) => f.dimension);
      expect(dimensions).toContain('capital');
      expect(dimensions).toContain('assetQuality');
      expect(dimensions).toContain('management');
      expect(dimensions).toContain('earnings');
      expect(dimensions).toContain('liquidity');
    });

    it('should generate valid forecasts with synthetic data when no history', async () => {
      mockPrisma.boardReport.findMany.mockResolvedValue([]);

      const forecasts = await service.forecastForInstitution('inst-123');
      for (const f of forecasts) {
        expect(f.currentScore).toBeGreaterThanOrEqual(1);
        expect(f.currentScore).toBeLessThanOrEqual(5);
        expect(f.q2Forecast).toBeGreaterThanOrEqual(1);
        expect(f.q2Forecast).toBeLessThanOrEqual(5);
        expect(f.q4Forecast).toBeGreaterThanOrEqual(1);
        expect(f.q4Forecast).toBeLessThanOrEqual(5);
        expect(['improving', 'stable', 'deteriorating']).toContain(f.trend);
      }
    });

    it('should compute AR(2) parameters from historical data', async () => {
      mockPrisma.boardReport.findMany.mockResolvedValue([
        {
          camelComposite: 2.0,
          nimSnapshot: 3.5,
          lcrSnapshot: 120,
          generatedAt: new Date('2024-01-01'),
        },
        {
          camelComposite: 2.2,
          nimSnapshot: 3.4,
          lcrSnapshot: 118,
          generatedAt: new Date('2024-04-01'),
        },
        {
          camelComposite: 2.1,
          nimSnapshot: 3.6,
          lcrSnapshot: 122,
          generatedAt: new Date('2024-07-01'),
        },
        {
          camelComposite: 2.3,
          nimSnapshot: 3.5,
          lcrSnapshot: 119,
          generatedAt: new Date('2024-10-01'),
        },
        {
          camelComposite: 2.2,
          nimSnapshot: 3.4,
          lcrSnapshot: 121,
          generatedAt: new Date('2025-01-01'),
        },
      ]);

      const forecasts = await service.forecastForInstitution('inst-123');
      for (const f of forecasts) {
        expect(f.ar2Params).toHaveProperty('phi1');
        expect(f.ar2Params).toHaveProperty('phi2');
        expect(f.ar2Params).toHaveProperty('intercept');
        expect(f.ar2Params).toHaveProperty('r2');
        expect(f.ar2Params.r2).toBeGreaterThanOrEqual(0);
      }
    });

    it('should produce confidence intervals that bracket the forecast', async () => {
      mockPrisma.boardReport.findMany.mockResolvedValue([]);

      const forecasts = await service.forecastForInstitution('inst-123');
      for (const f of forecasts) {
        expect(f.q2CI[0]).toBeLessThanOrEqual(f.q2Forecast);
        expect(f.q2CI[1]).toBeGreaterThanOrEqual(f.q2Forecast);
        expect(f.q4CI[0]).toBeLessThanOrEqual(f.q4Forecast);
        expect(f.q4CI[1]).toBeGreaterThanOrEqual(f.q4Forecast);
      }
    });
  });
});
