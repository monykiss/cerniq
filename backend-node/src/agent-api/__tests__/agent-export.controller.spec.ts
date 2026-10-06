import { NotFoundException } from '@nestjs/common';
import {
  AgentExportController,
  computeExportHash,
} from '../agent-export.controller';

describe('AgentExportController', () => {
  let controller: AgentExportController;
  let mockPrisma: any;
  let mockAudit: any;

  const INST_ID = 'inst-001';

  const mockRun = {
    id: 'run-1',
    agentId: 'ALM_DECISION',
    status: 'SUCCEEDED',
    triggerKind: 'API',
    institutionId: INST_ID,
    organizationId: null,
    durationMs: 5000,
    costUsdCents: 42,
    createdAt: new Date('2026-04-15T10:00:00Z'),
    completedAt: new Date('2026-04-15T10:00:05Z'),
    auditRootHash: 'abc123',
    promptVersion: '1.0.0',
    agentVersion: '1.0.0',
  };

  beforeEach(() => {
    mockPrisma = {
      agentRun: {
        findUnique: jest.fn().mockResolvedValue(mockRun),
      },
      agentAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            stepIndex: 0,
            stepKind: 'RUN_STARTED',
            toolName: null,
            payload: { agentId: 'ALM_DECISION' },
            prevHash: null,
            hash: 'hash-0',
            durationMs: null,
            createdAt: new Date('2026-04-15T10:00:00Z'),
          },
        ]),
      },
    };
    mockAudit = {
      verifyChain: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new AgentExportController(mockPrisma, mockAudit);
  });

  it('exports JSON with stable exportHash', async () => {
    const res = {
      setHeader: jest.fn(),
    } as any;

    const result = await controller.export(INST_ID, 'run-1', 'json', res);
    expect(result).toBeDefined();
    expect(result!.run.id).toBe('run-1');
    expect(result!.chain).toEqual({ ok: true });
    expect(result!.exportHash).toBeTruthy();

    // Hash is deterministic — recomputing should match.
    const recomputed = computeExportHash({
      ...result!,
      exportHash: '',
    });
    expect(recomputed).toBe(result!.exportHash);
  });

  it('returns 404 when run belongs to different institution', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      ...mockRun,
      institutionId: 'other-inst',
    });
    const res = { setHeader: jest.fn() } as any;
    await expect(
      controller.export(INST_ID, 'run-1', 'json', res),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('computeExportHash', () => {
  it('produces a stable hex hash', () => {
    const payload: any = {
      run: { id: 'r1', agentId: 'ALM_DECISION' },
      steps: [],
      chain: { ok: true },
      generatedAt: '2026-04-15T10:00:00Z',
      exportHash: '',
    };
    const h1 = computeExportHash(payload);
    const h2 = computeExportHash(payload);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64); // sha256 hex
  });
});
