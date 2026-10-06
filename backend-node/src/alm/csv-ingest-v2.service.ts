import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { parseFinancialField } from '../common/utils/financial-field';

// ─── CERNIQ Target Schema Fields ────────────────────────────

// ─── Column Classification Heuristics ───────────────────────

const HEADER_PATTERNS: Record<string, string[]> = {
  balance: [
    'balance',
    'amount',
    'monto',
    'saldo',
    'principal',
    'outstanding',
    'valor',
    'total',
  ],
  rate: [
    'rate',
    'tasa',
    'yield',
    'rendimiento',
    'coupon',
    'interest',
    'interes',
    'apy',
    'apr',
  ],
  duration: [
    'duration',
    'duracion',
    'maturity',
    'vencimiento',
    'term',
    'plazo',
    'years',
    'anos',
  ],
  name: [
    'name',
    'nombre',
    'description',
    'descripcion',
    'instrument',
    'instrumento',
    'account',
    'cuenta',
  ],
  subcategory: [
    'category',
    'categoria',
    'type',
    'tipo',
    'class',
    'clase',
    'subcategory',
    'subcategoria',
    'product',
    'producto',
  ],
  rateType: ['rate_type', 'tipo_tasa', 'fixed', 'variable', 'fijo'],
  maturityDate: ['maturity_date', 'fecha_vencimiento', 'mat_date', 'expiry'],
  repriceDate: ['reprice_date', 'fecha_reprecio', 'next_reprice', 'reset_date'],
};

// ─── Types ───────────────────────────────────────────────────

export interface ColumnMapping {
  csvColumn: string;
  cerniqField: string | null;
  confidence: number; // 0-1
  sampleValues: string[];
}

export interface IngestAnalysisResult {
  mappings: ColumnMapping[];
  sampleData: Record<string, string>[];
  unmappedColumns: string[];
  validationErrors: Array<{ row: number; field: string; issue: string }>;
  warnings: string[];
  ready: boolean;
}

export interface IngestCommitResult {
  rowsIngested: number;
  warnings: string[];
  errors: string[];
}

@Injectable()
export class CsvIngestV2Service {
  private readonly logger = new Logger(CsvIngestV2Service.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Step 1: Analyze CSV & Suggest Mappings ───────────────

  async analyzeCSV(
    institutionId: string,
    csvContent: string,
  ): Promise<IngestAnalysisResult> {
    const lines = csvContent.trim().split('\n');
    const MAX_CSV_ROWS = 50_000;
    if (lines.length < 2) {
      return {
        mappings: [],
        sampleData: [],
        unmappedColumns: [],
        validationErrors: [
          {
            row: 0,
            field: 'file',
            issue: 'CSV must have at least a header + 1 data row',
          },
        ],
        warnings: [],
        ready: false,
      };
    }
    if (lines.length > MAX_CSV_ROWS + 1) {
      return {
        mappings: [],
        sampleData: [],
        unmappedColumns: [],
        validationErrors: [
          {
            row: 0,
            field: 'file',
            issue: `CSV exceeds maximum of ${MAX_CSV_ROWS.toLocaleString()} data rows (got ${(lines.length - 1).toLocaleString()})`,
          },
        ],
        warnings: [],
        ready: false,
      };
    }

    const headers = this.parseCSVLine(lines[0]);
    const sampleRows = lines.slice(1, 4).map((line) => {
      const values = this.parseCSVLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] ?? '';
      });
      return row;
    });

    // Load saved mappings for this institution
    const savedMappings = await this.prisma.columnMappingMemory.findMany({
      where: { institutionId },
      take: 100,
    });
    type SavedMapping = {
      csvColumnName: string;
      cerniqField: string | null;
    };
    type SavedMappingWithField = {
      csvColumnName: string;
      cerniqField: string;
    };

    const savedMap = new Map<string, string>(
      (savedMappings as SavedMapping[])
        .filter(
          (mapping): mapping is SavedMappingWithField =>
            typeof mapping.cerniqField === 'string' &&
            mapping.cerniqField.length > 0,
        )
        .map((mapping) => [
          mapping.csvColumnName.toLowerCase(),
          mapping.cerniqField,
        ]),
    );

    // Classify each column
    const mappings: ColumnMapping[] = headers.map((header) => {
      const headerLower = header.toLowerCase().trim();
      const sampleValues = sampleRows
        .map((r) => r[header] ?? '')
        .filter(Boolean);

      // Check saved memory first
      if (savedMap.has(headerLower)) {
        return {
          csvColumn: header,
          cerniqField: savedMap.get(headerLower)!,
          confidence: 0.95,
          sampleValues,
        };
      }

      // Pattern matching on header name
      for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
        for (const pattern of patterns) {
          if (headerLower.includes(pattern)) {
            return {
              csvColumn: header,
              cerniqField: field,
              confidence: 0.85,
              sampleValues,
            };
          }
        }
      }

      // Value-based inference — intentionally permissive. These are
      // heuristics for "is this column numeric enough to be a balance
      // or rate?", not data-integrity checks. The actual row-ingest
      // path below uses parseFinancialField for strict validation.
      // Tightening these to strict parsing would cause legitimate
      // numeric columns with stray characters to mis-classify.
      // eslint-disable-next-line no-restricted-syntax -- heuristic, not data parse
      const allNumeric = sampleValues.every(
        (v) => !isNaN(parseFloat(v.replace(/[$,]/g, ''))), // heuristic
      );
      const hasDecimals = sampleValues.some((v) => v.includes('.'));
      const allSmall = sampleValues.every((v) => {
        // eslint-disable-next-line no-restricted-syntax -- heuristic, not data parse
        const n = parseFloat(v); // heuristic
        return !isNaN(n) && n >= 0 && n <= 0.3;
      });

      if (allSmall && hasDecimals)
        return {
          csvColumn: header,
          cerniqField: 'rate',
          confidence: 0.6,
          sampleValues,
        };
      if (allNumeric && !allSmall)
        return {
          csvColumn: header,
          cerniqField: 'balance',
          confidence: 0.5,
          sampleValues,
        };

      return {
        csvColumn: header,
        cerniqField: null,
        confidence: 0,
        sampleValues,
      };
    });

    const unmappedColumns = mappings
      .filter((m) => m.cerniqField === null)
      .map((m) => m.csvColumn);

    // Validation
    const validationErrors: IngestAnalysisResult['validationErrors'] = [];
    const warnings: string[] = [];

    const hasBalance = mappings.some((m) => m.cerniqField === 'balance');
    const hasName = mappings.some(
      (m) => m.cerniqField === 'name' || m.cerniqField === 'subcategory',
    );
    if (!hasBalance)
      warnings.push(
        'No balance/amount column detected — required for ingestion.',
      );
    if (!hasName)
      warnings.push(
        'No name/category column detected — items will need manual classification.',
      );

    return {
      mappings,
      sampleData: sampleRows,
      unmappedColumns,
      validationErrors,
      warnings,
      ready: hasBalance && validationErrors.length === 0,
    };
  }

  // ─── Step 2: Commit Ingestion with Confirmed Mappings ─────

  async commitIngestion(
    institutionId: string,
    csvContent: string,
    confirmedMappings: Record<string, string>, // csvColumn → cerniqField
    saveMappings: boolean = true,
  ): Promise<IngestCommitResult> {
    const lines = csvContent.trim().split('\n');
    const headers = this.parseCSVLine(lines[0]);

    // Save confirmed mappings for future uploads
    if (saveMappings) {
      for (const [csvCol, cerniqField] of Object.entries(confirmedMappings)) {
        await this.prisma.columnMappingMemory.upsert({
          where: {
            institutionId_csvColumnName: {
              institutionId,
              csvColumnName: csvCol.toLowerCase(),
            },
          },
          update: { cerniqField, confirmedAt: new Date() },
          create: {
            institutionId,
            csvColumnName: csvCol.toLowerCase(),
            cerniqField,
          },
        });
      }
    }

    // Parse data rows
    const items: any[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0 || values.every((v) => !v.trim())) continue;

      const row: Record<string, any> = {};
      headers.forEach((h, j) => {
        const field = confirmedMappings[h];
        if (field) row[field] = values[j]?.trim() ?? '';
      });

      // D22: Parse balance — strict. Strip `$,` before parsing.
      // parseFinancialField rejects trailing garbage and Infinity.
      // Balance must be > 0 (v2 rejects zero-balance rows, unlike v1).
      const balanceCleaned = (row.balance ?? '0').replace(/[$,]/g, '');
      const balance = parseFinancialField(balanceCleaned, {
        min: Number.MIN_VALUE, // strictly positive; min>0 with inclusive range
        max: 999_999_999_999,
      });
      if (balance === null) {
        warnings.push(
          `Row ${i + 1}: invalid balance "${row.balance}", skipping.`,
        );
        continue;
      }

      // D22: Parse rate — accept percent or decimal. Same bounds as
      // v1 (0-100 pre-scale; 0-1 post-scale via the /100 branch).
      // Downstream Math.max(0, Math.min(0.3, rate)) stays as the
      // second-stage clamp — v2 caps at 30% because loan/deposit
      // rates above that aren't realistic in COSSEC-regulated books.
      const rateCleaned = (row.rate ?? '0').replace(/%/g, '');
      const parsedRate = parseFinancialField(rateCleaned, { min: 0, max: 100 });
      let rate = parsedRate ?? 0;
      if (rate > 1) rate = rate / 100; // handle percentage format

      // D22: Parse duration (v2 uses years, 0-50 range per the
      // existing `|| 1` fallback's implicit expectation).
      const parsedDuration = parseFinancialField(row.duration ?? '1', {
        min: 0,
        max: 50,
      });
      const duration = parsedDuration ?? 1;

      // Determine category
      const sub = (row.subcategory ?? row.name ?? '').toLowerCase();
      const category = this.inferCategory(sub);

      items.push({
        institutionId,
        category,
        subcategory: this.normalizeSubcategory(sub, category),
        name: row.name || row.subcategory || `Item ${i}`,
        balance,
        rate: Math.max(0, Math.min(0.3, rate)),
        duration,
        rateType: (row.rateType || 'fixed').toLowerCase().includes('var')
          ? 'variable'
          : 'fixed',
      });
    }

    if (items.length === 0) {
      return {
        rowsIngested: 0,
        warnings,
        errors: ['No valid rows found after parsing.'],
      };
    }

    // Delete existing and import
    await this.prisma.balanceSheetItem.deleteMany({ where: { institutionId } });
    await this.prisma.balanceSheetItem.createMany({ data: items });

    return { rowsIngested: items.length, warnings, errors };
  }

  // ─── Private Helpers ──────────────────────────────────────

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    result.push(current.trim());
    return result;
  }

  private inferCategory(text: string): 'asset' | 'liability' {
    const liabilityKeywords = [
      'deposit',
      'savings',
      'share',
      'cd',
      'certificate',
      'borrow',
      'fhlb',
      'money_market',
      'ira',
      'draft',
      'liability',
      'pasivo',
    ];
    return liabilityKeywords.some((k) => text.includes(k))
      ? 'liability'
      : 'asset';
  }

  private normalizeSubcategory(text: string, category: string): string {
    const t = text.toLowerCase();
    if (t.includes('cash') || t.includes('efectivo')) return 'cash';
    if (
      t.includes('secur') ||
      t.includes('invest') ||
      t.includes('bond') ||
      t.includes('valor')
    )
      return 'securities';
    if (t.includes('auto') || t.includes('vehicle') || t.includes('vehiculo'))
      return 'auto_loans';
    if (
      t.includes('mortgage') ||
      t.includes('hipotec') ||
      t.includes('residential')
    )
      return 'residential_mortgage';
    if (t.includes('commercial') && t.includes('re')) return 'commercial_re';
    if (t.includes('commercial') || t.includes('c&i'))
      return 'commercial_loans';
    if (t.includes('credit') && t.includes('card')) return 'credit_cards';
    if (t.includes('consumer') || t.includes('personal'))
      return 'consumer_loans';
    if (t.includes('demand') || t.includes('checking'))
      return 'demand_deposits';
    if (t.includes('saving') || t.includes('ahorro')) return 'savings';
    if (
      t.includes('time') ||
      t.includes('cd') ||
      t.includes('plazo') ||
      t.includes('certificate')
    )
      return 'time_deposits';
    if (t.includes('money') && t.includes('market')) return 'money_market';
    if (t.includes('fhlb') || t.includes('borrow')) return 'borrowings';
    if (t.includes('draft')) return 'share_drafts';
    if (t.includes('ira')) return 'iras';
    return category === 'asset' ? 'other_assets' : 'other_borrowings';
  }
}
