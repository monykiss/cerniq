import type { JwtService } from '@nestjs/jwt';
import { ForbiddenException } from '@nestjs/common';
import { AlmRealtimeGateway } from './alm-realtime.gateway';
import type { MarketDataFeedService } from './market-data-feed.service';
import type { RateAlertService } from './rate-alert.service';
import type { AlmRecalcService } from './alm-recalc.service';
import type { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

// Focused security spec for AlmRealtimeGateway. Locks the WS hardening
// closing the CRITICAL body-trust IDOR flagged during the
// `cerniq:enterprise-audit-swarm` Phase audit:
//
//   Pre-fix: handleConnection accepted ANY truthy token without JWT
//   verification, leaving handleSubscribe/handleUnsubscribe trusting
//   `institutionId` from @MessageBody() without ownership checks. A
//   single connection with any non-empty bearer string + arbitrary
//   `institutionId` in the subscribe payload could join an
//   `institution:<ANY_ID>` room and receive cross-tenant rate updates,
//   recalc events, and threshold alerts.
//
//   Post-fix mirrors b2a64c25 (ai-advisor WS gateway):
//     1. handleConnection extracts + verifies a JWT via dual-source
//        (legacy JwtService.verify → Supabase /auth/v1/user fallback),
//        binds (userId, isPlatformAdmin) to client.data.user, disconnects
//        on failure.
//     2. handleSubscribe / handleUnsubscribe defense-in-depth-check
//        client.data.user, then call
//        institutionScope.verifyOwnership(institutionId, userId,
//        isPlatformAdmin) BEFORE client.join / client.leave. Single source
//        of truth for ownership across HTTP + WS surfaces.

type MockSocket = {
  id: string;
  handshake: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string | undefined>;
  };
  data: any;
  emit: jest.Mock;
  disconnect: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
};

const buildSocket = (
  handshake: MockSocket['handshake'] = { auth: {} },
): MockSocket => ({
  id: 'sock-1',
  handshake,
  data: {},
  emit: jest.fn(),
  disconnect: jest.fn(),
  join: jest.fn().mockResolvedValue(undefined),
  leave: jest.fn().mockResolvedValue(undefined),
});

describe('AlmRealtimeGateway (security)', () => {
  let marketDataFeed: jest.Mocked<
    Pick<MarketDataFeedService, 'fetchLatestRates'>
  >;
  let rateAlertService: jest.Mocked<Pick<RateAlertService, 'checkThresholds'>>;
  let almRecalcService: jest.Mocked<
    Pick<AlmRecalcService, 'getLastRecalc' | 'recalculateOnRateChange'>
  >;
  let institutionScope: jest.Mocked<
    Pick<InstitutionScopeGuard, 'verifyOwnership'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;
  let gateway: AlmRealtimeGateway;

  beforeEach(() => {
    marketDataFeed = {
      fetchLatestRates: jest.fn().mockResolvedValue([]),
    } as any;
    rateAlertService = {
      checkThresholds: jest.fn().mockResolvedValue([]),
    } as any;
    almRecalcService = {
      getLastRecalc: jest.fn().mockReturnValue(null),
      recalculateOnRateChange: jest.fn().mockResolvedValue({
        institutionId: 'inst-1',
        metrics: {},
        previousMetrics: {},
        recalculatedAt: new Date().toISOString(),
      }),
    } as any;
    institutionScope = {
      verifyOwnership: jest.fn().mockResolvedValue(undefined),
    } as any;
    jwtService = {
      verify: jest.fn().mockReturnValue({ userId: 'user-1' }),
    } as any;
    gateway = new AlmRealtimeGateway(
      marketDataFeed as unknown as MarketDataFeedService,
      rateAlertService as unknown as RateAlertService,
      almRecalcService as unknown as AlmRecalcService,
      institutionScope as unknown as InstitutionScopeGuard,
      jwtService as unknown as JwtService,
    );
  });

  describe('handleConnection (handshake-time JWT verify)', () => {
    it('rejects + disconnects when no token is provided', async () => {
      const sock = buildSocket({ auth: {} });

      await gateway.handleConnection(sock as any);

      expect(sock.emit).toHaveBeenCalledWith('error', {
        code: 'UNAUTHENTICATED',
        message: 'Missing or invalid auth token',
      });
      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('rejects + disconnects when JwtService.verify throws (no Supabase env)', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const sock = buildSocket({ auth: { token: 'bogus-token' } });

      await gateway.handleConnection(sock as any);

      expect(sock.disconnect).toHaveBeenCalledWith(true);
      expect(sock.data.user).toBeUndefined();
    });

    it('binds (userId, isPlatformAdmin) to client.data.user on valid legacy JWT', async () => {
      jwtService.verify.mockReturnValue({
        userId: 'user-42',
        access: { isPlatformAdmin: true },
      });
      const sock = buildSocket({ auth: { token: 'valid-token' } });

      await gateway.handleConnection(sock as any);

      expect(sock.data.user).toEqual({
        userId: 'user-42',
        isPlatformAdmin: true,
      });
      expect(sock.emit).toHaveBeenCalledWith(
        'connectionStatus',
        expect.objectContaining({ status: 'connected' }),
      );
      expect(sock.disconnect).not.toHaveBeenCalled();
    });

    it('falls back to JWT `sub` claim when userId is absent', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-from-sub' });
      const sock = buildSocket({ auth: { token: 't' } });

      await gateway.handleConnection(sock as any);

      expect(sock.data.user).toEqual({
        userId: 'user-from-sub',
        isPlatformAdmin: false,
      });
    });

    it('accepts Bearer header as legacy fallback when auth.token absent', async () => {
      jwtService.verify.mockReturnValue({ userId: 'header-user' });
      const sock = buildSocket({
        auth: {},
        headers: { authorization: 'Bearer header-token-value' },
      });

      await gateway.handleConnection(sock as any);

      expect(jwtService.verify).toHaveBeenCalledWith('header-token-value');
      expect(sock.data.user.userId).toBe('header-user');
    });
  });

  describe('handleSubscribe (per-message ownership check)', () => {
    it('rejects with UNAUTHENTICATED when client.data.user is missing', async () => {
      const sock = buildSocket();
      // No connection — client.data.user not set
      const result = await gateway.handleSubscribe(sock as any, {
        institutionId: 'inst-1',
      });

      expect(result).toEqual({
        success: false,
        message: 'UNAUTHENTICATED: No auth context on this socket',
      });
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(sock.join).not.toHaveBeenCalled();
    });

    it('rejects on payload-shape failure (no institutionId)', async () => {
      const sock = buildSocket();
      sock.data.user = { userId: 'user-1', isPlatformAdmin: false };

      const result = await gateway.handleSubscribe(sock as any, {});

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/institutionId required/);
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(sock.join).not.toHaveBeenCalled();
    });

    it('verifies ownership BEFORE client.join (invocationCallOrder lock)', async () => {
      const sock = buildSocket();
      sock.data.user = { userId: 'user-1', isPlatformAdmin: false };

      await gateway.handleSubscribe(sock as any, { institutionId: 'inst-1' });

      // Ordering check: any future refactor that reorders these calls
      // (join → verify) silently re-opens the bypass — lock against it.
      const verifyOrder =
        institutionScope.verifyOwnership.mock.invocationCallOrder[0];
      const joinOrder = sock.join.mock.invocationCallOrder[0];
      expect(verifyOrder).toBeLessThan(joinOrder);
    });

    it('rejects with FORBIDDEN when verifyOwnership throws — does NOT call client.join', async () => {
      institutionScope.verifyOwnership.mockRejectedValue(
        new ForbiddenException('not authorized for this institution'),
      );
      const sock = buildSocket();
      sock.data.user = { userId: 'user-1', isPlatformAdmin: false };

      const result = await gateway.handleSubscribe(sock as any, {
        institutionId: 'inst-other',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('FORBIDDEN');
      expect(sock.join).not.toHaveBeenCalled();
    });

    it('forwards platform-admin flag to verifyOwnership', async () => {
      const sock = buildSocket();
      sock.data.user = { userId: 'user-1', isPlatformAdmin: true };

      await gateway.handleSubscribe(sock as any, { institutionId: 'inst-1' });

      expect(institutionScope.verifyOwnership).toHaveBeenCalledWith(
        'inst-1',
        'user-1',
        true,
      );
    });
  });

  describe('handleUnsubscribe (per-message ownership check)', () => {
    it('rejects with UNAUTHENTICATED when client.data.user is missing', async () => {
      const sock = buildSocket();
      const result = await gateway.handleUnsubscribe(sock as any, {
        institutionId: 'inst-1',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('UNAUTHENTICATED');
      expect(institutionScope.verifyOwnership).not.toHaveBeenCalled();
      expect(sock.leave).not.toHaveBeenCalled();
    });

    it('verifies ownership BEFORE client.leave', async () => {
      const sock = buildSocket();
      sock.data.user = { userId: 'user-1', isPlatformAdmin: false };

      await gateway.handleUnsubscribe(sock as any, {
        institutionId: 'inst-1',
      });

      const verifyOrder =
        institutionScope.verifyOwnership.mock.invocationCallOrder[0];
      const leaveOrder = sock.leave.mock.invocationCallOrder[0];
      expect(verifyOrder).toBeLessThan(leaveOrder);
    });

    it('rejects with FORBIDDEN when verifyOwnership throws — does NOT call client.leave', async () => {
      institutionScope.verifyOwnership.mockRejectedValue(
        new ForbiddenException('not authorized for this institution'),
      );
      const sock = buildSocket();
      sock.data.user = { userId: 'user-1', isPlatformAdmin: false };

      const result = await gateway.handleUnsubscribe(sock as any, {
        institutionId: 'inst-other',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('FORBIDDEN');
      expect(sock.leave).not.toHaveBeenCalled();
    });
  });
});
