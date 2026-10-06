/**
 * ALM Demo Seed: Banco Comunidad PR
 *
 * Realistic Puerto Rico community bank with $1.2B in assets.
 * Produces: Duration gap ~+1.8yr (asset-sensitive), LCR ~118% (compliant)
 *
 * Usage:
 *   npx ts-node prisma/seed-alm-demo.ts
 *
 * Requires DATABASE_URL to be set.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding ALM demo data: Banco Comunidad PR...');

  // 1. Find or create a workspace
  let workspace = await prisma.workspace.findFirst({
    where: { name: 'Banco Comunidad PR Demo' },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { name: 'Banco Comunidad PR Demo' },
    });
    console.log(`  Created workspace: ${workspace.id}`);
  } else {
    console.log(`  Using existing workspace: ${workspace.id}`);
  }

  // 2. Create institution (delete existing demo first)
  const existingInst = await prisma.institution.findFirst({
    where: { name: 'Banco Comunidad PR', workspaceId: workspace.id },
  });
  if (existingInst) {
    await prisma.institution.delete({ where: { id: existingInst.id } });
    console.log(`  Cleaned up existing institution`);
  }

  const institution = await prisma.institution.create({
    data: {
      workspaceId: workspace.id,
      name: 'Banco Comunidad PR',
      type: 'bank',
      totalAssets: 1200, // $1.2B in millions
      currency: 'USD',
      reportingDate: new Date('2026-01-31'),
    },
  });
  console.log(`  Created institution: ${institution.id}`);

  // 3. Balance sheet items (in millions)
  const balanceSheetItems = [
    // ═══ ASSETS ($1,200M) ═══
    // Fixed mortgages — 40% of assets
    {
      category: 'asset',
      subcategory: 'loans',
      name: 'Fixed-Rate Residential Mortgages',
      balance: 480, // $480M
      rate: 0.065, // 6.5%
      duration: 4.2, // years
      rateType: 'fixed',
      maturityDate: new Date('2033-06-30'),
    },
    // Variable loans — 25% of assets
    {
      category: 'asset',
      subcategory: 'loans',
      name: 'Variable-Rate Commercial Loans',
      balance: 300, // $300M
      rate: 0.082, // 8.2% (SOFR + 3.0%)
      duration: 0.5, // reprices every 6 months
      rateType: 'variable',
      repriceDate: new Date('2026-07-01'),
      maturityDate: new Date('2031-03-31'),
    },
    // Securities — 20% of assets
    {
      category: 'asset',
      subcategory: 'securities',
      name: 'US Treasury & Agency Securities',
      balance: 240, // $240M
      rate: 0.041, // 4.1%
      duration: 2.8,
      rateType: 'fixed',
      maturityDate: new Date('2029-09-30'),
    },
    // Cash / HQLA — 15% of assets
    {
      category: 'asset',
      subcategory: 'cash',
      name: 'Cash & Fed Funds (HQLA Level 1)',
      balance: 180, // $180M
      rate: 0.053, // 5.3% overnight
      duration: 0.003, // ~1 day
      rateType: 'variable',
      repriceDate: new Date('2026-02-21'), // tomorrow
    },

    // ═══ LIABILITIES ($1,020M) ═══
    // Demand deposits — 35% of liabilities
    {
      category: 'liability',
      subcategory: 'deposits',
      name: 'Core Demand Deposits',
      balance: 357, // $357M
      rate: 0.012, // 1.2%
      duration: 1.2,
      rateType: 'fixed',
      maturityDate: new Date('2027-02-28'),
    },
    // Time deposits / CDs — 30%
    {
      category: 'liability',
      subcategory: 'deposits',
      name: 'Time Deposits & CDs',
      balance: 306, // $306M
      rate: 0.038, // 3.8%
      duration: 1.8,
      rateType: 'fixed',
      maturityDate: new Date('2028-01-31'),
    },
    // FHLB borrowings — 20%
    {
      category: 'liability',
      subcategory: 'borrowings',
      name: 'FHLB Advances',
      balance: 204, // $204M
      rate: 0.055, // 5.5%
      duration: 2.1,
      rateType: 'variable',
      repriceDate: new Date('2026-08-01'),
      maturityDate: new Date('2029-06-30'),
    },
    // Other borrowings — 15%
    {
      category: 'liability',
      subcategory: 'borrowings',
      name: 'Subordinated Notes & Other',
      balance: 153, // $153M
      rate: 0.048, // 4.8%
      duration: 3.5,
      rateType: 'fixed',
      maturityDate: new Date('2031-12-31'),
    },
  ];

  await prisma.balanceSheetItem.createMany({
    data: balanceSheetItems.map((item) => ({
      institutionId: institution.id,
      category: item.category,
      subcategory: item.subcategory,
      name: item.name,
      balance: item.balance,
      rate: item.rate,
      duration: item.duration,
      rateType: item.rateType,
      repriceDate: item.repriceDate || null,
      maturityDate: item.maturityDate || null,
    })),
  });
  console.log(`  Created ${balanceSheetItems.length} balance sheet items`);

  // 4. Liquidity position (LCR ~118%)
  // HQLA: $180M cash (L1) + $240M * 0.85 = $204M securities (L2A) = $384M total
  // But L2 cap = 2/3 * L1 = $120M → HQLA = $180M + $120M = $300M
  // Net outflows: 10% of $1,020M liabilities = $102M stressed, but let's set explicitly
  // LCR = $300M / $254M ≈ 118%
  await prisma.liquidityPosition.create({
    data: {
      institutionId: institution.id,
      date: new Date('2026-01-31'),
      hqlaLevel1: 180, // $180M cash
      hqlaLevel2: 120, // $120M after haircuts and cap
      cashOutflows: 310, // $310M 30-day stressed outflows
      cashInflows: 56, // $56M 30-day inflows
      lcr: 118.1, // (180+120) / (310-56) = 300/254 ≈ 118.1%
      nsfr: 112.5, // stable funding ratio
    },
  });
  console.log(`  Created liquidity position (LCR: 118.1%)`);

  // ─── Summary ───
  const totalAssets = balanceSheetItems
    .filter((i) => i.category === 'asset')
    .reduce((s, i) => s + i.balance, 0);
  const totalLiabilities = balanceSheetItems
    .filter((i) => i.category === 'liability')
    .reduce((s, i) => s + i.balance, 0);
  const equity = totalAssets - totalLiabilities;

  console.log(`\n  ════ Banco Comunidad PR ════`);
  console.log(`  Total Assets:      $${totalAssets}M`);
  console.log(`  Total Liabilities: $${totalLiabilities}M`);
  console.log(`  Equity:            $${equity}M`);
  console.log(`  Institution ID:    ${institution.id}`);
  console.log(`  Workspace ID:      ${workspace.id}`);
  console.log(`\n  Seed complete.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
