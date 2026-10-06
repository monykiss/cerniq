import { SOFRMonitorService } from './sofr-monitor.service';

describe('SOFRMonitorService', () => {
  const mk = (items: unknown[]) =>
    new SOFRMonitorService({
      balanceSheetItem: { findMany: jest.fn().mockResolvedValue(items) },
    } as any);

  // ── D1: honest empty-data shell (never the $38.7M demo) ────────

  it('returns a data_unavailable shell with null totals + CRITICAL gap when no balance sheet', async () => {
    const result = await mk([]).getExposureReport('inst-1');

    expect(result.status).toBe('data_unavailable');
    expect(result.exposures).toEqual([]);
    expect(result.totalLIBORExposure).toBeNull();
    expect(result.totalSOFRExposure).toBeNull();
    expect(result.totalValueTransfer).toBeNull();
    expect(result.pctPortfolioExposed).toBeNull();
    // the transition checklist is static reference data, present in both shapes
    expect(result.transitionChecklist).toHaveLength(7);

    const critical = result.gaps?.find((g) => g.severity === 'CRITICAL');
    expect(critical).toBeDefined();
    expect(critical!.reason).toBe('EMPTY_BALANCE_SHEET');
    expect(critical!.field).toBe('sofrMonitor.balanceSheet');
  });

  // ── D1: a balance sheet with no LIBOR instruments is a REAL zero ──

  it('reports a real zero-exposure result (status ok), not demo, when no LIBOR instruments exist', async () => {
    const result = await mk([
      {
        id: 'f1',
        name: 'Fixed Rate Mortgage',
        category: 'asset',
        subcategory: 'residential_mortgage',
        balance: 100,
        duration: 5,
        rate: 0.05,
        rateType: 'fixed',
      },
    ]).getExposureReport('inst-1');

    expect(result.status).toBe('ok');
    expect(result.gaps).toBeUndefined();
    expect(result.exposures).toEqual([]); // genuinely no LIBOR exposure
    expect(result.totalLIBORExposure).toBe(0);
    expect(result.totalValueTransfer).toBe(0);
    expect(result.pctPortfolioExposed).toBe(0);
  });

  // ── D1: real LIBOR instruments ─────────────────────────────────

  describe('with actual LIBOR balance sheet items', () => {
    let serviceWithData: SOFRMonitorService;

    beforeEach(() => {
      serviceWithData = mk([
        {
          id: 'i1',
          name: 'LIBOR Floating Mortgage',
          category: 'asset',
          subcategory: 'residential_mortgage',
          balance: 25,
          duration: 0.3,
          rate: 0.065,
          rateType: 'variable',
        },
        {
          id: 'i2',
          name: 'C&I Floating LIBOR',
          category: 'asset',
          subcategory: 'commercial_loans',
          balance: 15,
          duration: 3,
          rate: 0.072,
          rateType: 'variable',
        },
        {
          id: 'i3',
          name: 'SOFR-indexed CD',
          category: 'liability',
          subcategory: 'sofr_deposits',
          balance: 30,
          duration: 1,
          rate: 0.03,
          rateType: 'variable',
        },
        {
          id: 'i4',
          name: 'Fixed Rate Loan',
          category: 'asset',
          subcategory: 'commercial',
          balance: 50,
          duration: 5,
          rate: 0.06,
          rateType: 'fixed',
        },
      ]);
    });

    it('identifies LIBOR-referenced variable instruments with status ok', async () => {
      const result = await serviceWithData.getExposureReport('inst-1');
      expect(result.status).toBe('ok');
      expect(result.exposures).toHaveLength(2);
      expect(result.exposures[0].name).toContain('LIBOR');
    });

    it('SOFR equivalent is less than the LIBOR rate for each exposure', async () => {
      const result = await serviceWithData.getExposureReport('inst-1');
      for (const exp of result.exposures) {
        expect(exp.sofrEquivalent).toBeLessThan(exp.currentRate);
      }
    });

    it('totalLIBORExposure is the sum of LIBOR balances', async () => {
      const result = await serviceWithData.getExposureReport('inst-1');
      expect(result.totalLIBORExposure).toBe(40); // 25 + 15
    });

    it('selects 1M_LIBOR for short duration and 3M_LIBOR for longer', async () => {
      const result = await serviceWithData.getExposureReport('inst-1');
      const shortDur = result.exposures.find((e) =>
        e.name.includes('LIBOR Floating Mortgage'),
      );
      const longDur = result.exposures.find((e) =>
        e.name.includes('C&I Floating'),
      );

      expect(shortDur!.referenceRate).toBe('1M LIBOR');
      expect(shortDur!.spreadAdjustment).toBeCloseTo(0.00114, 4);
      expect(longDur!.referenceRate).toBe('3M LIBOR');
      expect(longDur!.spreadAdjustment).toBeCloseTo(0.00262, 4);
    });
  });
});
