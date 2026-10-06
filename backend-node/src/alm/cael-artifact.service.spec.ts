import { CaelArtifactService } from './cael-artifact.service';
import { CaelComplianceService } from './cael-compliance.service';
import type {
  ReportArtifactService,
  CreateArtifactInput,
} from './reports/report-artifact.service';

describe('CaelArtifactService — CAEL filing persistence (W1.1 Slice 2)', () => {
  const cael = new CaelComplianceService();
  const SUMMARY = {
    equity: 25,
    totalAssets: 250,
    capitalRatioRWA: 18.6,
    liquidityRatio: 12,
    interestIncome: 10,
    interestExpense: 4,
  };
  const results = [
    cael.evaluateCaelCompliance(
      cael.caelInputsFromEngines('reg7790', SUMMARY, {
        totalAllowance: 2.6,
        totalBalance: 200,
        methodology: 'Incurred Loss (Reg 8665)',
        overallStatus: 'computed',
      }),
    ),
    cael.evaluateCaelCompliance(
      cael.caelInputsFromEngines('piloto', SUMMARY, null),
    ),
  ];

  function make(): { svc: CaelArtifactService; recordSpy: jest.Mock } {
    const recordSpy = jest
      .fn()
      .mockImplementation((input: CreateArtifactInput) =>
        Promise.resolve({
          id: 'artifact-1',
          institutionId: input.institutionId,
          format: input.format,
          contentChecksum: 'sha256:deadbeef',
          sizeBytes: input.content.length,
          storageLocator: input.storageLocator,
          modelLineageSnapshot: input.modelLineage,
          preflightReady: false,
          generatedAt: new Date('2026-03-31T00:00:00Z'),
        }),
      );
    const reportArtifact = {
      record: recordSpy,
    } as unknown as ReportArtifactService;
    return { svc: new CaelArtifactService(reportArtifact), recordSpy };
  }

  it('records the filing as a CAEL_JSON artifact through the pipeline', async () => {
    const { svc, recordSpy } = make();
    const rec = await svc.persistFiling({ institutionId: 'inst-1', results });
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const input = recordSpy.mock.calls[0][0] as CreateArtifactInput;
    expect(input.format).toBe('CAEL_JSON');
    expect(input.institutionId).toBe('inst-1');
    expect(input.storageLocator).toBe('inline:cael:inst-1');
    expect(rec.id).toBe('artifact-1');
  });

  it('serializes the exact compute results as the checksummed content', async () => {
    const { svc, recordSpy } = make();
    await svc.persistFiling({ institutionId: 'inst-1', results });
    const input = recordSpy.mock.calls[0][0] as CreateArtifactInput;
    expect(input.content.toString('utf-8')).toBe(JSON.stringify(results));
  });

  it('stamps the CAEL model lineage (provenance)', async () => {
    const { svc, recordSpy } = make();
    await svc.persistFiling({ institutionId: 'inst-1', results });
    const input = recordSpy.mock.calls[0][0] as CreateArtifactInput;
    expect(input.modelLineage.map((m) => m.modelKey)).toEqual([
      'reg.cael-pr',
      'credit.incurred-loss',
    ]);
  });

  it('carries the filing data-gaps, de-duplicated (D1 — never dropped)', async () => {
    const { svc, recordSpy } = make();
    await svc.persistFiling({ institutionId: 'inst-1', results });
    const input = recordSpy.mock.calls[0][0] as CreateArtifactInput;
    // Both variants raise the same asset-quality + provisional gaps → deduped.
    const fields = (input.preflightGaps ?? []).map((g) => g.field);
    expect(fields).toContain('cael.asset_quality');
    expect(new Set(fields).size).toBe(fields.length); // no duplicates
  });
});
