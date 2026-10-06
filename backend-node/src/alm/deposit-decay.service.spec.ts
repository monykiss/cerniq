import { DepositDecayService } from './deposit-decay.service';

describe('DepositDecayService', () => {
  let service: DepositDecayService;
  let findMany: jest.Mock;

  // Granular CSV-taxonomy liabilities: 3 NMD products + 1 contractual (CDs) +
  // 1 non-deposit (borrowings). NMD total = 4200 + 1400 + 2100 = 7700.
  const granularLiabilities = [
    {
      subcategory: 'savings_deposits',
      name: 'Cuentas de Ahorro',
      balance: 4200,
    },
    { subcategory: 'demand_deposits', name: 'Cuenta Corriente', balance: 1400 },
    { subcategory: 'money_market', name: 'Mercado Monetario', balance: 2100 },
    {
      subcategory: 'time_deposits',
      name: 'Certificados de Depósito',
      balance: 3000,
    },
    { subcategory: 'borrowings', name: 'FHLB Advances', balance: 500 },
  ];

  beforeEach(() => {
    findMany = jest.fn();
    const mockPrisma = { balanceSheetItem: { findMany } } as any;
    service = new DepositDecayService(mockPrisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── D1: honest empty-data shell (never the $12B demo) ──────────

  it('returns a data_unavailable shell with a CRITICAL gap when the institution has no liabilities', async () => {
    findMany.mockResolvedValue([]);

    const result = await service.analyzeDecay('inst-empty');

    expect(result.status).toBe('data_unavailable');
    expect(result.products).toEqual([]);
    expect(result.portfolioWeightedLife).toBeNull();
    expect(result.portfolioHalfLife).toBeNull();
    expect(result.totalNMDBalance).toBeNull();
    expect(result.stableCorePct).toBeNull();
    expect(result.interpretation).toBeNull();
    expect(result.interpretationEs).toBeNull();

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('depositDecay.nmdBalances');
  });

  it('returns data_unavailable when only contractual / non-deposit liabilities exist', async () => {
    // Time deposits (contractual maturity) + borrowings are not NMDs — there
    // is nothing for the runoff model to compute, so it must NOT fabricate.
    findMany.mockResolvedValue([
      { subcategory: 'time_deposits', name: 'Certificados', balance: 3000 },
      { subcategory: 'borrowings', name: 'FHLB Advances', balance: 500 },
    ]);

    const result = await service.analyzeDecay('inst-cds-only');

    expect(result.status).toBe('data_unavailable');
    expect(result.products).toEqual([]);
    expect(result.totalNMDBalance).toBeNull();
  });

  // ── D1: real-data computation (not the unconditional demo) ─────

  it("queries only the institution's liability balance-sheet items", async () => {
    findMany.mockResolvedValue([]);

    await service.analyzeDecay('inst-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { institutionId: 'inst-1', category: 'liability' },
    });
  });

  it('models NMD products from real balances and excludes time deposits + borrowings', async () => {
    findMany.mockResolvedValue(granularLiabilities);

    const result = await service.analyzeDecay('inst-1');

    expect(result.status).toBe('ok');
    // 3 NMD products in registry order; share_drafts absent in this fixture.
    expect(result.products.map((p) => p.subcategory)).toEqual([
      'savings',
      'demand',
      'money_market',
    ]);
    // totalNMDBalance is the sum of NMD balances ONLY (excludes CDs $3000 and
    // borrowings $500). A silent-zero bug would either include or fabricate.
    expect(result.totalNMDBalance).toBe(7700);
    expect(
      result.products.find((p) => p.subcategory === 'savings')!.balance,
    ).toBe(4200);
  });

  it('computes half-life as ln(2)/λ, WAL as 1/λ, and the survival curve from real balances', async () => {
    findMany.mockResolvedValue(granularLiabilities);

    const result = await service.analyzeDecay('inst-1');

    for (const product of result.products) {
      expect(product.halfLife).toBeCloseTo(Math.log(2) / product.decayRate, 1);
      expect(product.behavioralMaturity).toBeCloseTo(1 / product.decayRate, 1);

      expect(product.survivalCurve).toHaveLength(11); // years 0..10
      expect(product.survivalCurve[0].year).toBe(0);
      expect(product.survivalCurve[10].year).toBe(10);
      // Year 0: 100% survival, balance == the product's real balance.
      expect(product.survivalCurve[0].pctRemaining).toBeCloseTo(100, 0);
      expect(product.survivalCurve[0].balance).toBeCloseTo(product.balance, 0);
      // Year 1: e^(-λ) * 100.
      expect(product.survivalCurve[1].pctRemaining).toBeCloseTo(
        Math.exp(-product.decayRate) * 100,
        0,
      );
    }
  });

  it('aligns λ to the canonical Hutchison-Pennacchi runoff calibration', async () => {
    findMany.mockResolvedValue(granularLiabilities);

    const result = await service.analyzeDecay('inst-1');

    const byKey = Object.fromEntries(
      result.products.map((p) => [p.subcategory, p.decayRate]),
    );
    expect(byKey.savings).toBe(0.1);
    expect(byKey.demand).toBe(0.08);
    expect(byKey.money_market).toBe(0.15);
  });

  it('computes portfolio weighted average life as a balance-weighted average of product WALs', async () => {
    findMany.mockResolvedValue(granularLiabilities);

    const result = await service.analyzeDecay('inst-1');

    const total = result.products.reduce((s, p) => s + p.balance, 0);
    const expectedWAL =
      result.products.reduce(
        (s, p) => s + p.balance * p.behavioralMaturity,
        0,
      ) / total;
    expect(result.portfolioWeightedLife).toBeCloseTo(expectedWAL, 1);
    // Every product here has WAL = 1/λ > 1yr → 100% core.
    expect(result.stableCorePct).toBeCloseTo(100, 0);
  });

  it('discloses the default-λ assumption as a WARNING gap (D1 provenance)', async () => {
    findMany.mockResolvedValue(granularLiabilities);

    const result = await service.analyzeDecay('inst-1');

    const warning = result.gaps?.find((g) => g.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning!.reason).toBe('COSSEC_INPUTS_INSUFFICIENT');
    expect(warning!.field).toBe('depositDecay.decayRate');
    expect(warning!.action).toContain('Hutchison-Pennacchi');
  });

  it('includes bilingual product labels', async () => {
    findMany.mockResolvedValue(granularLiabilities);

    const result = await service.analyzeDecay('inst-1');

    const savings = result.products.find((p) => p.subcategory === 'savings');
    expect(savings!.name).toBe('Savings / Member Shares');
    expect(savings!.nameEs).toBe('Ahorro / Acciones de Socios');
    expect(result.interpretation).toBeTruthy();
    expect(result.interpretationEs).toBeTruthy();
  });

  // ── Coarse demo-seed regime: split a single `deposits` subcategory by name ──

  it('infers product class from the item name when the subcategory is coarse', async () => {
    findMany.mockResolvedValue([
      { subcategory: 'deposits', name: 'Core Demand Deposits', balance: 1000 },
      { subcategory: 'deposits', name: 'Time Deposits & CDs', balance: 2000 },
      { subcategory: 'borrowings', name: 'FHLB Advances', balance: 500 },
    ]);

    const result = await service.analyzeDecay('inst-coarse');

    expect(result.status).toBe('ok');
    expect(result.products.map((p) => p.subcategory)).toEqual(['demand']);
    expect(result.totalNMDBalance).toBe(1000); // CDs + borrowings excluded
  });
});
