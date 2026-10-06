import { ExcelExportService } from './excel-export.service';

describe('ExcelExportService', () => {
  let service: ExcelExportService;
  let almEnterprise: any;

  beforeEach(() => {
    almEnterprise = {
      getALMSummary: jest.fn().mockResolvedValue({
        institution: {
          name: 'Coop Test',
          reportingDate: '2026-01-31T00:00:00Z',
        },
        riskScore: 72,
        durationGap: {
          assetDuration: 3.5,
          liabilityDuration: 2.1,
          durationGap: 1.4,
          riskProfile: 'asset-sensitive',
        },
        liquidity: { lcr: 145, hqla: 50, netOutflows: 34, status: 'compliant' },
        topRisks: ['Duration mismatch', 'Rate concentration'],
        recommendations: ['Shorten asset duration'],
      }),
      getCOSSECCompliance: jest.fn().mockResolvedValue({
        ratios: [
          {
            id: 1,
            name: 'Capital Ratio',
            value: 12.5,
            unit: '%',
            threshold: '>= 7%',
            status: 'pass',
            description: 'Adequate capital',
            examReadinessContribution: 8,
          },
          {
            id: 2,
            name: 'Liquidity Ratio',
            value: 3.2,
            unit: '%',
            threshold: '>= 5%',
            status: 'fail',
            description: 'Below minimum',
            examReadinessContribution: 2,
          },
        ],
        examReadinessScore: 85,
        overallStatus: 'conditional',
      }),
      listBalanceSheetItems: jest.fn().mockResolvedValue({
        items: [
          {
            category: 'asset',
            subcategory: 'loans',
            name: 'Consumer Loans',
            balance: 45000000,
            rate: 0.055,
            duration: 4.2,
            rateType: 'fixed',
          },
          {
            category: 'liability',
            subcategory: 'deposits',
            name: 'Savings',
            balance: 30000000,
            rate: 0.02,
            duration: 0.5,
            rateType: 'variable',
          },
        ],
      }),
      calculateNIISensitivity: jest.fn().mockResolvedValue({
        baseNII: 2.5,
        scenarios: [
          {
            name: '+100bps',
            shiftBps: 100,
            niImpact: 0.3,
            niImpactPct: 12,
            mveImpact: -1.2,
            mveImpactPct: -3.5,
          },
        ],
        riskRating: 'moderate',
      }),
    };

    service = new ExcelExportService(almEnterprise);
  });

  describe('exportToExcel', () => {
    it('should return a Buffer', async () => {
      const result = await service.exportToExcel('inst_001');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should produce valid XML Spreadsheet 2003 header', async () => {
      const result = await service.exportToExcel('inst_001');
      const xml = result.toString('utf-8');
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
      expect(xml).toContain('<Workbook');
    });

    it('should include all worksheet tabs (Data Gaps + 4 content sheets)', async () => {
      const result = await service.exportToExcel('inst_001');
      const xml = result.toString('utf-8');
      // D1 (2026-04-07): Data Gaps sheet is the first tab — reviewers
      // open the workbook and see the gap manifest immediately. If it has
      // any CRITICAL entries, the workbook should not be shipped.
      expect(xml).toContain('ss:Name="Data Gaps"');
      expect(xml).toContain('ss:Name="Executive Summary"');
      expect(xml).toContain('ss:Name="COSSEC Ratios"');
      expect(xml).toContain('ss:Name="Balance Sheet"');
      expect(xml).toContain('ss:Name="NII Sensitivity"');
    });

    it('Data Gaps sheet shows green-light message when no gaps detected', async () => {
      const xml = (await service.exportToExcel('inst_001')).toString('utf-8');
      expect(xml).toContain('No data gaps detected');
    });

    it('renders DATA UNAVAILABLE for nullable LCR fields when liquidity is data_unavailable', async () => {
      // D1: when ALMSummary returns data_unavailable LCR + a CRITICAL gap,
      // the Excel cells use xmlMaybeNumberCell to render DATA UNAVAILABLE
      // instead of phantom 0, AND the Data Gaps sheet surfaces the gap.
      almEnterprise.getALMSummary.mockResolvedValueOnce({
        institution: {
          name: 'Empty CU',
          reportingDate: '2026-01-01T00:00:00Z',
        },
        riskScore: null,
        durationGap: {
          assetDuration: 1,
          liabilityDuration: 1,
          durationGap: 0,
          riskProfile: 'neutral',
        },
        liquidity: {
          lcr: null,
          hqla: null,
          netOutflows: null,
          status: 'data_unavailable',
          buffer: null,
        },
        topRisks: [],
        recommendations: [],
        gaps: [
          {
            field: 'liquidity.lcr',
            reason: 'NO_LIQUIDITY_POSITION',
            severity: 'CRITICAL',
            action: 'Upload liquidity data',
          },
        ],
      });

      const xml = (await service.exportToExcel('inst_002')).toString('utf-8');
      // Data Gaps sheet surfaces the CRITICAL entry verbatim.
      expect(xml).toContain('CRITICAL');
      expect(xml).toContain('NO_LIQUIDITY_POSITION');
      expect(xml).toContain('Do NOT ship');
      // Executive Summary sheet renders DATA UNAVAILABLE for the LCR cell.
      expect(xml).toContain('DATA UNAVAILABLE');
    });

    it('should include institution name in Executive Summary', async () => {
      const result = await service.exportToExcel('inst_001');
      const xml = result.toString('utf-8');
      expect(xml).toContain('Coop Test');
    });

    it('should include risk score value', async () => {
      const result = await service.exportToExcel('inst_001');
      const xml = result.toString('utf-8');
      expect(xml).toContain('>72<');
    });

    it('should include COSSEC ratio data', async () => {
      const result = await service.exportToExcel('inst_001');
      const xml = result.toString('utf-8');
      expect(xml).toContain('Capital Ratio');
      expect(xml).toContain('PASS');
      expect(xml).toContain('FAIL');
    });

    it('should include balance sheet items with proper categories', async () => {
      const result = await service.exportToExcel('inst_001');
      const xml = result.toString('utf-8');
      expect(xml).toContain('Consumer Loans');
      expect(xml).toContain('--- ASSETS ---');
      expect(xml).toContain('--- LIABILITIES ---');
    });

    it('should handle errors from almEnterprise gracefully', async () => {
      almEnterprise.getALMSummary.mockRejectedValue(new Error('DB down'));
      almEnterprise.getCOSSECCompliance.mockRejectedValue(new Error('DB down'));
      almEnterprise.calculateNIISensitivity.mockRejectedValue(
        new Error('timeout'),
      );

      const result = await service.exportToExcel('inst_002');
      const xml = result.toString('utf-8');
      // Should still produce a valid workbook with empty/default data
      expect(xml).toContain('<Workbook');
      expect(xml).toContain('</Workbook>');
    });

    it('surfaces a failed source fetch in the Data Gaps sheet (no silent blank)', async () => {
      // Regression lock for the no-silent-catch fix (2026-06-07): a FETCH that
      // throws must be VISIBLE — logged with its source name + institutionId,
      // AND surfaced as a CRITICAL, ship-blocking DataGap on sheet 0 — never a
      // phantom-blank section an examiner could mistake for real (empty) data.
      almEnterprise.getALMSummary.mockRejectedValue(new Error('DB down'));
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      const xml = (await service.exportToExcel('inst_006')).toString('utf-8');

      // (1) The failure is logged with the source name + institution id.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'getALMSummary failed for institution inst_006',
        ),
      );
      // (2) The Data Gaps sheet names the failure instead of going blank.
      expect(xml).toContain('ALM summary unavailable (fetch error)');
      expect(xml).toContain('DEPENDENCY_REJECTED');
      expect(xml).toContain('CRITICAL');
      expect(xml).toContain('Do NOT ship');
    });

    it('should show placeholder message when no balance sheet items', async () => {
      almEnterprise.listBalanceSheetItems.mockResolvedValue({ items: [] });
      const result = await service.exportToExcel('inst_003');
      const xml = result.toString('utf-8');
      expect(xml).toContain('No balance sheet data');
    });

    it('should escape XML special characters', async () => {
      almEnterprise.getALMSummary.mockResolvedValue({
        institution: {
          name: 'Test & <Institution>',
          reportingDate: '2026-01-31T00:00:00Z',
        },
        riskScore: 50,
        topRisks: ['Risk with "quotes" & <tags>'],
        recommendations: [],
      });
      const result = await service.exportToExcel('inst_004');
      const xml = result.toString('utf-8');
      expect(xml).toContain('Test &amp; &lt;Institution&gt;');
      expect(xml).toContain('&amp;');
      expect(xml).not.toContain('& <');
    });
  });

  it('handles listBalanceSheetItems rejection gracefully', async () => {
    almEnterprise.listBalanceSheetItems.mockRejectedValue(
      new Error('DB error'),
    );
    const result = await service.exportToExcel('inst_005');
    expect(result).toBeInstanceOf(Buffer);
  });
});
