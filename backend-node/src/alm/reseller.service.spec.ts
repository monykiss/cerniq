import { NotFoundException } from '@nestjs/common';
import { ResellerService } from './reseller.service';

describe('ResellerService', () => {
  let service: ResellerService;
  const mockPrisma = {
    reseller: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    service = new ResellerService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a reseller with defaults', async () => {
    mockPrisma.reseller.create.mockResolvedValue({
      id: 'r1',
      name: 'Partner',
      slug: 'partner',
    });
    const result = await service.createReseller({
      name: 'Partner',
      slug: 'partner',
      revenueSharePct: 20,
    });
    expect(result.id).toBe('r1');
    expect(mockPrisma.reseller.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryColor: '#1B3A6B',
          billingModel: 'PASS_THROUGH',
        }),
      }),
    );
  });

  it('should get reseller by id', async () => {
    mockPrisma.reseller.findUnique.mockResolvedValue({
      id: 'r1',
      name: 'Partner',
      isActive: true,
    });
    const result = await service.getReseller('r1');
    expect(result.name).toBe('Partner');
    expect(result.clientCount).toBe(0);
  });

  it('should throw NotFoundException for missing reseller', async () => {
    mockPrisma.reseller.findUnique.mockResolvedValue(null);
    await expect(service.getReseller('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should list active resellers', async () => {
    mockPrisma.reseller.findMany.mockResolvedValue([
      { id: 'r1' },
      { id: 'r2' },
    ]);
    const result = await service.listResellers();
    expect(result.length).toBe(2);
  });

  it('should update reseller properties', async () => {
    mockPrisma.reseller.update.mockResolvedValue({ id: 'r1', name: 'Updated' });
    const result = await service.updateReseller('r1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('should get reseller by slug', async () => {
    mockPrisma.reseller.findUnique.mockResolvedValue({
      id: 'r1',
      name: 'Partner',
      slug: 'partner',
      isActive: true,
    });
    const result = await service.getResellerBySlug('partner');
    expect(result.name).toBe('Partner');
    expect(result.clientCount).toBe(0);
    expect(result.totalMRR).toBe(0);
  });

  it('should throw NotFoundException for missing slug', async () => {
    mockPrisma.reseller.findUnique.mockResolvedValue(null);
    await expect(service.getResellerBySlug('missing')).rejects.toThrow(
      'Reseller not found',
    );
  });

  it('should create reseller with custom options', async () => {
    mockPrisma.reseller.create.mockResolvedValue({
      id: 'r2',
      name: 'Custom',
      slug: 'custom',
      primaryColor: '#FF0000',
      billingModel: 'WHOLESALE',
    });
    const result = await service.createReseller({
      name: 'Custom',
      slug: 'custom',
      revenueSharePct: 30,
      primaryColor: '#FF0000',
      billingModel: 'WHOLESALE',
      logoUrl: 'https://example.com/logo.png',
      domain: 'custom.example.com',
    });
    expect(result.id).toBe('r2');
    expect(mockPrisma.reseller.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryColor: '#FF0000',
          billingModel: 'WHOLESALE',
          logoUrl: 'https://example.com/logo.png',
          domain: 'custom.example.com',
        }),
      }),
    );
  });
});
