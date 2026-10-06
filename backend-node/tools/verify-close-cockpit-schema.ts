#!/usr/bin/env node
/**
 * verify-close-cockpit-schema — guard against silent schema drift.
 *
 * Sessions 5 AND 6 of the Close Cockpit work both discovered that the
 * `prisma/schema.prisma` file had silently lost Close Cockpit models or
 * enum values between sessions (likely an IDE auto-formatter or linter
 * stripping content). The drift only affects the schema source — the
 * generated Prisma client in `node_modules/.prisma/client` survives, so
 * tsc and tests still pass until the next `prisma generate`, which then
 * silently strips the types and breaks runtime callers.
 *
 * This script grep-checks the schema for every required Close Cockpit
 * token and exits non-zero if any is missing. Wire it into pre-commit
 * or CI: any contributor who accidentally strips a model or enum value
 * gets a loud failure instead of a silent time bomb.
 *
 * Usage:
 *   npx ts-node tools/verify-close-cockpit-schema.ts
 *   # exit 0 = clean
 *   # exit 1 = drift detected; missing tokens listed in stderr
 *
 * The required-tokens list is the source of truth for "what must exist
 * in the schema after every session". Update it deliberately when you
 * intentionally remove or rename a Close Cockpit symbol.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_PATH = join(__dirname, '..', 'prisma', 'schema.prisma');

interface RequiredToken {
  token: string;
  /** Where the token should appear so the error message points the right way. */
  context: string;
}

const REQUIRED_MODELS: RequiredToken[] = [
  { token: 'model CloseCycle ', context: 'Close cycle root entity' },
  { token: 'model CloseTask ', context: 'Cycle task' },
  { token: 'model CloseJournalEntry ', context: 'JE posting' },
  { token: 'model CloseReconciliation ', context: 'Tie-out / recon' },
  { token: 'model CloseFluxNarrative ', context: 'Flux variance + narrative' },
  { token: 'model CloseActivity ', context: 'Activity stream' },
  { token: 'model GlBalanceSnapshot ', context: 'Org-linked GL snapshot table' },
];

const REQUIRED_ENUMS: RequiredToken[] = [
  { token: 'enum CloseCycleStatus ', context: 'Cycle lifecycle states' },
  { token: 'enum CloseTaskStatus ', context: 'Task status enum' },
  { token: 'enum JournalEntryStatus ', context: 'JE status enum' },
  { token: 'enum ReconciliationType ', context: 'Recon type enum' },
  { token: 'enum ReconciliationStatus ', context: 'Recon status enum' },
  { token: 'enum CloseActivityKind ', context: 'Activity kind enum' },
];

const REQUIRED_ENUM_VALUES: RequiredToken[] = [
  // CloseCycleStatus
  { token: 'OPEN', context: 'CloseCycleStatus.OPEN' },
  { token: 'IN_REVIEW', context: 'CloseCycleStatus.IN_REVIEW' },
  { token: 'SIGNED_OFF', context: 'CloseCycleStatus.SIGNED_OFF' },
  { token: 'REOPENED', context: 'CloseCycleStatus.REOPENED' },
  // CloseActivityKind — these have been the drift hotspots
  { token: 'CYCLE_OPENED', context: 'CloseActivityKind.CYCLE_OPENED' },
  { token: 'CYCLE_SIGNED_OFF', context: 'CloseActivityKind.CYCLE_SIGNED_OFF' },
  { token: 'CYCLE_REOPENED', context: 'CloseActivityKind.CYCLE_REOPENED' },
  { token: 'TASK_CASCADED_UNBLOCK', context: 'CloseActivityKind.TASK_CASCADED_UNBLOCK' },
  { token: 'JE_REVERSED', context: 'CloseActivityKind.JE_REVERSED' },
  { token: 'GL_UPLOADED', context: 'CloseActivityKind.GL_UPLOADED' },
  { token: 'RECON_REVIEWED', context: 'CloseActivityKind.RECON_REVIEWED' },
];

const REQUIRED_RELATIONS: RequiredToken[] = [
  {
    token: 'closeCycles ',
    context: 'Organization.closeCycles relation back-reference',
  },
  {
    token: 'glBalanceSnapshots ',
    context: 'Organization.glBalanceSnapshots relation back-reference',
  },
  {
    token: 'reversesJeId',
    context: 'CloseJournalEntry self-relation column for JE reversals',
  },
];

function main(): void {
  let schema: string;
  try {
    schema = readFileSync(SCHEMA_PATH, 'utf-8');
  } catch (err) {
    console.error(`[verify-close-cockpit-schema] Could not read ${SCHEMA_PATH}`);
    console.error(err);
    process.exit(2);
  }

  const missing: Array<{ token: string; context: string; bucket: string }> = [];

  for (const req of REQUIRED_MODELS) {
    if (!schema.includes(req.token)) missing.push({ ...req, bucket: 'model' });
  }
  for (const req of REQUIRED_ENUMS) {
    if (!schema.includes(req.token)) missing.push({ ...req, bucket: 'enum' });
  }
  for (const req of REQUIRED_ENUM_VALUES) {
    if (!schema.includes(req.token)) missing.push({ ...req, bucket: 'enum value' });
  }
  for (const req of REQUIRED_RELATIONS) {
    if (!schema.includes(req.token)) missing.push({ ...req, bucket: 'relation' });
  }

  if (missing.length === 0) {
    console.log(
      `[verify-close-cockpit-schema] OK — all ${
        REQUIRED_MODELS.length +
        REQUIRED_ENUMS.length +
        REQUIRED_ENUM_VALUES.length +
        REQUIRED_RELATIONS.length
      } required tokens present in schema.prisma`,
    );
    process.exit(0);
  }

  console.error('');
  console.error('❌ [verify-close-cockpit-schema] SCHEMA DRIFT DETECTED');
  console.error('');
  console.error(
    `${missing.length} required Close Cockpit token(s) are missing from prisma/schema.prisma:`,
  );
  console.error('');
  for (const m of missing) {
    console.error(`  • [${m.bucket}] ${m.token.trim()} — ${m.context}`);
  }
  console.error('');
  console.error('This usually means an IDE auto-formatter or linter stripped them.');
  console.error('Re-add the missing items from project_cerniq_close_cockpit.md');
  console.error('BEFORE running `prisma generate`, otherwise the next regeneration');
  console.error('will silently strip the generated client and break runtime callers.');
  console.error('');
  process.exit(1);
}

main();
