import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ComplianceController } from './compliance.controller';
import { ComplianceReportService } from './compliance-report.service';
import { AdminKeyGuard } from '../auth/admin-key.guard';

// Post-refactor: admin-key enforcement is in `AdminKeyGuard`. The
// guard's auth behavior (missing/empty/mismatched/env-absent → 401,
// same error message across all failure modes) is covered by the
// 10-case suite in `admin-key.guard.spec.ts`. This spec covers only
// the controller's own behavior:
//   (a) class-level `AdminKeyGuard` is wired (reflection lock — a
//       future refactor that drops the guard fails this test loudly).
//   (b) the handler delegates to
//       `ComplianceReportService.generateSOC2Evidence()` and wraps
//       the result as `{ ok: true, data: ... }`.
//   (c) service errors propagate.
//
// Pre-refactor (`HEAD~1`) this file had 3 tests calling
// `controller.getSOC2Evidence('wrong-key')` directly — that pattern no
// longer works because guards run at HTTP layer and direct controller
// method invocation bypasses them entirely. The reflection-based
// guard-wiring lock is the structural equivalent.

describe('ComplianceController', () => {
  let controller: ComplianceController;
  const mockReportService = {
    generateSOC2Evidence: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComplianceController],
      providers: [
        { provide: ComplianceReportService, useValue: mockReportService },
      ],
    })
      .overrideGuard(AdminKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ComplianceController>(ComplianceController);
    jest.clearAllMocks();
  });

  it('has AdminKeyGuard wired at the class level (reflection lock)', () => {
    // NestJS stores @UseGuards under the '__guards__' metadata key on
    // the controller class. The lock test catches the structural
    // regression where AdminKeyGuard is removed from the decorator —
    // a behavior-only test would not detect that because direct method
    // invocation bypasses guards anyway.
    const guards =
      Reflect.getMetadata('__guards__', ComplianceController) ?? [];
    const names = guards.map((g: { name?: string }) => g?.name ?? String(g));
    expect(names).toContain('AdminKeyGuard');
  });

  it('delegates to ComplianceReportService.generateSOC2Evidence and wraps the result', async () => {
    const mockReport = { controls: [], evidence: [] };
    mockReportService.generateSOC2Evidence.mockResolvedValue(mockReport);

    const result = await controller.getSOC2Evidence();

    expect(result).toEqual({ ok: true, data: mockReport });
    expect(mockReportService.generateSOC2Evidence).toHaveBeenCalledTimes(1);
  });

  it('propagates service errors', async () => {
    mockReportService.generateSOC2Evidence.mockRejectedValue(
      new Error('DB error'),
    );

    await expect(controller.getSOC2Evidence()).rejects.toThrow('DB error');
  });
});
