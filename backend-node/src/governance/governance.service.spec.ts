/**
 * Governance service specs — FAANG Audit P1 items #2 and #3.
 *
 * Tests both GovernedScenarioService and GovernedBenchmarkService:
 * upsert idempotency, list/filter, approve/retire lifecycle, getApproved.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { GovernedScenarioService } from './governed-scenario.service';
import { GovernedBenchmarkService } from './governed-benchmark.service';
import { PrismaService } from '../prisma.service';

function createMockStore(uniqueKey: string) {
  const items: any[] = [];
  let idCounter = 1;

  return {
    findMany: jest.fn(({ where }: any = {}) => {
      let result = [...items];
      if (where) {
        for (const [k, v] of Object.entries(where)) {
          result = result.filter((i) => i[k] === v);
        }
      }
      return Promise.resolve(result);
    }),
    findUnique: jest.fn(({ where }: any) => {
      const found = where.id
        ? items.find((i) => i.id === where.id)
        : items.find((i) => i[uniqueKey] === where[uniqueKey]);
      return Promise.resolve(found ?? null);
    }),
    upsert: jest.fn(({ where, create, update }: any) => {
      const existing = items.find((i) => i[uniqueKey] === where[uniqueKey]);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return Promise.resolve(existing);
      }
      const newItem = {
        id: `item-${idCounter++}`,
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      items.push(newItem);
      return Promise.resolve(newItem);
    }),
    update: jest.fn(({ where, data }: any) => {
      const found = items.find((i) => i.id === where.id);
      if (!found) throw new Error('Not found');
      Object.assign(found, data, { updatedAt: new Date() });
      return Promise.resolve(found);
    }),
    _items: items,
  };
}

// ── Scenario Tests ──

describe('GovernedScenarioService', () => {
  let service: GovernedScenarioService;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    store = createMockStore('scenarioKey');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GovernedScenarioService,
        { provide: PrismaService, useValue: { governedScenario: store } },
      ],
    }).compile();
    service = module.get(GovernedScenarioService);
  });

  const seed = (overrides: Partial<any> = {}) =>
    service.upsert({
      scenarioKey: 'stress.test-baseline',
      displayName: 'Test Baseline',
      description: 'Test scenario',
      version: '1.0.0',
      scope: 'REGULATORY',
      status: 'APPROVED',
      source: 'TEST',
      ownerName: 'Test',
      parameters: { rateShockBps: 200 },
      ...overrides,
    });

  it('creates a scenario on first upsert', async () => {
    const result = await seed();
    expect(result.scenarioKey).toBe('stress.test-baseline');
    expect(store._items).toHaveLength(1);
  });

  it('updates on re-upsert without duplication', async () => {
    await seed();
    await seed({ version: '1.1.0' });
    expect(store._items).toHaveLength(1);
    expect(store._items[0].version).toBe('1.1.0');
  });

  it('lists all scenarios', async () => {
    await seed();
    await seed({ scenarioKey: 'stress.adverse', scope: 'SECTOR' });
    const all = await service.list();
    expect(all).toHaveLength(2);
  });

  it('filters by scope', async () => {
    await seed();
    await seed({ scenarioKey: 'stress.sector', scope: 'SECTOR' });
    const filtered = await service.list({ scope: 'REGULATORY' });
    expect(filtered).toHaveLength(1);
  });

  it('gets by key', async () => {
    await seed();
    const found = await service.getByKey('stress.test-baseline');
    expect(found.displayName).toBe('Test Baseline');
  });

  it('throws NotFoundException for missing key', async () => {
    await expect(service.getByKey('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('approves a draft scenario', async () => {
    const s = await seed({ status: 'DRAFT' });
    const approved = await service.approve(s.id, 'reviewer');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('reviewer');
  });

  it('rejects double approval', async () => {
    const s = await seed({ status: 'APPROVED' });
    await expect(service.approve(s.id, 'reviewer')).rejects.toThrow(
      ConflictException,
    );
  });

  it('retires a scenario with reason', async () => {
    const s = await seed();
    const retired = await service.retire(s.id, 'Superseded by 2027 version');
    expect(retired.status).toBe('RETIRED');
    expect(retired.retiredReason).toBe('Superseded by 2027 version');
  });

  it('rejects retiring already retired', async () => {
    const s = await seed({ status: 'RETIRED' });
    await expect(service.retire(s.id, 'test')).rejects.toThrow(
      ConflictException,
    );
  });

  it('getApproved returns only approved scenarios', async () => {
    await seed();
    await seed({ scenarioKey: 'stress.draft', status: 'DRAFT' });
    const approved = await service.getApproved();
    expect(approved).toHaveLength(1);
  });
});

// ── Benchmark Tests ──

describe('GovernedBenchmarkService', () => {
  let service: GovernedBenchmarkService;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    store = createMockStore('datasetKey');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GovernedBenchmarkService,
        { provide: PrismaService, useValue: { governedBenchmark: store } },
      ],
    }).compile();
    service = module.get(GovernedBenchmarkService);
  });

  const seed = (overrides: Partial<any> = {}) =>
    service.upsert({
      datasetKey: 'curve.test-q1',
      displayName: 'Test Curve Q1',
      description: 'Test benchmark',
      benchmarkType: 'YIELD_CURVE',
      version: '1.0.0',
      status: 'APPROVED',
      asOfDate: new Date('2026-03-31'),
      source: 'TEST',
      ownerName: 'Test',
      refreshPolicy: 'QUARTERLY',
      data: { tenors: [{ tenor: 1, rate: 0.04 }] },
      ...overrides,
    });

  it('creates a benchmark on first upsert with checksum', async () => {
    const result = await seed();
    expect(result.datasetKey).toBe('curve.test-q1');
    expect(result.dataChecksum).toMatch(/^sha256:/);
    expect(store._items).toHaveLength(1);
  });

  it('updates on re-upsert without duplication', async () => {
    await seed();
    await seed({ version: '1.1.0' });
    expect(store._items).toHaveLength(1);
  });

  it('lists all benchmarks', async () => {
    await seed();
    await seed({ datasetKey: 'peer.test', benchmarkType: 'PEER_BENCHMARK' });
    const all = await service.list();
    expect(all).toHaveLength(2);
  });

  it('filters by benchmarkType', async () => {
    await seed();
    await seed({ datasetKey: 'peer.test', benchmarkType: 'PEER_BENCHMARK' });
    const filtered = await service.list({ benchmarkType: 'YIELD_CURVE' });
    expect(filtered).toHaveLength(1);
  });

  it('gets by key', async () => {
    await seed();
    const found = await service.getByKey('curve.test-q1');
    expect(found.displayName).toBe('Test Curve Q1');
  });

  it('throws NotFoundException for missing key', async () => {
    await expect(service.getByKey('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('approves a draft benchmark', async () => {
    const b = await seed({ status: 'DRAFT' });
    const approved = await service.approve(b.id, 'reviewer');
    expect(approved.status).toBe('APPROVED');
  });

  it('rejects double approval', async () => {
    const b = await seed({ status: 'APPROVED' });
    await expect(service.approve(b.id, 'reviewer')).rejects.toThrow(
      ConflictException,
    );
  });

  it('retires a benchmark', async () => {
    const b = await seed();
    const retired = await service.retire(b.id);
    expect(retired.status).toBe('RETIRED');
  });

  it('getApproved filters correctly', async () => {
    await seed();
    await seed({ datasetKey: 'draft.x', status: 'DRAFT' });
    const approved = await service.getApproved();
    expect(approved).toHaveLength(1);
  });
});
