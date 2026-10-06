import {
  Controller,
  Logger,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Observable, Subject } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';
import {
  AGENT_EVENT,
  AgentEventBusService,
} from '../agents/runner/agent-event-bus.service';
import { InstitutionScopeGuard } from './guards/institution-scope.guard';
import { StreamQuerySchema, parseOrThrow } from './dto/agent-api.dto';
import type { AgentStreamEvent } from './dto/api-types';

// AgentTenantStreamController is the *Activity Feed* SSE endpoint —
// "everything that happened across this institution's agents in real time".
// The peer's AgentsController already streams a single run via
// `/agents/runs/:runId/stream`; this is the per-tenant fan-out the
// dashboard subscribes to.
//
// Tenant safety: the in-process AgentEventBus is shared across all
// requests on a single Node process. We filter event payloads through a
// run-id → institution-id resolver cache so cross-tenant leakage cannot
// happen even if a future agent emits an event without an institution
// hint. Cache miss = read-through to the DB; cache TTL = 5 minutes which
// is shorter than typical run lifetimes so revoked institutions don't
// linger.

const RESOLVER_CACHE_TTL_MS = 5 * 60_000;
// 30s heartbeat — well under the typical 60s Cloudflare/Vercel proxy idle
// timeout. Heartbeats are RxJS comments (no payload) per SSE spec.
const HEARTBEAT_INTERVAL_MS = 30_000;

@ApiTags('Agent Activity Stream')
@Controller('api/v1/agents/:institutionId/stream')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AgentTenantStreamController {
  private readonly logger = new Logger(AgentTenantStreamController.name);
  private readonly resolverCache = new Map<
    string,
    { institutionId: string | null; expiresAt: number }
  >();

  constructor(
    private readonly bus: AgentEventBusService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse()
  stream(
    @Param('institutionId') institutionId: string,
    @Query() rawQuery: unknown,
  ): Observable<MessageEvent> {
    const query = (() => {
      try {
        return parseOrThrow(StreamQuerySchema, rawQuery);
      } catch {
        // Tolerant: bad query string just means "stream everything for this tenant".
        return { runId: undefined };
      }
    })();
    const runIdFilter = query.runId;

    const subject = new Subject<MessageEvent>();
    let eventSeq = 0;

    // Heartbeat keepalive — emits an SSE comment line. RxJS doesn't have a
    // first-class comment primitive, so we send a small `ping` event the
    // client can ignore.
    const heartbeat = setInterval(() => {
      subject.next({
        type: 'ping',
        data: JSON.stringify({ ts: Date.now() }),
      } as unknown as MessageEvent);
    }, HEARTBEAT_INTERVAL_MS);
    if (heartbeat.unref) heartbeat.unref();

    const off = this.bus.onAny(async (event, payload) => {
      const p = payload as { runId?: string } | undefined;
      if (!p?.runId) return;
      if (runIdFilter && p.runId !== runIdFilter) return;

      const ownerInstitutionId = await this.resolveInstitutionForRun(p.runId);
      if (ownerInstitutionId !== institutionId) return;

      const wireEvent: AgentStreamEvent = {
        type: event as AgentStreamEvent['type'],
        payload,
        id: `${Date.now()}-${++eventSeq}`,
      };
      subject.next({
        type: event,
        id: wireEvent.id,
        data: JSON.stringify(wireEvent),
      } as unknown as MessageEvent);

      // Auto-close subscriber-side stream when the *only* run we care about
      // terminates. Tenant-wide subscribers stay open until the client
      // disconnects.
      if (
        runIdFilter &&
        (event === AGENT_EVENT.RUN_COMPLETED ||
          event === AGENT_EVENT.RUN_FAILED)
      ) {
        subject.complete();
      }
    });

    subject.subscribe({
      complete: () => {
        clearInterval(heartbeat);
        off();
      },
    });

    return subject.asObservable();
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private async resolveInstitutionForRun(
    runId: string,
  ): Promise<string | null> {
    const now = Date.now();
    const cached = this.resolverCache.get(runId);
    if (cached && cached.expiresAt > now) return cached.institutionId;

    const row = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { institutionId: true },
    });
    const value = row?.institutionId ?? null;
    this.resolverCache.set(runId, {
      institutionId: value,
      expiresAt: now + RESOLVER_CACHE_TTL_MS,
    });
    // Opportunistic eviction: once we have >1000 entries, drop the oldest
    // 100. Keeps the cache from growing unbounded on long-lived workers.
    if (this.resolverCache.size > 1000) {
      const victims = [...this.resolverCache.entries()]
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
        .slice(0, 100)
        .map(([k]) => k);
      for (const v of victims) this.resolverCache.delete(v);
    }
    return value;
  }
}
