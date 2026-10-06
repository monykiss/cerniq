/**
 * Self-contained HTML report for the SIC 2026 demo.
 *
 * Pure function `SicDemoResult → HTML string`: no dependencies, no DB, no PDF
 * engine, no browser runtime. The output is a single Spanish-first document
 * (English secondary) with an inline SVG capital-ratio distribution plot — the
 * "fan chart" the brief asks for — that the founder can open in any browser and
 * print to PDF for the live call.
 *
 * Deterministic: the same `SicDemoResult` renders byte-identical HTML, so the
 * report inherits the harness's reproducibility (SR 11-7) and carries the same
 * SHA-256 provenance + model disclosures. It is explicitly watermarked as a
 * DEMONSTRATION artifact, never a regulatory filing.
 */
import type { SicDemoResult } from './sic-demo.service';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/**
 * Inline SVG: the stressed capital-ratio distribution (p5–p95 band, p25–p75
 * box, p50 median) plotted against the COSSEC floor and the baseline ratio.
 * Tells the story visually — the whole band sits between the floor and baseline.
 */
function distributionSvg(r: SicDemoResult): string {
  const d = r.capitalRatioUnderStress.distribution;
  const baseline = r.headline.baselineCapitalRatioPct;
  const floor = r.headline.cossecMinimumPct;

  const x0 = 70;
  const x1 = 690;
  const dMin = Math.floor(Math.min(floor, d.p5) - 0.5);
  const dMax = Math.ceil(Math.max(baseline, d.p95) + 0.5);
  const span = dMax - dMin || 1;
  const xOf = (v: number) => x0 + ((v - dMin) / span) * (x1 - x0);
  const yMid = 96;

  const ticks: string[] = [];
  for (let t = dMin; t <= dMax; t++) {
    const x = xOf(t);
    ticks.push(
      `<line x1="${x}" y1="132" x2="${x}" y2="138" stroke="var(--grid)" stroke-width="1"/>` +
        `<text x="${x}" y="150" text-anchor="middle" class="ax">${t}%</text>`,
    );
  }

  const floorX = xOf(floor);
  const baseX = xOf(baseline);

  return `<svg viewBox="0 0 760 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Distribución del ratio de capital bajo estrés">
  <!-- band p5..p95 -->
  <rect x="${xOf(d.p5)}" y="${yMid - 22}" width="${xOf(d.p95) - xOf(d.p5)}" height="44" rx="3" fill="var(--band)"/>
  <!-- box p25..p75 -->
  <rect x="${xOf(d.p25)}" y="${yMid - 16}" width="${xOf(d.p75) - xOf(d.p25)}" height="32" rx="2" fill="var(--box)"/>
  <!-- whisker p5..p95 -->
  <line x1="${xOf(d.p5)}" y1="${yMid}" x2="${xOf(d.p95)}" y2="${yMid}" stroke="var(--whisker)" stroke-width="1.5"/>
  <!-- median p50 -->
  <line x1="${xOf(d.p50)}" y1="${yMid - 18}" x2="${xOf(d.p50)}" y2="${yMid + 18}" stroke="var(--median)" stroke-width="2.5"/>
  <!-- COSSEC floor -->
  <line x1="${floorX}" y1="40" x2="${floorX}" y2="128" stroke="var(--floor)" stroke-width="2" stroke-dasharray="5 3"/>
  <text x="${floorX}" y="34" text-anchor="middle" class="lbl floor">Mínimo COSSEC ${floor}%</text>
  <!-- baseline -->
  <line x1="${baseX}" y1="40" x2="${baseX}" y2="128" stroke="var(--base)" stroke-width="2" stroke-dasharray="2 2"/>
  <text x="${baseX}" y="34" text-anchor="middle" class="lbl base">Base ${pct(baseline)}</text>
  <!-- adverse marker -->
  <text x="${xOf(d.p5)}" y="${yMid + 38}" text-anchor="middle" class="pt">p5 ${pct(d.p5)}</text>
  <text x="${xOf(d.p50)}" y="${yMid + 38}" text-anchor="middle" class="pt">p50 ${pct(d.p50)}</text>
  <text x="${xOf(d.p95)}" y="${yMid + 38}" text-anchor="middle" class="pt">p95 ${pct(d.p95)}</text>
  <!-- axis -->
  <line x1="${x0}" y1="132" x2="${x1}" y2="132" stroke="var(--grid)" stroke-width="1"/>
  ${ticks.join('\n  ')}
</svg>`;
}

function findingsRows(r: SicDemoResult): string {
  if (r.findings.length === 0) {
    return `<tr><td colspan="4" class="ok">Todas las razones dentro de los límites · All ratios within limits</td></tr>`;
  }
  return r.findings
    .map(
      (f) =>
        `<tr class="${f.status}">` +
        `<td class="st">${f.status === 'fail' ? 'INCUMPLE' : 'ALERTA'}</td>` +
        `<td>${esc(f.nameEs)}<span class="en">${esc(f.name)}</span></td>` +
        `<td class="num">${f.value}${esc(f.unit)}</td>` +
        `<td class="num">${esc(f.threshold)}</td>` +
        `</tr>`,
    )
    .join('\n      ');
}

function pipelineRows(r: SicDemoResult): string {
  return r.pipeline
    .map((s) => {
      const done = s.status === 'completed';
      return `<li class="${done ? 'done' : 'infra'}">${done ? '✓' : '·'} ${s.step}. ${esc(s.name)}${done ? '' : ' <span class="en">(requiere infraestructura)</span>'}</li>`;
    })
    .join('\n        ');
}

/** Render the demo result as a standalone, print-ready, Spanish-first HTML document. */
export function renderSicDemoHtml(r: SicDemoResult): string {
  const h = r.headline;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(r.institution.name)} — SIC 2026</title>
<style>
  :root {
    --ink:#0b1f33; --muted:#5b6b7b; --line:#dde4ea; --grid:#b9c4cf;
    --band:#dbeafe; --box:#93c5fd; --whisker:#1d4ed8; --median:#1e3a8a;
    --floor:#dc2626; --base:#64748b; --fail:#fef2f2; --warning:#fffbeb; --ok:#16a34a;
  }
  * { box-sizing:border-box; }
  body { font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); margin:0; padding:28px; background:#fff; }
  .wrap { max-width:780px; margin:0 auto; }
  header { border-bottom:2px solid var(--ink); padding-bottom:10px; margin-bottom:6px; }
  h1 { font-size:20px; margin:0; }
  .sub { color:var(--muted); font-size:13px; margin-top:2px; }
  .demo-tag { display:inline-block; background:#0b1f33; color:#fff; font-size:10px; letter-spacing:.08em; padding:2px 7px; border-radius:3px; vertical-align:middle; margin-left:8px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:22px 0 8px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  .en { color:var(--muted); font-style:italic; }
  .strip { display:flex; flex-wrap:wrap; gap:18px; margin:10px 0; }
  .metric { min-width:120px; }
  .metric .v { font-size:22px; font-weight:600; }
  .metric .k { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .headline { background:#f6f9fc; border-left:3px solid var(--whisker); padding:10px 14px; border-radius:0 4px 4px 0; }
  .headline p { margin:4px 0; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.st { font-size:11px; font-weight:700; }
  tr.fail { background:var(--fail); } tr.fail .st { color:var(--floor); }
  tr.warning { background:var(--warning); } tr.warning .st { color:#b45309; }
  td .en { display:block; font-size:11px; }
  td.ok { color:var(--ok); text-align:center; }
  ul.pipe { list-style:none; padding:0; margin:0; columns:2; font-size:13px; }
  ul.pipe li { margin:3px 0; } ul.pipe li.done { color:var(--ink); } ul.pipe li.infra { color:var(--muted); }
  .foot { margin-top:20px; padding-top:10px; border-top:1px solid var(--line); font-size:11px; color:var(--muted); }
  .foot code { font-size:10px; word-break:break-all; }
  ul.disc { padding-left:16px; margin:6px 0; }
  @media print { body { padding:0; } .wrap { max-width:none; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(r.institution.name)} <span class="demo-tag">DEMO</span></h1>
    <div class="sub">${esc(r.generatedFor)} · ${esc(r.institution.regulator)} · ${esc(r.institution.currency)} ${r.institution.totalAssets}M · al ${esc(r.institution.reportingDate)}</div>
  </header>

  <h2>Resumen · Baseline</h2>
  <div class="strip">
    <div class="metric"><div class="v">${pct(r.baseline.capitalRatioPct)}</div><div class="k">Ratio de capital</div></div>
    <div class="metric"><div class="v">${r.baseline.capitalRatioRWAPct != null ? pct(r.baseline.capitalRatioRWAPct) : '—'}</div><div class="k">Capital / RWA</div></div>
    <div class="metric"><div class="v">${pct(r.baseline.nim)}</div><div class="k">NIM</div></div>
    <div class="metric"><div class="v">${r.baseline.examReadinessScore}</div><div class="k">Exam readiness</div></div>
    <div class="metric"><div class="v">${esc(r.baseline.cossecOverallStatus)}</div><div class="k">Estado COSSEC</div></div>
  </div>

  <h2>Ratio de capital bajo estrés · Capital ratio under stress</h2>
  ${distributionSvg(r)}
  <div class="headline">
    <p>${esc(h.narrativeEs)}</p>
    <p class="en">${esc(h.narrative)}</p>
    <p style="font-size:12px;color:var(--muted)">Escenario: ${esc(r.scenario.nameEs)} · ${r.scenario.rateShiftBps}pb · depósitos ${r.scenario.depositShockPct}% · +${r.scenario.creditShockPct}% morosidad (${esc(r.scenario.creditShockSegment)}) · prob. incumplimiento ${pct(h.breachProbabilityPct)}</p>
  </div>

  <h2>Prueba de estrés inversa · Reverse stress (distance to breach)</h2>
  <div class="headline">
    <p>${esc(r.reverseStress.narrativeEs)}</p>
    <p class="en">${esc(r.reverseStress.narrative)}</p>
  </div>

  <h2>Hallazgos COSSEC · Findings (the risk capital ratio hides)</h2>
  <table>
    <thead><tr><th>Estado</th><th>Razón · Ratio</th><th class="num">Valor</th><th class="num">Límite</th></tr></thead>
    <tbody>
      ${findingsRows(r)}
    </tbody>
  </table>

  <h2>Pipeline · 7 pasos</h2>
  <ul class="pipe">
        ${pipelineRows(r)}
  </ul>

  <div class="foot">
    <strong>Metodología (proyección sembrada):</strong>
    <ul class="disc">${r.capitalRatioUnderStress.disclosures.map((dd) => `<li>${esc(dd)}</li>`).join('')}</ul>
    Artefacto de DEMOSTRACIÓN — no es una radicación regulatoria. SHA-256: <code>${esc(r.resultChecksum)}</code>
  </div>
</div>
</body>
</html>`;
}
