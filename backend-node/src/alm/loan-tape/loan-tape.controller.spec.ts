import { LoanTapeController } from './loan-tape.controller';
import type { LoanTapeIngestService } from './loan-tape-ingest.service';
import type { LoanTapeAggregationService } from './loan-tape-aggregation.service';
import type { GeographicConcentrationService } from './geographic-concentration.service';
import type { FhlbnyCollateralService } from './fhlbny-collateral.service';

describe('LoanTapeController — W2.0 HTTP surface', () => {
  let ingestSpy: jest.Mock;
  let rollupSpy: jest.Mock;
  let reconcileSpy: jest.Mock;
  let geoSpy: jest.Mock;
  let fhlbnySpy: jest.Mock;
  let fhlbnyFileSpy: jest.Mock;
  let controller: LoanTapeController;

  beforeEach(() => {
    ingestSpy = jest
      .fn()
      .mockResolvedValue({ status: 'ingested', persisted: 1 });
    rollupSpy = jest.fn().mockResolvedValue({ status: 'ok', segments: [] });
    reconcileSpy = jest.fn().mockResolvedValue({ status: 'ok', rows: [] });
    geoSpy = jest.fn().mockResolvedValue({ status: 'ok' });
    fhlbnySpy = jest.fn().mockResolvedValue({ status: 'ok', modeled: true });
    fhlbnyFileSpy = jest.fn().mockResolvedValue({ modeled: true, csv: '' });
    controller = new LoanTapeController(
      { ingestLoanTape: ingestSpy } as unknown as LoanTapeIngestService,
      {
        rollUpToSegments: rollupSpy,
        reconcileWithSegments: reconcileSpy,
      } as unknown as LoanTapeAggregationService,
      { analyze: geoSpy } as unknown as GeographicConcentrationService,
      {
        analyze: fhlbnySpy,
        generateModeledFile: fhlbnyFileSpy,
      } as unknown as FhlbnyCollateralService,
    );
  });

  it('POST loan-tape delegates to ingest service', async () => {
    await controller.ingestTape('inst-1', {
      csvContent: 'loanId,balance\nL1,1000',
      asOfDate: '2026-06-30',
    });
    expect(ingestSpy).toHaveBeenCalledWith(
      'inst-1',
      '2026-06-30',
      'loanId,balance\nL1,1000',
    );
  });

  it('GET rollup parses asOfDate', async () => {
    await controller.rollup('inst-1', '2026-06-30');
    expect(rollupSpy).toHaveBeenCalledWith(
      'inst-1',
      new Date('2026-06-30T00:00:00Z'),
    );
  });

  it('GET reconcile parses asOfDate', async () => {
    await controller.reconcile('inst-1', '2026-06-30');
    expect(reconcileSpy).toHaveBeenCalledWith(
      'inst-1',
      new Date('2026-06-30T00:00:00Z'),
    );
  });

  it('GET geographic-concentration delegates with the parsed asOfDate (W2.2)', async () => {
    await controller.geographicConcentration('inst-1', '2026-06-30');
    expect(geoSpy).toHaveBeenCalledWith(
      'inst-1',
      new Date('2026-06-30T00:00:00Z'),
    );
  });

  it('GET geographic-concentration rejects a malformed asOfDate', async () => {
    await expect(
      controller.geographicConcentration('inst-1', '06/30/2026'),
    ).rejects.toThrow('asOfDate');
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('GET fhlbny-collateral delegates with the parsed asOfDate (W2.1)', async () => {
    await controller.fhlbnyCollateral('inst-1', '2026-06-30');
    expect(fhlbnySpy).toHaveBeenCalledWith(
      'inst-1',
      new Date('2026-06-30T00:00:00Z'),
    );
  });

  it('GET fhlbny-collateral/file delegates to the modeled-file generator', async () => {
    await controller.fhlbnyCollateralFile('inst-1', '2026-06-30');
    expect(fhlbnyFileSpy).toHaveBeenCalledWith(
      'inst-1',
      new Date('2026-06-30T00:00:00Z'),
    );
  });

  it('class-level guard stack is declared', () => {
    const guards = Reflect.getMetadata('__guards__', LoanTapeController);
    const names = (guards ?? []).map((g: { name: string }) => g.name);
    expect(names).toContain('AuthTenantGuard');
    expect(names).toContain('InstitutionScopeGuard');
  });
});
