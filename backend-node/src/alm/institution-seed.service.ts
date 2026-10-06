/**
 * Institution seed pipeline — idempotent, transactional, delta-aware.
 *
 * The contract:
 *   1. `seedFromFixture(workspaceId, fixtureKey)` is safe to call any number of times.
 *      The first call creates an institution; subsequent calls upsert by
 *      `(workspaceId, seedKey)` and return a delta describing what changed.
 *   2. The whole operation runs inside a single Prisma transaction. Either everything
 *      lands or nothing does — there is no half-seeded institution.
 *   3. The returned `SeedResult.delta` is honest: if nothing changed, the delta says so.
 *      Callers (CLI, frontend, action registry) render the delta verbatim — no faking
 *      "Created!" when the database actually no-op'd.
 *
 * This service is the backbone of cross-session pickup: a future Claude session can
 * re-run `pnpm seed:institution --workspace=X --fixture=pr-cooperativa-demo` and land
 * in the exact same state as the prior session, without duplicating data.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { getFixture, InstitutionFixture, SeedResult } from './data/fixtures';

@Injectable()
export class InstitutionSeedService {
  private readonly logger = new Logger(InstitutionSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed (or re-seed) an institution from a registered fixture.
   *
   * Re-running with the same `(workspaceId, fixtureKey)` is the supported path. The
   * institution is upserted by its composite seed key, balance sheet items are
   * replaced atomically, and the liquidity position is upserted by `(institutionId, date)`.
   */
  async seedFromFixture(
    workspaceId: string,
    fixtureKey: string,
  ): Promise<SeedResult> {
    const fixture = getFixture(fixtureKey);
    this.logger.log(
      `Seeding fixture "${fixture.seedKey}" into workspace ${workspaceId}`,
    );

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ── 1. Upsert the institution by its stable seed key ──────────────────
      const existing = await tx.institution.findUnique({
        where: {
          workspace_seed_key: {
            workspaceId,
            seedKey: fixture.seedKey,
          },
        },
      });

      const institutionData = this.fixtureToInstitutionData(
        workspaceId,
        fixture,
      );

      let institution: typeof existing;
      let institutionDelta: 'created' | 'updated' | 'unchanged';

      if (!existing) {
        institution = await tx.institution.create({ data: institutionData });
        institutionDelta = 'created';
      } else if (this.institutionFieldsEqual(existing, institutionData)) {
        // Data is identical — skip the write entirely.
        institution = existing;
        institutionDelta = 'unchanged';
      } else {
        institution = await tx.institution.update({
          where: { id: existing.id },
          data: institutionData,
        });
        institutionDelta = 'updated';
      }

      // ── 2. Replace balance sheet items atomically ─────────────────────────
      // Items are leaves (no child relations), so a deleteMany + createMany inside
      // the same transaction is safe and avoids needing per-item seed keys.
      const before = await tx.balanceSheetItem.count({
        where: { institutionId: institution.id },
      });

      await tx.balanceSheetItem.deleteMany({
        where: { institutionId: institution.id },
      });

      await tx.balanceSheetItem.createMany({
        data: fixture.items.map((item) => ({
          institutionId: institution.id,
          category: item.category,
          subcategory: item.subcategory,
          name: item.name,
          balance: item.balance,
          // Fixtures store rate as percent (6.5 = 6.5%); schema stores as decimal (0.065).
          rate: item.rate / 100,
          duration: item.duration,
          rateType: item.rateType,
          depositBeta: item.depositBeta ?? null,
        })),
      });

      const after = fixture.items.length;
      const itemsReplaced = before > 0;

      // ── 3. Upsert liquidity position by (institutionId, date) ─────────────
      const liquidityDate = new Date(
        fixture.liquidity.date ?? fixture.reportingDate,
      );

      const liquidityPayload = {
        hqlaLevel1: fixture.liquidity.hqlaLevel1,
        hqlaLevel2: fixture.liquidity.hqlaLevel2,
        cashOutflows: fixture.liquidity.cashOutflows,
        cashInflows: fixture.liquidity.cashInflows,
        lcr: fixture.liquidity.lcr,
        nsfr: fixture.liquidity.nsfr,
      };

      const existingLiquidity = await tx.liquidityPosition.findUnique({
        where: {
          institutionId_date: {
            institutionId: institution.id,
            date: liquidityDate,
          },
        },
      });

      let liquidityDelta: 'created' | 'updated' | 'unchanged';
      if (!existingLiquidity) {
        await tx.liquidityPosition.create({
          data: {
            institutionId: institution.id,
            date: liquidityDate,
            ...liquidityPayload,
          },
        });
        liquidityDelta = 'created';
      } else if (
        this.liquidityFieldsEqual(existingLiquidity, liquidityPayload)
      ) {
        liquidityDelta = 'unchanged';
      } else {
        await tx.liquidityPosition.update({
          where: { id: existingLiquidity.id },
          data: liquidityPayload,
        });
        liquidityDelta = 'updated';
      }

      const result: SeedResult = {
        institutionId: institution.id,
        seedKey: fixture.seedKey,
        delta: {
          institution: institutionDelta,
          balanceSheetItems: { before, after, replaced: itemsReplaced },
          liquidityPosition: liquidityDelta,
        },
        fixture: {
          seedKey: fixture.seedKey,
          name: fixture.name,
          itemCount: fixture.items.length,
        },
      };

      this.logger.log(
        `Seed complete: institution=${institutionDelta}, items=${before}→${after}, liquidity=${liquidityDelta}`,
      );

      return result;
    });
  }

  /** Map a fixture to the writable subset of `Institution` fields. */
  private fixtureToInstitutionData(
    workspaceId: string,
    fixture: InstitutionFixture,
  ): Prisma.InstitutionUncheckedCreateInput {
    return {
      workspaceId,
      seedKey: fixture.seedKey,
      name: fixture.name,
      type: fixture.type,
      totalAssets: fixture.totalAssets,
      currency: fixture.currency,
      reportingDate: new Date(fixture.reportingDate),
      primaryRegulator: fixture.primaryRegulator ?? 'COSSEC',
      cossecRegistrationNumber: fixture.cossecRegistrationNumber ?? null,
      fiscalYearEnd: fixture.fiscalYearEnd ?? null,
      preferredLanguage: fixture.preferredLanguage ?? 'es',
    };
  }

  /**
   * Decide whether the existing institution row matches the fixture-shaped fields.
   *
   * Locked decision (2026-04-07): the strict-fixture-fields rule. We diff exactly
   * the fields the seeder writes from the fixture — name, type, currency,
   * reportingDate (normalized to ISO date), totalAssets (normalized to 2 decimal
   * places to defeat Decimal precision drift), primaryRegulator, and the optional
   * fixture metadata fields. Operational fields (contactName, ALCO schedule,
   * exam dates, timestamps) are intentionally NOT diffed — they belong to the
   * institution's lived state, not its seeded shape.
   *
   * Why this matters: re-running `pnpm seed:institution` against an unchanged
   * fixture should report `institution=unchanged` (good UX, honest delta).
   * The previous placeholder always reported `updated`, polluting the audit
   * log with false-positive churn.
   */
  private institutionFieldsEqual(
    existing: { [key: string]: unknown },
    next: Prisma.InstitutionUncheckedCreateInput,
  ): boolean {
    const normDate = (v: unknown): string => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'string') return v.slice(0, 10);
      return '';
    };
    const normNumber = (v: unknown): string => {
      if (v == null) return '';
      if (typeof v === 'number') return v.toFixed(2);
      if (typeof v === 'string') return Number(v).toFixed(2);
      if (
        typeof v === 'object' &&
        'toFixed' in v &&
        typeof (v as { toFixed: (n: number) => string }).toFixed === 'function'
      ) {
        return (v as { toFixed: (n: number) => string }).toFixed(2);
      }
      return '';
    };
    const normStr = (v: unknown): string => (v == null ? '' : String(v));

    return (
      normStr(existing.name) === normStr(next.name) &&
      normStr(existing.type) === normStr(next.type) &&
      normStr(existing.currency) === normStr(next.currency) &&
      normDate(existing.reportingDate) === normDate(next.reportingDate) &&
      normNumber(existing.totalAssets) === normNumber(next.totalAssets) &&
      normStr(existing.primaryRegulator) === normStr(next.primaryRegulator) &&
      normStr(existing.cossecRegistrationNumber) ===
        normStr(next.cossecRegistrationNumber) &&
      normStr(existing.fiscalYearEnd) === normStr(next.fiscalYearEnd) &&
      normStr(existing.preferredLanguage) === normStr(next.preferredLanguage)
    );
  }

  /** Field-by-field equality on the liquidity payload, normalized to 6 decimal places. */
  private liquidityFieldsEqual(
    existing: {
      hqlaLevel1: unknown;
      hqlaLevel2: unknown;
      cashOutflows: unknown;
      cashInflows: unknown;
      lcr: unknown;
      nsfr: unknown;
    },
    next: {
      hqlaLevel1: number;
      hqlaLevel2: number;
      cashOutflows: number;
      cashInflows: number;
      lcr: number;
      nsfr: number;
    },
  ): boolean {
    const norm = (v: unknown): string => {
      if (v == null) return '';
      if (typeof v === 'number') return v.toFixed(6);
      if (typeof v === 'string') return Number(v).toFixed(6);
      if (
        typeof v === 'object' &&
        'toFixed' in v &&
        typeof (v as { toFixed: (n: number) => string }).toFixed === 'function'
      ) {
        return (v as { toFixed: (n: number) => string }).toFixed(6);
      }
      return String(v);
    };

    return (
      norm(existing.hqlaLevel1) === norm(next.hqlaLevel1) &&
      norm(existing.hqlaLevel2) === norm(next.hqlaLevel2) &&
      norm(existing.cashOutflows) === norm(next.cashOutflows) &&
      norm(existing.cashInflows) === norm(next.cashInflows) &&
      norm(existing.lcr) === norm(next.lcr) &&
      norm(existing.nsfr) === norm(next.nsfr)
    );
  }
}
