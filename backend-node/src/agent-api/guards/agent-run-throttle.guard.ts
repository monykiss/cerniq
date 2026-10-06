import { Injectable } from '@nestjs/common';
import { RateLimitByUserGuard } from '../../common/guards/rate-limit-by-user.guard';

/**
 * Per-user rate limiter specific to expensive agent mutations
 * (`POST /run`, `POST /copilot`). Tighter than the global 100/min
 * because each call triggers a Claude Opus LLM invocation which can
 * cost $0.10–$1.00 per run depending on context size.
 *
 * Math for the chosen ceiling (10/user/minute):
 *   - Worst-case: 10 runs × $1 = $10/user/min
 *   - Monthly ceiling at sustained worst-case: 10 × 60 × 24 × 30 = 432k runs
 *     → $432k/user/month if every call hit the worst case
 *   - But the `AgentCostCircuitBreakerService` caps at
 *     `LLM_COST_CAP_USD_CENTS` per institution (default $100/month),
 *     so the real ceiling is $100 per institution + whatever tier
 *     override is set via `institutions.llm_cost_cap_usd_cents`.
 *   - Per-user rate limit is the OUTER defense; cost circuit breaker
 *     is the INNER defense. Both are needed:
 *       • Per-user stops a single compromised account from burning
 *         through the institution's entire monthly budget in 90 seconds.
 *       • Cost breaker stops the institution from being over-billed if
 *         multiple users share the same institution and collectively
 *         run too many.
 *
 * Storage: in-memory sliding window (inherited from parent). For
 * horizontal scale (>1 Railway replica), swap to Redis-backed storage
 * per the parent class's own TODO. Single-replica deploy today makes
 * this a deferred concern.
 *
 * Usage (method-level so GETs aren't throttled):
 *   @Post('run')
 *   @UseGuards(AuthGuard, InstitutionScopeGuard, AgentRunThrottleGuard)
 *   async run(...) {}
 */
@Injectable()
export class AgentRunThrottleGuard extends RateLimitByUserGuard {
  constructor() {
    // 10 expensive agent mutations per user per 60-second sliding window
    super(10, 60_000);
  }
}
