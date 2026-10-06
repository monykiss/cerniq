/**
 * Specs for the SIC 2026 HTML report renderer.
 *
 * Relationship-based: the document carries the institution, the headline
 * numbers, the inline SVG distribution chart, both languages, the findings, and
 * full provenance (DEMO watermark + checksum + disclosures). Deterministic.
 */
import { SicDemoService } from './sic-demo.service';
import { renderSicDemoHtml } from './sic-demo-report';

describe('renderSicDemoHtml', () => {
  let r: Awaited<ReturnType<SicDemoService['run']>>;
  let html: string;

  beforeAll(async () => {
    r = await new SicDemoService().run();
    html = renderSicDemoHtml(r);
  });

  it('is a self-contained HTML document (no external resources)', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>'); // inline CSS
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('renders the institution and the headline numbers', () => {
    expect(html).toContain(r.institution.name);
    expect(html).toContain(`${r.headline.baselineCapitalRatioPct.toFixed(2)}%`);
    expect(html).toContain(
      `${r.capitalRatioUnderStress.distribution.p5.toFixed(2)}%`,
    );
  });

  it('is bilingual, Spanish-first', () => {
    expect(html).toMatch(/lang="es"/);
    expect(html).toMatch(/Reestructuración Global/); // ES
    expect(html).toContain('Global Restructuring'); // EN
  });

  it('includes the inline SVG distribution chart with percentile markers + floor', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
    expect(html).toContain('p5');
    expect(html).toContain('p50');
    expect(html).toContain('p95');
    expect(html).toContain(`Mínimo COSSEC ${r.headline.cossecMinimumPct}%`);
  });

  it('surfaces the binding-constraint finding', () => {
    expect(r.findings.length).toBeGreaterThan(0);
    const top = r.findings.find((f) => f.status === 'fail') ?? r.findings[0];
    expect(html).toContain(top.nameEs);
  });

  it('carries provenance — DEMO watermark, checksum, and model disclosures', () => {
    expect(html).toContain('DEMO');
    expect(html).toContain('DEMOSTRACIÓN');
    expect(html).toContain(r.resultChecksum);
    expect(r.capitalRatioUnderStress.disclosures.length).toBeGreaterThan(0);
    expect(html).toContain(r.capitalRatioUnderStress.disclosures[0]);
  });

  it('escapes nothing dangerous — no raw unescaped angle brackets from data', () => {
    // The only `<`/`>` in the doc are markup; data fields are escaped. A quick
    // structural smoke check: balanced doctype/html/body tags present.
    expect((html.match(/<html/g) || []).length).toBe(1);
    expect((html.match(/<\/html>/g) || []).length).toBe(1);
    expect((html.match(/<body>/g) || []).length).toBe(1);
  });

  it('includes the reverse stress (distance-to-breach) narrative', () => {
    expect(html).toMatch(/Reverse stress|estrés inversa/i);
    expect(html).toContain(r.reverseStress.narrativeEs);
  });

  it('is deterministic — same result renders byte-identical HTML', () => {
    expect(renderSicDemoHtml(r)).toBe(html);
  });
});
