import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { parseFinancialField } from '../../common/utils/financial-field';
import { DataGap, dataGap } from '../reports/data-gap';

/**
 * Loan-tape ingestion (Wave 2, W2.0 Slice 1 — the Tier-B linchpin).
 *
 * Parses a generic instrument-level CSV (the industry-standard core-system
 * export pattern — Bible §4.2/§6.1; Fiserv DNA sells exactly this shape as
 * an "ALM-CECL Extract") into `LoanRecord` rows. Reuses the proven
 * csv-ingestion spine: bilingual header aliases, `parseFinancialField` for
 * every numeric (no phantom values from trailing garbage), a 50K-row cap,
 * and per-row bilingual errors.
 *
 * D1 contract:
 *   - MISSING optional field → null + a tape-level LOAN_TAPE_FIELD_MISSING
 *     WARNING gap with the coverage count. GARBAGE in any present field →
 *     a row ERROR (absent and unparsable are different facts).
 *   - municipio is stored as given (whitespace-normalized) and NEVER
 *     imputed — an imputed municipio would silently corrupt the W2.2
 *     concentration metrics.
 *   - Persistence is ALL-OR-NOTHING per tape: any row error rejects the
 *     whole upload (nothing deleted, nothing written). A half-ingested
 *     tape mistaken for the full book would understate every aggregate —
 *     worse than an explicit rejection listing the rows to fix.
 *   - A clean tape transactionally REPLACES the institution's records for
 *     that asOfDate — re-uploads are idempotent.
 *
 * Core-specific adapters (Fiserv DNA, Sharetec) are later W2.0 slices; the
 * generic CSV path de-risks the long tail regardless (roadmap).
 */

const MAX_TAPE_ROWS = 50_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical field → normalized header aliases (lowercase, no spaces/underscores). */
const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  externalLoanId: [
    'loanid',
    'loannumber',
    'numeroprestamo',
    'numprestamo',
    'idprestamo',
    'prestamoid',
  ],
  segmentName: ['segment', 'segmento', 'producto', 'product', 'tipoproducto'],
  balance: ['balance', 'saldo', 'saldoactual', 'outstandingbalance'],
  rate: ['rate', 'tasa', 'tasainteres', 'interestrate'],
  originationDate: ['originationdate', 'fechaoriginacion', 'fechaorigen'],
  maturityDate: ['maturitydate', 'fechavencimiento', 'vencimiento'],
  collateralType: [
    'collateraltype',
    'tipocolateral',
    'tipogarantia',
    'garantia',
  ],
  collateralValue: [
    'collateralvalue',
    'valorcolateral',
    'valorgarantia',
    'valortasacion',
  ],
  municipio: ['municipio', 'municipality'],
  delinquencyDays: [
    'delinquencydays',
    'diasmora',
    'diasdemora',
    'diasatraso',
    'dpd',
  ],
  borrowerId: [
    'borrowerid',
    'idsocio',
    'socioid',
    'numerosocio',
    'numsocio',
    'clienteid',
    'idcliente',
    'relacionid',
  ],
};

type CanonicalField =
  | 'externalLoanId'
  | 'segmentName'
  | 'balance'
  | 'rate'
  | 'originationDate'
  | 'maturityDate'
  | 'collateralType'
  | 'collateralValue'
  | 'municipio'
  | 'delinquencyDays'
  | 'borrowerId';

const REQUIRED_FIELDS: CanonicalField[] = [
  'externalLoanId',
  'segmentName',
  'balance',
];
const OPTIONAL_FIELDS: CanonicalField[] = [
  'rate',
  'originationDate',
  'maturityDate',
  'collateralType',
  'collateralValue',
  'municipio',
  'delinquencyDays',
  'borrowerId',
];

export interface ParsedLoanRecord {
  externalLoanId: string;
  segmentName: string;
  balance: number;
  rate: number | null;
  originationDate: string | null; // ISO YYYY-MM-DD
  maturityDate: string | null;
  collateralType: string | null;
  collateralValue: number | null;
  municipio: string | null;
  delinquencyDays: number | null;
  borrowerId: string | null;
}

export interface LoanTapeRowError {
  row: number;
  field: string;
  value: string;
  message: string;
  messageEs: string;
}

export interface LoanTapeParseResult {
  valid: boolean;
  records: ParsedLoanRecord[];
  errors: LoanTapeRowError[];
  warnings: string[];
  /** Tape-level per-field coverage disclosures (WARNING, never blocking). */
  gaps: DataGap[];
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    totalBalance: number;
    missingByField: Partial<Record<CanonicalField, number>>;
  };
}

export interface LoanTapeIngestResult {
  status: 'ingested' | 'rejected';
  asOfDate: string;
  persisted: number;
  replaced: boolean;
  parse: LoanTapeParseResult;
}

@Injectable()
export class LoanTapeIngestService {
  private readonly logger = new Logger(LoanTapeIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parse + persist a loan tape for one institution and tape date.
   * All-or-nothing: any row error rejects the upload without touching the
   * previously persisted tape for that date.
   */
  async ingestLoanTape(
    institutionId: string,
    asOfDate: string,
    csvContent: string,
  ): Promise<LoanTapeIngestResult> {
    const parse = this.parseLoanTape(csvContent);

    if (!ISO_DATE_RE.test(asOfDate) || !this.isRealDate(asOfDate)) {
      parse.errors.unshift({
        row: 0,
        field: 'asOfDate',
        value: asOfDate,
        message: `asOfDate must be a real date in YYYY-MM-DD form (got "${asOfDate}")`,
        messageEs: `asOfDate debe ser una fecha real en formato YYYY-MM-DD (recibido "${asOfDate}")`,
      });
      return {
        status: 'rejected',
        asOfDate,
        persisted: 0,
        replaced: false,
        parse: { ...parse, valid: false },
      };
    }

    if (!parse.valid || parse.errors.length > 0) {
      this.logger.warn({
        event: 'loan_tape_rejected',
        institutionId,
        asOfDate,
        errorRows: parse.summary.errorRows,
        totalRows: parse.summary.totalRows,
      });
      return {
        status: 'rejected',
        asOfDate,
        persisted: 0,
        replaced: false,
        parse,
      };
    }

    const tapeDate = new Date(`${asOfDate}T00:00:00Z`);
    const existing = await this.prisma.loanRecord.count({
      where: { institutionId, asOfDate: tapeDate },
    });

    await this.prisma.$transaction([
      this.prisma.loanRecord.deleteMany({
        where: { institutionId, asOfDate: tapeDate },
      }),
      this.prisma.loanRecord.createMany({
        data: parse.records.map((r) => ({
          institutionId,
          asOfDate: tapeDate,
          externalLoanId: r.externalLoanId,
          segmentName: r.segmentName,
          balance: r.balance,
          rate: r.rate,
          originationDate: r.originationDate
            ? new Date(`${r.originationDate}T00:00:00Z`)
            : null,
          maturityDate: r.maturityDate
            ? new Date(`${r.maturityDate}T00:00:00Z`)
            : null,
          collateralType: r.collateralType,
          collateralValue: r.collateralValue,
          municipio: r.municipio,
          delinquencyDays: r.delinquencyDays,
          borrowerId: r.borrowerId,
        })),
      }),
    ]);

    this.logger.log({
      event: 'loan_tape_ingested',
      institutionId,
      asOfDate,
      persisted: parse.records.length,
      replacedPrior: existing,
    });

    return {
      status: 'ingested',
      asOfDate,
      persisted: parse.records.length,
      replaced: existing > 0,
      parse,
    };
  }

  /** Pure parser — no I/O, deterministic, spec/golden-friendly. */
  parseLoanTape(csvContent: string): LoanTapeParseResult {
    const lines = csvContent
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      return this.rejectedResult(
        'Loan tape must have a header row and at least one data row',
        'La cinta de préstamos debe tener una fila de encabezados y al menos una fila de datos',
      );
    }
    if (lines.length > MAX_TAPE_ROWS + 1) {
      return this.rejectedResult(
        `Loan tape exceeds the maximum of ${MAX_TAPE_ROWS.toLocaleString()} rows (got ${(lines.length - 1).toLocaleString()})`,
        `La cinta excede el máximo de ${MAX_TAPE_ROWS.toLocaleString()} filas (recibido ${(lines.length - 1).toLocaleString()})`,
      );
    }

    // Header resolution: normalized header → canonical field.
    const headers = lines[0].split(',').map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, ''),
    );
    const headerIndex = new Map<CanonicalField, number>();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
      [CanonicalField, string[]]
    >) {
      const idx = headers.findIndex((h) => aliases.includes(h));
      if (idx >= 0) headerIndex.set(field, idx);
    }

    const missingRequired = REQUIRED_FIELDS.filter((f) => !headerIndex.has(f));
    if (missingRequired.length > 0) {
      return this.rejectedResult(
        `Missing required column(s): ${missingRequired.join(', ')} — accepted aliases include loan_id/numero_prestamo, segment/producto, balance/saldo`,
        `Faltan columna(s) requerida(s): ${missingRequired.join(', ')} — alias aceptados incluyen loan_id/numero_prestamo, segment/producto, balance/saldo`,
      );
    }

    const records: ParsedLoanRecord[] = [];
    const errors: LoanTapeRowError[] = [];
    const warnings: string[] = [];
    const seenLoanIds = new Set<string>();
    const missingByField: Partial<Record<CanonicalField, number>> = {};
    let totalBalance = 0;

    const cell = (values: string[], field: CanonicalField): string => {
      const idx = headerIndex.get(field);
      return idx === undefined ? '' : (values[idx] ?? '').trim();
    };
    const countMissing = (field: CanonicalField) => {
      missingByField[field] = (missingByField[field] ?? 0) + 1;
    };

    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1;
      const values = lines[i].split(',');
      const rowErrors: LoanTapeRowError[] = [];

      const externalLoanId = cell(values, 'externalLoanId');
      if (!externalLoanId) {
        rowErrors.push(
          this.rowError(rowNum, 'externalLoanId', externalLoanId, {
            en: 'Loan id is required',
            es: 'El número de préstamo es requerido',
          }),
        );
      } else if (seenLoanIds.has(externalLoanId)) {
        rowErrors.push(
          this.rowError(rowNum, 'externalLoanId', externalLoanId, {
            en: `Duplicate loan id "${externalLoanId}" in the same tape`,
            es: `Número de préstamo duplicado "${externalLoanId}" en la misma cinta`,
          }),
        );
      }

      const segmentName = cell(values, 'segmentName');
      if (!segmentName) {
        rowErrors.push(
          this.rowError(rowNum, 'segmentName', segmentName, {
            en: 'Segment/product is required',
            es: 'El segmento/producto es requerido',
          }),
        );
      }

      const rawBalance = cell(values, 'balance');
      const balance = parseFinancialField(rawBalance, {
        min: 0,
        max: 999_999_999_999,
      });
      if (balance === null) {
        rowErrors.push(
          this.rowError(rowNum, 'balance', rawBalance, {
            en: `Balance must be a non-negative number up to $999B (got "${rawBalance}")`,
            es: `El saldo debe ser un número no negativo hasta $999B (recibido "${rawBalance}")`,
          }),
        );
      }

      // ── Optional fields: absent → null + coverage count; garbage → error ──
      const rate = this.parseOptionalRate(
        cell(values, 'rate'),
        rowNum,
        rowErrors,
        () => countMissing('rate'),
      );
      const originationDate = this.parseOptionalDate(
        cell(values, 'originationDate'),
        'originationDate',
        rowNum,
        rowErrors,
        () => countMissing('originationDate'),
      );
      const maturityDate = this.parseOptionalDate(
        cell(values, 'maturityDate'),
        'maturityDate',
        rowNum,
        rowErrors,
        () => countMissing('maturityDate'),
      );
      if (originationDate && maturityDate && maturityDate < originationDate) {
        rowErrors.push(
          this.rowError(rowNum, 'maturityDate', maturityDate, {
            en: `Maturity ${maturityDate} precedes origination ${originationDate}`,
            es: `El vencimiento ${maturityDate} precede a la originación ${originationDate}`,
          }),
        );
      }

      const rawCollateralType = cell(values, 'collateralType');
      const collateralType = rawCollateralType || null;
      if (!collateralType) countMissing('collateralType');

      const collateralValue = this.parseOptionalAmount(
        cell(values, 'collateralValue'),
        'collateralValue',
        rowNum,
        rowErrors,
        () => countMissing('collateralValue'),
      );

      // Municipio: whitespace-normalized, stored as given, NEVER imputed.
      const rawMunicipio = cell(values, 'municipio').replace(/\s+/g, ' ');
      const municipio = rawMunicipio || null;
      if (!municipio) countMissing('municipio');

      const delinquencyDays = this.parseOptionalDays(
        cell(values, 'delinquencyDays'),
        rowNum,
        rowErrors,
        () => countMissing('delinquencyDays'),
      );

      // Borrower key: stored as given, NEVER imputed (a null borrower is
      // excluded from single-borrower aggregation, not its own obligor).
      const rawBorrowerId = cell(values, 'borrowerId');
      const borrowerId = rawBorrowerId || null;
      if (!borrowerId) countMissing('borrowerId');

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      seenLoanIds.add(externalLoanId);
      totalBalance += balance as number;
      records.push({
        externalLoanId,
        segmentName,
        balance: balance as number,
        rate,
        originationDate,
        maturityDate,
        collateralType,
        collateralValue,
        municipio,
        borrowerId,
        delinquencyDays,
      });
    }

    // Tape-level coverage gaps (D1: per-field disclosure, never imputation).
    const gaps: DataGap[] = [];
    for (const field of OPTIONAL_FIELDS) {
      const missing = missingByField[field] ?? 0;
      if (missing > 0) {
        gaps.push(
          dataGap(`loanTape.${field}`, 'LOAN_TAPE_FIELD_MISSING', {
            severity: 'WARNING',
            action: `"${field}" falta en ${missing} de ${lines.length - 1} filas — los agregados que dependen de este campo divulgarán la cobertura parcial; nunca se imputa. / "${field}" is missing on ${missing} of ${lines.length - 1} rows — aggregates depending on this field will disclose partial coverage; it is never imputed.`,
            context: {
              field,
              missingRows: missing,
              totalRows: lines.length - 1,
            },
          }),
        );
      }
    }

    const totalRows = lines.length - 1;
    return {
      valid: errors.length === 0 && records.length > 0,
      records,
      errors,
      warnings,
      gaps,
      summary: {
        totalRows,
        validRows: records.length,
        errorRows: totalRows - records.length,
        totalBalance,
        missingByField,
      },
    };
  }

  // ─── field parsers (absent → null; garbage → row error) ───

  private parseOptionalRate(
    raw: string,
    rowNum: number,
    rowErrors: LoanTapeRowError[],
    onMissing: () => void,
  ): number | null {
    if (raw === '') {
      onMissing();
      return null;
    }
    const parsed = parseFinancialField(raw, { min: 0, max: 100 });
    if (parsed === null) {
      rowErrors.push(
        this.rowError(rowNum, 'rate', raw, {
          en: `Rate must be a number 0-100 (percent) or 0-1 (decimal); got "${raw}"`,
          es: `La tasa debe ser un número 0-100 (porcentaje) o 0-1 (decimal); recibido "${raw}"`,
        }),
      );
      return null;
    }
    // Percent-or-decimal auto-scale (matches csv-ingestion): >1 = percent form.
    return parsed > 1 ? parsed / 100 : parsed;
  }

  private parseOptionalAmount(
    raw: string,
    field: string,
    rowNum: number,
    rowErrors: LoanTapeRowError[],
    onMissing: () => void,
  ): number | null {
    if (raw === '') {
      onMissing();
      return null;
    }
    const parsed = parseFinancialField(raw, { min: 0, max: 999_999_999_999 });
    if (parsed === null) {
      rowErrors.push(
        this.rowError(rowNum, field, raw, {
          en: `${field} must be a non-negative number (got "${raw}")`,
          es: `${field} debe ser un número no negativo (recibido "${raw}")`,
        }),
      );
    }
    return parsed;
  }

  private parseOptionalDays(
    raw: string,
    rowNum: number,
    rowErrors: LoanTapeRowError[],
    onMissing: () => void,
  ): number | null {
    if (raw === '') {
      onMissing();
      return null;
    }
    const parsed = parseFinancialField(raw, {
      min: 0,
      max: 36_500,
      integer: true,
    });
    if (parsed === null) {
      rowErrors.push(
        this.rowError(rowNum, 'delinquencyDays', raw, {
          en: `Delinquency days must be a non-negative integer (got "${raw}")`,
          es: `Los días de mora deben ser un entero no negativo (recibido "${raw}")`,
        }),
      );
    }
    return parsed;
  }

  private parseOptionalDate(
    raw: string,
    field: string,
    rowNum: number,
    rowErrors: LoanTapeRowError[],
    onMissing: () => void,
  ): string | null {
    if (raw === '') {
      onMissing();
      return null;
    }
    if (!ISO_DATE_RE.test(raw) || !this.isRealDate(raw)) {
      rowErrors.push(
        this.rowError(rowNum, field, raw, {
          en: `${field} must be a real date in YYYY-MM-DD form (got "${raw}")`,
          es: `${field} debe ser una fecha real en formato YYYY-MM-DD (recibido "${raw}")`,
        }),
      );
      return null;
    }
    return raw;
  }

  /** YYYY-MM-DD strings that survive a UTC round-trip (rejects 2026-02-30). */
  private isRealDate(iso: string): boolean {
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso;
  }

  private rowError(
    row: number,
    field: string,
    value: string,
    msg: { en: string; es: string },
  ): LoanTapeRowError {
    return { row, field, value, message: msg.en, messageEs: msg.es };
  }

  private rejectedResult(
    message: string,
    messageEs: string,
  ): LoanTapeParseResult {
    return {
      valid: false,
      records: [],
      errors: [{ row: 0, field: 'file', value: '', message, messageEs }],
      warnings: [],
      gaps: [],
      summary: {
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        totalBalance: 0,
        missingByField: {},
      },
    };
  }
}
