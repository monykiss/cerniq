import { Injectable, Logger } from '@nestjs/common';
import { parseFinancialField } from '../common/utils/financial-field';

// ─── Cooperativa subcategory mapping (ES → system key) ─────────────
const SUBCATEGORY_ALIASES: Record<string, string> = {
  // Spanish asset names
  prestamos_personales: 'consumer_loans',
  prestamos_hipotecarios: 'residential_mortgages',
  prestamos_comerciales: 'commercial_loans',
  inversiones: 'investment_securities',
  efectivo_equivalentes: 'cash_equivalents',
  efectivo: 'cash_equivalents',
  otros_activos: 'other_assets',
  // Spanish liability names
  ahorros_socios: 'savings_deposits',
  certificados_accion: 'time_deposits',
  depositos_a_plazo: 'time_deposits',
  cuentas_corrientes: 'demand_deposits',
  prestamos_externos: 'borrowings',
  otros_pasivos: 'other_liabilities',
  // English passthrough (already valid)
  commercial_loans: 'commercial_loans',
  residential_mortgages: 'residential_mortgages',
  consumer_loans: 'consumer_loans',
  investment_securities: 'investment_securities',
  cash_equivalents: 'cash_equivalents',
  other_assets: 'other_assets',
  demand_deposits: 'demand_deposits',
  savings_deposits: 'savings_deposits',
  time_deposits: 'time_deposits',
  borrowings: 'borrowings',
  subordinated_debt: 'subordinated_debt',
  other_liabilities: 'other_liabilities',
};

const VALID_CATEGORIES = ['asset', 'liability', 'activo', 'pasivo'];
// Spanish rate types as cooperativas actually write them. "tasa" is feminine,
// so **"fija" is the correct and by far the most common form** — the list
// previously accepted only the masculine "fijo", rejecting well-formed exports
// from essentially every Spanish-language cooperativa. `variable` is identical
// in both languages; `hibrida`/`híbrida` mirror `hybrid`.
const RATE_TYPE_SYNONYMS: Record<string, string> = {
  fixed: 'fixed',
  variable: 'variable',
  hybrid: 'hybrid',
  fijo: 'fixed',
  fija: 'fixed',
  hibrido: 'hybrid',
  hibrida: 'hybrid',
  híbrido: 'hybrid',
  híbrida: 'hybrid',
};
const VALID_RATE_TYPES = Object.keys(RATE_TYPE_SYNONYMS);

const ASSET_SUBCATEGORIES = new Set([
  'commercial_loans',
  'residential_mortgages',
  'consumer_loans',
  'investment_securities',
  'cash_equivalents',
  'other_assets',
]);
const LIABILITY_SUBCATEGORIES = new Set([
  'demand_deposits',
  'savings_deposits',
  'time_deposits',
  'borrowings',
  'subordinated_debt',
  'other_liabilities',
]);

export interface CSVRowError {
  row: number;
  field: string;
  value: string;
  message: string;
  messageEs: string;
}

export interface CSVParseResult {
  valid: boolean;
  items: ParsedBalanceSheetItem[];
  errors: CSVRowError[];
  warnings: string[];
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    totalAssets: number;
    totalLiabilities: number;
  };
}

export interface ParsedBalanceSheetItem {
  category: string;
  subcategory: string;
  name: string;
  balance: number;
  rate: number;
  duration: number;
  repriceDate?: string;
  maturityDate?: string;
  rateType: string;
}

@Injectable()
export class CSVIngestionService {
  private readonly logger = new Logger(CSVIngestionService.name);

  parseCSV(csvContent: string): CSVParseResult {
    const lines = csvContent
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((l) => l.trim().length > 0);

    // Distinguish "the upload arrived empty" from "the file has a header but no
    // data". Collapsing both into one message actively misled: a 0-byte body
    // caused by a dropped multipart upload was reported as a malformed CSV,
    // sending the user to re-check data that was never the problem.
    if (csvContent.trim().length === 0) {
      return this.emptyResult(
        'The uploaded file arrived empty (0 bytes). The file itself may be fine — ' +
          'this usually means the upload was interrupted before the data reached the server. ' +
          'Please re-select the file and try again.',
      );
    }

    if (lines.length < 2) {
      // Report the measurements, not just the verdict. A 3.4 KB file that
      // yields one line is a truncated upload; a genuinely one-line file is a
      // user error. Identical message, opposite fixes — so state the bytes and
      // separators that were actually received and let the reader tell them
      // apart without server access.
      const bytes = Buffer.byteLength(csvContent, 'utf8');
      const separators =
        (csvContent.match(/\n/g) || []).length +
        (csvContent.match(/\r/g) || []).length;
      return this.emptyResult(
        `The file has only ${lines.length} non-empty line(s); a CSV needs a header row and at least one data row. ` +
          `Received ${bytes} byte(s) with ${separators} line separator(s). ` +
          (bytes > 200 && separators === 0
            ? 'The content arrived with no line breaks at all, which means the upload was altered in transit rather than the file being malformed — please report this.'
            : 'If your file does have multiple rows, the upload was cut short; re-select the file and try again.'),
      );
    }

    const MAX_CSV_ROWS = 50_000;
    if (lines.length > MAX_CSV_ROWS + 1) {
      return this.emptyResult(
        `CSV exceeds maximum of ${MAX_CSV_ROWS.toLocaleString()} data rows (got ${(lines.length - 1).toLocaleString()})`,
      );
    }

    // Parse headers
    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
    const requiredHeaders = [
      'category',
      'subcategory',
      'name',
      'balance',
      'rate',
      'duration',
      'ratetype',
    ];

    // Also accept Spanish headers
    const headerMap = this.mapHeaders(headers);
    const missingHeaders = requiredHeaders.filter(
      (h) => headerMap[h] === undefined,
    );

    if (missingHeaders.length > 0) {
      return this.emptyResult(
        `Missing required columns: ${missingHeaders.join(', ')}. ` +
          `Required: category, subcategory, name, balance, rate, duration, rateType`,
      );
    }

    // Parse rows
    const items: ParsedBalanceSheetItem[] = [];
    const errors: CSVRowError[] = [];
    const warnings: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0) continue;

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').trim();
      });

      const rowErrors = this.validateRow(row, headerMap, i + 1);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      // Normalize values
      const rawCategory = this.getField(
        row,
        headerMap,
        'category',
      ).toLowerCase();
      const category =
        rawCategory === 'activo'
          ? 'asset'
          : rawCategory === 'pasivo'
            ? 'liability'
            : rawCategory;

      const rawSubcategory = this.getField(row, headerMap, 'subcategory')
        .toLowerCase()
        .replace(/\s+/g, '_');
      const subcategory = SUBCATEGORY_ALIASES[rawSubcategory] || rawSubcategory;

      // Validate subcategory matches category
      if (category === 'asset' && !ASSET_SUBCATEGORIES.has(subcategory)) {
        if (LIABILITY_SUBCATEGORIES.has(subcategory)) {
          errors.push({
            row: i + 1,
            field: 'subcategory',
            value: rawSubcategory,
            message: `"${rawSubcategory}" is a liability subcategory but row is marked as asset`,
            messageEs: `"${rawSubcategory}" es subcategoría de pasivo pero la fila está marcada como activo`,
          });
          continue;
        }
        warnings.push(
          `Row ${i + 1}: Unknown subcategory "${rawSubcategory}" mapped to "${subcategory}"`,
        );
      }
      if (
        category === 'liability' &&
        !LIABILITY_SUBCATEGORIES.has(subcategory)
      ) {
        if (ASSET_SUBCATEGORIES.has(subcategory)) {
          errors.push({
            row: i + 1,
            field: 'subcategory',
            value: rawSubcategory,
            message: `"${rawSubcategory}" is an asset subcategory but row is marked as liability`,
            messageEs: `"${rawSubcategory}" es subcategoría de activo pero la fila está marcada como pasivo`,
          });
          continue;
        }
        warnings.push(
          `Row ${i + 1}: Unknown subcategory "${rawSubcategory}" mapped to "${subcategory}"`,
        );
      }

      // D22: parseFinancialField rejects trailing garbage + Infinity
      // in one step, so "250000000abc" no longer silently becomes a
      // real $250M balance. Bounds preserved: $0 - $999B.
      const rawBalance = this.getField(row, headerMap, 'balance');
      const balance = parseFinancialField(rawBalance, {
        min: 0,
        max: 999_999_999_999,
      });
      if (balance === null) {
        errors.push({
          row: i + 1,
          field: 'balance',
          value: String(rawBalance),
          message: `Balance must be a non-negative number up to $999B (got ${rawBalance})`,
          messageEs: `El balance debe ser un numero no negativo hasta $999B (recibido ${rawBalance})`,
        });
        continue;
      }

      // D22: the pre-auto-scale parse must reject "1.5abc" outright.
      // Previously it became 1.5, auto-scaled to 0.015 silently.
      // Accept either percent (0-100) or decimal (0-1) form; the
      // auto-scale below normalizes.
      const rawRateField = this.getField(row, headerMap, 'rate');
      const rawRate = parseFinancialField(rawRateField, { min: 0, max: 100 });
      if (rawRate === null) {
        errors.push({
          row: i + 1,
          field: 'rate',
          value: String(rawRateField),
          message: `Rate must be between 0% and 100% (got ${rawRateField})`,
          messageEs: `La tasa debe estar entre 0% y 100% (recibido ${rawRateField})`,
        });
        continue;
      }
      // Auto-detect: if rate > 1, treat as percentage (5.25 → 0.0525); if ≤ 1, treat as decimal
      const rate = rawRate > 1 ? rawRate / 100 : rawRate;

      if (rawRate > 1) {
        warnings.push(
          `Row ${i + 1}: Rate ${rawRate} interpreted as ${rawRate}% (converted to ${rate})`,
        );
      }

      const rawRateType = this.getField(
        row,
        headerMap,
        'ratetype',
      ).toLowerCase();
      const rateType = RATE_TYPE_SYNONYMS[rawRateType] || rawRateType;

      // D22: duration validated up-front. 0-600 months (50y max).
      const rawDuration = this.getField(row, headerMap, 'duration');
      const duration = parseFinancialField(rawDuration, { min: 0, max: 600 });
      if (duration === null) {
        errors.push({
          row: i + 1,
          field: 'duration',
          value: String(rawDuration),
          message: `Duration must be between 0 and 600 months (got ${rawDuration})`,
          messageEs: `La duración debe estar entre 0 y 600 meses (recibido ${rawDuration})`,
        });
        continue;
      }

      const repriceDateRaw = this.getField(row, headerMap, 'repricedate');
      const maturityDateRaw = this.getField(row, headerMap, 'maturitydate');

      items.push({
        category,
        subcategory,
        name: this.getField(row, headerMap, 'name'),
        balance,
        rate,
        duration,
        repriceDate: repriceDateRaw || undefined,
        maturityDate: maturityDateRaw || undefined,
        rateType,
      });
    }

    const totalAssets = items
      .filter((i) => i.category === 'asset')
      .reduce((s, i) => s + Number(i.balance), 0);
    const totalLiabilities = items
      .filter((i) => i.category === 'liability')
      .reduce((s, i) => s + Number(i.balance), 0);

    // Sanity check: equity should be positive
    if (items.length > 0 && totalAssets < totalLiabilities) {
      warnings.push(
        `Warning: Total liabilities ($${totalLiabilities.toFixed(1)}M) exceed total assets ($${totalAssets.toFixed(1)}M) — negative equity`,
      );
    }

    return {
      valid: errors.length === 0 && items.length > 0,
      items,
      errors,
      warnings,
      summary: {
        totalRows: lines.length - 1,
        validRows: items.length,
        errorRows: errors.length,
        totalAssets,
        totalLiabilities,
      },
    };
  }

  // ─── Cooperativa CSV Template ─────────────────────────────────────

  getCooperativaTemplate(): string {
    // Realistic $185M PR cooperativa — 40 rows, all 12 COSSEC ratios PASS
    // Assets: $185M | Liabilities: $165M | Equity: $20M (10.81% capital ratio)
    // L/D: 78.4% | Liquidity: 47.0% | NIM: 2.71% | Concentration: 39.8% residential (WARNING, realistic)
    // NOTE: All rates expressed as percentages (>1) to avoid CSV auto-detect misinterpretation
    return [
      'category,subcategory,name,balance,rate,duration,rateType,repriceDate,maturityDate',
      // ── Residential Mortgages ($39M) ──
      'asset,residential_mortgages,30yr Fixed Pool A - San Juan,7.5,5.75,12.0,fixed,,2038-03-01',
      'asset,residential_mortgages,30yr Fixed Pool B - Bayamon,6.5,5.50,14.0,fixed,,2040-03-01',
      'asset,residential_mortgages,30yr Fixed Pool C - Caguas,5.5,6.00,10.0,fixed,,2036-03-01',
      'asset,residential_mortgages,15yr Fixed Pool D - Ponce,5.0,4.75,8.0,fixed,,2034-03-01',
      'asset,residential_mortgages,15yr Fixed Pool E - Mayaguez,4.5,4.50,7.5,fixed,,2033-09-01',
      'asset,residential_mortgages,30yr Fixed Pool F - Arecibo,4.0,5.85,13.0,fixed,,2039-03-01',
      'asset,residential_mortgages,ARM Pool G - Carolina,3.5,6.50,9.0,variable,2026-09-01,2035-03-01',
      'asset,residential_mortgages,15yr Fixed Pool H - Humacao,2.5,5.00,6.5,fixed,,2032-09-01',
      // ── Consumer / Auto Loans ($27M) ──
      'asset,consumer_loans,Auto Loans - New Vehicles,8.0,7.50,4.0,fixed,,2030-03-01',
      'asset,consumer_loans,Auto Loans - Used Vehicles,6.0,8.25,3.0,fixed,,2029-03-01',
      'asset,consumer_loans,Personal Lines of Credit,5.0,9.00,2.0,variable,2026-06-01,2028-03-01',
      'asset,consumer_loans,Student Consolidation Loans,4.0,7.00,5.0,fixed,,2031-03-01',
      'asset,consumer_loans,Secured Personal Loans,4.0,7.75,3.5,fixed,,2029-09-01',
      // ── Commercial Loans ($32M) ──
      'asset,commercial_loans,CRE - Retail Center Bayamon,10.0,6.50,5.0,fixed,,2031-03-01',
      'asset,commercial_loans,CRE - Office Park San Juan,9.0,7.00,4.0,variable,2026-09-01,2030-03-01',
      'asset,commercial_loans,Small Business Term Loans,7.0,7.50,3.0,fixed,,2029-03-01',
      'asset,commercial_loans,Working Capital Lines,6.0,8.00,2.0,variable,2026-06-01,2028-03-01',
      // ── Investment Securities ($60M) ──
      'asset,investment_securities,US Treasury Notes 2yr,16.0,4.25,2.0,fixed,,2028-03-01',
      'asset,investment_securities,US Treasury Notes 5yr,14.0,4.50,4.5,fixed,,2030-09-01',
      'asset,investment_securities,Agency MBS - FNMA 30yr,16.0,5.00,6.0,fixed,,2032-03-01',
      'asset,investment_securities,Agency MBS - FHLMC 15yr,14.0,4.75,3.5,fixed,,2029-09-01',
      // ── Cash Equivalents ($27M) ──
      'asset,cash_equivalents,Fed Funds Sold,10.0,5.25,0.01,variable,2026-04-01,2026-04-01',
      'asset,cash_equivalents,Interest-Bearing Deposits - BPPR,9.0,4.80,0.08,variable,2026-04-01,2026-04-30',
      'asset,cash_equivalents,Money Market Instruments,8.0,4.50,0.25,variable,2026-06-01,2026-06-15',
      // ── Savings Deposits ($50M) ──
      'liability,savings_deposits,Regular Savings - Socios,24.0,1.50,0.25,variable,2026-06-01,',
      'liability,savings_deposits,Christmas Club Savings,9.0,2.00,0.5,variable,2026-06-01,',
      'liability,savings_deposits,Youth Savings Accounts,5.0,1.75,0.25,variable,2026-06-01,',
      'liability,savings_deposits,Money Market Savings,12.0,3.00,0.17,variable,2026-04-01,',
      // ── Demand Deposits ($20M) ──
      'liability,demand_deposits,Share Draft / Checking,13.0,1.25,0.08,variable,,',
      'liability,demand_deposits,Business Checking,7.0,1.50,0.08,variable,,',
      // ── Time Deposits / CDs ($55M) ──
      'liability,time_deposits,6-Month Share Certificates,10.0,2.50,0.5,fixed,,2026-09-01',
      'liability,time_deposits,12-Month Share Certificates,15.0,3.00,1.0,fixed,,2027-03-01',
      'liability,time_deposits,18-Month Share Certificates,12.0,3.25,1.5,fixed,,2027-09-01',
      'liability,time_deposits,24-Month Share Certificates,10.0,3.50,2.0,fixed,,2028-03-01',
      'liability,time_deposits,60-Month Share Certificates,8.0,3.75,5.0,fixed,,2031-03-01',
      // ── FHLB Borrowings ($35M) ──
      'liability,borrowings,FHLB Advance - 1yr Fixed,14.0,5.00,1.0,fixed,,2027-03-01',
      'liability,borrowings,FHLB Advance - 2yr Fixed,12.0,5.15,2.0,fixed,,2028-03-01',
      'liability,borrowings,FHLB Advance - 3yr Fixed,9.0,5.30,3.0,fixed,,2029-03-01',
      // ── Subordinated Debt ($5M) ──
      'liability,subordinated_debt,Subordinated Capital Notes 2031,3.0,5.50,5.0,fixed,,2031-03-01',
      'liability,subordinated_debt,Subordinated Capital Notes 2029,2.0,5.25,3.0,fixed,,2029-03-01',
    ].join('\n');
  }

  getGenericTemplate(): string {
    return [
      'category,subcategory,name,balance,rate,duration,rateType',
      'asset,commercial_loans,Commercial Real Estate,350,5.25,4.5,fixed',
      'asset,residential_mortgages,30yr Fixed Mortgages,280,4.75,6.2,fixed',
      'asset,investment_securities,Treasury Notes,120,4.10,2.8,fixed',
      'asset,cash_equivalents,Cash & Fed Funds,80,5.30,0.1,variable',
      'liability,demand_deposits,Checking Accounts,200,0.50,0.1,variable',
      'liability,savings_deposits,Money Market,150,3.80,0.3,variable',
      'liability,time_deposits,12-Month CDs,180,4.00,0.9,fixed',
      'liability,borrowings,FHLB Advances,100,4.50,1.5,fixed',
    ].join('\n');
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  /** Map Spanish/English header synonyms to canonical keys */
  private mapHeaders(headers: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    const synonyms: Record<string, string> = {
      category: 'category',
      categoria: 'category',
      subcategory: 'subcategory',
      subcategoria: 'subcategory',
      name: 'name',
      nombre: 'name',
      balance: 'balance',
      saldo: 'balance',
      monto: 'balance',
      rate: 'rate',
      tasa: 'rate',
      duration: 'duration',
      duracion: 'duration',
      ratetype: 'ratetype',
      tipotasa: 'ratetype',
      tipo_tasa: 'ratetype',
      repricedate: 'repricedate',
      fechareprecio: 'repricedate',
      maturitydate: 'maturitydate',
      fechavencimiento: 'maturitydate',
    };

    headers.forEach((h, idx) => {
      const canonical = synonyms[h.replace(/[_\s]/g, '')] || h;
      if (!map[canonical]) {
        map[canonical] = idx;
      }
    });

    return map;
  }

  private getField(
    row: Record<string, string>,
    headerMap: Record<string, number>,
    key: string,
  ): string {
    const headers = Object.keys(row);
    const idx = headerMap[key];
    if (idx === undefined) return '';
    return row[headers[idx]] || '';
  }

  /** Handle quoted CSV fields (commas inside quotes) */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  private validateRow(
    row: Record<string, string>,
    headerMap: Record<string, number>,
    rowNum: number,
  ): CSVRowError[] {
    const errors: CSVRowError[] = [];

    // Category
    const category = this.getField(row, headerMap, 'category').toLowerCase();
    if (!VALID_CATEGORIES.includes(category)) {
      errors.push({
        row: rowNum,
        field: 'category',
        value: category,
        message: `Invalid category "${category}". Must be: asset, liability (or activo, pasivo)`,
        messageEs: `Categoría inválida "${category}". Debe ser: asset, liability, activo, o pasivo`,
      });
    }

    // Name
    const name = this.getField(row, headerMap, 'name');
    if (!name || name.length === 0) {
      errors.push({
        row: rowNum,
        field: 'name',
        value: name,
        message: 'Name is required',
        messageEs: 'Nombre es requerido',
      });
    }

    // D22: Balance — strict parse + bounds in one step. Bounds
    // accept non-negative with no practical upper cap here (the
    // ingest path above enforces the $999B cap; this is the
    // validation surface used pre-ingest to surface UX errors).
    const balanceStr = this.getField(row, headerMap, 'balance');
    const balance = parseFinancialField(balanceStr, {
      min: 0,
      max: 999_999_999_999,
    });
    if (balance === null) {
      errors.push({
        row: rowNum,
        field: 'balance',
        value: balanceStr,
        message: `Invalid balance "${balanceStr}" — must be a non-negative number up to $999B`,
        messageEs: `Saldo inválido "${balanceStr}" — debe ser un número no negativo hasta $999B`,
      });
    }

    // D22: Rate 0-100 (validator accepts either percent or decimal
    // before the service normalizes; mirror the upper-loop rule).
    const rateStr = this.getField(row, headerMap, 'rate');
    const rate = parseFinancialField(rateStr, { min: 0, max: 100 });
    if (rate === null) {
      errors.push({
        row: rowNum,
        field: 'rate',
        value: rateStr,
        message: `Invalid rate "${rateStr}" — must be a number between 0 and 100`,
        messageEs: `Tasa inválida "${rateStr}" — debe ser un número entre 0 y 100`,
      });
    }

    // D22: Duration 0-50 years at this surface (the pre-ingest
    // validation layer uses years; the post-ingest layer uses
    // months; this is intentional — matches existing test coverage).
    const durationStr = this.getField(row, headerMap, 'duration');
    const duration = parseFinancialField(durationStr, { min: 0, max: 50 });
    if (duration === null) {
      errors.push({
        row: rowNum,
        field: 'duration',
        value: durationStr,
        message: `Invalid duration "${durationStr}" — must be a number between 0 and 50 years`,
        messageEs: `Duración inválida "${durationStr}" — debe ser un número entre 0 y 50 años`,
      });
    }

    // Rate type
    const rateType = this.getField(row, headerMap, 'ratetype').toLowerCase();
    if (rateType && !VALID_RATE_TYPES.includes(rateType)) {
      errors.push({
        row: rowNum,
        field: 'rateType',
        value: rateType,
        message: `Invalid rate type "${rateType}". Must be: fixed, variable, hybrid (or fijo/fija, hibrido/hibrida)`,
        messageEs: `Tipo de tasa inválido "${rateType}". Debe ser: fixed, variable, hybrid (o fijo/fija, hibrido/hibrida)`,
      });
    }

    return errors;
  }

  private emptyResult(errorMessage: string): CSVParseResult {
    return {
      valid: false,
      items: [],
      errors: [
        {
          row: 0,
          field: 'headers',
          value: '',
          message: errorMessage,
          messageEs: errorMessage,
        },
      ],
      warnings: [],
      summary: {
        totalRows: 0,
        validRows: 0,
        errorRows: 1,
        totalAssets: 0,
        totalLiabilities: 0,
      },
    };
  }
}
