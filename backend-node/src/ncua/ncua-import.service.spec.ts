import { NcuaImportService } from './ncua-import.service';
import { NcuaApiService } from './ncua-api.service';
import { NcuaFieldMapperService } from './ncua-field-mapper.service';
import { FIELD_MAP } from './ncua-field-mapper.service';

describe('NcuaImportService', () => {
  let service: NcuaImportService;
  let apiService: NcuaApiService;
  let fieldMapper: NcuaFieldMapperService;
  const mockPrisma = {
    institution: {
      create: jest.fn().mockResolvedValue({ id: 'inst-new' }),
      findUnique: jest.fn(),
    },
    balanceSheetItem: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as any;

  const mockCreditUnion = {
    charterNumber: '12345',
    name: 'Cooperativa de Ahorro y Credito Caguas',
    city: 'Caguas',
    state: 'PR',
    zipCode: '00725',
    dateChartered: '1975-03-15',
    lowIncomeDesignation: true,
    memberCount: 25000,
    peerGroup: '6',
    fieldOfMembership: 'Community',
    website: 'https://example.com',
    ceoName: 'Maria Rodriguez',
    phoneNumber: '787-555-0100',
  };

  const mockCallReport = {
    charterNumber: '12345',
    quarter: '2025-Q4',
    reportDate: '2025-Q4',
    fields: {
      ACCT_010: 2_800_000_000,
      ACCT_018: 1_680_000_000,
      ACCT_657: 280_000_000,
      ACCT_025: 2_380_000_000,
      ACCT_003: 420_000_000,
      ACCT_115: 98_000_000,
      ACCT_116: 28_000_000,
      ACCT_730: 42_000_000,
      ACCT_660: 0.1,
      ACCT_671: 0.008,
    },
  };

  beforeEach(() => {
    apiService = new NcuaApiService();
    fieldMapper = new NcuaFieldMapperService();
    service = new NcuaImportService(mockPrisma, apiService, fieldMapper);
    jest.clearAllMocks();

    // Mock the API service methods
    jest
      .spyOn(apiService, 'fetchCreditUnion')
      .mockResolvedValue(mockCreditUnion);
    jest
      .spyOn(apiService, 'fetchLatestQuarters')
      .mockResolvedValue([mockCallReport]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Import flow ─────────────────────────────────────────────────────────

  it('imports a credit union and returns structured result', async () => {
    const result = await service.importCreditUnion('12345', 'workspace-uuid');

    expect(result.name).toBe('Cooperativa de Ahorro y Credito Caguas');
    expect(result.totalAssets).toBe('$2.8B');
    expect(result.quartersImported).toBe(1);
    expect(result.balanceSheetItemCount).toBeGreaterThan(0);
    expect(result.institutionId).toBeDefined();
  });

  it('calls NCUA API with correct charter number', async () => {
    await service.importCreditUnion('67890', 'workspace-uuid');

    expect(apiService.fetchCreditUnion).toHaveBeenCalledWith('67890');
    expect(apiService.fetchLatestQuarters).toHaveBeenCalledWith('67890', 4);
  });

  // ── Sync flow ─────────────────────────────────────────────────────────

  it('syncs existing institution with latest NCUA data', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      name: 'Caguas CU',
      charterNumber: '12345',
    });

    const result = await service.syncCreditUnion('inst-1');

    expect(result.institutionId).toBe('inst-1');
    expect(result.updatedFields).toBeGreaterThan(0);
    expect(result.latestQuarter).toBeDefined();
    expect(result.syncedAt).toBeDefined();
  });

  it('throws NotFoundException for unknown institution', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);

    await expect(service.syncCreditUnion('nonexistent')).rejects.toThrow(
      'not found',
    );
  });

  it('throws when institution has no charter number', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'inst-no-charter',
      name: 'Test CU',
      charterNumber: null,
    });

    await expect(service.syncCreditUnion('inst-no-charter')).rejects.toThrow(
      'no charter number',
    );
  });

  // ── Bulk import ───────────────────────────────────────────────────────

  it('bulk imports multiple credit unions', async () => {
    const result = await service.bulkImport(
      ['12345', '12346'],
      'workspace-uuid',
    );

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  it('handles partial failures in bulk import', async () => {
    jest
      .spyOn(apiService, 'fetchCreditUnion')
      .mockResolvedValueOnce(mockCreditUnion)
      .mockRejectedValueOnce(new Error('API timeout'));

    const result = await service.bulkImport(
      ['12345', '99999'],
      'workspace-uuid',
    );

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe('NcuaFieldMapperService', () => {
  let mapper: NcuaFieldMapperService;

  beforeEach(() => {
    mapper = new NcuaFieldMapperService();
  });

  it('should be defined', () => {
    expect(mapper).toBeDefined();
  });

  it('maps call report to balance sheet with correct categories', () => {
    const callReport = {
      charterNumber: '12345',
      quarter: '2025-Q4',
      reportDate: '2025-Q4',
      fields: {
        ACCT_010: 2_800_000_000,
        ACCT_018: 1_680_000_000,
        ACCT_657: 280_000_000,
        ACCT_025: 2_380_000_000,
        ACCT_115: 98_000_000,
        ACCT_116: 28_000_000,
      },
    };

    const result = mapper.mapToBalanceSheet(callReport);

    expect(result.quarter).toBe('2025-Q4');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.summary.totalAssets).toBe(2_800_000_000);
    expect(result.summary.totalLoans).toBe(1_680_000_000);
    expect(result.summary.netWorth).toBe(280_000_000);
    expect(result.summary.totalDeposits).toBe(2_380_000_000);
  });

  it('includes bilingual labels for all mapped items', () => {
    const callReport = {
      charterNumber: '12345',
      quarter: '2025-Q4',
      reportDate: '2025-Q4',
      fields: { ACCT_010: 1000, ACCT_018: 600 },
    };

    const result = mapper.mapToBalanceSheet(callReport);

    for (const item of result.items) {
      expect(item.name).toBeTruthy();
      expect(item.nameEs).toBeTruthy();
      expect(item.ncuaAcctCode).toMatch(/^ACCT_/);
    }
  });

  it('maps credit union info to institution create input', () => {
    const cuData = {
      charterNumber: '12345',
      name: 'Test FCU',
      city: 'San Juan',
      state: 'PR',
      zipCode: '00901',
      dateChartered: '1975-01-01',
      lowIncomeDesignation: true,
      memberCount: 10000,
      peerGroup: '5',
      fieldOfMembership: 'Community',
      website: 'https://test.com',
      ceoName: 'Test CEO',
      phoneNumber: '787-555-0100',
    };

    const result = mapper.mapToInstitution(cuData);

    expect(result.name).toBe('Test FCU');
    expect(result.charterNumber).toBe('12345');
    expect(result.state).toBe('PR');
    expect(result.memberCount).toBe(10000);
    expect(result.lowIncomeDesignation).toBe(true);
  });

  it('contains at least 45 field mappings', () => {
    expect(FIELD_MAP.length).toBeGreaterThanOrEqual(45);
  });

  it('all field mappings have both EN and ES labels', () => {
    for (const mapping of FIELD_MAP) {
      expect(mapping.name).toBeTruthy();
      expect(mapping.nameEs).toBeTruthy();
      expect(mapping.acctCode).toMatch(/^ACCT_/);
      expect(['asset', 'liability', 'equity', 'income', 'expense']).toContain(
        mapping.category,
      );
    }
  });
});
