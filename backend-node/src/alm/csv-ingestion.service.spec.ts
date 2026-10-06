import { CSVIngestionService } from './csv-ingestion.service';

describe('CSVIngestionService', () => {
  let service: CSVIngestionService;

  beforeEach(() => {
    service = new CSVIngestionService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should parse valid CSV with English headers', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,CRE Loans,10,5.25,4.5,fixed',
      'liability,demand_deposits,Checking,8,0.50,0.1,variable',
    ].join('\n');

    const result = service.parseCSV(csv);
    expect(result.valid).toBe(true);
    expect(result.items.length).toBe(2);
    expect(result.summary.totalAssets).toBe(10);
    expect(result.summary.totalLiabilities).toBe(8);
  });

  it('should reject CSV with missing headers', () => {
    const csv = 'name,balance\nasset,10';
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should auto-convert rates > 1 to decimal', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Loans,100,5.25,3,fixed',
    ].join('\n');

    const result = service.parseCSV(csv);
    expect(result.items[0].rate).toBeCloseTo(0.0525, 4);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should return cooperativa template with valid structure', () => {
    const template = service.getCooperativaTemplate();
    const result = service.parseCSV(template);
    expect(result.valid).toBe(true);
    expect(result.items.length).toBeGreaterThan(20);
    expect(result.summary.totalAssets).toBeGreaterThan(0);
  });

  it('should validate row errors for invalid category', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'invalid_cat,commercial_loans,Bad Row,10,5,3,fixed',
    ].join('\n');

    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('category');
  });

  // ── Coverage boost: edge cases ──

  it('rejects CSV with only header row (no data)', () => {
    const csv = 'category,subcategory,name,balance,rate,duration,rateType';
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('header row');
  });

  it('rejects CSV exceeding MAX_CSV_ROWS', () => {
    const header = 'category,subcategory,name,balance,rate,duration,rateType';
    const rows = Array.from(
      { length: 50002 },
      () => 'asset,commercial_loans,CRE,10,5.25,4.5,fixed',
    );
    const csv = [header, ...rows].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('maximum');
  });

  it('handles Spanish headers (categoria, subcategoria, nombre, saldo, tasa, duracion, tipotasa)', () => {
    const csv = [
      'categoria,subcategoria,nombre,saldo,tasa,duracion,tipotasa',
      'activo,commercial_loans,Prestamos CRE,10,5.25,4.5,fijo',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(true);
    expect(result.items[0].category).toBe('asset');
    expect(result.items[0].rateType).toBe('fixed');
  });

  // "tasa" is feminine in Spanish, so "tasa fija" is the correct and by far the
  // most common form. The validator historically accepted only the masculine
  // "fijo", so a correctly-written cooperativa export was rejected outright.
  it.each([
    ['fija', 'fixed'],
    ['fijo', 'fixed'],
    ['hibrida', 'hybrid'],
    ['hibrido', 'hybrid'],
    ['variable', 'variable'],
  ])('accepts Spanish rate type "%s" as %s', (spanish, canonical) => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      `asset,commercial_loans,Prestamo,10,5.25,4.5,${spanish}`,
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(true);
    expect(result.items[0].rateType).toBe(canonical);
  });

  it('handles "pasivo" as liability category', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'pasivo,demand_deposits,Checking,8,0.50,0.1,variable',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(true);
    expect(result.items[0].category).toBe('liability');
  });

  it('warns when liabilities exceed assets (negative equity)', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Loans,5,5,3,fixed',
      'liability,demand_deposits,Deposits,10,1,0.1,variable',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.warnings.some((w) => w.includes('negative equity'))).toBe(
      true,
    );
  });

  it('errors when liability subcategory used with asset category', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,demand_deposits,Bad Row,10,5,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('liability subcategory');
  });

  it('errors when asset subcategory used with liability category', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'liability,commercial_loans,Bad Row,10,5,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('asset subcategory');
  });

  it('validates negative balance as error', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Loans,-10,5,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('balance');
  });

  it('validates out-of-range rate (>100)', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Loans,10,150,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('rate');
  });

  it('validates out-of-range duration (>50)', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Loans,10,5,55,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('duration');
  });

  it('validates invalid rateType', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Loans,10,5,3,floating',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('rateType');
  });

  it('validates missing name', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,,10,5,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('name');
  });

  it('handles quoted CSV fields with commas', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,"CRE Loans, Phase 1",10,5,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(true);
    expect(result.items[0].name).toBe('CRE Loans, Phase 1');
  });

  it('getGenericTemplate returns parseable CSV', () => {
    const template = service.getGenericTemplate();
    const result = service.parseCSV(template);
    expect(result.valid).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('handles \\r\\n line endings', () => {
    const csv =
      'category,subcategory,name,balance,rate,duration,rateType\r\nasset,commercial_loans,Loans,10,5.25,4.5,fixed\r\n';
    const result = service.parseCSV(csv);
    expect(result.valid).toBe(true);
  });

  it('warns for unknown asset subcategory', () => {
    const csv = [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,unknown_sub,Test,10,5,3,fixed',
    ].join('\n');
    const result = service.parseCSV(csv);
    expect(result.warnings.some((w) => w.includes('Unknown subcategory'))).toBe(
      true,
    );
  });
});
