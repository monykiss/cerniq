import { Prisma } from '@prisma/client';
import { MonteCarloService } from './monte-carlo.service';

// Build a service whose Prisma returns the given balance-sheet items.
function makeService(items: any[]): MonteCarloService {
  const prisma = {
    balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
  } as any;
  return new MonteCarloService(prisma);
}

const REAL_ITEMS = [
  {
    category: 'asset',
    balance: 1_000_000,
    rate: 0.05,
    duration: 3,
    rateType: 'variable',
    subcategory: 'auto_loans',
  },
  {
    category: 'liability',
    balance: 800_000,
    rate: 0.02,
    duration: 1,
    rateType: 'fixed',
    subcategory: 'savings',
    depositBeta: 0.4,
  },
];

describe('MonteCarloService', () => {
  // ─── Structural / clamping (ok path) ────────────────────────
  it('clamps paths to a minimum of 100', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', { paths: 50 });
    expect(r.paths).toBeGreaterThanOrEqual(100);
  });

  it('caps paths at 100_000', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 200_000,
      quarters: 1,
    });
    expect(r.paths).toBeLessThanOrEqual(100_000);
  });

  it('clamps quarters to a minimum of 1', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 100,
      quarters: 0,
    });
    expect(r.quarters).toBeGreaterThanOrEqual(1);
  });

  it('fan chart has one entry per quarter', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 200,
      quarters: 8,
    });
    expect(r.fanChart).toHaveLength(8);
    expect(r.fanChart[0]).toHaveProperty('p5');
    expect(r.fanChart[0]).toHaveProperty('p95');
  });

  it('distribution has 20 buckets', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 500,
      quarters: 4,
    });
    expect(r.distribution.buckets).toHaveLength(20);
  });

  it('standard error is a non-negative number', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 500,
      quarters: 4,
    });
    expect(r.standardError!).toBeGreaterThanOrEqual(0);
  });

  it('handles odd path counts (antithetic variates)', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 101,
      quarters: 2,
    });
    expect(r.paths).toBe(101);
    expect(r.fanChart).toHaveLength(2);
  });

  it('uses custom Vasicek params when provided', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 200,
      quarters: 4,
      kappa: 0.1,
      theta: 0.05,
      sigma: 0.02,
    });
    expect(r.vasicekParams.kappa).toBe(0.1);
    expect(r.vasicekParams.theta).toBe(0.05);
    expect(r.vasicekParams.sigma).toBe(0.02);
  });

  it('clamps sigma to a valid range', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 100,
      quarters: 1,
      sigma: 0,
    });
    expect(r.vasicekParams.sigma).toBeGreaterThan(0);
  });

  it('reports convergence status', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 10000,
      quarters: 4,
    });
    expect(typeof r.convergenceMet).toBe('boolean');
  });

  // ─── Real-data NII / EVE (ok path) ──────────────────────────
  it('computes NII and EVE from a real balance sheet', async () => {
    const r = await makeService(REAL_ITEMS).runSimulation('i', {
      paths: 1000,
      quarters: 4,
    });
    expect(r.status).toBe('ok');
    expect(typeof r.meanNII).toBe('number');
    expect(r.var95NII!).toBeLessThanOrEqual(r.meanNII!); // worst-case <= mean
    expect(typeof r.meanEVE).toBe('number');
    expect(r.var95EVE!).toBeLessThanOrEqual(r.meanEVE!);
  });

  // ─── D1 honest-minimum shell (no phantom $3.2M NII) ─────────
  it('empty balance sheet → data_unavailable shell with null metrics + CRITICAL gap', async () => {
    const r = await makeService([]).runSimulation('inst-empty', {
      paths: 500,
      quarters: 4,
    });
    expect(r.status).toBe('data_unavailable');
    expect(r.meanNII).toBeNull();
    expect(r.var95NII).toBeNull();
    expect(r.meanEVE).toBeNull();
    expect(r.standardError).toBeNull();
    expect(r.fanChart).toEqual([]);
    expect(r.distribution.buckets).toEqual([]);
    const crit = r.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(crit?.reason).toBe('EMPTY_BALANCE_SHEET');
    // The deleted $3.2M phantom NII must not reappear.
    expect(JSON.stringify(r)).not.toContain('3.2');
  });

  // ─── Prisma Decimal coercion (the production bug) ────────────
  it('coerces Prisma Decimal balances instead of silently zeroing them', async () => {
    const D = (n: number) => new Prisma.Decimal(n);
    const decItems = [
      {
        category: 'asset',
        balance: D(1_000_000),
        rate: D(0.05),
        duration: D(3),
        rateType: 'fixed',
        subcategory: 'auto_loans',
      },
    ];
    const r = await makeService(decItems).runSimulation('inst-dec', {
      paths: 1000,
      quarters: 4,
    });
    expect(r.status).toBe('ok');
    // With real balances coerced, NII is materially non-zero. Before the fix,
    // Number.isFinite(Decimal) was false → balance 0 → meanNII exactly 0.
    expect(Math.abs(r.meanNII!)).toBeGreaterThan(100);
  });

  it('tolerates NaN balances (coerced to 0, result still finite)', async () => {
    const r = await makeService([
      {
        category: 'asset',
        balance: NaN,
        rate: 0.05,
        duration: 3,
        rateType: 'fixed',
        subcategory: 'loans',
      },
    ]).runSimulation('inst-nan', { paths: 100, quarters: 2 });
    expect(r.status).toBe('ok');
    expect(Number.isFinite(r.meanNII!)).toBe(true);
  });

  it('applies default deposit betas by subcategory without error', async () => {
    const r = await makeService([
      {
        category: 'liability',
        balance: 10_000,
        rate: 0.01,
        rateType: 'variable',
        subcategory: 'demand_deposits',
      },
      {
        category: 'liability',
        balance: 20_000,
        rate: 0.02,
        rateType: 'variable',
        subcategory: 'time_cd',
      },
      {
        category: 'liability',
        balance: 15_000,
        rate: 0.015,
        rateType: 'variable',
        subcategory: 'other_borrowings',
      },
    ]).runSimulation('inst-betas', { paths: 200, quarters: 2 });
    expect(r.status).toBe('ok');
    expect(Number.isFinite(r.meanNII!)).toBe(true);
  });
});
