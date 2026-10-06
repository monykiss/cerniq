import { renderCaelReport, type CaelReportContext } from './cael-report';
import {
  CaelComplianceService,
  type CaelComplianceResult,
} from './cael-compliance.service';

describe('renderCaelReport — bilingual CAEL filing (W1.1 Slice 2)', () => {
  const svc = new CaelComplianceService();
  const SUMMARY = {
    equity: 25,
    totalAssets: 250,
    capitalRatioRWA: 18.6,
    liquidityRatio: 12,
    interestIncome: 10,
    interestExpense: 4,
  };

  // The three quarterly variants: 7790 (incurred-loss), CECL, Piloto.
  const results: CaelComplianceResult[] = [
    svc.evaluateCaelCompliance(
      svc.caelInputsFromEngines('reg7790', SUMMARY, {
        totalAllowance: 2.6,
        totalBalance: 200,
        methodology: 'Incurred Loss (Reg 8665)',
        overallStatus: 'computed',
      }),
    ),
    svc.evaluateCaelCompliance(
      svc.caelInputsFromEngines('cecl', SUMMARY, {
        totalAllowance: 3.8,
        totalBalance: 200,
        methodology: 'WARM',
        overallStatus: 'computed',
      }),
    ),
    svc.evaluateCaelCompliance(
      svc.caelInputsFromEngines('piloto', SUMMARY, null),
    ),
  ];

  const ctx: CaelReportContext = {
    institutionName: 'Cooperativa San Juan',
    reportingDate: '2026-03-31',
    generatedFor: 'Demostración SIC 2026',
  };

  const html = renderCaelReport(results, ctx);

  it('is a self-contained HTML document — no scripts, no external resources', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('is Spanish-first with an English secondary layer', () => {
    expect(html).toContain('lang="es"');
    expect(html).toContain('Informe de cumplimiento CAEL');
    expect(html).toContain('class="en"'); // English secondary spans
  });

  it('renders a section for each of the three CAEL variants', () => {
    expect(html).toContain('CAEL (Reglamento 7790)');
    expect(html).toContain('CAEL con CECL');
    expect(html).toContain('CAEL Piloto');
    expect((html.match(/<section class="variant">/g) || []).length).toBe(3);
  });

  it('shows the overall-status badge per variant (all conditional here)', () => {
    // asset-quality is data_unavailable for every variant → conditional.
    expect(html).toContain('CONDICIONAL');
    expect(html).toContain('Conditional');
  });

  it('renders each leg with value, threshold, and source', () => {
    expect(html).toContain('&gt;= 8%'); // capital threshold (7790/CECL), HTML-escaped
    expect(html).toContain('&gt;= 4%'); // piloto net-equity threshold, HTML-escaped
    expect(html).toContain('18.60%'); // capital value
    expect(html).toContain(
      'Ley 255-2002 Art. 6.02 (8% indivisible capital over RWA)',
    );
  });

  it('flags provisional bands with a PROV. marker', () => {
    expect(html).toContain('PROV.');
    // the statutory liquidity leg (CC-2021-02) must NOT be marked provisional —
    // its row should carry its source without a PROV. badge attached.
    expect(html).toContain('Carta Circular CC-2021-02 (5% minimum liquidity)');
  });

  it("renders the loss-basis comparison (the dual filing's whole point)", () => {
    expect(html).toContain('Loss-basis comparison');
    expect(html).toContain('1.30%'); // incurred-loss coverage 2.6/200
    expect(html).toContain('1.90%'); // CECL coverage 3.8/200
  });

  it('surfaces the data-gap disclosures (asset-quality + provisional bands)', () => {
    expect(html).toContain('Data gaps');
    expect(html).toMatch(/asset.quality|morosidad|NPL/i);
    expect(html).toContain('WARNING');
  });

  it('HTML-escapes every datum (no injection via institution name)', () => {
    const evil = renderCaelReport(results, {
      ...ctx,
      institutionName: 'Coop <script>alert(1)</script> & "Q1"',
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('&amp;');
  });

  it('watermarks the artifact as a DEMOSTRACIÓN, not a filing', () => {
    expect(html).toContain('DEMOSTRACIÓN');
    expect(html).toContain('no es una radicación regulatoria');
  });

  it('is structurally balanced (matched section/table tags)', () => {
    const open = (re: RegExp) => (html.match(re) || []).length;
    expect(open(/<section/g)).toBe(open(/<\/section>/g));
    expect(open(/<table/g)).toBe(open(/<\/table>/g));
    expect(open(/<table/g)).toBe(3); // one ratio table per variant
  });

  it('is deterministic — identical input renders byte-identical HTML', () => {
    expect(renderCaelReport(results, ctx)).toBe(html);
  });

  it('renders gracefully when given no variants', () => {
    const empty = renderCaelReport([], ctx);
    expect(empty.startsWith('<!doctype html>')).toBe(true);
    expect(empty).toContain('Sin variantes CAEL');
  });

  it('badges a compliant variant CUMPLE and a statutory-fail INCUMPLE', () => {
    const compliant = renderCaelReport(
      [
        svc.evaluateCaelCompliance({
          variant: 'reg7790',
          capitalRatioRwaPct: 18,
          netEquityRatioPct: 10,
          delinquencyPct: 1, // full data → compliant
          roaPct: 1,
          liquidityRatioPct: 12,
          allowance: null,
        }),
      ],
      ctx,
    );
    expect(compliant).toContain('CUMPLE');

    const failed = renderCaelReport(
      [
        svc.evaluateCaelCompliance({
          variant: 'reg7790',
          capitalRatioRwaPct: 5, // statutory capital fail
          netEquityRatioPct: 10,
          delinquencyPct: 1,
          roaPct: 1,
          liquidityRatioPct: 12,
          allowance: null,
        }),
      ],
      ctx,
    );
    expect(failed).toContain('INCUMPLE');
  });
});
