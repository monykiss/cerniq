import { Injectable } from '@nestjs/common';
import { NcuaCallReportData, NcuaCreditUnionData } from './ncua-api.service';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface MappedBalanceSheetItem {
  category: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subcategory: string;
  name: string;
  nameEs: string;
  balance: number;
  rate?: number;
  rateType?: 'fixed' | 'variable';
  ncuaAcctCode: string;
}

export interface MappedBalanceSheet {
  quarter: string;
  items: MappedBalanceSheetItem[];
  summary: {
    totalAssets: number;
    totalLoans: number;
    totalDeposits: number;
    netWorth: number;
    netIncome: number;
    netWorthRatio: number;
    delinquencyRatio: number;
  };
}

export interface InstitutionCreateInput {
  name: string;
  charterNumber: string;
  city: string;
  state: string;
  zipCode: string;
  memberCount: number;
  peerGroup: string;
  fieldOfMembership: string;
  lowIncomeDesignation: boolean;
  website: string | null;
  ceoName: string | null;
  phoneNumber: string | null;
}

// ─── NCUA ACCT Code → CERNIQ Field Mapping ──────────────────────────────────
// The NCUA Form 5300 uses ~900 ACCT codes. Below are the ~50 most critical
// fields mapped to CERNIQ's balance sheet schema.

interface FieldMapping {
  acctCode: string;
  category: MappedBalanceSheetItem['category'];
  subcategory: string;
  name: string;
  nameEs: string;
  rateType?: 'fixed' | 'variable';
}

export const FIELD_MAP: FieldMapping[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  {
    acctCode: 'ACCT_010',
    category: 'asset',
    subcategory: 'total',
    name: 'Total Assets',
    nameEs: 'Activos Totales',
  },
  {
    acctCode: 'ACCT_003',
    category: 'asset',
    subcategory: 'cash',
    name: 'Cash & Equivalents',
    nameEs: 'Efectivo y Equivalentes',
  },
  {
    acctCode: 'ACCT_008',
    category: 'asset',
    subcategory: 'investments',
    name: 'Total Investments',
    nameEs: 'Inversiones Totales',
  },
  {
    acctCode: 'ACCT_018',
    category: 'asset',
    subcategory: 'loans',
    name: 'Total Loans',
    nameEs: 'Préstamos Totales',
  },
  {
    acctCode: 'ACCT_011',
    category: 'asset',
    subcategory: 'loans',
    name: 'Real Estate Loans',
    nameEs: 'Préstamos Hipotecarios',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_370',
    category: 'asset',
    subcategory: 'loans',
    name: 'Consumer Loans',
    nameEs: 'Préstamos de Consumo',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_385',
    category: 'asset',
    subcategory: 'loans',
    name: 'Commercial Loans',
    nameEs: 'Préstamos Comerciales',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_004',
    category: 'asset',
    subcategory: 'investments',
    name: 'US Government Securities',
    nameEs: 'Valores del Gobierno Federal',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_005',
    category: 'asset',
    subcategory: 'investments',
    name: 'Federal Agency Securities',
    nameEs: 'Valores de Agencias Federales',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_006',
    category: 'asset',
    subcategory: 'investments',
    name: 'MBS',
    nameEs: 'Valores Respaldados por Hipotecas',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_007',
    category: 'asset',
    subcategory: 'investments',
    name: 'Other Investments',
    nameEs: 'Otras Inversiones',
  },
  {
    acctCode: 'ACCT_799',
    category: 'asset',
    subcategory: 'other',
    name: 'Other Assets',
    nameEs: 'Otros Activos',
  },
  {
    acctCode: 'ACCT_025A',
    category: 'asset',
    subcategory: 'loans',
    name: 'Used Vehicle Loans',
    nameEs: 'Préstamos Vehículos Usados',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_025B',
    category: 'asset',
    subcategory: 'loans',
    name: 'New Vehicle Loans',
    nameEs: 'Préstamos Vehículos Nuevos',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_369',
    category: 'asset',
    subcategory: 'loans',
    name: 'Credit Card Loans',
    nameEs: 'Préstamos Tarjeta de Crédito',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_045',
    category: 'asset',
    subcategory: 'reserves',
    name: 'Allowance for Loan Losses',
    nameEs: 'Reserva para Préstamos Incobrables',
  },

  // ── Liabilities ───────────────────────────────────────────────────────────
  {
    acctCode: 'ACCT_025',
    category: 'liability',
    subcategory: 'deposits',
    name: 'Total Deposits/Shares',
    nameEs: 'Depósitos/Acciones Totales',
  },
  {
    acctCode: 'ACCT_602',
    category: 'liability',
    subcategory: 'deposits',
    name: 'Regular Shares',
    nameEs: 'Acciones Regulares',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_604',
    category: 'liability',
    subcategory: 'deposits',
    name: 'Share Drafts',
    nameEs: 'Cuentas Corrientes',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_606',
    category: 'liability',
    subcategory: 'deposits',
    name: 'Money Market Shares',
    nameEs: 'Acciones Money Market',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_608',
    category: 'liability',
    subcategory: 'deposits',
    name: 'Share Certificates',
    nameEs: 'Certificados de Acciones',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_610',
    category: 'liability',
    subcategory: 'deposits',
    name: 'IRA/Keogh Accounts',
    nameEs: 'Cuentas IRA/Keogh',
    rateType: 'fixed',
  },
  {
    acctCode: 'ACCT_860',
    category: 'liability',
    subcategory: 'borrowings',
    name: 'Borrowed Funds',
    nameEs: 'Fondos Prestados',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_862',
    category: 'liability',
    subcategory: 'borrowings',
    name: 'FHLB Borrowings',
    nameEs: 'Préstamos FHLB',
    rateType: 'variable',
  },
  {
    acctCode: 'ACCT_740',
    category: 'liability',
    subcategory: 'other',
    name: 'Other Liabilities',
    nameEs: 'Otros Pasivos',
  },

  // ── Equity ────────────────────────────────────────────────────────────────
  {
    acctCode: 'ACCT_657',
    category: 'equity',
    subcategory: 'netWorth',
    name: 'Net Worth',
    nameEs: 'Patrimonio Neto',
  },
  {
    acctCode: 'ACCT_658',
    category: 'equity',
    subcategory: 'netWorth',
    name: 'Undivided Earnings',
    nameEs: 'Ganancias No Distribuidas',
  },
  {
    acctCode: 'ACCT_659',
    category: 'equity',
    subcategory: 'netWorth',
    name: 'Regular Reserves',
    nameEs: 'Reservas Regulares',
  },
  {
    acctCode: 'ACCT_660',
    category: 'equity',
    subcategory: 'ratio',
    name: 'Net Worth Ratio',
    nameEs: 'Razón de Patrimonio',
  },

  // ── Income ────────────────────────────────────────────────────────────────
  {
    acctCode: 'ACCT_115',
    category: 'income',
    subcategory: 'interest',
    name: 'Total Interest Income',
    nameEs: 'Ingresos por Intereses Totales',
  },
  {
    acctCode: 'ACCT_110',
    category: 'income',
    subcategory: 'interest',
    name: 'Interest on Loans',
    nameEs: 'Intereses sobre Préstamos',
  },
  {
    acctCode: 'ACCT_112',
    category: 'income',
    subcategory: 'interest',
    name: 'Interest on Investments',
    nameEs: 'Intereses sobre Inversiones',
  },
  {
    acctCode: 'ACCT_131',
    category: 'income',
    subcategory: 'fees',
    name: 'Fee Income',
    nameEs: 'Ingresos por Comisiones',
  },
  {
    acctCode: 'ACCT_130',
    category: 'income',
    subcategory: 'other',
    name: 'Non-Interest Income',
    nameEs: 'Ingresos No Financieros',
  },
  {
    acctCode: 'ACCT_730',
    category: 'income',
    subcategory: 'net',
    name: 'Net Income',
    nameEs: 'Ingreso Neto',
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  {
    acctCode: 'ACCT_116',
    category: 'expense',
    subcategory: 'interest',
    name: 'Total Interest Expense',
    nameEs: 'Gastos por Intereses Totales',
  },
  {
    acctCode: 'ACCT_119',
    category: 'expense',
    subcategory: 'interest',
    name: 'Dividend Expense',
    nameEs: 'Gastos por Dividendos',
  },
  {
    acctCode: 'ACCT_719',
    category: 'expense',
    subcategory: 'provision',
    name: 'Provision for Loan Losses',
    nameEs: 'Provisión para Préstamos Incobrables',
  },
  {
    acctCode: 'ACCT_210',
    category: 'expense',
    subcategory: 'operating',
    name: 'Employee Compensation',
    nameEs: 'Compensación de Empleados',
  },
  {
    acctCode: 'ACCT_220',
    category: 'expense',
    subcategory: 'operating',
    name: 'Office Operations',
    nameEs: 'Operaciones de Oficina',
  },
  {
    acctCode: 'ACCT_230',
    category: 'expense',
    subcategory: 'operating',
    name: 'Professional Services',
    nameEs: 'Servicios Profesionales',
  },

  // ── Key Ratios ────────────────────────────────────────────────────────────
  {
    acctCode: 'ACCT_671',
    category: 'asset',
    subcategory: 'ratio',
    name: 'Delinquency Ratio',
    nameEs: 'Razón de Morosidad',
  },
  {
    acctCode: 'ACCT_672',
    category: 'asset',
    subcategory: 'ratio',
    name: 'Net Charge-Off Ratio',
    nameEs: 'Razón de Castigos Netos',
  },
  {
    acctCode: 'ACCT_673',
    category: 'asset',
    subcategory: 'ratio',
    name: 'ROA',
    nameEs: 'Retorno sobre Activos',
  },
  {
    acctCode: 'ACCT_675',
    category: 'expense',
    subcategory: 'ratio',
    name: 'Operating Expense Ratio',
    nameEs: 'Razón de Gastos Operativos',
  },
  {
    acctCode: 'ACCT_550',
    category: 'asset',
    subcategory: 'ratio',
    name: 'Loans-to-Shares Ratio',
    nameEs: 'Razón Préstamos/Acciones',
  },
];

// Build lookup map for O(1) access
const FIELD_LOOKUP = new Map(FIELD_MAP.map((f) => [f.acctCode, f]));

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class NcuaFieldMapperService {
  /**
   * Map NCUA call report ACCT codes to CERNIQ BalanceSheetItem format.
   * Iterates through all known field mappings and produces a structured
   * balance sheet with bilingual labels.
   */
  mapToBalanceSheet(callReport: NcuaCallReportData): MappedBalanceSheet {
    const items: MappedBalanceSheetItem[] = [];

    for (const [acctCode, value] of Object.entries(callReport.fields)) {
      const mapping = FIELD_LOOKUP.get(acctCode);
      if (!mapping) continue;

      items.push({
        category: mapping.category,
        subcategory: mapping.subcategory,
        name: mapping.name,
        nameEs: mapping.nameEs,
        balance: value,
        rateType: mapping.rateType,
        ncuaAcctCode: acctCode,
      });
    }

    // Compute summary from known ACCT codes
    const get = (code: string): number => callReport.fields[code] ?? 0;

    const totalAssets = get('ACCT_010');
    const netWorth = get('ACCT_657');

    const summary = {
      totalAssets,
      totalLoans: get('ACCT_018'),
      totalDeposits: get('ACCT_025'),
      netWorth,
      netIncome: get('ACCT_730'),
      netWorthRatio:
        totalAssets > 0 ? get('ACCT_660') || netWorth / totalAssets : 0,
      delinquencyRatio: get('ACCT_671'),
    };

    return {
      quarter: callReport.quarter,
      items,
      summary,
    };
  }

  /**
   * Map NCUA credit union basic info to CERNIQ Institution create input.
   */
  mapToInstitution(creditUnion: NcuaCreditUnionData): InstitutionCreateInput {
    return {
      name: creditUnion.name,
      charterNumber: creditUnion.charterNumber,
      city: creditUnion.city,
      state: creditUnion.state,
      zipCode: creditUnion.zipCode,
      memberCount: creditUnion.memberCount,
      peerGroup: creditUnion.peerGroup,
      fieldOfMembership: creditUnion.fieldOfMembership,
      lowIncomeDesignation: creditUnion.lowIncomeDesignation,
      website: creditUnion.website,
      ceoName: creditUnion.ceoName,
      phoneNumber: creditUnion.phoneNumber,
    };
  }

  /**
   * Return the full field mapping for documentation/inspection endpoints.
   */
  getFieldMap(): FieldMapping[] {
    return FIELD_MAP;
  }
}
