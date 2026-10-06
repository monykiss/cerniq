import { Injectable, Logger } from '@nestjs/common';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { DataGap, dataGap, mergeGaps } from './reports/data-gap';

/** Round to n decimal places with NaN guard */
function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

@Injectable()
export class ExcelExportService {
  private readonly logger = new Logger(ExcelExportService.name);

  constructor(private readonly almEnterprise: AlmEnterpriseService) {}

  /**
   * Export a multi-sheet ALM report as a tab-separated workbook.
   *
   * Uses an XML Spreadsheet 2003 format (SpreadsheetML) which Excel,
   * LibreOffice, and Numbers open natively with proper sheet tabs.
   * This avoids any dependency on heavy xlsx libraries.
   *
   * Sheets:
   *   1. Executive Summary (risk score, key metrics)
   *   2. COSSEC Ratios (all 12 with thresholds and status)
   *   3. Balance Sheet (all line items)
   *   4. NII Sensitivity (rate shock scenarios)
   */
  async exportToExcel(institutionId: string): Promise<Buffer> {
    this.logger.log(`Excel export requested for institution ${institutionId}`);

    // Fetch failures land here so the workbook can SURFACE them (sheet 0)
    // instead of rendering phantom blanks. A failed fetch is materially
    // different from a legitimately-empty result: each source still degrades
    // independently (one failure must not abort the whole workbook), but every
    // failure is logged AND recorded as a CRITICAL data gap — never swallowed.
    const fetchGaps: DataGap[] = [];

    // Fetch all data in parallel. Each `.catch` logs + records the failure
    // before falling back, so the resilient "partial workbook" behaviour is
    // preserved without masking a fetch error as real (empty) output (D1).
    const [summary, cossec, balanceSheetData, niiSensitivity] =
      await Promise.all([
        this.almEnterprise.getALMSummary(institutionId).catch((err) => {
          this.recordFetchFailure(
            fetchGaps,
            institutionId,
            'getALMSummary',
            'summary',
            'ALM summary unavailable (fetch error)',
            err,
          );
          return null;
        }),
        this.almEnterprise.getCOSSECCompliance(institutionId).catch((err) => {
          this.recordFetchFailure(
            fetchGaps,
            institutionId,
            'getCOSSECCompliance',
            'cossec',
            'COSSEC compliance unavailable (fetch error)',
            err,
          );
          return null;
        }),
        this.almEnterprise
          .listBalanceSheetItems(institutionId, { page: 1, pageSize: 1000 })
          .catch((err) => {
            this.recordFetchFailure(
              fetchGaps,
              institutionId,
              'listBalanceSheetItems',
              'balanceSheet',
              'Balance sheet unavailable (fetch error)',
              err,
            );
            return { items: [] };
          }),
        this.almEnterprise
          .calculateNIISensitivity(institutionId)
          .catch((err) => {
            this.recordFetchFailure(
              fetchGaps,
              institutionId,
              'calculateNIISensitivity',
              'niiSensitivity',
              'NII sensitivity unavailable (fetch error)',
              err,
            );
            return null;
          }),
      ]);

    // Build XML Spreadsheet 2003 workbook
    const xml = this.buildSpreadsheetML(
      institutionId,
      summary,
      cossec,
      balanceSheetData.items ?? [],
      niiSensitivity,
      fetchGaps,
    );

    return Buffer.from(xml, 'utf-8');
  }

  /**
   * Record a failed source fetch so it is VISIBLE, never a silent blank.
   *
   * Logs the failure (ops/audit trail) AND pushes a CRITICAL `DataGap` so the
   * Data Gaps sheet — the first tab a reviewer opens — names the failure with
   * `DEPENDENCY_REJECTED` and a human label ("ALM summary unavailable (fetch
   * error)"). Without this, a fetch error would render as phantom blanks/zeros
   * in that section and an examiner could not tell "missing data" from "fetch
   * failed". That distinction is the whole point of the D1 gap contract.
   */
  private recordFetchFailure(
    sink: DataGap[],
    institutionId: string,
    method: string,
    field: string,
    label: string,
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(
      `Excel export: ${method} failed for institution ${institutionId} — ${message}. Surfacing as a CRITICAL data gap.`,
    );
    sink.push(
      dataGap(field, 'DEPENDENCY_REJECTED', {
        severity: 'CRITICAL',
        action: `${label} — the source fetch failed; retry the export and, if it persists, check the ALM service logs. Do not treat the blank section as real data.`,
        context: { institutionId, method, error: message },
      }),
    );
  }

  // ─── SpreadsheetML Builder ──────────────────────────────────────

  private buildSpreadsheetML(
    institutionId: string,
    summary: any,
    cossec: any,
    balanceSheetItems: any[],
    niiSensitivity: any,
    fetchGaps: DataGap[] = [],
  ): string {
    const sheets: string[] = [];

    // D1 (2026-04-07): the Gaps sheet is the gate. Reviewers reading the
    // Excel export should look at this sheet first — if it has any CRITICAL
    // entries, the workbook should not be shipped to a board or regulator.
    // Other sheets render `DATA UNAVAILABLE` for the affected cells, but
    // this is the canonical manifest that names every missing input.
    //
    // `fetchGaps` lead the manifest: a source that FAILED to fetch (vs. one
    // that returned legitimately-empty data) is the most fundamental problem,
    // so it appears before the per-field gaps the sources reported themselves.
    const allGaps: DataGap[] = mergeGaps(
      fetchGaps,
      summary?.gaps,
      cossec?.gaps,
    );

    sheets.push(this.buildGapsSheet(allGaps));
    sheets.push(this.buildExecutiveSummarySheet(summary, institutionId));
    sheets.push(this.buildCOSSECSheet(cossec));
    sheets.push(this.buildBalanceSheetSheet(balanceSheetItems));
    sheets.push(this.buildNIISensitivitySheet(niiSensitivity));

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      '  xmlns:o="urn:schemas-microsoft-com:office:office"',
      '  xmlns:x="urn:schemas-microsoft-com:office:excel"',
      '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '  <Styles>',
      '    <Style ss:ID="header">',
      '      <Font ss:Bold="1" ss:Size="11"/>',
      '      <Interior ss:Color="#4472C4" ss:Pattern="Solid"/>',
      '      <Font ss:Color="#FFFFFF" ss:Bold="1" ss:Size="11"/>',
      '    </Style>',
      '    <Style ss:ID="title">',
      '      <Font ss:Bold="1" ss:Size="14"/>',
      '    </Style>',
      '    <Style ss:ID="number">',
      '      <NumberFormat ss:Format="#,##0.00"/>',
      '    </Style>',
      '    <Style ss:ID="pct">',
      '      <NumberFormat ss:Format="0.00%"/>',
      '    </Style>',
      '    <Style ss:ID="pass">',
      '      <Interior ss:Color="#C6EFCE" ss:Pattern="Solid"/>',
      '    </Style>',
      '    <Style ss:ID="warn">',
      '      <Interior ss:Color="#FFEB9C" ss:Pattern="Solid"/>',
      '    </Style>',
      '    <Style ss:ID="fail">',
      '      <Interior ss:Color="#FFC7CE" ss:Pattern="Solid"/>',
      '    </Style>',
      '  </Styles>',
      ...sheets,
      '</Workbook>',
    ].join('\n');
  }

  // ─── Sheet 0: Data Gaps (D1, 2026-04-07) ────────────────────────
  //
  // The first sheet a reviewer should look at. Lists every CRITICAL and
  // WARNING gap surfaced by the ALM summary and COSSEC compliance calls.
  // If `gaps.length === 0`, the sheet is just a header that says "no
  // gaps detected" — that's the green-light state for shipping.

  private buildGapsSheet(gaps: DataGap[]): string {
    const rows: string[] = [];

    rows.push(this.xmlRow([this.xmlStringCell('Data Gaps Manifest', 'title')]));
    rows.push(this.xmlRow([]));

    if (gaps.length === 0) {
      rows.push(
        this.xmlRow([
          this.xmlStringCell(
            'No data gaps detected. Every numeric field on the other sheets is backed by real data. This workbook is safe to ship.',
            'pass',
          ),
        ]),
      );
      return this.wrapSheet('Data Gaps', rows);
    }

    const criticalCount = gaps.filter((g) => g.severity === 'CRITICAL').length;
    const warningCount = gaps.filter((g) => g.severity === 'WARNING').length;

    rows.push(
      this.xmlRow([
        this.xmlStringCell(
          criticalCount > 0
            ? `WARNING: ${criticalCount} CRITICAL gaps + ${warningCount} warnings. Do NOT ship this workbook to a board or regulator until the CRITICAL gaps are resolved.`
            : `${warningCount} WARNINGS — review before shipping.`,
          criticalCount > 0 ? 'fail' : 'warn',
        ),
      ]),
    );
    rows.push(this.xmlRow([]));

    rows.push(
      this.xmlRow([
        this.xmlStringCell('Severity', 'header'),
        this.xmlStringCell('Field', 'header'),
        this.xmlStringCell('Reason', 'header'),
        this.xmlStringCell('Action', 'header'),
      ]),
    );

    for (const gap of gaps) {
      rows.push(
        this.xmlRow([
          this.xmlStringCell(
            gap.severity,
            gap.severity === 'CRITICAL' ? 'fail' : 'warn',
          ),
          this.xmlStringCell(gap.field),
          this.xmlStringCell(gap.reason),
          this.xmlStringCell(gap.action ?? ''),
        ]),
      );
    }

    return this.wrapSheet('Data Gaps', rows);
  }

  // ─── Sheet 1: Executive Summary ─────────────────────────────────

  private buildExecutiveSummarySheet(
    summary: any,
    institutionId: string,
  ): string {
    const rows: string[] = [];

    const instName = summary?.institution?.name ?? 'Unknown Institution';
    const reportDate =
      summary?.institution?.reportingDate?.split('T')[0] ??
      new Date().toISOString().split('T')[0];

    rows.push(this.xmlRow([this.xmlStringCell('CerniQ ALM Report', 'title')]));
    rows.push(this.xmlRow([this.xmlStringCell(`Institution: ${instName}`)]));
    rows.push(this.xmlRow([this.xmlStringCell(`Report Date: ${reportDate}`)]));
    rows.push(
      this.xmlRow([
        this.xmlStringCell(`Institution ID: ${institutionId.slice(0, 8)}...`),
      ]),
    );
    rows.push(this.xmlRow([])); // blank row

    // Risk Score. D1 (2026-04-07): nullable when LCR is data_unavailable.
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Risk Score', 'header'),
        this.xmlStringCell('Value', 'header'),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Overall Risk Score (0-100)'),
        this.xmlMaybeNumberCell(summary?.riskScore),
      ]),
    );
    rows.push(this.xmlRow([]));

    // Duration Gap
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Duration Gap Analysis', 'header'),
        this.xmlStringCell('Value', 'header'),
      ]),
    );
    const dg = summary?.durationGap;
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Asset Duration (years)'),
        this.xmlNumberCell(dg?.assetDuration ?? 0),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Liability Duration (years)'),
        this.xmlNumberCell(dg?.liabilityDuration ?? 0),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Duration Gap'),
        this.xmlNumberCell(dg?.durationGap ?? 0),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Risk Profile'),
        this.xmlStringCell(dg?.riskProfile ?? 'N/A'),
      ]),
    );
    rows.push(this.xmlRow([]));

    // Liquidity. D1 (2026-04-07): use xmlMaybeNumberCell for the LCR fields
    // so missing data renders as DATA UNAVAILABLE instead of phantom 0.
    // The status string communicates the same thing in the Status row.
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Liquidity', 'header'),
        this.xmlStringCell('Value', 'header'),
      ]),
    );
    const liq = summary?.liquidity;
    rows.push(
      this.xmlRow([
        this.xmlStringCell('LCR (%)'),
        this.xmlMaybeNumberCell(liq?.lcr),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('HQLA ($M)'),
        this.xmlMaybeNumberCell(liq?.hqla),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Net Outflows ($M)'),
        this.xmlMaybeNumberCell(liq?.netOutflows),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Status'),
        this.xmlStringCell(liq?.status ?? 'N/A'),
      ]),
    );
    rows.push(this.xmlRow([]));

    // Top Risks
    rows.push(this.xmlRow([this.xmlStringCell('Top Risks', 'header')]));
    const risks: string[] = summary?.topRisks ?? [];
    for (const risk of risks) {
      rows.push(this.xmlRow([this.xmlStringCell(risk)]));
    }
    rows.push(this.xmlRow([]));

    // Recommendations
    rows.push(this.xmlRow([this.xmlStringCell('Recommendations', 'header')]));
    const recs: string[] = summary?.recommendations ?? [];
    for (const rec of recs) {
      rows.push(this.xmlRow([this.xmlStringCell(rec)]));
    }

    return this.wrapSheet('Executive Summary', rows);
  }

  // ─── Sheet 2: COSSEC Ratios ─────────────────────────────────────

  private buildCOSSECSheet(cossec: any): string {
    const rows: string[] = [];

    // Header
    rows.push(
      this.xmlRow([
        this.xmlStringCell('#', 'header'),
        this.xmlStringCell('Ratio', 'header'),
        this.xmlStringCell('Value', 'header'),
        this.xmlStringCell('Unit', 'header'),
        this.xmlStringCell('Threshold', 'header'),
        this.xmlStringCell('Status', 'header'),
        this.xmlStringCell('Description', 'header'),
        this.xmlStringCell('Exam Readiness Contribution', 'header'),
      ]),
    );

    const ratios: any[] = cossec?.ratios ?? [];
    for (const ratio of ratios) {
      const statusStyle =
        ratio.status === 'pass'
          ? 'pass'
          : ratio.status === 'warning'
            ? 'warn'
            : ratio.status === 'fail'
              ? 'fail'
              : undefined;

      rows.push(
        this.xmlRow([
          this.xmlNumberCell(ratio.id ?? 0),
          this.xmlStringCell(ratio.name ?? ''),
          this.xmlNumberCell(ratio.value ?? 0),
          this.xmlStringCell(ratio.unit ?? ''),
          this.xmlStringCell(ratio.threshold ?? ''),
          this.xmlStringCell((ratio.status ?? '').toUpperCase(), statusStyle),
          this.xmlStringCell(ratio.description ?? ''),
          this.xmlNumberCell(ratio.examReadinessContribution ?? 0),
        ]),
      );
    }

    // Summary row
    rows.push(this.xmlRow([]));
    rows.push(
      this.xmlRow([
        this.xmlStringCell(''),
        this.xmlStringCell('Exam Readiness Score', 'header'),
        this.xmlNumberCell(cossec?.examReadinessScore ?? 0),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell(''),
        this.xmlStringCell('Overall Status', 'header'),
        this.xmlStringCell((cossec?.overallStatus ?? 'N/A').toUpperCase()),
      ]),
    );

    return this.wrapSheet('COSSEC Ratios', rows);
  }

  // ─── Sheet 3: Balance Sheet ─────────────────────────────────────

  private buildBalanceSheetSheet(items: any[]): string {
    const rows: string[] = [];

    // Header
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Category', 'header'),
        this.xmlStringCell('Subcategory', 'header'),
        this.xmlStringCell('Name', 'header'),
        this.xmlStringCell('Balance ($M)', 'header'),
        this.xmlStringCell('Rate (%)', 'header'),
        this.xmlStringCell('Duration (yrs)', 'header'),
        this.xmlStringCell('Rate Type', 'header'),
      ]),
    );

    // Separate assets and liabilities
    const assets = items.filter((i: any) => i.category === 'asset');
    const liabilities = items.filter((i: any) => i.category === 'liability');

    // Assets
    if (assets.length > 0) {
      rows.push(this.xmlRow([this.xmlStringCell('--- ASSETS ---', 'title')]));
      let totalAssets = 0;
      for (const item of assets) {
        totalAssets += Number(item.balance ?? 0);
        rows.push(
          this.xmlRow([
            this.xmlStringCell(item.category ?? ''),
            this.xmlStringCell(item.subcategory ?? ''),
            this.xmlStringCell(item.name ?? ''),
            this.xmlNumberCell(round(item.balance ?? 0, 2)),
            this.xmlNumberCell(round(item.rate ?? 0, 4)),
            this.xmlNumberCell(round(item.duration ?? 0, 2)),
            this.xmlStringCell(item.rateType ?? ''),
          ]),
        );
      }
      rows.push(
        this.xmlRow([
          this.xmlStringCell(''),
          this.xmlStringCell(''),
          this.xmlStringCell('Total Assets', 'header'),
          this.xmlNumberCell(round(totalAssets, 2)),
        ]),
      );
    }

    // Liabilities
    if (liabilities.length > 0) {
      rows.push(this.xmlRow([]));
      rows.push(
        this.xmlRow([this.xmlStringCell('--- LIABILITIES ---', 'title')]),
      );
      let totalLiabilities = 0;
      for (const item of liabilities) {
        totalLiabilities += Number(item.balance ?? 0);
        rows.push(
          this.xmlRow([
            this.xmlStringCell(item.category ?? ''),
            this.xmlStringCell(item.subcategory ?? ''),
            this.xmlStringCell(item.name ?? ''),
            this.xmlNumberCell(round(item.balance ?? 0, 2)),
            this.xmlNumberCell(round(item.rate ?? 0, 4)),
            this.xmlNumberCell(round(item.duration ?? 0, 2)),
            this.xmlStringCell(item.rateType ?? ''),
          ]),
        );
      }
      rows.push(
        this.xmlRow([
          this.xmlStringCell(''),
          this.xmlStringCell(''),
          this.xmlStringCell('Total Liabilities', 'header'),
          this.xmlNumberCell(round(totalLiabilities, 2)),
        ]),
      );
    }

    if (items.length === 0) {
      rows.push(
        this.xmlRow([
          this.xmlStringCell(
            'No balance sheet data. Upload your balance sheet to populate this sheet.',
          ),
        ]),
      );
    }

    return this.wrapSheet('Balance Sheet', rows);
  }

  // ─── Sheet 4: NII Sensitivity ───────────────────────────────────

  private buildNIISensitivitySheet(niiSensitivity: any): string {
    const rows: string[] = [];

    rows.push(
      this.xmlRow([
        this.xmlStringCell('Scenario', 'header'),
        this.xmlStringCell('Rate Shift (bps)', 'header'),
        this.xmlStringCell('NII Impact ($M)', 'header'),
        this.xmlStringCell('NII Impact (%)', 'header'),
        this.xmlStringCell('MVE Impact ($M)', 'header'),
        this.xmlStringCell('MVE Impact (%)', 'header'),
      ]),
    );

    const baseNII = niiSensitivity?.baseNII ?? 0;
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Base Case'),
        this.xmlNumberCell(0),
        this.xmlNumberCell(round(baseNII, 2)),
        this.xmlStringCell('--'),
        this.xmlStringCell('--'),
        this.xmlStringCell('--'),
      ]),
    );

    const scenarios: any[] = niiSensitivity?.scenarios ?? [];
    for (const s of scenarios) {
      rows.push(
        this.xmlRow([
          this.xmlStringCell(s.name ?? ''),
          this.xmlNumberCell(s.shiftBps ?? 0),
          this.xmlNumberCell(round(s.niImpact ?? 0, 2)),
          this.xmlNumberCell(round(s.niImpactPct ?? 0, 2)),
          this.xmlNumberCell(round(s.mveImpact ?? 0, 2)),
          this.xmlNumberCell(round(s.mveImpactPct ?? 0, 2)),
        ]),
      );
    }

    // Summary
    rows.push(this.xmlRow([]));
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Base NII ($M)', 'header'),
        this.xmlNumberCell(round(baseNII, 2)),
      ]),
    );
    rows.push(
      this.xmlRow([
        this.xmlStringCell('Risk Rating', 'header'),
        this.xmlStringCell((niiSensitivity?.riskRating ?? 'N/A').toUpperCase()),
      ]),
    );

    return this.wrapSheet('NII Sensitivity', rows);
  }

  // ─── XML Helpers ────────────────────────────────────────────────

  private xmlEscape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private xmlStringCell(value: string, styleId?: string): string {
    const style = styleId ? ` ss:StyleID="${styleId}"` : '';
    return `<Cell${style}><Data ss:Type="String">${this.xmlEscape(String(value))}</Data></Cell>`;
  }

  private xmlNumberCell(value: number, styleId?: string): string {
    const style = styleId ? ` ss:StyleID="${styleId}"` : ' ss:StyleID="number"';
    const num = Number.isFinite(value) ? value : 0;
    return `<Cell${style}><Data ss:Type="Number">${num}</Data></Cell>`;
  }

  /**
   * D1 (2026-04-07): nullable number cell. When the input is null/undefined,
   * renders as the string `DATA UNAVAILABLE` instead of a phantom 0. Use this
   * for any field that may be data_unavailable from the underlying ALM
   * service. The presenter is the last line of defense against silent zeros.
   */
  private xmlMaybeNumberCell(
    value: number | null | undefined,
    styleId?: string,
  ): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return this.xmlStringCell('DATA UNAVAILABLE');
    }
    const style = styleId ? ` ss:StyleID="${styleId}"` : ' ss:StyleID="number"';
    return `<Cell${style}><Data ss:Type="Number">${value}</Data></Cell>`;
  }

  private xmlRow(cells: string[]): string {
    if (cells.length === 0) {
      return '      <Row/>';
    }
    return `      <Row>${cells.join('')}</Row>`;
  }

  private wrapSheet(name: string, rows: string[]): string {
    return [
      `  <Worksheet ss:Name="${this.xmlEscape(name)}">`,
      '    <Table>',
      ...rows,
      '    </Table>',
      '  </Worksheet>',
    ].join('\n');
  }
}
