import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// AgentCostCircuitBreakerService gates new agent runs when the
// institution's month-to-date LLM spend exceeds the configured cap.
//
// Three states:
//   OK       — spend < 80% of cap → runs proceed normally
//   WARN     — 80% ≤ spend < 100% → runs proceed, UI shows amber banner
//   BLOCKED  — spend ≥ 100% → new runs rejected with BUDGET_EXCEEDED code
//
// Configuration accepts either of two env vars, in priority order:
//   1. LLM_COST_CAP_USD_CENTS  — integer cents (precise, legacy)
//   2. LLM_COST_ALERT_THRESHOLD_USD — USD float (customer-facing; shipped
//      in `.env.example` so this is the name operators expect to edit)
// Both are schema-validated in `env.schema.ts`, so reaching this
// constructor means the value is a real number already. Default when
// both are unset: $100.00 = 10000 cents.
//
// Callers: AgentQueueService.enqueue() checks before dispatching. The cost
// endpoint (AgentRunsController.cost) includes the snapshot in the
// response so the dashboard can render budget state.

export type BudgetState = 'OK' | 'WARN' | 'BLOCKED';

const DEFAULT_CAP_CENTS = 10000;

@Injectable()
export class AgentCostCircuitBreakerService {
  private readonly logger = new Logger(AgentCostCircuitBreakerService.name);
  private readonly capUsdCents: number | null;

  constructor(private readonly prisma: PrismaService) {
    this.capUsdCents = AgentCostCircuitBreakerService.resolveCapCents(
      process.env,
      (msg) => this.logger.warn(msg),
    );
  }

  /**
   * Resolve the cap in cents from env, preferring the precise `_CENTS`
   * form and falling back to the customer-facing USD form. Exported as
   * a static so the spec can exercise the resolution table without
   * constructing the full service.
   */
  static resolveCapCents(
    env: NodeJS.ProcessEnv,
    warn: (msg: string) => void = () => {},
  ): number | null {
    const rawCents = env.LLM_COST_CAP_USD_CENTS;
    if (rawCents !== undefined && rawCents !== '') {
      const parsed = Number(rawCents);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        warn(
          `LLM_COST_CAP_USD_CENTS="${rawCents}" is not a positive integer — circuit breaker disabled`,
        );
        return null;
      }
      return parsed;
    }

    const rawUsd = env.LLM_COST_ALERT_THRESHOLD_USD;
    if (rawUsd !== undefined && rawUsd !== '') {
      const parsed = Number(rawUsd);
      if (!Number.isFinite(parsed) || parsed < 0) {
        warn(
          `LLM_COST_ALERT_THRESHOLD_USD="${rawUsd}" is not a nonnegative number — circuit breaker disabled`,
        );
        return null;
      }
      // Convert to cents with rounding to avoid float-precision drift
      // (e.g. 100.1 USD → 10010 cents, not 10009.99999…).
      return Math.round(parsed * 100);
    }

    return DEFAULT_CAP_CENTS;
  }

  async isAllowed(institutionId: string): Promise<{
    allowed: boolean;
    state: BudgetState;
    spentCents: number;
    capCents: number | null;
  }> {
    if (this.capUsdCents === null) {
      return { allowed: true, state: 'OK', spentCents: 0, capCents: null };
    }

    const spentCents = await this.monthToDateSpend(institutionId);
    const state = this.classify(spentCents);

    return {
      allowed: state !== 'BLOCKED',
      state,
      spentCents,
      capCents: this.capUsdCents,
    };
  }

  snapshotForInstitution(
    institutionId: string,
    precomputedSpendCents: number,
  ): {
    capUsdCents: number | null;
    remainingUsdCents: number | null;
    state: BudgetState;
  } {
    if (this.capUsdCents === null) {
      return {
        capUsdCents: null,
        remainingUsdCents: null,
        state: 'OK',
      };
    }
    const remaining = Math.max(0, this.capUsdCents - precomputedSpendCents);
    return {
      capUsdCents: this.capUsdCents,
      remainingUsdCents: remaining,
      state: this.classify(precomputedSpendCents),
    };
  }

  // ─── internals ────────────────────────────────────────────────────────

  private async monthToDateSpend(institutionId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const result = await this.prisma.agentRun.aggregate({
      where: {
        institutionId,
        createdAt: { gte: monthStart },
      },
      _sum: { costUsdCents: true },
    });
    return result._sum.costUsdCents ?? 0;
  }

  private classify(spentCents: number): BudgetState {
    if (this.capUsdCents === null) return 'OK';
    const ratio = spentCents / this.capUsdCents;
    if (ratio >= 1) return 'BLOCKED';
    if (ratio >= 0.8) return 'WARN';
    return 'OK';
  }
}
