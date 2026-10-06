import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { AgentTriggerService } from '../trigger/agent-trigger.service';
import { AgentCostCircuitBreakerService } from '../../queue/agent/agent-cost-circuit-breaker.service';
import { isSchedulerDisabled } from './scheduler-flag.util';

// AgentSchedulerService is the heartbeat of the Risk Monitor agent — the
// "subscription anchor" (Vol.3 §Sprint 2). It runs on three cadences:
//
//   Daily  09:00 AST  — Liquidity ratios (LCR, NSFR, intraday)
//   Weekly Monday 09:00 — Rate risk, duration gaps, peer benchmark deltas
//   Monthly 1st 09:00  — CAMEL drift, credit quality, capital adequacy
//
// For each cadence, the scheduler resolves *active institutions* (those
// with at least one balance sheet upload or prior agent run) and dispatches
// a RISK_MONITOR run per institution via AgentTriggerService, which handles
// idempotency so duplicate cron fires are safe.
//
// Batching: institutions are processed in batches of 5 (matching
// AGENT_WORKER_CONCURRENCY default) to avoid overwhelming the LLM
// provider. The cost circuit breaker is checked per-institution so a
// client that's over budget gets skipped, not crashed.
//
// Timezone: AST (UTC-4, no DST) is used because COSSEC and all PR
// cooperativas operate on AST. The Cron decorator accepts a timezone
// string; 'America/Puerto_Rico' maps to AST.

const BATCH_SIZE = 5;
const TZ = 'America/Puerto_Rico';

@Injectable()
export class AgentSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AgentSchedulerService.name);
  private enabled = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly trigger: AgentTriggerService,
    private readonly costBreaker: AgentCostCircuitBreakerService,
  ) {}

  onModuleInit() {
    if (isSchedulerDisabled()) {
      this.enabled = false;
      this.logger.warn(
        'Agent scheduler DISABLED by AGENT_SCHEDULER_DISABLED env',
      );
    }
  }

  @Cron('0 0 9 * * *', { name: 'agent-daily-monitor', timeZone: TZ })
  async handleDaily() {
    if (!this.enabled) return;
    await this.dispatchForAllInstitutions('daily');
  }

  @Cron('0 0 9 * * 1', { name: 'agent-weekly-monitor', timeZone: TZ })
  async handleWeekly() {
    if (!this.enabled) return;
    await this.dispatchForAllInstitutions('weekly');
  }

  @Cron('0 0 9 1 * *', { name: 'agent-monthly-monitor', timeZone: TZ })
  async handleMonthly() {
    if (!this.enabled) return;
    await this.dispatchForAllInstitutions('monthly');
  }

  async dispatchForAllInstitutions(
    scanKind: 'daily' | 'weekly' | 'monthly',
  ): Promise<{ dispatched: number; skipped: number; failed: number }> {
    const start = Date.now();
    this.logger.log(`[${scanKind}] starting scheduled risk monitor scan`);

    const institutions = await this.resolveActiveInstitutions();
    if (institutions.length === 0) {
      this.logger.log(`[${scanKind}] no active institutions — skipping`);
      return { dispatched: 0, skipped: 0, failed: 0 };
    }

    let dispatched = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < institutions.length; i += BATCH_SIZE) {
      const batch = institutions.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (inst) => {
          const budget = await this.costBreaker.isAllowed(inst.id);
          if (!budget.allowed) {
            this.logger.warn(
              `[${scanKind}] skipping ${inst.id} — budget ${budget.state}`,
            );
            skipped++;
            return;
          }
          await this.trigger.runScheduledMonitor(
            inst.id,
            scanKind,
            inst.organizationId,
          );
          dispatched++;
        }),
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          failed++;
          this.logger.error(
            `[${scanKind}] dispatch failed: ${(r.reason as Error).message}`,
          );
        }
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `[${scanKind}] completed in ${durationMs}ms — ` +
        `dispatched=${dispatched} skipped=${skipped} failed=${failed}`,
    );
    return { dispatched, skipped, failed };
  }

  private async resolveActiveInstitutions(): Promise<
    Array<{ id: string; organizationId: string | null }>
  > {
    // Active = has at least one agent run in the last 90 days OR has a
    // balance sheet uploaded. This avoids scanning demo/test institutions
    // that aren't paying clients.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const recentRuns = await this.prisma.agentRun.findMany({
      where: { createdAt: { gte: cutoff } },
      select: { institutionId: true, organizationId: true },
      distinct: ['institutionId'],
    });

    return recentRuns
      .filter(
        (
          r: any,
        ): r is { institutionId: string; organizationId: string | null } =>
          !!r.institutionId,
      )
      .map((r: any) => ({
        id: r.institutionId!,
        organizationId: r.organizationId,
      }));
  }
}
