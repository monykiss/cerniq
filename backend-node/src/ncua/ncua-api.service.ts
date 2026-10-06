import { Injectable, Logger } from '@nestjs/common';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface NcuaCreditUnionData {
  charterNumber: string;
  name: string;
  city: string;
  state: string;
  zipCode: string;
  dateChartered: string;
  lowIncomeDesignation: boolean;
  memberCount: number;
  peerGroup: string;
  fieldOfMembership: string;
  website: string | null;
  ceoName: string | null;
  phoneNumber: string | null;
}

export interface NcuaCallReportData {
  charterNumber: string;
  quarter: string;
  reportDate: string;
  /** Raw ACCT code → value mapping from the NCUA call report */
  fields: Record<string, number>;
}

export interface NcuaSearchResult {
  charterNumber: string;
  name: string;
  city: string;
  state: string;
  totalAssets: number;
  memberCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const NCUA_BASE_URL =
  'https://www.ncua.gov/analysis/credit-union-corporate-call-report-data';
const NCUA_API_BASE = 'https://ncua.gov/api/v1';

// Request timeout: 30 seconds
const REQUEST_TIMEOUT_MS = 30_000;

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class NcuaApiService {
  private readonly logger = new Logger(NcuaApiService.name);

  /**
   * Fetch basic credit union information by charter number.
   */
  async fetchCreditUnion(charterNumber: string): Promise<NcuaCreditUnionData> {
    this.logger.log({
      msg: 'Fetching credit union data',
      charterNumber,
    });

    try {
      const url = `${NCUA_API_BASE}/credit-unions/${charterNumber}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CERNIQ-Platform/1.0',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `NCUA API returned ${response.status} for charter ${charterNumber}`,
        );
      }

      const data = await response.json();

      return this.mapCreditUnionResponse(data, charterNumber);
    } catch (err) {
      this.logger.error({
        msg: 'Failed to fetch credit union data',
        charterNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      });

      // NEVER silently substitute fabricated NCUA data on an API failure — that
      // would import a phantom credit union as real. Demo data is opt-in (dev
      // only) via NCUA_DEMO_FALLBACK=1; by default, propagate the failure.
      if (this.demoFallbackEnabled()) {
        this.logger.warn({
          msg: 'NCUA_DEMO_FALLBACK=1 — returning DEMO credit-union data (NOT real)',
          charterNumber,
        });
        return this.getDemoCreditUnionData(charterNumber);
      }
      throw err instanceof Error
        ? err
        : new Error(`NCUA API unavailable for charter ${charterNumber}`);
    }
  }

  /**
   * Fetch a quarterly call report (Form 5300) for a credit union.
   * Quarter format: "2025-Q4"
   */
  async fetchCallReport(
    charterNumber: string,
    quarter: string,
  ): Promise<NcuaCallReportData> {
    this.logger.log({
      msg: 'Fetching call report',
      charterNumber,
      quarter,
    });

    try {
      const url = `${NCUA_API_BASE}/credit-unions/${charterNumber}/call-report?quarter=${quarter}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CERNIQ-Platform/1.0',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `NCUA API returned ${response.status} for call report ${charterNumber}/${quarter}`,
        );
      }

      const data = await response.json();

      return this.mapCallReportResponse(data, charterNumber, quarter);
    } catch (err) {
      this.logger.error({
        msg: 'Failed to fetch call report',
        charterNumber,
        quarter,
        error: err instanceof Error ? err.message : 'Unknown error',
      });

      // Demo call-report financials are opt-in (dev only) — NEVER silently
      // import a fabricated Form 5300 as a real regulatory filing.
      if (this.demoFallbackEnabled()) {
        this.logger.warn({
          msg: 'NCUA_DEMO_FALLBACK=1 — returning DEMO call-report data (NOT real)',
          charterNumber,
          quarter,
        });
        return this.getDemoCallReportData(charterNumber, quarter);
      }
      throw err instanceof Error
        ? err
        : new Error(
            `NCUA API unavailable for call report ${charterNumber}/${quarter}`,
          );
    }
  }

  /**
   * Fetch the last N quarters of call report data.
   * Defaults to 4 quarters (1 year).
   */
  async fetchLatestQuarters(
    charterNumber: string,
    count = 4,
  ): Promise<NcuaCallReportData[]> {
    this.logger.log({
      msg: 'Fetching latest quarters',
      charterNumber,
      count,
    });

    const quarters = this.getRecentQuarters(count);
    const results: NcuaCallReportData[] = [];

    for (const quarter of quarters) {
      try {
        const report = await this.fetchCallReport(charterNumber, quarter);
        results.push(report);
      } catch (err) {
        this.logger.warn({
          msg: 'Skipping quarter due to error',
          charterNumber,
          quarter,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Search for credit unions by name and optional state filter.
   */
  async searchByName(
    name: string,
    state?: string,
  ): Promise<NcuaSearchResult[]> {
    this.logger.log({ msg: 'Searching credit unions', name, state });

    try {
      let url = `${NCUA_API_BASE}/credit-unions/search?name=${encodeURIComponent(name)}`;
      if (state) {
        url += `&state=${encodeURIComponent(state)}`;
      }

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CERNIQ-Platform/1.0',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`NCUA search returned ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((item: any) => ({
        charterNumber: String(item.charterNumber ?? item.CU_NUMBER ?? ''),
        name: item.name ?? item.CU_NAME ?? '',
        city: item.city ?? item.CITY ?? '',
        state: item.state ?? item.STATE ?? '',
        totalAssets: Number(item.totalAssets ?? item.TOTAL_ASSETS ?? 0),
        memberCount: Number(item.memberCount ?? item.MEMBERS ?? 0),
      }));
    } catch (err) {
      this.logger.error({
        msg: 'Credit union search failed',
        name,
        state,
        error: err instanceof Error ? err.message : 'Unknown error',
      });

      if (this.demoFallbackEnabled()) {
        this.logger.warn({
          msg: 'NCUA_DEMO_FALLBACK=1 — returning DEMO search results (NOT real)',
          name,
          state,
        });
        return this.getDemoSearchResults(name, state);
      }
      throw err instanceof Error
        ? err
        : new Error(`NCUA search unavailable for "${name}"`);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Demo NCUA data is a DEV-ONLY fallback, opt-in via NCUA_DEMO_FALLBACK=1.
   * In production (flag unset) an NCUA API failure PROPAGATES — CerniQ must
   * never import a fabricated Form 5300 / charter record as real regulatory
   * data when the upstream NCUA API is unreachable.
   */
  private demoFallbackEnabled(): boolean {
    return process.env.NCUA_DEMO_FALLBACK === '1';
  }

  private mapCreditUnionResponse(
    data: any,
    charterNumber: string,
  ): NcuaCreditUnionData {
    return {
      charterNumber,
      name: data.name ?? data.CU_NAME ?? `Credit Union ${charterNumber}`,
      city: data.city ?? data.CITY ?? '',
      state: data.state ?? data.STATE ?? '',
      zipCode: data.zipCode ?? data.ZIP_CODE ?? '',
      dateChartered: data.dateChartered ?? data.DATE_CHARTERED ?? '',
      lowIncomeDesignation: Boolean(
        data.lowIncomeDesignation ?? data.LI_DESIGNATION ?? false,
      ),
      memberCount: Number(data.memberCount ?? data.MEMBERS ?? 0),
      peerGroup: data.peerGroup ?? data.PEER_GROUP ?? '',
      fieldOfMembership: data.fieldOfMembership ?? data.FOM ?? '',
      website: data.website ?? data.WEBSITE ?? null,
      ceoName: data.ceoName ?? data.CEO ?? null,
      phoneNumber: data.phoneNumber ?? data.PHONE ?? null,
    };
  }

  private mapCallReportResponse(
    data: any,
    charterNumber: string,
    quarter: string,
  ): NcuaCallReportData {
    const fields: Record<string, number> = {};

    // NCUA returns fields as ACCT_NNN keys or nested objects
    if (data.fields && typeof data.fields === 'object') {
      for (const [key, value] of Object.entries(data.fields)) {
        fields[key] = Number(value ?? 0);
      }
    } else if (typeof data === 'object') {
      // Flat response format
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('ACCT_')) {
          fields[key] = Number(value ?? 0);
        }
      }
    }

    return {
      charterNumber,
      quarter,
      reportDate: data.reportDate ?? data.REPORT_DATE ?? quarter,
      fields,
    };
  }

  /**
   * Generate the last N quarter strings (e.g. "2025-Q4", "2025-Q3", ...).
   */
  private getRecentQuarters(count: number): string[] {
    const quarters: string[] = [];
    const now = new Date();
    let year = now.getFullYear();
    // NCUA data has ~2 quarter lag; start from 2 quarters ago
    let q = Math.ceil((now.getMonth() + 1) / 3) - 2;

    if (q <= 0) {
      year -= 1;
      q += 4;
    }

    for (let i = 0; i < count; i++) {
      quarters.push(`${year}-Q${q}`);
      q -= 1;
      if (q <= 0) {
        year -= 1;
        q = 4;
      }
    }

    return quarters;
  }

  // ─── Demo data (used when NCUA API is unreachable) ────────────────────────

  private getDemoCreditUnionData(charterNumber: string): NcuaCreditUnionData {
    return {
      charterNumber,
      name: `Demo Credit Union #${charterNumber}`,
      city: 'San Juan',
      state: 'PR',
      zipCode: '00901',
      dateChartered: '1975-03-15',
      lowIncomeDesignation: true,
      memberCount: 25000,
      peerGroup: '6',
      fieldOfMembership: 'Community',
      website: null,
      ceoName: null,
      phoneNumber: null,
    };
  }

  private getDemoCallReportData(
    charterNumber: string,
    quarter: string,
  ): NcuaCallReportData {
    return {
      charterNumber,
      quarter,
      reportDate: quarter,
      fields: {
        ACCT_010: 2_800_000_000, // Total Assets
        ACCT_018: 1_680_000_000, // Total Loans
        ACCT_657: 280_000_000, // Net Worth
        ACCT_025: 2_380_000_000, // Total Deposits/Shares
        ACCT_003: 420_000_000, // Cash & Equivalents
        ACCT_008: 560_000_000, // Total Investments
        ACCT_115: 98_000_000, // Interest Income
        ACCT_116: 28_000_000, // Interest Expense
        ACCT_602: 252_000_000, // Regular Shares
        ACCT_604: 476_000_000, // Share Drafts
        ACCT_606: 714_000_000, // Money Market
        ACCT_608: 952_000_000, // Share Certificates
        ACCT_011: 840_000_000, // Real Estate Loans
        ACCT_370: 560_000_000, // Consumer Loans
        ACCT_385: 280_000_000, // Commercial Loans
        ACCT_719: 14_000_000, // Provision for Loan Losses
        ACCT_045: 22_400_000, // Allowance for Loan Losses
        ACCT_660: 0.1, // Net Worth Ratio (10%)
        ACCT_671: 0.008, // Delinquency Ratio
        ACCT_730: 42_000_000, // Net Income
      },
    };
  }

  private getDemoSearchResults(
    name: string,
    state?: string,
  ): NcuaSearchResult[] {
    return [
      {
        charterNumber: '12345',
        name: `${name} Federal Credit Union`,
        city: state === 'PR' ? 'Caguas' : 'Orlando',
        state: state ?? 'PR',
        totalAssets: 2_800_000_000,
        memberCount: 25000,
      },
      {
        charterNumber: '12346',
        name: `${name} Community CU`,
        city: state === 'PR' ? 'Bayamon' : 'Miami',
        state: state ?? 'PR',
        totalAssets: 950_000_000,
        memberCount: 12000,
      },
    ];
  }
}
