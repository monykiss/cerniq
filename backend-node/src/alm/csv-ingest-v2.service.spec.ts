import { CsvIngestV2Service } from './csv-ingest-v2.service';

describe('CsvIngestV2Service', () => {
  let service: CsvIngestV2Service;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      columnMappingMemory: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      balanceSheetItem: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    service = new CsvIngestV2Service(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('analyzes CSV and auto-maps columns by header names', async () => {
    const csv = `name,balance,rate,duration\nCash,50,0.01,0\nLoans,200,0.06,5`;
    const result = await service.analyzeCSV('inst_1', csv);

    expect(result.mappings).toHaveLength(4);
    const balanceMapping = result.mappings.find(
      (m) => m.csvColumn === 'balance',
    );
    expect(balanceMapping!.cerniqField).toBe('balance');
    expect(balanceMapping!.confidence).toBeGreaterThanOrEqual(0.85);

    const nameMapping = result.mappings.find((m) => m.csvColumn === 'name');
    expect(nameMapping!.cerniqField).toBe('name');

    expect(result.sampleData).toHaveLength(2);
    expect(result.ready).toBe(true);
  });

  it('returns not-ready when CSV has only header (no data rows)', async () => {
    const csv = 'name,balance';
    const result = await service.analyzeCSV('inst_1', csv);

    expect(result.ready).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it('warns when no balance column is detected', async () => {
    const csv = `label,description\nA,First\nB,Second`;
    const result = await service.analyzeCSV('inst_1', csv);

    expect(result.warnings.some((w) => w.includes('balance'))).toBe(true);
    expect(result.ready).toBe(false);
  });

  it('commits ingestion and saves rows to DB', async () => {
    const csv = `name,balance,rate\ncash,50,0.01\nauto_loans,200,0.06`;
    const mappings = { name: 'subcategory', balance: 'balance', rate: 'rate' };

    const result = await service.commitIngestion('inst_1', csv, mappings);

    expect(result.rowsIngested).toBe(2);
    expect(prisma.balanceSheetItem.deleteMany).toHaveBeenCalledWith({
      where: { institutionId: 'inst_1' },
    });
    expect(prisma.balanceSheetItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          institutionId: 'inst_1',
          balance: 50,
        }),
      ]),
    });
  });

  it('parseCSVLine handles quoted fields with commas', async () => {
    const csv = `name,balance\n"Savings, Regular",100\n"Time Deposit, 12mo",200`;
    const result = await service.analyzeCSV('inst_1', csv);

    expect(result.sampleData[0]['name']).toBe('Savings, Regular');
    expect(result.sampleData[1]['name']).toBe('Time Deposit, 12mo');
  });

  it('rejects CSV exceeding 50K rows', async () => {
    const header = 'name,balance';
    const rows = Array(50_002).fill('item,100');
    const csv = [header, ...rows].join('\n');

    const result = await service.analyzeCSV('inst_1', csv);
    expect(result.ready).toBe(false);
    expect(result.validationErrors[0].issue).toContain('50,000');
  });

  // ── analyzeCSV additional branches ──────────────────
  it('uses saved column mapping memory when available', async () => {
    prisma.columnMappingMemory.findMany.mockResolvedValue([
      { csvColumnName: 'my_field', cerniqField: 'balance' },
    ]);

    const csv = `my_field,other\n100,hello`;
    const result = await service.analyzeCSV('inst_1', csv);

    const mapping = result.mappings.find((m) => m.csvColumn === 'my_field');
    expect(mapping!.cerniqField).toBe('balance');
    expect(mapping!.confidence).toBe(0.95);
  });

  it('infers rate column from small decimal values', async () => {
    const csv = `pct_col,name\n0.05,Loan A\n0.12,Loan B\n0.03,Loan C`;
    const result = await service.analyzeCSV('inst_1', csv);

    const pctMapping = result.mappings.find((m) => m.csvColumn === 'pct_col');
    expect(pctMapping!.cerniqField).toBe('rate');
    expect(pctMapping!.confidence).toBe(0.6);
  });

  it('infers balance column from large numeric values', async () => {
    const csv = `num_col,name\n50000,Asset A\n120000,Asset B`;
    const result = await service.analyzeCSV('inst_1', csv);

    const numMapping = result.mappings.find((m) => m.csvColumn === 'num_col');
    expect(numMapping!.cerniqField).toBe('balance');
    expect(numMapping!.confidence).toBe(0.5);
  });

  it('warns when no name/category column detected', async () => {
    const csv = `balance,rate\n100,0.05\n200,0.06`;
    const result = await service.analyzeCSV('inst_1', csv);
    expect(result.warnings.some((w) => w.includes('name/category'))).toBe(true);
  });

  it('classifies Spanish headers (saldo, tasa, nombre)', async () => {
    const csv = `nombre,saldo,tasa\nPrestamo Auto,50000,0.06\nHipoteca,150000,0.045`;
    const result = await service.analyzeCSV('inst_1', csv);

    expect(
      result.mappings.find((m) => m.csvColumn === 'nombre')!.cerniqField,
    ).toBe('name');
    expect(
      result.mappings.find((m) => m.csvColumn === 'saldo')!.cerniqField,
    ).toBe('balance');
    expect(
      result.mappings.find((m) => m.csvColumn === 'tasa')!.cerniqField,
    ).toBe('rate');
  });

  it('detects repriceDate from reset_date header', async () => {
    const csv = `name,balance,reset_date,mat_date\nLoan A,100,2026-06-01,2027-01-01`;
    const result = await service.analyzeCSV('inst_1', csv);

    expect(
      result.mappings.find((m) => m.csvColumn === 'reset_date')!.cerniqField,
    ).toBe('repriceDate');
    expect(
      result.mappings.find((m) => m.csvColumn === 'mat_date')!.cerniqField,
    ).toBe('maturityDate');
  });

  // ── commitIngestion additional branches ─────────────
  it('skips blank rows during commit', async () => {
    const csv = `name,balance,rate\ncash,50,0.01\n,,\nauto,200,0.06`;
    const mappings = { name: 'subcategory', balance: 'balance', rate: 'rate' };

    const result = await service.commitIngestion('inst_1', csv, mappings);
    expect(result.rowsIngested).toBe(2);
  });

  it('warns and skips rows with invalid balance', async () => {
    const csv = `name,balance\ncash,abc\nauto,200`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    const result = await service.commitIngestion('inst_1', csv, mappings);
    expect(result.rowsIngested).toBe(1);
    expect(result.warnings.some((w) => w.includes('invalid balance'))).toBe(
      true,
    );
  });

  it('warns and skips rows with zero balance', async () => {
    const csv = `name,balance\ncash,0\nauto,200`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    const result = await service.commitIngestion('inst_1', csv, mappings);
    expect(result.rowsIngested).toBe(1);
  });

  it('returns error when no valid rows found', async () => {
    const csv = `name,balance\ncash,0\nother,-50`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    const result = await service.commitIngestion('inst_1', csv, mappings);
    expect(result.rowsIngested).toBe(0);
    expect(result.errors).toContain('No valid rows found after parsing.');
  });

  it('converts percentage rates (>1) to decimal', async () => {
    const csv = `name,balance,rate\nauto_loans,100,6.5`;
    const mappings = { name: 'subcategory', balance: 'balance', rate: 'rate' };

    await service.commitIngestion('inst_1', csv, mappings);

    const createCall = prisma.balanceSheetItem.createMany.mock.calls[0][0];
    expect(createCall.data[0].rate).toBe(0.065);
  });

  it('saves mappings to columnMappingMemory when saveMappings is true', async () => {
    const csv = `name,balance\ncash,100`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    await service.commitIngestion('inst_1', csv, mappings, true);
    expect(prisma.columnMappingMemory.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not save mappings when saveMappings is false', async () => {
    const csv = `name,balance\ncash,100`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    await service.commitIngestion('inst_1', csv, mappings, false);
    expect(prisma.columnMappingMemory.upsert).not.toHaveBeenCalled();
  });

  it('infers liability category from deposit-related keywords', async () => {
    const csv = `name,balance\ndeposit savings,50000\nfhlb borrowing,100000`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    await service.commitIngestion('inst_1', csv, mappings);

    const createCall = prisma.balanceSheetItem.createMany.mock.calls[0][0];
    expect(
      createCall.data.every((item: any) => item.category === 'liability'),
    ).toBe(true);
  });

  it('normalizes subcategories for various keywords', async () => {
    const csv = `name,balance\nauto loan,100\ncash equiv,200\nsecurities portfolio,300\nresidential mortgage,400\ndemand deposit,500\ntime deposit cd,600`;
    const mappings = { name: 'subcategory', balance: 'balance' };

    await service.commitIngestion('inst_1', csv, mappings);

    const createCall = prisma.balanceSheetItem.createMany.mock.calls[0][0];
    const subcategories = createCall.data.map((item: any) => item.subcategory);
    expect(subcategories).toContain('auto_loans');
    expect(subcategories).toContain('cash');
    expect(subcategories).toContain('securities');
    expect(subcategories).toContain('residential_mortgage');
    expect(subcategories).toContain('demand_deposits');
    expect(subcategories).toContain('time_deposits');
  });

  it('detects variable rate type from rateType field', async () => {
    const csv = `name,balance,rate_type\nvariable loan,100,variable`;
    const mappings = {
      name: 'subcategory',
      balance: 'balance',
      rate_type: 'rateType',
    };

    await service.commitIngestion('inst_1', csv, mappings);

    const createCall = prisma.balanceSheetItem.createMany.mock.calls[0][0];
    expect(createCall.data[0].rateType).toBe('variable');
  });
});
