import { CSVIngestionService } from './csv-ingestion.service';
import { CsvSchemaInferenceService } from './csv-schema-inference.service';

describe('CsvSchemaInferenceService', () => {
  const svc = new CsvSchemaInferenceService();
  const strict = new CSVIngestionService();

  describe('parseLooseNumber', () => {
    it.each([
      ['1234.56', 1234.56],
      ['1,234.56', 1234.56],
      ['1.234,56', 1234.56],
      ['$1,234.56', 1234.56],
      ['  7.5  ', 7.5],
      ['5,75', 5.75],
      ['1,500', 1500],
      ['(500)', -500],
      ['500-', -500],
      ['4.25%', 4.25],
    ])('parses %s', (input, expected) => {
      expect(svc.parseLooseNumber(input)).toBe(expected);
    });

    // Missing must stay missing: a null here becomes a skipped row or a
    // question, never a zero that silently lands in a regulatory total.
    it.each(['', '   ', 'N/A', 'n/d', '--', 'abc'])(
      'returns null (not 0) for %s',
      (input) => {
        expect(svc.parseLooseNumber(input)).toBeNull();
      },
    );
  });

  describe('normalizeHeader', () => {
    it.each([
      ['Saldo Actual ($)', 'saldo_actual'],
      ['  Descripción  ', 'descripcion'],
      ['Tasa de Interés %', 'tasa_de_interes'],
      ['CATEGORÍA', 'categoria'],
    ])('normalizes %s', (input, expected) => {
      expect(svc.normalizeHeader(input)).toBe(expected);
    });
  });

  describe('delimiter detection', () => {
    it('picks semicolon for Spanish-locale Excel output', () => {
      const lines = [
        'Cuenta;Saldo;Tasa',
        'Prestamos Hipotecarios;1.500.000,50;5,75',
        'Ahorros de Socios;2.300.000,00;1,50',
      ];
      expect(svc.detectDelimiter(lines)).toBe(';');
    });

    it('is not fooled by commas inside a quoted prose column', () => {
      const lines = [
        'Cuenta;Descripcion;Saldo',
        'Hipotecas;"Pool A, San Juan, fijo";1500000',
        'Ahorros;"Regular, socios";2300000',
      ];
      expect(svc.detectDelimiter(lines)).toBe(';');
    });

    it('still picks comma for a normal CSV', () => {
      const lines = ['category,subcategory,balance', 'asset,cash,100'];
      expect(svc.detectDelimiter(lines)).toBe(',');
    });
  });

  describe('header row detection', () => {
    it('skips Excel title and metadata rows above the real header', () => {
      const lines = [
        'COOPERATIVA DE AHORRO Y CREDITO DE SAN JUAN',
        'Estado de Situacion - Q2 2026',
        '',
        'Cuenta,Descripcion,Saldo,Tasa,Plazo',
        'Hipotecarios,Pool A,1500000,5.75,12',
      ].filter((l) => l.trim().length > 0);

      expect(svc.detectHeaderRow(lines, ',').index).toBe(2);
    });
  });

  describe('derivation guardrails', () => {
    it('derives the balance-sheet side from a known subcategory', () => {
      expect(svc.deriveCategory('savings_deposits')).toBe('liability');
      expect(svc.deriveCategory('residential_mortgages')).toBe('asset');
      expect(svc.deriveCategory('nonsense')).toBeNull();
    });

    it('infers product type from Spanish prose', () => {
      expect(svc.inferSubcategoryFromText('Préstamos Hipotecarios')).toBe(
        'residential_mortgages',
      );
      expect(svc.inferSubcategoryFromText('Ahorros de Socios')).toBe(
        'savings_deposits',
      );
      expect(svc.inferSubcategoryFromText('Certificados de Acción')).toBe(
        'time_deposits',
      );
      expect(svc.inferSubcategoryFromText('zzz unknown zzz')).toBeNull();
    });
  });

  // The whole point: a messy real-world export must end up in the SAME strict
  // parser that the canonical template uses, with matching totals.
  describe('round-trip into the strict parser', () => {
    const messyCoopExport = [
      'COOPERATIVA DE AHORRO Y CREDITO ORIENTAL',
      'Estado de Situacion Financiera;Junio 2026',
      '',
      'Cuenta;Descripcion;Saldo;Tasa;Plazo;Modalidad',
      'Prestamos Hipotecarios;Pool residencial San Juan;12.500.000,00;5,75;12,5;Fijo',
      'Prestamos de Auto;Vehiculos nuevos;4.250.000,00;7,60;4,0;Fijo',
      'Inversiones;Notas del Tesoro 5yr;8.000.000,00;4,50;4,5;Fijo',
      'Efectivo;Fondos federales vendidos;3.000.000,00;5,10;0,01;Variable',
      'Ahorros de Socios;Ahorro regular;15.000.000,00;1,55;0,25;Variable',
      'Certificados de Accion;Certificado 12 meses;9.000.000,00;3,10;1,0;Fijo',
      'Prestamos Externos;Adelanto FHLB 1 ano;2.500.000,00;5,10;1,0;Fijo',
      '',
      'TOTAL;;54.250.000,00;;;',
    ].join('\n');

    it('reads a semicolon + Spanish-decimal export with a preamble', () => {
      const inference = svc.infer(messyCoopExport);

      expect(inference.status).toBe('ready');
      expect(inference.delimiter).toBe(';');
      expect(inference.skippedPreambleRows).toBe(2);
      expect(inference.mapping.balance).toBeDefined();
      expect(inference.mapping.rate).toBeDefined();
      // No explicit category column — must be derived, not demanded.
      expect(inference.mapping.category).toBeUndefined();
      expect(inference.notes.some((n) => n.includes('derived'))).toBe(true);
    });

    it('converts to canonical CSV that the strict parser accepts', () => {
      const inference = svc.infer(messyCoopExport);
      const converted = svc.toCanonicalCsv(messyCoopExport, inference);

      expect(converted).not.toBeNull();

      const result = strict.parseCSV(converted!.csv);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.summary.validRows).toBe(7);

      // Assets: 12.5 + 4.25 + 8 + 3 = 27.75M; liabilities: 15 + 9 + 2.5 = 26.5M
      expect(result.summary.totalAssets).toBeCloseTo(27_750_000, 0);
      expect(result.summary.totalLiabilities).toBeCloseTo(26_500_000, 0);
    });

    // Category subtotals are the nastiest real-world case: "Total Prestamos"
    // matches the loan keywords, so without an explicit guard it imports as a
    // position and double-counts every loan beneath it.
    it('drops per-category subtotal rows instead of double-counting them', () => {
      const withSubtotals = [
        'Cuenta;Saldo;Tasa;Plazo',
        'Prestamos Hipotecarios;10.000.000,00;5,75;12',
        'Prestamos de Auto;5.000.000,00;7,60;4',
        'Total Prestamos;15.000.000,00;;',
        'Ahorros de Socios;8.000.000,00;1,55;0,25',
      ].join('\n');

      const inference = svc.infer(withSubtotals);
      const converted = svc.toCanonicalCsv(withSubtotals, inference);
      const result = strict.parseCSV(converted!.csv);

      expect(result.valid).toBe(true);
      expect(result.summary.validRows).toBe(3);
      // 10M + 5M, NOT 30M.
      expect(result.summary.totalAssets).toBeCloseTo(15_000_000, 0);
      expect(result.summary.totalLiabilities).toBeCloseTo(8_000_000, 0);
    });

    it('drops the TOTAL footer row instead of importing it as a line item', () => {
      const inference = svc.infer(messyCoopExport);
      const converted = svc.toCanonicalCsv(messyCoopExport, inference);

      expect(converted!.skippedRows).toBe(1);
      expect(converted!.csv).not.toContain('TOTAL');
    });
  });

  describe('asking instead of fabricating', () => {
    const noRateFile = [
      'Cuenta,Descripcion,Saldo',
      'Prestamos Hipotecarios,Pool A,1500000',
      'Ahorros de Socios,Regular,2300000',
    ].join('\n');

    it('asks for a rate rather than defaulting it to zero', () => {
      const inference = svc.infer(noRateFile);

      expect(inference.status).toBe('needs_input');
      const rateQuestion = inference.questions.find((q) => q.field === 'rate');
      expect(rateQuestion).toBeDefined();
      expect(rateQuestion!.deferrable).toBe(false);
      expect(rateQuestion!.prompt).toContain('will not assume');
    });

    it('refuses to convert while a blocking answer is missing', () => {
      const inference = svc.infer(noRateFile);
      expect(svc.toCanonicalCsv(noRateFile, inference)).toBeNull();
    });

    it('converts once the user supplies the rate, and discloses the assumption', () => {
      const inference = svc.infer(noRateFile);
      const converted = svc.toCanonicalCsv(noRateFile, inference, {
        defaults: { rate: '4.5' },
      });

      expect(converted).not.toBeNull();
      expect(converted!.notes.some((n) => n.startsWith('DISCLOSURE:'))).toBe(
        true,
      );

      const result = strict.parseCSV(converted!.csv);
      expect(result.valid).toBe(true);
      expect(result.summary.validRows).toBe(2);
    });

    it('treats duration as deferrable but discloses the resulting gap', () => {
      const inference = svc.infer(noRateFile);
      const durationQuestion = inference.questions.find(
        (q) => q.field === 'duration',
      );
      expect(durationQuestion!.deferrable).toBe(true);

      const converted = svc.toCanonicalCsv(noRateFile, inference, {
        defaults: { rate: '4.5' },
      });
      expect(
        converted!.notes.some(
          (n) => n.includes('DISCLOSURE') && n.includes('duration'),
        ),
      ).toBe(true);
    });
  });

  describe('unusable input', () => {
    it('names an empty upload as a transport problem, not bad data', () => {
      const inference = svc.infer('');
      expect(inference.status).toBe('unusable');
      expect(inference.unusableReason).toContain('interrupted');
    });

    it('reports a single-line file honestly', () => {
      const inference = svc.infer('category,balance');
      expect(inference.status).toBe('unusable');
      expect(inference.unusableReason).toContain('one non-empty line');
    });
  });

  describe('canonical template regression', () => {
    it('leaves an already-canonical file working through inference', () => {
      const canonical = strict.getCooperativaTemplate();
      const inference = svc.infer(canonical);

      expect(inference.status).toBe('ready');
      expect(inference.headerRowIndex).toBe(0);

      const converted = svc.toCanonicalCsv(canonical, inference);
      const result = strict.parseCSV(converted!.csv);

      expect(result.valid).toBe(true);
      expect(result.summary.validRows).toBe(40);
      expect(result.summary.totalAssets).toBe(185);
      expect(result.summary.totalLiabilities).toBe(165);
    });
  });

  // A PR cooperativa export: semicolon-delimited, Spanish headers, feminine
  // "fija", and a bare "Reprecio" column. Every part of this combination
  // previously failed — `fija` was rejected by the validator and `Reprecio`
  // was not a recognised header, so variable-rate rows lost the reprice date
  // that the repricing-gap analysis is built on.
  it('round-trips a Spanish semicolon cooperativa export, including Reprecio and fija', () => {
    const csv = [
      'Categoria;Subcategoria;Nombre;Saldo Actual;Tasa;Duracion;Tipo de Tasa;Reprecio;Vencimiento',
      'activo;hipotecas_residenciales;Pool A;7.5;5.75;12.0;fija;;2038-03-01',
      'pasivo;depositos_ahorro;Ahorro Socios;24.0;1.50;0.25;variable;2026-06-01;',
    ].join('\n');

    const inference = svc.infer(csv);
    expect(inference.status).not.toBe('unusable');
    expect(inference.mapping.repriceDate).toBe(7);

    const converted = svc.toCanonicalCsv(csv, inference, {
      columnOverrides: {},
      defaults: {},
    });
    expect(converted).not.toBeNull();
    expect(converted!.csv).toContain('2026-06-01');

    // The whole point of inference is that the STRICT parser then accepts it.
    const reparsed = strict.parseCSV(converted!.csv);
    expect(reparsed.valid).toBe(true);
    expect(reparsed.summary.validRows).toBe(2);
  });
});
