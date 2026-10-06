import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MarketDataFeedService } from './market-data-feed.service';
import { RateAlertService } from './rate-alert.service';
import { AlmRecalcService } from './alm-recalc.service';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import {
  readSupabaseVerifyEnv,
  verifySupabaseAccessToken,
} from '../auth/supabase-jwt.util';
import {
  SubscribePayloadSchema,
  MarketDataSnapshot,
  MarketRateResult,
} from './realtime-alm.dto';
import { corsOriginCallback } from '../security/origin-allowlist';

/** Default polling interval: 5 minutes (300 000 ms). */
const DEFAULT_POLL_MS = 300_000;

/** Heartbeat interval: 30 seconds. */
const HEARTBEAT_MS = 30_000;

/** Per-socket authenticated user context bound at handshake time. */
interface SocketUserCtx {
  userId: string;
  isPlatformAdmin: boolean;
}

@WebSocketGateway({
  namespace: '/alm-realtime',
  cors: {
    // Same origin policy as the HTTP API (FRONTEND_URL / ALLOWED_ORIGINS);
    // previously any *.vercel.app origin was accepted here.
    origin: corsOriginCallback,
  },
})
export class AlmRealtimeGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AlmRealtimeGateway.name);

  /** Maps clientId → Set of institutionIds they are subscribed to. */
  private readonly clientSubscriptions = new Map<string, Set<string>>();

  /** Heartbeat timer reference. */
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** Polling timer for market-data-driven recalcs. */
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly marketDataFeed: MarketDataFeedService,
    private readonly rateAlertService: RateAlertService,
    private readonly almRecalcService: AlmRecalcService,
    private readonly institutionScope: InstitutionScopeGuard,
    private readonly jwtService: JwtService,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────

  onModuleInit(): void {
    // Start the market-data polling cycle
    this.startPollCycle();

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.server?.emit('heartbeat', { ts: Date.now() });
    }, HEARTBEAT_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();

    this.logger.log('ALM Realtime Gateway initialised');
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clientSubscriptions.clear();
  }

  // ─── Connection handling (closes CRITICAL body-trust IDOR) ─
  //
  // Pre-fix: handleConnection only checked token *presence* — any
  // non-empty bearer string accepted, no JWT verification, no userId
  // binding. Combined with body-trust on `institutionId` in
  // handleSubscribe, any caller knowing the WS endpoint could join
  // `institution:<ANY_ID>` rooms and receive cross-tenant alerts +
  // recalc events.
  //
  // Post-fix: extract a JWT from `client.handshake.auth.token` (socket.io
  // standard auth channel) or the legacy `Authorization: Bearer <token>`
  // header. Verify via the same dual-source pattern AuthGuard uses
  // (legacy JwtService, then Supabase fallback). Reject on missing or
  // invalid — fail-closed, no anonymous fallback. Verified userId and
  // platform-admin flag land on `client.data.user` for the subscribe handler.
  //
  // Mirrors b2a64c25 (ai-advisor WS gateway) + 6d9d7394 (Supabase JWT
  // fallback). Per-handler ownership verification follows the same
  // single-primitive contract: `institutionScope.verifyOwnership(...)`.

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.verifyClientToken(client);
    if (!user) {
      this.logger.warn(
        `ALM realtime WS rejected: missing/invalid token (clientId=${client.id})`,
      );
      client.emit('error', {
        code: 'UNAUTHENTICATED',
        message: 'Missing or invalid auth token',
      });
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    this.clientSubscriptions.set(client.id, new Set());

    this.logger.log(
      `ALM realtime WS connected: user=${user.userId} (clientId=${client.id})`,
    );

    client.emit('connectionStatus', {
      status: 'connected',
      feedsActive: ['SOFR', 'US_TREASURY', 'PR_DEPOSIT_INDEX'],
    });
  }

  handleDisconnect(client: Socket): void {
    const subs = this.clientSubscriptions.get(client.id);
    if (subs) {
      for (const instId of subs) {
        void client.leave(`institution:${instId}`);
      }
    }
    this.clientSubscriptions.delete(client.id);
    this.logger.log(`Client ${client.id} disconnected`);
  }

  // ─── Client → Server events ────────────────────────────────

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ success: boolean; message: string }> {
    // Defense-in-depth user-presence re-check: handleConnection should
    // have rejected unauthenticated sockets, but a regression on that
    // path can't silently re-open the bypass — fail-closed here too.
    const user = client.data.user as SocketUserCtx | undefined;
    if (!user) {
      return {
        success: false,
        message: 'UNAUTHENTICATED: No auth context on this socket',
      };
    }

    const parsed = SubscribePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        success: false,
        message: 'Invalid payload: institutionId required',
      };
    }

    const { institutionId } = parsed.data;

    // Verify caller owns the institution BEFORE joining the room.
    // Single source of truth for institution-ownership across HTTP /
    // WS / body-param surfaces (matches ai-advisor.gateway:152,
    // ai-advisor.controller:ask, agent-trust.controller, etc.).
    try {
      await this.institutionScope.verifyOwnership(
        institutionId,
        user.userId,
        user.isPlatformAdmin,
      );
    } catch (err) {
      // Fail-closed: WARN already logged inside verifyOwnership.
      return {
        success: false,
        message:
          err instanceof Error
            ? `FORBIDDEN: ${err.message}`
            : 'FORBIDDEN: Not authorized for institution',
      };
    }

    const roomName = `institution:${institutionId}`;
    await client.join(roomName);
    const subs = this.clientSubscriptions.get(client.id) ?? new Set<string>();
    subs.add(institutionId);
    this.clientSubscriptions.set(client.id, subs);

    this.logger.log(
      `ALM realtime WS subscribe: user=${user.userId} institution=${institutionId} (clientId=${client.id})`,
    );

    // Send latest cached recalc if available
    const lastRecalc = this.almRecalcService.getLastRecalc(institutionId);
    if (lastRecalc) {
      for (const [metric, value] of Object.entries(lastRecalc.metrics)) {
        const prev = lastRecalc.previousMetrics[metric] ?? value;
        client.emit('almRecalc', {
          institutionId,
          metric,
          newValue: value,
          previousValue: prev,
          delta: value - prev,
        });
      }
    }

    return { success: true, message: `Subscribed to ${institutionId}` };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ success: boolean; message: string }> {
    const user = client.data.user as SocketUserCtx | undefined;
    if (!user) {
      return {
        success: false,
        message: 'UNAUTHENTICATED: No auth context on this socket',
      };
    }

    const parsed = SubscribePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        success: false,
        message: 'Invalid payload: institutionId required',
      };
    }

    const { institutionId } = parsed.data;

    // Verify ownership before leaving the room: leaving a room you
    // don't own is harmless on socket.io side, but the check denies
    // an unauthenticated reconnaissance path that probes which
    // institution ids exist (response message would otherwise differ
    // between known and unknown ids if leave behavior diverged).
    try {
      await this.institutionScope.verifyOwnership(
        institutionId,
        user.userId,
        user.isPlatformAdmin,
      );
    } catch (err) {
      return {
        success: false,
        message:
          err instanceof Error
            ? `FORBIDDEN: ${err.message}`
            : 'FORBIDDEN: Not authorized for institution',
      };
    }

    await client.leave(`institution:${institutionId}`);

    const subs = this.clientSubscriptions.get(client.id);
    subs?.delete(institutionId);

    this.logger.log(
      `ALM realtime WS unsubscribe: user=${user.userId} institution=${institutionId} (clientId=${client.id})`,
    );
    return { success: true, message: `Unsubscribed from ${institutionId}` };
  }

  @SubscribeMessage('getLatestRates')
  async handleGetLatestRates(
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; data: MarketDataSnapshot[] }> {
    try {
      const snapshots = await this.marketDataFeed.fetchLatestRates();
      return { success: true, data: snapshots };
    } catch (err) {
      this.logger.error(`Failed to fetch latest rates: ${err}`);
      return { success: false, data: [] };
    }
  }

  // ─── Server-push cycle ─────────────────────────────────────

  /**
   * Called each poll cycle: fetch rates, broadcast updates, recalc,
   * check alerts for each subscribed institution.
   */
  private async onPollCycle(): Promise<void> {
    try {
      const snapshots = await this.marketDataFeed.fetchLatestRates();

      // Broadcast rate updates to all connected clients
      for (const snap of snapshots) {
        const prev = snap.previousValue ?? snap.value;
        const changePct = prev !== 0 ? ((snap.value - prev) / prev) * 100 : 0;

        this.server.emit('rateUpdate', {
          dataType: snap.dataType,
          value: snap.value,
          previousValue: prev,
          changePercent: this.round(changePct),
          asOfDate: snap.asOfDate,
        });
      }

      // Collect institution rooms and trigger recalc + alerts
      const rooms = this.getSubscribedInstitutions();

      const rateResults: MarketRateResult[] = snapshots.map((s) => ({
        dataType: s.dataType,
        value: s.value,
        previousValue: s.previousValue ?? undefined,
        asOfDate: s.asOfDate,
        source: s.source,
      }));

      for (const institutionId of rooms) {
        await this.recalcAndAlert(institutionId, rateResults);
      }
    } catch (err) {
      this.logger.error(`Poll cycle error: ${err}`);
    }
  }

  /**
   * Recalculate ALM metrics for a single institution and emit events.
   */
  private async recalcAndAlert(
    institutionId: string,
    rates: MarketRateResult[],
  ): Promise<void> {
    const room = `institution:${institutionId}`;

    try {
      const result = await this.almRecalcService.recalculateOnRateChange(
        institutionId,
        rates,
      );

      // Emit per-metric recalc events
      for (const [metric, value] of Object.entries(result.metrics)) {
        const prev = result.previousMetrics[metric] ?? value;
        this.server.to(room).emit('almRecalc', {
          institutionId,
          metric,
          newValue: value,
          previousValue: prev,
          delta: this.round(value - prev),
        });
      }

      // Check alert thresholds
      const alerts = await this.rateAlertService.checkThresholds(
        institutionId,
        result.metrics as unknown as Record<string, number>,
      );

      for (const alert of alerts) {
        this.server.to(room).emit('alert', {
          institutionId,
          metric: alert.metric,
          level: alert.level,
          currentValue: alert.currentValue,
          threshold: alert.threshold,
          message: alert.message,
          messageEs: alert.messageEs,
        });
      }
    } catch (err) {
      this.logger.error(`Recalc/alert error for ${institutionId}: ${err}`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private startPollCycle(): void {
    const intervalMs = this.parseInterval(
      process.env.ALM_REALTIME_POLL_MS,
      DEFAULT_POLL_MS,
    );

    this.pollTimer = setInterval(() => {
      void this.onPollCycle();
    }, intervalMs);
    if (this.pollTimer.unref) this.pollTimer.unref();

    // Immediate first cycle
    void this.onPollCycle();

    this.logger.log(`Poll cycle started (${intervalMs / 1000}s interval)`);
  }

  private getSubscribedInstitutions(): Set<string> {
    const institutions = new Set<string>();
    for (const subs of this.clientSubscriptions.values()) {
      for (const id of subs) institutions.add(id);
    }
    return institutions;
  }

  private parseInterval(raw: string | undefined, fallback: number): number {
    const parsed = parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private round(n: number, decimals = 4): number {
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
  }

  // ─── Auth helpers (dual-source: legacy JWT then Supabase) ──
  //
  // Same dual-source pattern as `AuthGuard.canActivate` (legacy
  // `JwtService.verify` then Supabase `${SUPABASE_URL}/auth/v1/user`
  // HTTP lookup) and as `AiAdvisorGateway.verifyClientToken`. Inlined
  // here rather than calling a shared `AuthService` to keep the gateway
  // self-contained — when the auth-coverage-audit Phase B work
  // consolidates both into a single primitive, this branch + the
  // ai-advisor gateway's branch swap together.

  private async verifyClientToken(
    client: Socket,
  ): Promise<SocketUserCtx | null> {
    const token = this.extractToken(client);
    if (!token) return null;

    const legacy = this.tryVerifyLegacyJwt(token);
    if (legacy) return legacy;

    const supabase = await this.tryVerifySupabaseToken(token);
    if (supabase) return supabase;

    this.logger.warn(
      `ALM realtime WS token failed both legacy and Supabase verification (clientId=${client.id})`,
    );
    return null;
  }

  private tryVerifyLegacyJwt(token: string): SocketUserCtx | null {
    try {
      const payload = this.jwtService.verify(token);
      const userId =
        (payload?.userId as string | undefined) ??
        (payload?.sub as string | undefined);
      if (!userId) return null;
      const access = payload?.access as
        | { isPlatformAdmin?: boolean }
        | undefined;
      return {
        userId,
        isPlatformAdmin: !!access?.isPlatformAdmin,
      };
    } catch {
      return null;
    }
  }

  private async tryVerifySupabaseToken(
    token: string,
  ): Promise<SocketUserCtx | null> {
    const verified = await verifySupabaseAccessToken(
      token,
      readSupabaseVerifyEnv(),
    );
    if (!verified) return null;
    // Supabase tokens don't carry the platform `isPlatformAdmin` claim
    // (that lives in PlatformAccessService and is applied by
    // AuthGuard for HTTP requests). WS Supabase users get the
    // normal-user flag here; cross-tenant platform-admin support over
    // WS would require mirroring AuthGuard's PlatformAccessService
    // lookup in this branch — a follow-up if needed.
    return {
      userId: verified.userId,
      isPlatformAdmin: false,
    };
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const fromAuth =
      (auth?.token as string | undefined) ||
      (auth?.accessToken as string | undefined);
    if (fromAuth) return fromAuth;

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string') {
      const m = header.match(/^Bearer\s+(.+)$/i);
      if (m) return m[1];
    }
    return null;
  }
}
