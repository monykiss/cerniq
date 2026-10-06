/**
 * COSSEC-insured Puerto Rico cooperativas registry (Anejo 9).
 *
 * Committed JSON is the source of truth for GTM CRM seeding and product
 * market-map Institution shells. Do not invent rows — refresh by re-extracting
 * the quarterly COSSEC Estadísticas PDF Anejo 9 table.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type IcpTier = 'tier1' | 'tier2' | 'tier3';

export interface PrCooperativaRegistryEntry {
  cossecCharter: string;
  seedKey: string;
  legalName: string;
  displayName: string;
  hqMunicipality: string;
  region: string;
  totalAssetsUsd: number;
  members: number;
  employees: number;
  asOf: string;
  icpTier: IcpTier;
  source: string;
}

export interface PrCooperativaRegistryMeta {
  period: string;
  asOf: string;
  source: string;
  sourceUrl: string;
  note?: string;
  expectedCount: number;
  systemTotals: {
    totalAssetsUsd: number;
    members: number;
    employees: number;
  };
}

export interface PrCooperativaRegistry {
  meta: PrCooperativaRegistryMeta;
  institutions: PrCooperativaRegistryEntry[];
}

/** market research notes §1.3 top-20 legal/display anchors (Q3 ranks; assets may drift by quarter). */
export const MARKET_BIBLE_TOP20_NAMES = [
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
] as const;

const REGISTRY_FILENAME = 'pr-cooperativas-q2-2025.json';

let cached: PrCooperativaRegistry | null = null;

export function loadPrCooperativaRegistry(): PrCooperativaRegistry {
  if (cached) return cached;
  const path = join(__dirname, REGISTRY_FILENAME);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PrCooperativaRegistry;
  cached = raw;
  return raw;
}

export function listPrCooperativas(): PrCooperativaRegistryEntry[] {
  return loadPrCooperativaRegistry().institutions;
}

export function getPrCooperativaByCharter(
  charter: string,
): PrCooperativaRegistryEntry | undefined {
  const normalized = charter.replace(/^0+/, '') || '0';
  return listPrCooperativas().find(
    (row) => row.cossecCharter.replace(/^0+/, '') === normalized,
  );
}

export function icpTierFromAssets(totalAssetsUsd: number): IcpTier {
  if (totalAssetsUsd >= 100_000_000) return 'tier1';
  if (totalAssetsUsd >= 50_000_000) return 'tier2';
  return 'tier3';
}

export interface RegistryVerifyResult {
  ok: boolean;
  count: number;
  expectedCount: number;
  missingTop20: string[];
  hasAguada: boolean;
  tierCounts: Record<IcpTier, number>;
  errors: string[];
}

/**
 * Self-contained verify gate — count === 91, no Aguada, market research notes top-20
 * names present, tier math consistent with assets.
 */
export function verifyPrCooperativaRegistry(
  registry: PrCooperativaRegistry = loadPrCooperativaRegistry(),
): RegistryVerifyResult {
  const errors: string[] = [];
  const { institutions, meta } = registry;
  const count = institutions.length;
  const expectedCount = meta.expectedCount ?? 91;

  if (count !== expectedCount) {
    errors.push(`expected ${expectedCount} institutions, got ${count}`);
  }

  const charters = new Set<string>();
  for (const row of institutions) {
    if (charters.has(row.cossecCharter)) {
      errors.push(`duplicate cossecCharter ${row.cossecCharter}`);
    }
    charters.add(row.cossecCharter);
    if (row.icpTier !== icpTierFromAssets(row.totalAssetsUsd)) {
      errors.push(
        `${row.seedKey}: icpTier ${row.icpTier} mismatches assets ${row.totalAssetsUsd}`,
      );
    }
  }

  const blob = institutions
    .map((r) => `${r.displayName} ${r.legalName}`)
    .join('\n');
  const hasAguada = /aguada/i.test(blob);
  if (hasAguada) {
    errors.push('dissolved Coop Aguada must not appear in the registry');
  }

  const missingTop20 = MARKET_BIBLE_TOP20_NAMES.filter(
    (needle) =>
      !new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(
        blob,
      ),
  );
  if (missingTop20.length > 0) {
    errors.push(
      `missing market research notes top-20 anchors: ${missingTop20.join(', ')}`,
    );
  }

  const tierCounts: Record<IcpTier, number> = {
    tier1: 0,
    tier2: 0,
    tier3: 0,
  };
  for (const row of institutions) {
    tierCounts[row.icpTier] += 1;
  }

  return {
    ok: errors.length === 0,
    count,
    expectedCount,
    missingTop20,
    hasAguada,
    tierCounts,
    errors,
  };
}
