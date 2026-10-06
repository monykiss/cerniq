import { RegulatoryAlertService } from './regulatory-alert.service';

describe('RegulatoryAlertService', () => {
  let service: RegulatoryAlertService;

  const mockScraper = {
    runDailyScan: jest.fn(),
  };
  const mockExtractor = {
    extract: jest.fn(),
  };
  const mockDelivery = {
    mapAndDeliverToAllInstitutions: jest.fn(),
  };
  const mockPrisma = {
    regulatoryPublication: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.regulatoryPublication.update.mockResolvedValue({});
    service = new RegulatoryAlertService(
      mockScraper as any,
      mockExtractor as any,
      mockDelivery as any,
      mockPrisma as any,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runFullPipeline', () => {
    it('should scan and return zero alerts when no new publications', async () => {
      mockScraper.runDailyScan.mockResolvedValue({ scanned: 5, newFound: 0 });

      const result = await service.runFullPipeline();
      expect(result.scanned).toBe(5);
      expect(result.newPublications).toBe(0);
      expect(result.alertsDelivered).toBe(0);
      expect(result.extractionFailures).toBe(0);
      expect(result.deliveryFailures).toBe(0);
      expect(result.failedPublicationIds).toEqual([]);
      expect(mockExtractor.extract).not.toHaveBeenCalled();
    });

    it('should process new publications, deliver alerts, and mark as processed', async () => {
      const impact = {
        severity: 'HIGH',
        requirements: ['Review capital ratios'],
        affectedSubcategories: ['capital'],
        deadline: null,
        keyQuote: 'Important update',
      };
      mockScraper.runDailyScan.mockResolvedValue({ scanned: 3, newFound: 2 });
      mockPrisma.regulatoryPublication.findMany.mockResolvedValue([
        { id: 'pub-1', title: 'Circular A' },
        { id: 'pub-2', title: 'Circular B' },
      ]);
      mockExtractor.extract.mockResolvedValue(impact);
      mockDelivery.mapAndDeliverToAllInstitutions.mockResolvedValue(3);

      const result = await service.runFullPipeline();
      expect(result.scanned).toBe(3);
      expect(result.newPublications).toBe(2);
      expect(result.alertsDelivered).toBe(6);
      expect(result.extractionFailures).toBe(0);
      expect(mockExtractor.extract).toHaveBeenCalledTimes(2);
      expect(mockDelivery.mapAndDeliverToAllInstitutions).toHaveBeenCalledTimes(
        2,
      );
      // Both publications marked as processed with real impact data
      expect(mockPrisma.regulatoryPublication.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.regulatoryPublication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pub-1' },
          data: expect.objectContaining({
            processedAt: expect.any(Date),
            impactJson: impact,
          }),
        }),
      );
    });

    it('should track extraction failures and mark publication with error metadata', async () => {
      mockScraper.runDailyScan.mockResolvedValue({ scanned: 1, newFound: 1 });
      mockPrisma.regulatoryPublication.findMany.mockResolvedValue([
        { id: 'pub-err', title: 'Circular Rota' },
      ]);
      mockExtractor.extract.mockRejectedValue(new Error('AI unavailable'));
      mockDelivery.mapAndDeliverToAllInstitutions.mockResolvedValue(2);

      const result = await service.runFullPipeline();

      expect(result.scanned).toBe(1);
      expect(result.newPublications).toBe(1);
      expect(result.alertsDelivered).toBe(2);
      expect(result.extractionFailures).toBe(1);
      expect(result.failedPublicationIds).toEqual(['pub-err']);
      // Fallback alert includes extraction failure metadata
      expect(mockDelivery.mapAndDeliverToAllInstitutions).toHaveBeenCalledWith(
        'pub-err',
        expect.objectContaining({
          severity: 'UNKNOWN',
          _extractionFailed: true,
          _failureReason: 'AI unavailable',
        }),
      );
      // Publication marked as processed with error metadata (not retried forever)
      expect(mockPrisma.regulatoryPublication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pub-err' },
          data: expect.objectContaining({
            processedAt: expect.any(Date),
            impactJson: expect.objectContaining({
              extractionFailed: true,
              error: 'AI unavailable',
            }),
          }),
        }),
      );
    });

    it('should track delivery failures separately from extraction failures', async () => {
      mockScraper.runDailyScan.mockResolvedValue({ scanned: 2, newFound: 2 });
      mockPrisma.regulatoryPublication.findMany.mockResolvedValue([
        { id: 'pub-broken', title: 'Circular Fallida' },
        { id: 'pub-good', title: 'Circular Buena' },
      ]);
      mockExtractor.extract
        .mockRejectedValueOnce(new Error('AI down'))
        .mockResolvedValueOnce({
          severity: 'HIGH',
          requirements: ['Check capital'],
          affectedSubcategories: ['capital'],
          deadline: null,
          keyQuote: 'Update',
        });
      // First call is fallback delivery (fails), second is good pub delivery
      mockDelivery.mapAndDeliverToAllInstitutions
        .mockRejectedValueOnce(new Error('delivery down'))
        .mockResolvedValueOnce(5);

      const result = await service.runFullPipeline();

      expect(result.alertsDelivered).toBe(5);
      expect(result.extractionFailures).toBe(1);
      expect(result.deliveryFailures).toBe(1);
      expect(result.failedPublicationIds).toEqual(['pub-broken']);
      expect(mockExtractor.extract).toHaveBeenCalledTimes(2);
      // Both publications still marked as processed
      expect(mockPrisma.regulatoryPublication.update).toHaveBeenCalledTimes(2);
    });

    it('should not break if marking publication as processed fails', async () => {
      mockScraper.runDailyScan.mockResolvedValue({ scanned: 1, newFound: 1 });
      mockPrisma.regulatoryPublication.findMany.mockResolvedValue([
        { id: 'pub-1', title: 'Circular' },
      ]);
      mockExtractor.extract.mockResolvedValue({
        severity: 'LOW',
        requirements: [],
        affectedSubcategories: [],
        deadline: null,
        keyQuote: null,
      });
      mockDelivery.mapAndDeliverToAllInstitutions.mockResolvedValue(1);
      mockPrisma.regulatoryPublication.update.mockRejectedValue(
        new Error('DB down'),
      );

      const result = await service.runFullPipeline();

      // Pipeline still succeeds — persistence failure is best-effort
      expect(result.alertsDelivered).toBe(1);
      expect(result.extractionFailures).toBe(0);
    });
  });

  describe('getRecentPublications', () => {
    it('should query recent publications with default limit', async () => {
      mockPrisma.regulatoryPublication.findMany.mockResolvedValue([
        { id: 'pub-1', title: 'Circular A' },
        { id: 'pub-2', title: 'Circular B' },
      ]);

      const pubs = await service.getRecentPublications();
      expect(pubs).toHaveLength(2);
      expect(mockPrisma.regulatoryPublication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { publishedAt: 'desc' },
          take: 20,
        }),
      );
    });

    it('should respect custom limit parameter', async () => {
      mockPrisma.regulatoryPublication.findMany.mockResolvedValue([]);

      await service.getRecentPublications(5);
      expect(mockPrisma.regulatoryPublication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });
});
