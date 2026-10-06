import { EwsController } from './ews.controller';
import type { AssetEWSService } from '../asset-ews.service';
import type { EwsSnapshotService } from './ews-snapshot.service';

describe('EwsController — EWS watchlist API (W1.3)', () => {
  let computeSpy: jest.Mock;
  let historySpy: jest.Mock;
  let trendSpy: jest.Mock;
  let captureSpy: jest.Mock;
  let controller: EwsController;

  beforeEach(() => {
    computeSpy = jest.fn().mockResolvedValue({ alertLevel: 'GREEN' });
    historySpy = jest.fn().mockResolvedValue([]);
    trendSpy = jest.fn().mockResolvedValue({ status: 'ok' });
    captureSpy = jest.fn().mockResolvedValue({ alerts: [] });
    controller = new EwsController(
      { computeEWS: computeSpy } as unknown as AssetEWSService,
      {
        getHistory: historySpy,
        getTrend: trendSpy,
        captureSnapshot: captureSpy,
      } as unknown as EwsSnapshotService,
    );
  });

  it('GET ews computes on demand without persisting', async () => {
    await controller.getCurrent('inst-1');
    expect(computeSpy).toHaveBeenCalledWith('inst-1');
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('GET ews/trend delegates to the snapshot service', async () => {
    await controller.getTrend('inst-1');
    expect(trendSpy).toHaveBeenCalledWith('inst-1');
  });

  it('POST ews/snapshot captures with source=manual', async () => {
    await controller.captureSnapshot('inst-1');
    expect(captureSpy).toHaveBeenCalledWith('inst-1', { source: 'manual' });
  });

  describe('history ?limit parsing (no parseInt silent coercion)', () => {
    it.each([
      [undefined, 90], // default
      ['30', 30],
      ['90abc', 90], // parseInt would have taken 30/90 — Number rejects
      ['0', 90], // below range → default
      ['-5', 90],
      ['12.5', 90], // non-integer → default
      ['9999', 366], // capped at one year of daily snapshots
    ] as const)('limit=%p → %p', async (raw, expected) => {
      await controller.getHistory('inst-1', raw);
      expect(historySpy).toHaveBeenCalledWith('inst-1', expected);
    });
  });

  it('class-level guard stack is declared (auth-coverage contract)', () => {
    // The verify:auth-coverage gate checks this statically; this spec locks
    // it behaviorally so a refactor that drops a guard fails fast here too.
    const guards = Reflect.getMetadata('__guards__', EwsController);
    const names = (guards ?? []).map((g: { name: string }) => g.name);
    expect(names).toContain('AuthTenantGuard');
    expect(names).toContain('InstitutionScopeGuard');
  });
});
