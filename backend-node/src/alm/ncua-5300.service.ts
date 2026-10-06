import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// ─── NCUA Account Code → CERNIQ Subcategory Mapping ────────

const ASSET_CODES: Record<string, { code: string; label: string }> = {
  cash: { code: '010', label: 'Cash & Cash Equivalents' },
  securities: { code: '799B', label: 'Total Investments' },
  consumer_loans: { code: '025A', label: 'Personal Loans (Unsecured)' },
  auto_loans: { code: '025B', label: 'Vehicle Loans' },
  residential_mortgage: { code: '703', label: 'First Mortgage RE Loans' },
  commercial_re: { code: '387A', label: 'Member Business Loans - RE' },
  commercial_loans: { code: '386A', label: 'Member Business Loans - Other' },
  credit_cards: { code: '696', label: 'Credit Card Loans' },
};

const LIABILITY_CODES: Record<string, { code: string; label: string }> = {
  savings: { code: '010A', label: 'Regular Shares' },
  share_drafts: { code: '018', label: 'Share Drafts' },
  demand_deposits: { code: '657A', label: 'Share Savings' },
  iras: { code: '655B', label: 'IRAs / Keogh' },
  time_deposits: { code: '050', label: 'Share Certificates (CDs)' },
  money_market: { code: '062', label: 'Money Market Shares' },
  borrowings: { code: '916', label: 'FHLB Advances / Borrowed Funds' },
};

// ─── Edit Checks ────────────────────────────────────────────

interface EditCheck {
  code: string;
  description: string;
  validate: (fields: Record<string, number>) => boolean;
  severity: 'error' | 'warning';
}

const EDIT_CHECKS: EditCheck[] = [
  {
    code: 'EC-001',
    description: 'Total Assets must equal Total Liabilities + Net Worth',
    validate: (f) =>
      Math.abs(f.totalAssets - f.totalLiabilities - f.netWorth) < 0.1,
    severity: 'error',
  },
  {
    code: 'EC-002',
    description: 'Total Shares must equal sum of all share subcategories',
    validate: (f) => Math.abs(f.totalShares - f.sumShareSubs) < 0.1,
    severity: 'error',
  },
  {
    code: 'EC-003',
    description: 'Net Worth Ratio must be non-negative',
    validate: (f) => f.netWorth >= 0,
    severity: 'error',
  },
  {
    code: 'EC-004',
    description: 'Total Loans must not exceed Total Assets',
    validate: (f) => f.totalLoans <= f.totalAssets * 1.001,
    severity: 'error',
  },
  {
    code: 'EC-005',
    description: 'Allowance should not exceed 15% of Gross Loans',
    validate: (f) => f.allowance <= f.totalLoans * 0.15,
    severity: 'warning',
  },
  {
    code: 'EC-006',
    description: 'Investments should not exceed 80% of Total Assets',
    validate: (f) => f.totalInvestments <= f.totalAssets * 0.8,
    severity: 'warning',
  },
  {
    code: 'EC-010',
    description: 'All account balances must be non-negative',
    validate: (f) => Object.values(f).every((v) => v >= 0),
    severity: 'error',
  },
  {
    code: 'EC-020',
    description: 'Delinquent loans > 6% flags for examiner review',
    validate: (f) => f.delinquentLoans <= f.totalLoans * 0.06,
    severity: 'warning',
  },
];

// ─── Types ───────────────────────────────────────────────────

export interface Form5300Field {
  accountCode: string;
  label: string;
  value: number;
  sourceField: string;
  schedule: string;
}

/**
 * Form 5300 result. D1 (2026-04-07): when input data is incomplete or
 * derived from fallback ratios, the `gaps[]` manifest enumerates exactly
 * what's missing or estimated. NCUA 5300 is a regulator filing — never
 * submit a form whose `gaps[]` contains a CRITICAL entry. Use
 * `hasCriticalGap(result.gaps)` from `reports/data-gap.ts` to gate
 * submission.
 */
export interface Form5300Result {
  institutionId: string;
  quarter: string;
  charterNumber: string | null;
  fields: Form5300Field[];
  validationResult: {
    valid: boolean;
    errors: Array<{ code: string; description: string }>;
    warnings: Array<{ code: string; description: string }>;
  };
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    netWorthRatio: number;
    totalLoans: number;
    totalShares: number;
    totalInvestments: number;
  };
  overallStatus: 'ready_to_file' | 'needs_review' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class NCUA5300Service {
  private readonly logger = new Logger(NCUA5300Service.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateForm5300(
    institutionId: string,
    quarter?: string,
  ): Promise<Form5300Result> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    const now = new Date();
    const q =
      quarter ?? `${now.getFullYear()}Q${Math.ceil((now.getMonth() + 1) / 3)}`;

    // D1 (2026-04-07): refuse to generate Form 5300 on an empty balance
    // sheet. The previous behavior produced a "valid" form with all-zero
    // fields whose validation passed (zero == zero == zero balances). A
    // 5300 is a regulator filing — submitting one with phantom zeros is a
    // legal exposure. Surface a CRITICAL gap and return a structured
    // data_unavailable shell so callers can render explicit DATA UNAVAILABLE
    // before any submission.
    if (items.length === 0) {
      this.logger.warn({
        event: 'form5300_data_unavailable',
        institutionId,
        reason: 'EMPTY_BALANCE_SHEET',
      });
      return {
        institutionId,
        quarter: q,
        charterNumber: institution?.cossecRegistrationNumber ?? null,
        fields: [],
        validationResult: { valid: false, errors: [], warnings: [] },
        summary: {
          totalAssets: 0,
          totalLiabilities: 0,
          netWorth: 0,
          netWorthRatio: 0,
          totalLoans: 0,
          totalShares: 0,
          totalInvestments: 0,
        },
        overallStatus: 'data_unavailable',
        gaps: [
          dataGap('form5300.balanceSheet', 'EMPTY_BALANCE_SHEET', {
            severity: 'CRITICAL',
            action:
              'Upload balance sheet items before generating Form 5300. Filing with phantom data is a regulatory exposure.',
            context: { institutionId, quarter: q },
          }),
        ],
      };
    }

    // Map balance sheet items to 5300 fields
    const fields: Form5300Field[] = [];

    // Assets
    const assets = items.filter((i: any) => i.category === 'asset');
    const assetBySub = new Map<string, number>();
    for (const item of assets) {
      const sub = item.subcategory.toLowerCase();
      assetBySub.set(sub, (assetBySub.get(sub) ?? 0) + Number(item.balance));
    }

    for (const [sub, mapping] of Object.entries(ASSET_CODES)) {
      const value = assetBySub.get(sub) ?? 0;
      fields.push({
        accountCode: mapping.code,
        label: mapping.label,
        value,
        sourceField: `BalanceSheetItem.${sub}`,
        schedule: 'A',
      });
    }

    // Liabilities
    const liabilities = items.filter((i: any) => i.category === 'liability');
    const liabBySub = new Map<string, number>();
    for (const item of liabilities) {
      const sub = item.subcategory.toLowerCase();
      liabBySub.set(sub, (liabBySub.get(sub) ?? 0) + Number(item.balance));
    }

    for (const [sub, mapping] of Object.entries(LIABILITY_CODES)) {
      const value = liabBySub.get(sub) ?? 0;
      fields.push({
        accountCode: mapping.code,
        label: mapping.label,
        value,
        sourceField: `BalanceSheetItem.${sub}`,
        schedule: 'C',
      });
    }

    // Computed fields
    const totalAssets = assets.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const totalLiabilities = liabilities.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const netWorth = totalAssets - totalLiabilities;
    const totalLoans = assets
      .filter(
        (i: any) =>
          !['cash', 'securities'].includes(i.subcategory.toLowerCase()),
      )
      .reduce((s: number, i: any) => s + Number(i.balance), 0);
    const totalShares = liabilities
      .filter((i: any) => !i.subcategory.toLowerCase().includes('borrowing'))
      .reduce((s: number, i: any) => s + Number(i.balance), 0);
    const totalInvestments = assetBySub.get('securities') ?? 0;

    fields.push(
      {
        accountCode: '010TOTAL',
        label: 'Total Assets',
        value: totalAssets,
        sourceField: 'computed',
        schedule: 'A',
      },
      {
        accountCode: '802',
        label: 'Total Shares & Deposits',
        value: totalShares,
        sourceField: 'computed',
        schedule: 'C',
      },
      {
        accountCode: '931',
        label: 'Total Equity (Net Worth)',
        value: netWorth,
        sourceField: 'computed',
        schedule: 'D',
      },
    );

    // Run edit checks. KNOWN LIMITATION (2026-04-07): allowance and
    // delinquentLoans are derived from sector-typical ratios (1.3% and 1.8%
    // of total loans respectively). These should come from real allowance
    // and delinquency tables. Surfaced as WARNING gaps below so reviewers
    // and auditors see that two of the edit-check inputs are sector defaults,
    // not measured values from this institution.
    const allowance = totalLoans * 0.013;
    const delinquentLoans = totalLoans * 0.018;
    const checkFields: Record<string, number> = {
      totalAssets,
      totalLiabilities,
      netWorth,
      totalLoans,
      totalShares,
      totalInvestments,
      allowance,
      delinquentLoans,
      sumShareSubs:
        Array.from(liabBySub.values()).reduce((s, v) => s + v, 0) -
        (liabBySub.get('borrowings') ?? 0),
    };

    const errors: Array<{ code: string; description: string }> = [];
    const warnings: Array<{ code: string; description: string }> = [];

    for (const check of EDIT_CHECKS) {
      if (!check.validate(checkFields)) {
        if (check.severity === 'error')
          errors.push({ code: check.code, description: check.description });
        else
          warnings.push({ code: check.code, description: check.description });
      }
    }

    // Surface WARNING gaps for the placeholder ratios so the reviewer and
    // any audit reading the result knows allowance/delinquency are sector
    // defaults, not measured values.
    const gaps: DataGap[] = [
      dataGap('form5300.allowance', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire a real allowance source into Form5300Service so EC-005 (allowance ≤ 15% of loans) uses measured data instead of the 1.3%-of-loans sector default.',
        context: { hardcodedRatio: 0.013 },
      }),
      dataGap('form5300.delinquentLoans', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          'Wire a real delinquency source into Form5300Service so EC-020 (delinquency ≤ 6% of loans) uses measured data instead of the 1.8%-of-loans sector default.',
        context: { hardcodedRatio: 0.018 },
      }),
    ];

    const overallStatus: Form5300Result['overallStatus'] =
      errors.length > 0 ? 'needs_review' : 'ready_to_file';

    return {
      institutionId,
      quarter: q,
      charterNumber: institution?.cossecRegistrationNumber ?? null,
      fields,
      validationResult: { valid: errors.length === 0, errors, warnings },
      summary: {
        totalAssets: Math.round(totalAssets * 10) / 10,
        totalLiabilities: Math.round(totalLiabilities * 10) / 10,
        netWorth: Math.round(netWorth * 10) / 10,
        netWorthRatio:
          totalAssets > 0
            ? Math.round((netWorth / totalAssets) * 10000) / 100
            : 0,
        totalLoans: Math.round(totalLoans * 10) / 10,
        totalShares: Math.round(totalShares * 10) / 10,
        totalInvestments: Math.round(totalInvestments * 10) / 10,
      },
      overallStatus,
      gaps,
    };
  }
}
