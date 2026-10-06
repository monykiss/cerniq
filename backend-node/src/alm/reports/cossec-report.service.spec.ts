import { CossecReportService } from './cossec-report.service';
import type { COSSECComplianceResult } from '../alm-enterprise.service';

const mkRatio = (
  id: number,
  name: string,
  nameEs: string,
  value: number,
  status: 'pass' | 'warning' | 'fail' | 'info' | 'data_unavailable',
): COSSECComplianceResult['ratios'][number] =>
  ({
    id,
    name,
    nameEs,
    value,
    unit: '%',
    threshold: '>= 8%',
    thresholdDirection: 'gte',
    status,
    description: `${name} description`,
    descriptionEs: `Descripción de ${nameEs}`,
    examReadinessContribution: 10,
    sectorMedian: null,
    percentileRank: null,
    percentileRankEs: null,
  }) as any;

const fixture = (
  overall: COSSECComplianceResult['overallStatus'],
): COSSECComplianceResult =>
  ({
    institutionName: 'Cooperativa de Ahorro y Crédito de Prueba',
    institutionType: 'cooperativa',
    reportingDate: '2026-03-31T00:00:00.000Z',
    checks: [],
    ratios:
      overall === 'data_unavailable'
        ? []
        : [
            mkRatio(
              1,
              'Capital Adequacy',
              'Suficiencia de Capital',
              12.3,
              'pass',
            ),
            mkRatio(
              2,
              'Asset Quality (Est.)',
              'Calidad de Activos (Est.)',
              2.1,
              'pass',
            ),
            mkRatio(3, 'Liquidity Ratio', 'Razón de Liquidez', 13.4, 'fail'),
            mkRatio(
              4,
              'Loan-to-Deposit Ratio',
              'Razón Préstamos/Depósitos',
              86,
              'warning',
            ),
            mkRatio(
              12,
              'Net Interest Margin',
              'Margen de Interés Neto',
              3.1,
              'pass',
            ),
          ],
    examReadinessScore: 78,
    overallStatus: overall,
    gaps:
      overall === 'data_unavailable'
        ? [
            {
              field: 'cossec.balanceSheet',
              reason: 'EMPTY_BALANCE_SHEET',
              severity: 'CRITICAL',
              action: 'Upload balance sheet items.',
            } as any,
          ]
        : undefined,
    summary: {
      totalAssets: 250,
      totalLiabilities: 219,
      equity: 31,
      totalLoans: 160,
      totalShares: 200,
      liquidAssets: 33.5,
      capitalRatio: 12.3,
      loanToShareRatio: 80,
      // Below the 5% operational minimum (CC-2021-02) so buildConclusions
      // exercises the "no alcanza" branch under the corrected threshold.
      liquidityRatio: 3.4,
      earningAssets: 200,
      interestIncome: 14,
      interestExpense: 4,
      nim: 3.1,
      earningAssetsYield: 7,
      costOfFunds: 2,
      largestSectorPct: 45,
      largestSectorName: 'consumer_loans',
    },
  }) as COSSECComplianceResult;

describe('CossecReportService', () => {
  const mkService = (result: COSSECComplianceResult) => {
    const almEnterprise = {
      getCOSSECCompliance: jest.fn().mockResolvedValue(result),
    } as any;
    return new CossecReportService(almEnterprise);
  };

  it('generates a valid PDF buffer for a compliant institution', async () => {
    const svc = mkService(fixture('compliant'));
    const out = await svc.generateCossecReportPdf('inst-1');
    expect(out.buffer.length).toBeGreaterThan(1000);
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.compliance.overallStatus).toBe('compliant');
  });

  it('defaults to a Spanish filename (Spanish-first contract)', async () => {
    const svc = mkService(fixture('compliant'));
    const out = await svc.generateCossecReportPdf('inst-1');
    expect(out.filename).toMatch(/^informe-cossec-cooperativa-de-ahorro/);
    expect(out.filename).toMatch(/\.pdf$/);
  });

  it('produces an English filename for lang=en', async () => {
    const svc = mkService(fixture('compliant'));
    const out = await svc.generateCossecReportPdf('inst-1', 'en');
    expect(out.filename).toMatch(/^cossec-report-/);
  });

  it('still renders a PDF when data is unavailable (explicit gap disclosure, no phantom zeros)', async () => {
    const svc = mkService(fixture('data_unavailable'));
    const out = await svc.generateCossecReportPdf('inst-1');
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.compliance.gaps).toHaveLength(1);
  });

  describe('buildConclusions (conclusion-first, CEO-readable)', () => {
    it('Spanish conclusions lead with the capital ratio verdict', () => {
      const svc = mkService(fixture('compliant'));
      const lines = svc.buildConclusions(fixture('compliant'), 'es');
      expect(lines[0]).toContain('12.3%');
      expect(lines[0]).toContain('activos sujetos a riesgo');
      expect(lines[0]).toContain('sobre el mínimo de 8%');
      expect(lines[0]).toContain('Ley 255');
    });

    it('flags below-minimum liquidity in plain Spanish', () => {
      const svc = mkService(fixture('compliant'));
      const lines = svc.buildConclusions(fixture('compliant'), 'es');
      expect(lines[1]).toContain('liquidez');
      expect(lines[1]).toContain('no alcanza');
    });

    it('names failing ratios in the attention line', () => {
      const svc = mkService(fixture('compliant'));
      const lines = svc.buildConclusions(fixture('compliant'), 'es');
      expect(lines.some((l) => l.includes('Razón de Liquidez'))).toBe(true);
    });

    it('English variant mirrors the same verdicts', () => {
      const svc = mkService(fixture('compliant'));
      const lines = svc.buildConclusions(fixture('compliant'), 'en');
      expect(lines[0]).toContain('12.3%');
      expect(lines[0]).toContain('risk-weighted assets');
      expect(lines[0]).toContain('above the 8% minimum');
    });

    it('prefers the statutory RWA ratio over the leverage ratio when present', () => {
      const c = fixture('compliant');
      // capitalRatioRWA (statutory) differs from capitalRatio (leverage) —
      // the conclusion must lead with the statutory figure.
      c.summary.capitalRatioRWA = 9.1;
      const lines = mkService(c).buildConclusions(c, 'es');
      expect(lines[0]).toContain('9.1%');
      expect(lines[0]).not.toContain('12.3%');
    });

    it('data_unavailable yields only the missing-data conclusion', () => {
      const svc = mkService(fixture('data_unavailable'));
      const lines = svc.buildConclusions(fixture('data_unavailable'), 'es');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('faltan datos');
    });
  });
});
