import { MaturityLadderService } from './maturity-ladder.service';

describe('MaturityLadderService', () => {
  let service: MaturityLadderService;

  // Use a fixed asOfDate so tests are deterministic
  const asOfDate = '2026-01-01';

  const assets = [
    { name: 'Treasury Bill', balance: 5_000_000, maturityDate: '2026-01-15' },
    { name: 'Auto Loan Pool', balance: 20_000_000, maturityDate: '2026-07-01' },
    { name: 'Mortgage Pool', balance: 50_000_000, maturityDate: '2031-01-01' },
    {
      name: 'Commercial Loan',
      balance: 15_000_000,
      maturityDate: '2027-01-01',
    },
    { name: 'Overnight Funds', balance: 2_000_000, maturityDate: '2026-01-02' },
  ];

  const liabilities = [
    {
      name: 'Demand Deposits',
      balance: 30_000_000,
      maturityDate: '2026-01-02',
    },
    { name: 'CD 6M', balance: 15_000_000, maturityDate: '2026-07-01' },
    { name: 'CD 1Y', balance: 10_000_000, maturityDate: '2027-01-01' },
    { name: 'FHLB Advance', balance: 20_000_000, maturityDate: '2028-01-01' },
    { name: 'Sub Debt', balance: 5_000_000, maturityDate: '2036-01-01' },
  ];

  beforeEach(() => {
    service = new MaturityLadderService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return 13 standard buckets', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    expect(result.buckets).toHaveLength(13);
    expect(result.buckets[0].period).toBe('O/N');
    expect(result.buckets[12].period).toBe('>10Y');
  });

  it('total assets should equal sum of asset balances', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    const expected = assets.reduce((s, a) => s + a.balance, 0);
    expect(result.totalAssets).toBeCloseTo(expected, 0);
  });

  it('total liabilities should equal sum of liability balances', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    const expected = liabilities.reduce((s, l) => s + l.balance, 0);
    expect(result.totalLiabilities).toBeCloseTo(expected, 0);
  });

  it('bucket asset totals should sum to total assets', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    const bucketSum = result.buckets.reduce((s, b) => s + b.assetTotal, 0);
    expect(bucketSum).toBeCloseTo(result.totalAssets, 0);
  });

  it('cumulative gap at last bucket should equal net position', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    const lastBucket = result.buckets[result.buckets.length - 1];
    expect(lastBucket.cumulativeGap).toBeCloseTo(result.netPosition, 0);
  });

  it('concentration risk should be between 0 and 1', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    expect(result.concentrationRisk).toBeGreaterThanOrEqual(0);
    expect(result.concentrationRisk).toBeLessThanOrEqual(1);
  });

  it('overnight bucket should contain overnight items', () => {
    const result = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    const onBucket = result.buckets.find((b) => b.period === 'O/N')!;
    // Overnight Funds (2M asset) and Demand Deposits (30M liability) both mature on Jan 2
    expect(onBucket.assetTotal).toBeGreaterThanOrEqual(2_000_000);
    expect(onBucket.liabilityTotal).toBeGreaterThanOrEqual(30_000_000);
  });

  it('liquidity gap ratios should return status for each bucket', () => {
    const ladder = service.buildMaturityLadder({
      assets,
      liabilities,
      asOfDate,
    });
    const ratios = service.computeLiquidityGapRatios({
      buckets: ladder.buckets,
      totalAssets: ladder.totalAssets,
    });
    expect(ratios).toHaveLength(13);
    for (const r of ratios) {
      expect(['Critical', 'Warning', 'Monitor', 'Adequate']).toContain(
        r.status,
      );
    }
  });
});
