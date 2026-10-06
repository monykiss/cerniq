import { BadRequestException } from '@nestjs/common';

/**
 * Domain-specific error codes for ALM calculation failures.
 * These provide actionable context to API consumers and audit trails.
 */
export enum AlmErrorCode {
  EMPTY_BALANCE_SHEET = 'ALM_EMPTY_BALANCE_SHEET',
  NO_ASSETS = 'ALM_NO_ASSETS',
  NO_LIABILITIES = 'ALM_NO_LIABILITIES',
  ZERO_TOTAL_ASSETS = 'ALM_ZERO_TOTAL_ASSETS',
  NEGATIVE_BALANCE = 'ALM_NEGATIVE_BALANCE',
  INVALID_RATE = 'ALM_INVALID_RATE',
  NEGATIVE_DURATION = 'ALM_NEGATIVE_DURATION',
  INSUFFICIENT_SCENARIOS = 'ALM_INSUFFICIENT_SCENARIOS',
  INVALID_HQLA = 'ALM_INVALID_HQLA',
  ZERO_OUTFLOWS = 'ALM_ZERO_OUTFLOWS',
  COMPUTATION_OVERFLOW = 'ALM_COMPUTATION_OVERFLOW',
}

export class AlmValidationError extends BadRequestException {
  constructor(code: AlmErrorCode, detail: string) {
    super({
      code,
      message: detail,
      domain: 'ALM',
    });
  }
}

/**
 * Validate a balance sheet has the minimum required data for ALM calculations.
 * Throws AlmValidationError with a specific code if validation fails.
 */
export function validateBalanceSheet(
  balanceSheet: { assets?: any[]; liabilities?: any[]; equity?: number },
  context: string,
): void {
  if (!balanceSheet) {
    throw new AlmValidationError(
      AlmErrorCode.EMPTY_BALANCE_SHEET,
      `${context}: Balance sheet is required`,
    );
  }
  if (!balanceSheet.assets || balanceSheet.assets.length === 0) {
    throw new AlmValidationError(
      AlmErrorCode.NO_ASSETS,
      `${context}: At least one asset is required`,
    );
  }
  if (!balanceSheet.liabilities || balanceSheet.liabilities.length === 0) {
    throw new AlmValidationError(
      AlmErrorCode.NO_LIABILITIES,
      `${context}: At least one liability is required`,
    );
  }
}
