/**
 * End-to-end specs for the SIC 2026 demo harness.
 *
 * The harness composes the real ALM engines against the dynamically-built
 * institution. These specs prove: (1) it is reproducible (SR 11-7 — identical
 * runs, identical SHA-256 checksum); (2) every headline number is a RELATIONSHIP
 * of the inputs (baseline = equity/assets, stressed = (equity−losses)/assets,
 * credit shock targets the consumer book); and (3) the D1 gap manifest is
 * present and carries no CRITICAL gap for a fully-populated institution.
 *
 * No committed golden snapshot: the harness transitively calls CECL + the COSSEC
 * frameworks, which are under concurrent edit in this shared tree — a committed
 * snapshot would couple this spec to a peer's in-flight work. The reproducibility
 * (checksum) + relationship assertions are self-contained and peer-robust.
 */
import { SicDemoService } from './sic-demo.service';
import { buildSanJuanFederalDemo } from '../data/fixtures/builders/san-juan-federal.builder';

describe('SicDemoService', () => {
  it('is reproducible — two runs produce identical checksums and results (SR 11-7)', async () => {
    const a = await new SicDemoService().run();
    const b = await new SicDemoService().run();
    expect(a.resultChecksum).toBe(b.resultChecksum);
    expect(a).toEqual(b);
    expect(a.resultChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('baseline capital ratio = equity / total assets from the built institution', async () => {
    const r = await new SicDemoService().run();
    const fx = buildSanJuanFederalDemo();
    const assets = fx.items
      .filter((i) => i.category === 'asset')
      .reduce((s, i) => s + i.balance, 0);
    const liabilities = fx.items
      .filter((i) => i.category === 'liability')
      .reduce((s, i) => s + i.balance, 0);
    const equity = assets - liabilities;
    expect(r.baseline.capitalRatioPct).toBeCloseTo((equity / assets) * 100, 1);
  });

  it('SIC credit loss targets the consumer book = consumer × +3%', async () => {
    const r = await new SicDemoService().run();
    const fx = buildSanJuanFederalDemo();
    const consumer = fx.items
      .filter((i) => i.subcategory === 'consumer_loans')
      .reduce((s, i) => s + i.balance, 0);
    const totalLoans = fx.items
      .filter(
        (i) =>
          i.category === 'asset' &&
          [
            'consumer_loans',
            'residential_mortgages',
            'commercial_loans',
          ].includes(i.subcategory),
      )
      .reduce((s, i) => s + i.balance, 0);
    expect(r.stress.creditLoss).toBeCloseTo(consumer * 0.03, 2);
    // segment-targeted ⇒ strictly less than a whole-book application
    expect(r.stress.creditLoss).toBeLessThan(totalLoans * 0.03);
    expect(r.scenario.creditShockSegment).toBe('consumer');
  });

  it('deterministic stressed ratio = (equity − total stress loss) / assets', async () => {
    const r = await new SicDemoService().run();
    const d = r.capitalRatioUnderStress.deterministic;
    expect(d.stressedCapitalRatioPct).toBeCloseTo(
      ((r.baseline.equity - d.totalLoss) / r.institution.totalAssets) * 100,
      2,
    );
    // the adverse tail sits below baseline (stress erodes capital)
    expect(r.headline.adverseTailCapitalRatioPct).toBeLessThan(
      r.headline.baselineCapitalRatioPct,
    );
  });

  it('headline adverse cushion = (p5 − COSSEC minimum) in bps', async () => {
    const r = await new SicDemoService().run();
    expect(r.headline.adverseCushionBps).toBe(
      Math.round(
        (r.capitalRatioUnderStress.distribution.p5 -
          r.headline.cossecMinimumPct) *
          100,
      ),
    );
  });

  it('reacts to a smaller capital ratio — a thinner-capitalized coop breaches sooner', async () => {
    const healthy = await new SicDemoService().run();
    const thin = await new SicDemoService().run({
      institution: { capitalRatioPct: 4 },
    });
    expect(thin.headline.adverseTailCapitalRatioPct).toBeLessThan(
      healthy.headline.adverseTailCapitalRatioPct,
    );
    expect(thin.headline.breachProbabilityPct).toBeGreaterThan(
      healthy.headline.breachProbabilityPct,
    );
  });

  it('runs the compute pipeline steps and flags infra-bound steps honestly', async () => {
    const r = await new SicDemoService().run();
    const completed = r.pipeline
      .filter((s) => s.status === 'completed')
      .map((s) => s.step);
    expect(completed).toEqual(
      expect.arrayContaining(['1', '2', '3', '4', '5b']),
    );
    const infra = r.pipeline
      .filter((s) => s.status === 'requires_infra')
      .map((s) => s.step);
    expect(infra).toEqual(expect.arrayContaining(['5', '6', '7']));
  });

  it('carries a D1 gap manifest with no CRITICAL gaps for a populated institution', async () => {
    const r = await new SicDemoService().run();
    expect(Array.isArray(r.gaps)).toBe(true);
    expect(r.gaps.some((g) => g.severity === 'CRITICAL')).toBe(false);
    expect(r.modelLineage.length).toBeGreaterThanOrEqual(5);
  });

  it('surfaces COSSEC findings (fail-first) and names the binding constraint in the narrative', async () => {
    const r = await new SicDemoService().run();
    // this institution carries real IRR + concentration findings, so the list is non-empty
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect(['fail', 'warning']).toContain(f.status);
    }
    // fail-first ordering: no 'fail' may appear after the first 'warning'
    const firstWarning = r.findings.findIndex((f) => f.status === 'warning');
    if (firstWarning !== -1) {
      expect(
        r.findings.slice(firstWarning).every((f) => f.status === 'warning'),
      ).toBe(true);
    }
    // the binding constraint is named in the headline narrative (both languages)
    const top = r.findings.find((f) => f.status === 'fail') ?? r.findings[0];
    expect(r.headline.narrative).toContain(top.name);
    expect(r.headline.narrativeEs).toContain(top.nameEs);
  });

  it('computes a reverse stress test (distance-to-breach) from the engine outputs', async () => {
    const r = await new SicDemoService().run();
    const rs = r.reverseStress;
    // loss-to-floor = equity − floor×assets, derived from the COSSEC summary
    expect(rs.lossToFloor).toBeCloseTo(
      r.baseline.equity -
        (r.headline.cossecMinimumPct / 100) * r.institution.totalAssets,
      1,
    );
    expect(rs.alreadyBelowFloor).toBe(false); // baseline 10% is well above 7%
    // headroom multiple = lossToFloor / the scenario's total deterministic loss
    expect(rs.headroomMultiple).toBeCloseTo(
      rs.lossToFloor / r.capitalRatioUnderStress.deterministic.totalLoss,
      2,
    );
    // the breaking-point consumer default exceeds the scenario's +3% (it has headroom)
    expect(rs.breakingPointSegmentDefaultPct).toBeGreaterThan(
      r.scenario.creditShockPct,
    );
    expect(rs.narrative).toMatch(/absorb/i);
    expect(rs.narrativeEs).toMatch(/absorber/i);
  });
});
