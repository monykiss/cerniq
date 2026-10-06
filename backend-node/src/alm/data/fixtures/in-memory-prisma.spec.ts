/**
 * Specs for the reusable in-memory Prisma fake. Confirms it serves the fixture
 * data shape the ALM engines expect — and, critically, that it applies the
 * seeder's percent→decimal rate normalization so the math sees production shape.
 */
import { makeInMemoryPrismaFromFixture } from './in-memory-prisma';
import { buildSanJuanFederalDemo } from './builders/san-juan-federal.builder';

describe('makeInMemoryPrismaFromFixture', () => {
  const fixture = buildSanJuanFederalDemo();
  const prisma = makeInMemoryPrismaFromFixture(fixture, {
    institutionId: 'inst-x',
  });

  it('serves every balance-sheet item (findMany + count agree)', async () => {
    const items = await prisma.balanceSheetItem.findMany();
    expect(items).toHaveLength(fixture.items.length);
    expect(await prisma.balanceSheetItem.count()).toBe(fixture.items.length);
  });

  it('normalizes percent rates to decimals (seeder parity)', async () => {
    const items = (await prisma.balanceSheetItem.findMany()) as Array<{
      subcategory: string;
      rate: number;
    }>;
    const served = items.find((i) => i.subcategory === 'consumer_loans')!;
    const source = fixture.items.find(
      (i) => i.subcategory === 'consumer_loans',
    )!;
    expect(served.rate).toBeCloseTo(source.rate / 100, 6);
  });

  it('tags institution + rows with the requested id', async () => {
    const inst = (await prisma.institution.findUnique()) as { id: string };
    expect(inst.id).toBe('inst-x');
    const items = (await prisma.balanceSheetItem.findMany()) as Array<{
      institutionId: string;
    }>;
    for (const i of items) expect(i.institutionId).toBe('inst-x');
  });

  it('serves the liquidity position and loan segments', async () => {
    const liq = (await prisma.liquidityPosition.findFirst()) as { lcr: number };
    expect(liq.lcr).toBeCloseTo(fixture.liquidity.lcr, 6);
    const segs = await prisma.loanSegment.findMany();
    expect(segs).toHaveLength((fixture.loanSegments ?? []).length);
  });

  it('returns empty interest-rate-scenario delegates (no persisted scenarios)', async () => {
    expect(await prisma.interestRateScenario.findMany()).toEqual([]);
    expect(await prisma.interestRateScenario.deleteMany()).toEqual({
      count: 0,
    });
  });
});
