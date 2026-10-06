import { Test, TestingModule } from '@nestjs/testing';
import { MarketDataController } from './market-data.controller';
import { MarketDataFeedService } from './market-data-feed.service';
import { RateAlertService } from './rate-alert.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

describe('MarketDataController', () => {
  let controller: MarketDataController;
  let marketDataFeed: Record<string, jest.Mock>;
  let rateAlertService: Record<string, jest.Mock>;

  beforeEach(async () => {
    marketDataFeed = {
      fetchLatestRates: jest.fn(),
      fetchTreasuryCurve: jest.fn(),
      fetchSOFR: jest.fn(),
      getHistoricalRates: jest.fn(),
    };
    rateAlertService = {
      getActiveAlerts: jest.fn(),
      setThreshold: jest.fn(),
      removeThreshold: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketDataController],
      providers: [
        { provide: MarketDataFeedService, useValue: marketDataFeed },
        { provide: RateAlertService, useValue: rateAlertService },
      ],
    })
      .overrideGuard(AuthTenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(InstitutionScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MarketDataController>(MarketDataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── Guard-wiring lock ─────────────────────────────────────────────────────
  // The contract (matches the controller's b86baed8 state — the user's
  // explicit preference: method-level guards on the 3 alert routes,
  // public-by-design on the 4 market-data feed routes): removing
  // @UseGuards from any of the 3 alert methods (or adding one to any of
  // the 4 public market-data methods) fails this spec even though
  // canActivate is mocked. This is the only test that catches a silent
  // guard-removal regression.

  describe('guard wiring (reflection)', () => {
    const expectGuards = (
      method: keyof MarketDataController,
      expected: string[],
    ) => {
      const handler = controller[method];
      const guards = Reflect.getMetadata('__guards__', handler) as
        | Array<{ name: string }>
        | undefined;
      const names = (guards ?? []).map((g) => g.name);
      expect(names).toEqual(expected);
    };

    it('GET alerts/:institutionId is guarded by AuthTenantGuard + InstitutionScopeGuard', () => {
      expectGuards('getActiveAlerts', [
        'AuthTenantGuard',
        'InstitutionScopeGuard',
      ]);
    });

    it('POST alerts/:institutionId is guarded', () => {
      expectGuards('setAlertThreshold', [
        'AuthTenantGuard',
        'InstitutionScopeGuard',
      ]);
    });

    it('DELETE alerts/:institutionId/:metric is guarded', () => {
      expectGuards('removeAlertThreshold', [
        'AuthTenantGuard',
        'InstitutionScopeGuard',
      ]);
    });

    it('GET /latest is intentionally public (no method-level guards)', () => {
      expectGuards('getLatestRates', []);
    });

    it('GET /treasury-curve is intentionally public', () => {
      expectGuards('getTreasuryCurve', []);
    });

    it('GET /sofr is intentionally public', () => {
      expectGuards('getSOFR', []);
    });

    it('GET /history/:dataType is intentionally public', () => {
      expectGuards('getHistory', []);
    });
  });

  // ─── Behavior smoke tests (guards bypassed via overrideGuard above) ───────

  describe('alert handlers', () => {
    it('getActiveAlerts forwards :institutionId to the service', async () => {
      rateAlertService.getActiveAlerts.mockResolvedValue([]);
      const result = await controller.getActiveAlerts('inst-1');
      expect(rateAlertService.getActiveAlerts).toHaveBeenCalledWith('inst-1');
      expect(result).toEqual({ data: [] });
    });

    it('setAlertThreshold validates body via Zod and forwards on success', async () => {
      const body = {
        metric: 'sofr',
        warnLevel: 5.0,
        breachLevel: 5.5,
        direction: 'ABOVE' as const,
      };
      const persisted = { ...body, notifyEmail: false, notifyWebhook: false };
      rateAlertService.setThreshold.mockResolvedValue(persisted);
      const result = await controller.setAlertThreshold('inst-1', body);
      expect(rateAlertService.setThreshold).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining(body),
      );
      expect(result).toEqual({ data: persisted });
    });

    it('setAlertThreshold throws BadRequest on invalid body', async () => {
      await expect(
        controller.setAlertThreshold('inst-1', {
          metric: 'unknown',
        } as unknown),
      ).rejects.toThrow();
      expect(rateAlertService.setThreshold).not.toHaveBeenCalled();
    });

    it('removeAlertThreshold forwards :institutionId + :metric', async () => {
      rateAlertService.removeThreshold.mockResolvedValue(undefined);
      await controller.removeAlertThreshold('inst-1', 'sofr');
      expect(rateAlertService.removeThreshold).toHaveBeenCalledWith(
        'inst-1',
        'sofr',
      );
    });
  });
});
