/**
 * Track B — Product ALM shells for the full COSSEC cooperativa universe.
 *
 * Seeds Institution rows into a dedicated `pr-market-map` workspace with
 * metadata only (no fabricated balance sheet / liquidity). Empty BS →
 * DATA_UNAVAILABLE reports per D1.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  listPrCooperativas,
  PrCooperativaRegistryEntry,
} from './data/registry/pr-cooperativas.registry';

export const MARKET_MAP_WORKSPACE_NAME = 'pr-market-map';

export interface MarketShellSeedDelta {
  seedKey: string;
  institutionId: string;
  status: 'created' | 'updated' | 'unchanged';
}

export interface MarketRegistrySeedResult {
  workspaceId: string;
  workspaceName: string;
  created: number;
  updated: number;
  unchanged: number;
  total: number;
  deltas: MarketShellSeedDelta[];
}

@Injectable()
export class MarketRegistrySeedService {
  private readonly logger = new Logger(MarketRegistrySeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure the market-map workspace exists, then upsert all registry shells.
   * When `workspaceId` is provided, that workspace is used (must exist).
   */
  async seedMarketRegistry(options?: {
    workspaceId?: string;
    ownerId?: string;
  }): Promise<MarketRegistrySeedResult> {
    const workspace = options?.workspaceId
      ? await this.prisma.workspace.findUniqueOrThrow({
          where: { id: options.workspaceId },
        })
      : await this.ensureMarketMapWorkspace(options?.ownerId);

    const registry = listPrCooperativas();
    const deltas: MarketShellSeedDelta[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const row of registry) {
      const delta = await this.upsertShell(workspace.id, row);
      deltas.push(delta);
      if (delta.status === 'created') created++;
      else if (delta.status === 'updated') updated++;
      else unchanged++;
    }

    this.logger.log(
      `Market registry seeded into ${workspace.id}: created=${created} updated=${updated} unchanged=${unchanged}`,
    );

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      created,
      updated,
      unchanged,
      total: registry.length,
      deltas,
    };
  }

  async ensureMarketMapWorkspace(ownerId?: string) {
    const existing = await this.prisma.workspace.findFirst({
      where: { name: MARKET_MAP_WORKSPACE_NAME },
    });
    if (existing) return existing;

    return this.prisma.workspace.create({
      data: {
        name: MARKET_MAP_WORKSPACE_NAME,
        ownerId: ownerId ?? null,
      },
    });
  }

  private async upsertShell(
    workspaceId: string,
    row: PrCooperativaRegistryEntry,
  ): Promise<MarketShellSeedDelta> {
    const reportingDate = new Date(`${row.asOf}T00:00:00.000Z`);
    // Store millions with 2dp — matches fixture convention and avoids float churn.
    const totalAssetsMillions = new Prisma.Decimal(
      (row.totalAssetsUsd / 1_000_000).toFixed(2),
    );

    const data = {
      workspaceId,
      seedKey: row.seedKey,
      name: row.displayName,
      type: 'cooperativa',
      totalAssets: totalAssetsMillions,
      currency: 'USD',
      reportingDate,
      primaryRegulator: 'COSSEC',
      regulatoryBody: 'COSSEC',
      cossecRegistrationNumber: row.cossecCharter,
      preferredLanguage: 'es',
      fiscalYearEnd: 'december',
    };

    const existing = await this.prisma.institution.findUnique({
      where: {
        workspace_seed_key: {
          workspaceId,
          seedKey: row.seedKey,
        },
      },
      include: {
        _count: { select: { balanceSheetItems: true } },
      },
    });

    if (!existing) {
      const created = await this.prisma.institution.create({ data });
      return {
        seedKey: row.seedKey,
        institutionId: created.id,
        status: 'created',
      };
    }

    const assetsEqual =
      Number(existing.totalAssets).toFixed(2) ===
      totalAssetsMillions.toFixed(2);
    const same =
      existing.name === data.name &&
      existing.cossecRegistrationNumber === data.cossecRegistrationNumber &&
      assetsEqual &&
      existing.primaryRegulator === data.primaryRegulator &&
      existing.preferredLanguage === data.preferredLanguage;

    // Never invent BS items. If a shell somehow acquired items, leave them —
    // market-map seed only updates institution metadata.
    if (same) {
      return {
        seedKey: row.seedKey,
        institutionId: existing.id,
        status: 'unchanged',
      };
    }

    const updated = await this.prisma.institution.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        totalAssets: data.totalAssets,
        reportingDate: data.reportingDate,
        cossecRegistrationNumber: data.cossecRegistrationNumber,
        primaryRegulator: data.primaryRegulator,
        regulatoryBody: data.regulatoryBody,
        preferredLanguage: data.preferredLanguage,
        fiscalYearEnd: data.fiscalYearEnd,
      },
    });

    return {
      seedKey: row.seedKey,
      institutionId: updated.id,
      status: 'updated',
    };
  }
}
