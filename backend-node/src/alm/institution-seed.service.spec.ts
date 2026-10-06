/**
 * InstitutionSeedService — idempotency contract.
 *
 * The whole reason this service exists is so a seed run can be repeated without
 * duplicating data. These specs lock that contract in: the FIRST run creates,
 * the SECOND run with identical input produces the same institutionId, and the
 * delta correctly reports `unchanged` for both the institution (equality check
 * on fixture-shaped fields) and the liquidity position.
 */
import { InstitutionSeedService } from './institution-seed.service';

interface FakeRow {
  id: string;
  workspaceId: string;
  seedKey: string | null;
  [k: string]: unknown;
}

/**
 * Tiny in-memory Prisma stand-in. Models only the surface the seeder touches —
 * institution, balanceSheetItem, liquidityPosition — and just enough of $transaction
 * to satisfy the contract (passes the same `tx` object straight through). This is
 * intentionally not a generic mock; reading it tells you exactly what the service
 * depends on.
 */
function makeFakePrisma() {
  const institutions: FakeRow[] = [];
  const balanceSheetItems: FakeRow[] = [];
  const liquidityPositions: FakeRow[] = [];
  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;

  const tx = {
    institution: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.workspace_seed_key) {
          return (
            institutions.find(
              (i) =>
                i.workspaceId === where.workspace_seed_key.workspaceId &&
                i.seedKey === where.workspace_seed_key.seedKey,
            ) ?? null
          );
        }
        return institutions.find((i) => i.id === where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: FakeRow = { id: id('inst'), ...data };
        institutions.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = institutions.find((i) => i.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    balanceSheetItem: {
      count: jest.fn(
        async ({ where }: any) =>
          balanceSheetItems.filter(
            (i) => i.institutionId === where.institutionId,
          ).length,
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        for (let i = balanceSheetItems.length - 1; i >= 0; i--) {
          if (balanceSheetItems[i].institutionId === where.institutionId) {
            balanceSheetItems.splice(i, 1);
          }
        }
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) {
          balanceSheetItems.push({ id: id('bsi'), ...d } as FakeRow);
        }
        return { count: data.length };
      }),
    },
    liquidityPosition: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.institutionId_date;
        return (
          liquidityPositions.find(
            (l) =>
              l.institutionId === key.institutionId &&
              (l.date as Date).getTime() === (key.date as Date).getTime(),
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: FakeRow = { id: id('liq'), ...data };
        liquidityPositions.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = liquidityPositions.find((l) => l.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
  };

  return {
    $transaction: jest.fn(async (cb: (tx: FakeTx) => Promise<unknown>) =>
      cb(tx),
    ),
    _state: { institutions, balanceSheetItems, liquidityPositions },
    _tx: tx,
  };
}

type FakeTx = ReturnType<typeof makeFakeTx>;

// Hoisted helper that gives the recursive `tx` reference an explicit type to break the
// self-reference cycle (`typeof tx` inside the same const declaration is illegal under
// strict mode). The function below is never called — its return type is used as the
// inferred shape of the in-memory tx object.
function makeFakeTx() {
  return {
    institution: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    balanceSheetItem: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    liquidityPosition: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('InstitutionSeedService', () => {
  let prisma: ReturnType<typeof makeFakePrisma>;
  let service: InstitutionSeedService;

  beforeEach(() => {
    prisma = makeFakePrisma();
    service = new InstitutionSeedService(prisma as never);
  });

  it('first run creates the institution, balance sheet items, and liquidity position', async () => {
    const result = await service.seedFromFixture('ws-1', 'pr-cooperativa-demo');

    expect(result.delta.institution).toBe('created');
    expect(result.delta.balanceSheetItems.before).toBe(0);
    expect(result.delta.balanceSheetItems.after).toBe(10);
    expect(result.delta.balanceSheetItems.replaced).toBe(false);
    expect(result.delta.liquidityPosition).toBe('created');
    expect(prisma._state.institutions).toHaveLength(1);
    expect(prisma._state.balanceSheetItems).toHaveLength(10);
    expect(prisma._state.liquidityPositions).toHaveLength(1);
  });

  it('second run with same fixture returns the SAME institutionId — pickup contract', async () => {
    const first = await service.seedFromFixture('ws-1', 'pr-cooperativa-demo');
    const second = await service.seedFromFixture('ws-1', 'pr-cooperativa-demo');

    expect(second.institutionId).toBe(first.institutionId);
    // No duplicate institution row.
    expect(prisma._state.institutions).toHaveLength(1);
    // Equality rule (2026-04-07): the institution's fixture-shaped fields
    // are byte-identical on re-seed, so the delta reports unchanged. The
    // previous placeholder reported 'updated' and polluted the audit log.
    expect(second.delta.institution).toBe('unchanged');
    // Balance sheet items were replaced — same count, fresh rows.
    expect(prisma._state.balanceSheetItems).toHaveLength(10);
    expect(second.delta.balanceSheetItems.replaced).toBe(true);
    expect(second.delta.balanceSheetItems.before).toBe(10);
    expect(second.delta.balanceSheetItems.after).toBe(10);
    // Liquidity position is byte-identical, so the equality check reports unchanged.
    expect(second.delta.liquidityPosition).toBe('unchanged');
    // Only one liquidity row total — upsert by (institutionId, date) worked.
    expect(prisma._state.liquidityPositions).toHaveLength(1);
  });

  it('different workspaces with same fixture create independent institutions', async () => {
    const a = await service.seedFromFixture('ws-1', 'pr-cooperativa-demo');
    const b = await service.seedFromFixture('ws-2', 'pr-cooperativa-demo');

    expect(a.institutionId).not.toBe(b.institutionId);
    expect(prisma._state.institutions).toHaveLength(2);
    expect(prisma._state.balanceSheetItems).toHaveLength(20);
  });

  it('throws a useful error for an unknown fixture key', async () => {
    await expect(
      service.seedFromFixture('ws-1', 'no-such-fixture'),
    ).rejects.toThrow(/Unknown institution fixture/);
  });
});
