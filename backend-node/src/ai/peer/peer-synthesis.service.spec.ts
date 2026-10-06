import { PeerSynthesisService } from './peer-synthesis.service';

describe('PeerSynthesisService', () => {
  let service: PeerSynthesisService;
  const mockPrisma = {
    institution: {
      findMany: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    service = new PeerSynthesisService(mockPrisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate monthly synthesis with institutions', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([
      {
        name: 'Coop A',
        totalAssets: 200,
        balanceSheetItems: [
          { category: 'asset', balance: 100, rate: 0.05 },
          { category: 'liability', balance: 80, rate: 0.02 },
        ],
      },
      {
        name: 'Coop B',
        totalAssets: 300,
        balanceSheetItems: [
          { category: 'asset', balance: 200, rate: 0.06 },
          { category: 'liability', balance: 150, rate: 0.03 },
        ],
      },
    ]);

    const result = await service.generateMonthlySynthesis();
    expect(result.month).toMatch(/^\d{4}-\d{2}$/);
    expect(result.analysis.institutionCount).toBe(2);
    expect(result.reportTextEs).toContain('Informe Mensual');
    expect(result.reportTextEn).toContain('Monthly Market Intelligence');
  });

  it('should handle empty institutions with defaults', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([]);
    const result = await service.generateMonthlySynthesis();
    // When no institutions, falls back to 94 per code
    expect(result.analysis.institutionCount).toBe(94);
    expect(result.analysis.sectorTrends.length).toBe(3);
  });

  it('should return NIM spread in analysis', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([
      {
        name: 'High NIM',
        totalAssets: 100,
        balanceSheetItems: [
          { category: 'asset', balance: 100, rate: 0.08 },
          { category: 'liability', balance: 80, rate: 0.01 },
        ],
      },
      {
        name: 'Low NIM',
        totalAssets: 100,
        balanceSheetItems: [
          { category: 'asset', balance: 100, rate: 0.04 },
          { category: 'liability', balance: 80, rate: 0.03 },
        ],
      },
    ]);

    const result = await service.generateMonthlySynthesis();
    expect(typeof result.analysis.nimSpread).toBe('number');
    expect(typeof result.analysis.topQAvgNIM).toBe('number');
  });

  it('getLatestReport should delegate to generateMonthlySynthesis', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([]);
    const result = await service.getLatestReport();
    expect(result).not.toBeNull();
    expect(result!.month).toBeDefined();
  });
});
