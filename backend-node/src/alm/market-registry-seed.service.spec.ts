import { MarketRegistrySeedService } from './market-registry-seed.service';
import { listPrCooperativas } from './data/registry/pr-cooperativas.registry';

describe('MarketRegistrySeedService', () => {
  const workspace = { id: 'ws-market', name: 'pr-market-map' };
  let prisma: {
    workspace: {
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
    };
    institution: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: MarketRegistrySeedService;

  beforeEach(() => {
    prisma = {
      workspace: {
        findFirst: jest.fn().mockResolvedValue(workspace),
        findUniqueOrThrow: jest.fn().mockResolvedValue(workspace),
        create: jest.fn().mockResolvedValue(workspace),
      },
      institution: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: `inst-${data.seedKey}`, ...data }),
          ),
        update: jest.fn(),
      },
    };
    service = new MarketRegistrySeedService(prisma as never);
  });

  it('creates 91 Institution shells with no balance-sheet writes', async () => {
    const result = await service.seedMarketRegistry();

    expect(result.total).toBe(91);
    expect(result.created).toBe(91);
    expect(result.unchanged).toBe(0);
    expect(prisma.institution.create).toHaveBeenCalledTimes(91);

    const first = listPrCooperativas()[0];
    expect(prisma.institution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seedKey: first.seedKey,
        type: 'cooperativa',
        cossecRegistrationNumber: first.cossecCharter,
        primaryRegulator: 'COSSEC',
        preferredLanguage: 'es',
      }),
    });
  });

  it('is idempotent when shells already match registry metadata', async () => {
    prisma.institution.findUnique.mockImplementation(
      ({ where }: { where: { workspace_seed_key: { seedKey: string } } }) => {
        const seedKey = where.workspace_seed_key.seedKey;
        const row = listPrCooperativas().find((r) => r.seedKey === seedKey)!;
        return Promise.resolve({
          id: `inst-${seedKey}`,
          name: row.displayName,
          totalAssets: Number((row.totalAssetsUsd / 1_000_000).toFixed(2)),
          cossecRegistrationNumber: row.cossecCharter,
          primaryRegulator: 'COSSEC',
          preferredLanguage: 'es',
          _count: { balanceSheetItems: 0 },
        });
      },
    );
    prisma.institution.update.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data }),
    );

    const result = await service.seedMarketRegistry({
      workspaceId: workspace.id,
    });

    expect(result.created).toBe(0);
    expect(result.unchanged).toBe(91);
    expect(prisma.institution.create).not.toHaveBeenCalled();
    expect(prisma.institution.update).not.toHaveBeenCalled();
  });
});
