/**
 * Bilingual CAEL filing report — the dual-output renderer (W1.1 Slice 2).
 *
 * Pure function `CaelComplianceResult[] → HTML string`: no dependencies, no DB,
 * no PDF engine, no browser runtime. Renders the three quarterly CAEL variants
 * (Reglamento 7790 incurred-loss, CAEL-with-CECL, CAEL Piloto) as a single
 * Spanish-first document (English secondary) the founder opens in any browser
 * and prints to PDF — the "dual-output" the W1.1 plan calls for, the two loss
 * bases (incurred-loss vs CECL) sitting side by side.
 *
 * Deterministic: identical results render byte-identical HTML. It is explicitly
 * a DEMOSTRACIÓN / compute-preview artifact — the governed, checksummed
 * `ReportArtifact` persistence (a `CAEL_*` `ReportArtifactFormat` enum, blocked
 * on PR #71) is a later slice — so it carries no filing identity and is watermarked
 * as such. Every datum is HTML-escaped; provisional CAEL bands are flagged inline.
 */
import type {
  CaelComplianceResult,
  CaelRatioStatus,
} from './cael-compliance.service';

/** Institution + run metadata the result objects don't carry. */
export interface CaelReportContext {
  institutionName: string;
  reportingDate: string;
  regulator?: string;
  generatedFor?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(n: number | null): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(2)}%`;
}

/** Overall-status → bilingual badge (label ES / label EN / css class). */
function overallBadge(status: CaelComplianceResult['overallStatus']): {
  es: string;
  en: string;
  cls: string;
} {
  switch (status) {
    case 'compliant':
      return { es: 'CUMPLE', en: 'Compliant', cls: 'ok' };
    case 'non-compliant':
      return { es: 'INCUMPLE', en: 'Non-compliant', cls: 'fail' };
    case 'data_unavailable':
      return { es: 'SIN DATOS', en: 'Data unavailable', cls: 'na' };
    default:
      return { es: 'CONDICIONAL', en: 'Conditional', cls: 'warning' };
  }
}

/** Per-leg status → cell symbol + css class. */
function legStatusCell(status: CaelRatioStatus): string {
  const map: Record<CaelRatioStatus, [string, string]> = {
    pass: ['✓', 'ok'],
    fail: ['✗', 'fail'],
    data_unavailable: ['—', 'na'],
    info: ['·', 'muted'],
  };
  const [sym, cls] = map[status];
  return `<td class="st ${cls}">${sym}</td>`;
}

function ratioRows(result: CaelComplianceResult): string {
  return result.ratios
    .map((r) => {
      const prov = r.provisional
        ? `<span class="prov" title="${esc(r.source)}">PROV.</span>`
        : '';
      return (
        `<tr class="${r.status}">` +
        legStatusCell(r.status) +
        `<td>${esc(r.nameEs)}<span class="en">${esc(r.name)}</span></td>` +
        `<td class="num">${pct(r.value)}</td>` +
        `<td class="num">${esc(r.threshold)}</td>` +
        `<td class="src">${esc(r.source)}${prov}</td>` +
        `</tr>`
      );
    })
    .join('\n        ');
}

function variantSection(result: CaelComplianceResult): string {
  const b = overallBadge(result.overallStatus);
  const score =
    result.composite.examReadinessScore === null
      ? '—'
      : `${result.composite.examReadinessScore}`;
  const provNote = result.composite.provisional
    ? ' <span class="en">(incluye bandas provisionales · includes provisional bands)</span>'
    : '';
  const cov = pct(result.allowance.coveragePct);
  const basis =
    result.allowance.basis === 'n/a'
      ? 'N/A'
      : esc(result.allowance.methodology ?? result.allowance.basis);
  return `<section class="variant">
    <h3>${esc(result.frameworkNameEs)} <span class="en">${esc(result.frameworkName)}</span>
      <span class="badge ${b.cls}">${b.es} · ${b.en}</span></h3>
    <div class="strip">
      <div class="metric"><div class="v">${esc(score)}</div><div class="k">Preparación examen · Readiness${provNote}</div></div>
      <div class="metric"><div class="v">${cov}</div><div class="k">Cobertura provisión · Allowance coverage</div></div>
      <div class="metric"><div class="v">${basis}</div><div class="k">Base de pérdida · Loss basis</div></div>
    </div>
    <table>
      <thead><tr><th>Estado</th><th>Razón · Ratio</th><th class="num">Valor</th><th class="num">Umbral</th><th>Fuente · Source</th></tr></thead>
      <tbody>
        ${ratioRows(result)}
      </tbody>
    </table>
  </section>`;
}

/**
 * The whole point of the dual filing: the same coop's allowance coverage under
 * the legacy incurred-loss basis (Reg 7790) vs CECL. Rendered only when both
 * loss-basis variants are present.
 */
function lossBasisComparison(results: CaelComplianceResult[]): string {
  const incurred = results.find((r) => r.lossBasis === 'incurred-loss');
  const cecl = results.find((r) => r.lossBasis === 'cecl');
  if (!incurred || !cecl) return '';
  const a = incurred.allowance.coveragePct;
  const c = cecl.allowance.coveragePct;
  const delta =
    a !== null && c !== null ? pct(Math.round((c - a) * 10000) / 10000) : '—';
  return `<section>
    <h2>Comparación de base de pérdida · Loss-basis comparison</h2>
    <div class="headline">
      <p>Provisión sobre la cartera bajo cada base — el motivo de la radicación dual.
        <span class="en">Allowance coverage under each basis — the reason for the dual filing.</span></p>
      <div class="strip">
        <div class="metric"><div class="v">${pct(a)}</div><div class="k">Pérdida incurrida · Incurred-loss (Reg 7790)</div></div>
        <div class="metric"><div class="v">${pct(c)}</div><div class="k">CECL (CC-2023-01)</div></div>
        <div class="metric"><div class="v">${delta}</div><div class="k">Δ CECL − incurrida · CECL − incurred</div></div>
      </div>
    </div>
  </section>`;
}

/** Consolidated, de-duplicated gap disclosures across all variants. */
function disclosures(results: CaelComplianceResult[]): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const r of results) {
    for (const g of r.gaps) {
      const key = `${g.field}|${g.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sev = g.severity === 'CRITICAL' ? 'crit' : 'warn';
      items.push(
        `<li class="${sev}"><strong>${esc(g.severity)}</strong> ${esc(g.field)}${g.action ? ` — ${esc(g.action)}` : ''}</li>`,
      );
    }
  }
  if (items.length === 0) {
    return `<p class="ok">Sin brechas de datos · No data gaps</p>`;
  }
  return `<ul class="disc">\n        ${items.join('\n        ')}\n      </ul>`;
}

/** Render the CAEL variants as a standalone, print-ready, Spanish-first HTML document. */
export function renderCaelReport(
  results: CaelComplianceResult[],
  ctx: CaelReportContext,
): string {
  const regulator = ctx.regulator ?? 'COSSEC';
  const generatedFor = ctx.generatedFor ?? '';
  const body =
    results.length === 0
      ? `<p class="na">Sin variantes CAEL para mostrar · No CAEL variants to render</p>`
      : results.map(variantSection).join('\n  ') +
        '\n  ' +
        lossBasisComparison(results);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(ctx.institutionName)} — CAEL</title>
<style>
  :root {
    --ink:#0b1f33; --muted:#5b6b7b; --line:#dde4ea;
    --fail:#fef2f2; --warning:#fffbeb; --ok:#16a34a; --okbg:#ecfdf5;
    --na:#64748b; --nabg:#f1f5f9; --whisker:#1d4ed8; --crit:#dc2626;
  }
  * { box-sizing:border-box; }
  body { font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); margin:0; padding:28px; background:#fff; }
  .wrap { max-width:820px; margin:0 auto; }
  header { border-bottom:2px solid var(--ink); padding-bottom:10px; margin-bottom:6px; }
  h1 { font-size:20px; margin:0; }
  .sub { color:var(--muted); font-size:13px; margin-top:2px; }
  .demo-tag { display:inline-block; background:#0b1f33; color:#fff; font-size:10px; letter-spacing:.08em; padding:2px 7px; border-radius:3px; vertical-align:middle; margin-left:8px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:22px 0 8px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  h3 { font-size:15px; margin:20px 0 6px; }
  .en { color:var(--muted); font-style:italic; }
  .badge { font-size:10px; font-weight:700; letter-spacing:.06em; padding:2px 8px; border-radius:3px; vertical-align:middle; margin-left:6px; }
  .badge.ok { background:var(--okbg); color:var(--ok); } .badge.fail { background:var(--fail); color:var(--crit); }
  .badge.warning { background:var(--warning); color:#b45309; } .badge.na { background:var(--nabg); color:var(--na); }
  .strip { display:flex; flex-wrap:wrap; gap:18px; margin:8px 0; }
  .metric { min-width:130px; }
  .metric .v { font-size:20px; font-weight:600; }
  .metric .k { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .headline { background:#f6f9fc; border-left:3px solid var(--whisker); padding:10px 14px; border-radius:0 4px 4px 0; }
  .headline p { margin:4px 0; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-top:4px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.st { font-size:14px; font-weight:700; text-align:center; }
  td.st.ok { color:var(--ok); } td.st.fail { color:var(--crit); } td.st.na,td.st.muted { color:var(--na); }
  tr.fail { background:var(--fail); } tr.data_unavailable { background:var(--nabg); }
  td .en { display:block; font-size:11px; }
  td.src { font-size:10px; color:var(--muted); }
  .prov { display:inline-block; background:#fef3c7; color:#92400e; font-size:9px; font-weight:700; padding:1px 4px; border-radius:2px; margin-left:5px; }
  .ok { color:var(--ok); } .na { color:var(--na); }
  ul.disc { padding-left:16px; margin:6px 0; font-size:12px; }
  ul.disc li.crit { color:var(--crit); } ul.disc li.warn { color:#b45309; }
  .foot { margin-top:22px; padding-top:10px; border-top:1px solid var(--line); font-size:11px; color:var(--muted); }
  @media print { body { padding:0; } .wrap { max-width:none; } section.variant { break-inside:avoid; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(ctx.institutionName)} — CAEL <span class="demo-tag">DEMOSTRACIÓN</span></h1>
    <div class="sub">${esc(regulator)} · Informe de cumplimiento CAEL · al ${esc(ctx.reportingDate)}${generatedFor ? ` · ${esc(generatedFor)}` : ''}</div>
  </header>

  <p style="font-size:12px;color:var(--muted);margin:10px 0">Desde marzo 2024 cada cooperativa radica TRES informes CAEL trimestrales (Reg 7790 base incurrida, CAEL-con-CECL, CAEL Piloto). <span class="en">Since March 2024 each cooperativa files three quarterly CAEL reports.</span></p>

  ${body}

  <h2>Brechas de datos y supuestos · Data gaps &amp; disclosures</h2>
  ${disclosures(results)}

  <div class="foot">
    Artefacto de DEMOSTRACIÓN / vista previa de cómputo — no es una radicación regulatoria.
    Las bandas marcadas <span class="prov">PROV.</span> son provisionales (texto Reg 7790 sin OCR, pendiente validación COSSEC).
    <span class="en">DEMONSTRATION / compute-preview artifact — not a regulatory filing. PROV. bands are provisional pending COSSEC validation.</span>
  </div>
</div>
</body>
</html>`;
}
