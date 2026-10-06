import { Injectable, Logger } from '@nestjs/common';

/**
 * Schema inference for arbitrary balance-sheet files.
 *
 * The strict parser in `csv-ingestion.service.ts` requires an exact header set
 * (`category, subcategory, name, balance, rate, duration, rateType`). Real
 * cooperativa exports almost never look like that: COSSEC and core-banking
 * extracts arrive semicolon-delimited from Spanish-locale Excel, with two or
 * three title rows above the real header, `Saldo`/`Monto` instead of `balance`,
 * and `1.234.567,89` instead of `1234567.89`. Every one of those hard-failed.
 *
 * This service does NOT re-implement validation. It infers the file's shape,
 * rewrites it into the canonical CSV that the existing parser already accepts,
 * and hands it back. One validation path, one source of truth.
 *
 * Guardrail — inference may DERIVE but never INVENT:
 *   • deriving `category` from a known `subcategory` is arithmetic on facts
 *     already in the file (`savings_deposits` is a liability, always);
 *   • guessing a missing `rate` is not. Missing required values become
 *     questions for the user, never a silently-substituted zero. That is D1
 *     ("gaps + partial reports, never 0 for missing data") applied to import.
 */

export const CANONICAL_HEADER =
  'category,subcategory,name,balance,rate,duration,rateType,repriceDate,maturityDate';

/** Fields the strict parser requires a column for. */
export const REQUIRED_FIELDS = [
  'category',
  'subcategory',
  'name',
  'balance',
  'rate',
  'duration',
  'rateType',
] as const;

export const OPTIONAL_FIELDS = ['repriceDate', 'maturityDate'] as const;

export type CanonicalField =
  | (typeof REQUIRED_FIELDS)[number]
  | (typeof OPTIONAL_FIELDS)[number];

/**
 * Header synonyms, EN + ES. Keys are already normalized (lowercase, accents
 * stripped, non-alphanumerics collapsed to `_`), so `Saldo Actual ($)` and
 * `saldo_actual` both land on `saldo_actual`.
 */
const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  category: [
    'category',
    'categoria',
    'tipo',
    'type',
    'clase',
    'class',
    'grupo',
    'group',
    'tipo_cuenta',
    'account_type',
    'naturaleza',
  ],
  subcategory: [
    'subcategory',
    'subcategoria',
    'sub_categoria',
    'cuenta',
    'account',
    'producto',
    'product',
    'concepto',
    'rubro',
    'linea',
    'line',
    'account_group',
    'clasificacion',
  ],
  name: [
    'name',
    'nombre',
    'descripcion',
    'description',
    'detalle',
    'detail',
    'label',
    'titulo',
    'title',
    'instrumento',
    'instrument',
    'denominacion',
  ],
  balance: [
    'balance',
    'saldo',
    'monto',
    'importe',
    'amount',
    'valor',
    'value',
    'principal',
    'saldo_actual',
    'saldo_final',
    'current_balance',
    'outstanding',
    'book_value',
    'valor_libro',
  ],
  rate: [
    'rate',
    'tasa',
    'interes',
    'interest',
    'apr',
    'yield',
    'rendimiento',
    'tasa_interes',
    'interest_rate',
    'tasa_promedio',
    'coupon',
    'cupon',
  ],
  duration: [
    'duration',
    'duracion',
    'plazo',
    'term',
    'plazo_meses',
    'term_months',
    'wal',
    'vida_promedio',
    'average_life',
    'duracion_efectiva',
    'effective_duration',
  ],
  rateType: [
    'ratetype',
    'rate_type',
    'tipo_tasa',
    'tipo_de_tasa',
    'fijo_variable',
    'fixed_variable',
    'modalidad',
    'rate_basis',
  ],
  repriceDate: [
    'repricedate',
    'reprice_date',
    'fecha_revision',
    'revision',
    'repricing',
    'fecha_reprecio',
    // Bare "Reprecio" is what PR cooperativa exports actually use as the column
    // heading; only the compound `fecha_reprecio` was recognised, so the column
    // was silently dropped and every variable-rate row lost its reprice date —
    // which is the input the repricing-gap analysis depends on.
    'reprecio',
    'reprecios',
    'next_reprice',
    'proxima_revision',
  ],
  maturityDate: [
    'maturitydate',
    'maturity_date',
    'fecha_vencimiento',
    'vencimiento',
    'maturity',
    'vence',
    'due_date',
    'fecha_final',
  ],
};

/**
 * Keyword → subcategory, for files that name the product in prose instead of
 * carrying a subcategory column. Ordered most-specific first: "prestamos
 * hipotecarios" must beat the bare "prestamos".
 */
const SUBCATEGORY_KEYWORDS: Array<{ match: string[]; subcategory: string }> = [
  {
    match: ['hipotecar', 'mortgage', 'residencial', 'vivienda', 'casa'],
    subcategory: 'residential_mortgages',
  },
  {
    match: ['comercial', 'commercial', 'cre', 'negocio', 'empresarial', 'pyme'],
    subcategory: 'commercial_loans',
  },
  {
    match: [
      'auto',
      'vehicul',
      'personal',
      'consumo',
      'consumer',
      'tarjeta',
      'card',
      'estudiantil',
      'student',
    ],
    subcategory: 'consumer_loans',
  },
  {
    match: [
      'inversion',
      'investment',
      'treasury',
      'tesoro',
      'bono',
      'bond',
      'mbs',
      'securit',
      'valores',
    ],
    subcategory: 'investment_securities',
  },
  {
    match: ['efectivo', 'cash', 'fed_funds', 'caja', 'disponibilidad'],
    subcategory: 'cash_equivalents',
  },
  {
    match: ['certificad', 'plazo', 'time_deposit', 'cd', 'certificate'],
    subcategory: 'time_deposits',
  },
  {
    match: ['ahorro', 'saving', 'socio'],
    subcategory: 'savings_deposits',
  },
  {
    match: ['corriente', 'checking', 'demand', 'share_draft', 'vista'],
    subcategory: 'demand_deposits',
  },
  {
    match: ['subordinad', 'subordinated'],
    subcategory: 'subordinated_debt',
  },
  {
    match: [
      'fhlb',
      'externo',
      'borrowing',
      'advance',
      'adelanto',
      'linea_credito',
      'obligacion',
    ],
    subcategory: 'borrowings',
  },
];

/**
 * Structural rows that carry a number but are not line items. They must be
 * excluded from the denominator when judging whether a file is classifiable —
 * otherwise a single `TOTAL` footer drags an otherwise-perfect export below
 * the confidence threshold — and dropped during conversion, so their amounts
 * are never double-counted into the balance sheet.
 */
const AGGREGATE_ROW_LABELS = [
  'total',
  'totales',
  'subtotal',
  'sub_total',
  'gran_total',
  'suma',
  'sumas',
  'balance_general',
  'grand_total',
];

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

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

/** How far down the file to look for the real header row. */
const MAX_HEADER_SCAN_ROWS = 25;

export type QuestionKind = 'map_column' | 'provide_default' | 'confirm';

export interface InferenceQuestion {
  id: string;
  field: CanonicalField;
  kind: QuestionKind;
  /** English prompt; the frontend supplies its own ES copy where needed. */
  prompt: string;
  promptEs: string;
  /** Candidate source columns (map_column) or suggested values (provide_default). */
  options: string[];
  /** False when the import genuinely cannot proceed without an answer. */
  deferrable: boolean;
  suggestion: string | null;
}

export interface DetectedColumn {
  sourceHeader: string;
  sourceIndex: number;
  field: CanonicalField | null;
  confidence: number;
}

export interface SchemaInference {
  /** ready = safe to import now; needs_input = ask the user; unusable = not tabular. */
  status: 'ready' | 'needs_input' | 'unusable';
  delimiter: string;
  delimiterLabel: string;
  headerRowIndex: number;
  skippedPreambleRows: number;
  sourceHeaders: string[];
  columns: DetectedColumn[];
  mapping: Partial<Record<CanonicalField, number>>;
  questions: InferenceQuestion[];
  /** Assumptions applied, surfaced so a report can disclose them. */
  notes: string[];
  dataRowCount: number;
  sampleRows: string[][];
  unusableReason: string | null;
}

export interface ResolutionInput {
  /** field → source column index, from the user answering a map_column question. */
  columnOverrides?: Partial<Record<CanonicalField, number>>;
  /** field → literal value applied to every row, from a provide_default answer. */
  defaults?: Partial<Record<CanonicalField, string>>;
}

@Injectable()
export class CsvSchemaInferenceService {
  private readonly logger = new Logger(CsvSchemaInferenceService.name);

  /**
   * Normalize a header cell for synonym matching: strip BOM/accents, lowercase,
   * drop currency and unit decorations, collapse separators to `_`.
   * `"Saldo Actual ($)"` → `saldo_actual`.
   */
  normalizeHeader(raw: string): string {
    return raw
      .replace(/^\uFEFF/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[$%€]/g, ' ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Parse a number written in any of the shapes these exports actually use:
   * `1,234.56` (US), `1.234,56` (ES), `$1 234,56`, `(500)` for negative,
   * `5,75%`. Returns null when there is no number at all — callers must treat
   * that as a gap, never as zero.
   */
  parseLooseNumber(raw: string): number | null {
    if (raw === null || raw === undefined) {
      return null;
    }

    let text = String(raw).trim();
    if (text.length === 0) {
      return null;
    }

    const isParenNegative = /^\(.*\)$/.test(text);
    if (isParenNegative) {
      text = text.slice(1, -1);
    }

    const isTrailingNegative = /-$/.test(text);
    text = text
      .replace(/[$€£\s]/g, '')
      .replace(/%$/, '')
      .replace(/-$/, '');

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');

    if (hasComma && hasDot) {
      // Whichever separator appears last is the decimal point.
      const decimalIsComma = text.lastIndexOf(',') > text.lastIndexOf('.');
      text = decimalIsComma
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
    } else if (hasComma) {
      // A lone comma is a decimal separator when it isn't grouping digits in
      // threes: "1,5" is 1.5 but "1,500" is 1500.
      const [, tail = ''] = text.split(',');
      text =
        tail.length === 3 ? text.replace(/,/g, '') : text.replace(',', '.');
    }

    if (!/^-?\d*\.?\d+$/.test(text)) {
      return null;
    }

    const value = Number(text);
    if (!Number.isFinite(value)) {
      return null;
    }

    return isParenNegative || isTrailingNegative ? -value : value;
  }

  /** Quote-aware split for an arbitrary single-character delimiter. */
  splitLine(line: string, delimiter: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
        continue;
      }

      current += ch;
    }

    out.push(current.trim());
    return out;
  }

  /**
   * Pick the delimiter that yields the most consistent column count across the
   * sample. Consistency beats raw count: a prose column full of commas would
   * otherwise win on a semicolon-delimited file.
   */
  detectDelimiter(lines: string[]): string {
    const sample = lines.slice(0, 30);
    let best = ',';
    let bestScore = -1;

    for (const candidate of DELIMITER_CANDIDATES) {
      const counts = sample.map(
        (line) => this.splitLine(line, candidate).length,
      );
      const multiColumn = counts.filter((c) => c > 1);
      if (multiColumn.length === 0) {
        continue;
      }

      const frequency = new Map<number, number>();
      for (const count of multiColumn) {
        frequency.set(count, (frequency.get(count) || 0) + 1);
      }

      let modeCount = 0;
      let modeFrequency = 0;
      for (const [count, freq] of frequency) {
        if (freq > modeFrequency) {
          modeFrequency = freq;
          modeCount = count;
        }
      }

      // Reward agreement across rows, then width as the tie-break.
      const score = modeFrequency * 10 + modeCount;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  /** Best canonical field for a source header, with a 0..1 confidence. */
  private matchField(
    normalized: string,
  ): { field: CanonicalField; confidence: number } | null {
    if (!normalized) {
      return null;
    }

    let best: { field: CanonicalField; confidence: number } | null = null;

    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as Array<
      [CanonicalField, string[]]
    >) {
      for (const synonym of synonyms) {
        let confidence = 0;

        if (normalized === synonym) {
          confidence = 1;
        } else if (
          normalized.startsWith(`${synonym}_`) ||
          normalized.endsWith(`_${synonym}`)
        ) {
          confidence = 0.85;
        } else if (normalized.includes(synonym) && synonym.length >= 4) {
          confidence = 0.7;
        }

        if (confidence > 0 && (!best || confidence > best.confidence)) {
          best = { field, confidence };
        }
      }
    }

    return best;
  }

  /**
   * Locate the real header row. Excel and COSSEC exports routinely carry a
   * title, an institution name, and a blank line above it, so row 0 is only a
   * guess. Score each candidate by how many canonical fields it resolves.
   */
  detectHeaderRow(
    lines: string[],
    delimiter: string,
  ): { index: number; score: number } {
    let bestIndex = 0;
    let bestScore = -1;

    const scanLimit = Math.min(lines.length, MAX_HEADER_SCAN_ROWS);
    for (let i = 0; i < scanLimit; i++) {
      const cells = this.splitLine(lines[i], delimiter);
      if (cells.length < 2) {
        continue;
      }

      const matched = new Set<CanonicalField>();
      for (const cell of cells) {
        const hit = this.matchField(this.normalizeHeader(cell));
        if (hit && hit.confidence >= 0.7) {
          matched.add(hit.field);
        }
      }

      // A header row is only credible if rows beneath it share its width.
      const following = lines.slice(i + 1, i + 6);
      const consistent = following.filter(
        (line) => this.splitLine(line, delimiter).length === cells.length,
      ).length;

      const score = matched.size * 10 + consistent;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return { index: bestIndex, score: bestScore };
  }

  /** Infer a subcategory from free-text product naming. */
  inferSubcategoryFromText(text: string): string | null {
    const normalized = this.normalizeHeader(text);
    if (!normalized) {
      return null;
    }

    for (const { match, subcategory } of SUBCATEGORY_KEYWORDS) {
      if (match.some((keyword) => normalized.includes(keyword))) {
        return subcategory;
      }
    }

    return null;
  }

  /**
   * True for `TOTAL`, `Subtotal`, `Sumas`, and friends — rows that carry an
   * amount but describe other rows rather than a position.
   */
  isAggregateRowLabel(text: string): boolean {
    const normalized = this.normalizeHeader(text);
    if (!normalized) {
      return false;
    }
    return AGGREGATE_ROW_LABELS.some(
      (label) => normalized === label || normalized.startsWith(`${label}_`),
    );
  }

  /** Derive the balance-sheet side from a known subcategory. */
  deriveCategory(subcategory: string): 'asset' | 'liability' | null {
    if (ASSET_SUBCATEGORIES.has(subcategory)) {
      return 'asset';
    }
    if (LIABILITY_SUBCATEGORIES.has(subcategory)) {
      return 'liability';
    }
    return null;
  }

  /**
   * Inspect an arbitrary file and report how to read it — plus what still needs
   * a human answer.
   */
  infer(rawContent: string): SchemaInference {
    const normalizedContent = rawContent
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const lines = normalizedContent
      .split('\n')
      .filter((line) => line.trim().length > 0);

    const empty: SchemaInference = {
      status: 'unusable',
      delimiter: ',',
      delimiterLabel: 'comma',
      headerRowIndex: 0,
      skippedPreambleRows: 0,
      sourceHeaders: [],
      columns: [],
      mapping: {},
      questions: [],
      notes: [],
      dataRowCount: 0,
      sampleRows: [],
      unusableReason: null,
    };

    if (lines.length === 0) {
      return {
        ...empty,
        unusableReason:
          'The file is empty. If the file looks correct on your machine, the upload may have been interrupted before the data reached the server.',
      };
    }

    if (lines.length < 2) {
      return {
        ...empty,
        unusableReason:
          'The file has only one non-empty line, so there is a header or a row but never both.',
      };
    }

    const delimiter = this.detectDelimiter(lines);
    const { index: headerRowIndex } = this.detectHeaderRow(lines, delimiter);
    const sourceHeaders = this.splitLine(lines[headerRowIndex], delimiter);
    const dataLines = lines.slice(headerRowIndex + 1);

    const columns: DetectedColumn[] = sourceHeaders.map(
      (sourceHeader, sourceIndex) => {
        const hit = this.matchField(this.normalizeHeader(sourceHeader));
        return {
          sourceHeader,
          sourceIndex,
          field: hit ? hit.field : null,
          confidence: hit ? hit.confidence : 0,
        };
      },
    );

    // Highest-confidence column wins each field, so a file carrying both
    // "saldo" and "saldo_anterior" binds balance to the exact match.
    const mapping: Partial<Record<CanonicalField, number>> = {};
    const claimed = new Map<CanonicalField, number>();
    for (const column of columns) {
      if (!column.field) {
        continue;
      }
      const incumbent = claimed.get(column.field);
      if (incumbent === undefined || column.confidence > incumbent) {
        claimed.set(column.field, column.confidence);
        mapping[column.field] = column.sourceIndex;
      }
    }

    const notes: string[] = [];
    const questions: InferenceQuestion[] = [];

    if (headerRowIndex > 0) {
      notes.push(
        `Skipped ${headerRowIndex} preamble row(s) above the header row.`,
      );
    }
    if (delimiter !== ',') {
      notes.push(
        `Detected "${this.delimiterLabel(delimiter)}" as the column separator.`,
      );
    }

    const sampleRows = dataLines
      .slice(0, 5)
      .map((line) => this.splitLine(line, delimiter));

    // ── Derivations that use only facts already in the file ──
    const subcategoryIndex = mapping.subcategory;
    const nameIndex = mapping.name;

    if (mapping.category === undefined) {
      const probeIndex = subcategoryIndex ?? nameIndex;
      if (probeIndex !== undefined) {
        // Judge derivability over real line items only. Totals and blank
        // spacers are structural and get dropped at conversion time, so
        // counting them here would penalise a perfectly good export.
        const lineItemRows = dataLines.filter((line) => {
          const cells = this.splitLine(line, delimiter);
          return !this.isAggregateRowLabel(cells[probeIndex] || '');
        });

        const derivable = lineItemRows.filter((line) => {
          const cells = this.splitLine(line, delimiter);
          const sub = this.inferSubcategoryFromText(cells[probeIndex] || '');
          return sub !== null && this.deriveCategory(sub) !== null;
        }).length;

        if (lineItemRows.length > 0 && derivable / lineItemRows.length >= 0.8) {
          notes.push(
            "No category column found — asset/liability derived from each row's product type.",
          );
        } else {
          questions.push(
            this.mapColumnQuestion('category', sourceHeaders, columns),
          );
        }
      } else {
        questions.push(
          this.mapColumnQuestion('category', sourceHeaders, columns),
        );
      }
    }

    if (subcategoryIndex === undefined) {
      if (nameIndex !== undefined) {
        notes.push(
          "No subcategory column found — product type inferred from each row's description.",
        );
      } else {
        questions.push(
          this.mapColumnQuestion('subcategory', sourceHeaders, columns),
        );
      }
    }

    if (nameIndex === undefined && subcategoryIndex !== undefined) {
      notes.push(
        'No description column found — the subcategory value is used as the line-item name.',
      );
    }

    // ── Balance is the one thing that can never be inferred ──
    if (mapping.balance === undefined) {
      const numericCandidates = this.numericColumnHeaders(
        sourceHeaders,
        dataLines,
        delimiter,
      );
      questions.push({
        id: 'map:balance',
        field: 'balance',
        kind: 'map_column',
        prompt:
          'Which column holds the outstanding balance for each line item?',
        promptEs: '¿Que columna contiene el saldo pendiente de cada partida?',
        options: numericCandidates.length ? numericCandidates : sourceHeaders,
        deferrable: false,
        suggestion: numericCandidates[0] ?? null,
      });
    }

    // ── Values we will not invent: ask, with a suggested default ──
    if (mapping.rate === undefined) {
      questions.push({
        id: 'default:rate',
        field: 'rate',
        kind: 'provide_default',
        prompt:
          'This file has no interest-rate column. Map one, or give a portfolio-level rate to apply to every row. CERNIQ will not assume a rate — a fabricated 0% would silently distort NII and EVE.',
        promptEs:
          'Este archivo no tiene columna de tasa. Asigne una, o indique una tasa a nivel de portafolio para todas las filas. CERNIQ no asumira una tasa — un 0% inventado distorsionaria NII y EVE.',
        options: sourceHeaders,
        deferrable: false,
        suggestion: null,
      });
    }

    if (mapping.duration === undefined) {
      questions.push({
        id: 'default:duration',
        field: 'duration',
        kind: 'provide_default',
        prompt:
          'No duration column found. Map one, or supply an average duration in years. You can defer this — the report will run but will disclose that repricing-gap figures are incomplete.',
        promptEs:
          'No se encontró columna de duración. Asigne una, o indique una duración promedio en años. Puede diferirlo — el informe correrá pero revelará que las cifras de brecha de reprecio están incompletas.',
        options: sourceHeaders,
        deferrable: true,
        suggestion: null,
      });
    }

    if (mapping.rateType === undefined) {
      questions.push({
        id: 'default:rateType',
        field: 'rateType',
        kind: 'provide_default',
        prompt:
          'No fixed/variable column found. Defaulting every row to "fixed" is the conservative choice for rate-shock modelling; confirm or map a column.',
        promptEs:
          'No se encontro columna de tasa fija/variable. Usar "fixed" en todas las filas es la opcion conservadora para modelar shocks de tasa; confirme o asigne una columna.',
        options: sourceHeaders,
        deferrable: true,
        suggestion: 'fixed',
      });
    }

    const blocking = questions.filter((question) => !question.deferrable);

    return {
      status: blocking.length > 0 ? 'needs_input' : 'ready',
      delimiter,
      delimiterLabel: this.delimiterLabel(delimiter),
      headerRowIndex,
      skippedPreambleRows: headerRowIndex,
      sourceHeaders,
      columns,
      mapping,
      questions,
      notes,
      dataRowCount: dataLines.length,
      sampleRows,
      unusableReason: null,
    };
  }

  /**
   * Rewrite the source file into the canonical CSV the strict parser accepts.
   *
   * Returns null when a required value is missing for every row — the caller
   * must surface questions rather than emit a zero.
   */
  toCanonicalCsv(
    rawContent: string,
    inference: SchemaInference,
    resolution: ResolutionInput = {},
  ): { csv: string; notes: string[]; skippedRows: number } | null {
    const mapping = { ...inference.mapping, ...resolution.columnOverrides };
    const defaults = resolution.defaults || {};

    const rateDefault =
      defaults.rate !== undefined ? this.parseLooseNumber(defaults.rate) : null;
    const durationDefault =
      defaults.duration !== undefined
        ? this.parseLooseNumber(defaults.duration)
        : null;
    const rateTypeDefault = (defaults.rateType || 'fixed').trim();

    if (mapping.balance === undefined) {
      return null;
    }
    if (mapping.rate === undefined && rateDefault === null) {
      return null;
    }

    const normalizedContent = rawContent
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const lines = normalizedContent
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .slice(inference.headerRowIndex + 1);

    const notes: string[] = [];
    const rows: string[] = [CANONICAL_HEADER];
    let skippedRows = 0;
    let derivedCategories = 0;
    let inferredSubcategories = 0;

    const cellAt = (cells: string[], index: number | undefined): string =>
      index === undefined ? '' : (cells[index] || '').trim();

    for (const line of lines) {
      const cells = this.splitLine(line, inference.delimiter);

      const balance = this.parseLooseNumber(cellAt(cells, mapping.balance));
      if (balance === null) {
        // A row without a readable balance is a subtotal, a blank spacer, or a
        // footer. Dropping it is correct; counting it is how phantom totals
        // appear.
        skippedRows++;
        continue;
      }

      const rawName = cellAt(cells, mapping.name);
      const rawSubcategory = cellAt(cells, mapping.subcategory);

      // Drop subtotal/total rows BEFORE keyword inference. "Total Prestamos"
      // would otherwise match the loan keywords and be imported as a position,
      // double-counting every loan underneath it.
      if (
        this.isAggregateRowLabel(rawSubcategory) ||
        this.isAggregateRowLabel(rawName)
      ) {
        skippedRows++;
        continue;
      }

      let subcategory = rawSubcategory
        ? this.normalizeHeader(rawSubcategory)
        : '';
      if (!subcategory || this.deriveCategory(subcategory) === null) {
        const inferred =
          this.inferSubcategoryFromText(rawSubcategory) ||
          this.inferSubcategoryFromText(rawName);
        if (inferred) {
          if (subcategory !== inferred) {
            inferredSubcategories++;
          }
          subcategory = inferred;
        }
      }

      if (!subcategory) {
        skippedRows++;
        continue;
      }

      let category = cellAt(cells, mapping.category).toLowerCase();
      if (category === 'activo') {
        category = 'asset';
      } else if (category === 'pasivo') {
        category = 'liability';
      }
      if (category !== 'asset' && category !== 'liability') {
        const derived = this.deriveCategory(subcategory);
        if (!derived) {
          skippedRows++;
          continue;
        }
        category = derived;
        derivedCategories++;
      }

      const rateValue =
        mapping.rate !== undefined
          ? this.parseLooseNumber(cellAt(cells, mapping.rate))
          : rateDefault;
      if (rateValue === null) {
        skippedRows++;
        continue;
      }

      const durationValue =
        mapping.duration !== undefined
          ? this.parseLooseNumber(cellAt(cells, mapping.duration))
          : durationDefault;

      const rateTypeRaw =
        mapping.rateType !== undefined
          ? cellAt(cells, mapping.rateType).toLowerCase()
          : rateTypeDefault;
      const rateType =
        rateTypeRaw === 'fijo'
          ? 'fixed'
          : rateTypeRaw === 'variable'
            ? 'variable'
            : rateTypeRaw || 'fixed';

      const name = rawName || rawSubcategory || subcategory;

      rows.push(
        [
          category,
          subcategory,
          this.escapeCsv(name),
          String(balance),
          String(rateValue),
          String(durationValue ?? 0),
          rateType,
          this.escapeCsv(cellAt(cells, mapping.repriceDate)),
          this.escapeCsv(cellAt(cells, mapping.maturityDate)),
        ].join(','),
      );
    }

    if (rows.length < 2) {
      return null;
    }

    if (derivedCategories > 0) {
      notes.push(
        `Derived asset/liability side for ${derivedCategories} row(s) from their product type.`,
      );
    }
    if (inferredSubcategories > 0) {
      notes.push(
        `Inferred the product type for ${inferredSubcategories} row(s) from their description.`,
      );
    }
    if (skippedRows > 0) {
      notes.push(
        `Skipped ${skippedRows} row(s) with no readable balance, product type, or rate — these are typically subtotal or footer lines.`,
      );
    }
    if (mapping.duration === undefined && durationDefault === null) {
      notes.push(
        'DISCLOSURE: no duration data was supplied, so repricing-gap and EVE figures in this report are incomplete.',
      );
    }
    if (mapping.rate === undefined && rateDefault !== null) {
      notes.push(
        `DISCLOSURE: a uniform ${rateDefault}% rate was applied to every row because the file carried no per-instrument rate.`,
      );
    }

    return { csv: rows.join('\n'), notes, skippedRows };
  }

  private escapeCsv(value: string): string {
    if (!value) {
      return '';
    }
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  private delimiterLabel(delimiter: string): string {
    switch (delimiter) {
      case ',':
        return 'comma';
      case ';':
        return 'semicolon';
      case '\t':
        return 'tab';
      case '|':
        return 'pipe';
      default:
        return delimiter;
    }
  }

  /** Headers whose column is mostly numeric — the plausible balance columns. */
  private numericColumnHeaders(
    headers: string[],
    dataLines: string[],
    delimiter: string,
  ): string[] {
    const sample = dataLines.slice(0, 20);
    if (sample.length === 0) {
      return [];
    }

    return headers.filter((_header, index) => {
      const numeric = sample.filter((line) => {
        const cells = this.splitLine(line, delimiter);
        return this.parseLooseNumber(cells[index] || '') !== null;
      }).length;
      return numeric / sample.length >= 0.8;
    });
  }

  private mapColumnQuestion(
    field: CanonicalField,
    headers: string[],
    columns: DetectedColumn[],
  ): InferenceQuestion {
    const unclaimed = columns
      .filter((column) => column.field === null)
      .map((column) => column.sourceHeader);

    return {
      id: `map:${field}`,
      field,
      kind: 'map_column',
      prompt: `Which column holds "${field}"?`,
      promptEs: `¿Que columna contiene "${field}"?`,
      options: unclaimed.length ? unclaimed : headers,
      deferrable: false,
      suggestion: unclaimed[0] ?? null,
    };
  }
}
