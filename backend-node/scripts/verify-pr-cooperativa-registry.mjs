#!/usr/bin/env node
/**
 * Gate: committed COSSEC Anejo 9 registry must stay at 91 rows with market research notes
 * top-20 anchors and no dissolved Aguada. Supports --self-test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(
  __dirname,
  '../src/alm/data/registry/pr-cooperativas-q2-2025.json',
);

const TOP20 = [
  'Rincón',
  'COOPACA',
  'CrediCentro',
  'Las Piedras',
  'Oriental',
  'Isabela',
  'Camuy',
  'Vega',
  'Cabo Rojo',
  'Sagrada Familia',
  'Manatí',
  'San José',
  'Medi-Coop',
  'Villalba',
  'Zeno Gandía',
  'Roosevelt Roads',
  'Mauna-Coop',
  'Candel',
  'LarCoop',
  'Quebradillas',
];

function tierFromAssets(assets) {
  if (assets >= 100_000_000) return 'tier1';
  if (assets >= 50_000_000) return 'tier2';
  return 'tier3';
}

function verify(registry) {
  const errors = [];
  const { institutions, meta } = registry;
  const expected = meta?.expectedCount ?? 91;
  if (institutions.length !== expected) {
    errors.push(`expected ${expected}, got ${institutions.length}`);
  }
  const blob = institutions
    .map((r) => `${r.displayName} ${r.legalName}`)
    .join('\n');
  if (/aguada/i.test(blob)) errors.push('dissolved Aguada present');
  for (const needle of TOP20) {
    if (!new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(blob)) {
      errors.push(`missing top-20 anchor: ${needle}`);
    }
  }
  for (const row of institutions) {
    if (row.icpTier !== tierFromAssets(row.totalAssetsUsd)) {
      errors.push(`tier mismatch ${row.seedKey}`);
    }
  }
  return errors;
}

function selfTest() {
  const good = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const goodErrors = verify(good);
  if (goodErrors.length) {
    console.error('SELF-TEST FAIL: live registry invalid', goodErrors);
    process.exit(1);
  }
  const bad = structuredClone(good);
  bad.institutions = bad.institutions.slice(0, 90);
  if (verify(bad).length === 0) {
    console.error('SELF-TEST FAIL: truncated registry should fail');
    process.exit(1);
  }
  console.log('self-test: 2/2 case(s) pass');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const errors = verify(registry);
  if (errors.length) {
    console.error('PR cooperativa registry verify FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `PR cooperativa registry OK: ${registry.institutions.length} institutions (${registry.meta.period})`,
  );
}
