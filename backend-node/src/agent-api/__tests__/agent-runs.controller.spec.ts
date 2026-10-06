import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentRunsController } from '../agent-runs.controller';

describe('AgentRunsController', () => {
  let controller: AgentRunsController;
  let mockPrisma: any;
  let mockCostBreaker: any;
  let mockRunner: any;
  let mockAudit: any;

  const INST_ID = 'inst-001';

  beforeEach(() => {
    mockPrisma = {
      agentRun: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    mockCostBreaker = {
      snapshotForInstitution: jest.fn().mockReturnValue({
        capUsdCents: 10000,
        remainingUsdCents: 10000,
        state: 'OK',
      }),
    };
    mockRunner = {
      run: jest.fn().mockResolvedValue({
        runId: 'run-1',
        status: 'QUEUED',
        existing: false,
      }),
    };
    mockAudit = {
      listForRun: jest.fn().mockResolvedValue([]),
    };
    controller = new AgentRunsController(
      mockPrisma,
      mockCostBreaker,
      mockRunner,
      mockAudit,
    );
  });

  describe('listRuns', () => {
    it('returns empty list when no runs exist', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([]);
      const result = await controller.listRuns(INST_ID, {});
      expect(result.runs).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it('applies limit + 1 for has-more detection', async () => {
      const rows = Array.from({ length: 51 }, (_, i) => ({
        id: `run-${i}`,
        agentId: 'ALM_DECISION',
        status: 'SUCCEEDED',
        triggerKind: 'API',
        institutionId: INST_ID,
        organizationId: null,
        durationMs: 1234,
        costUsdCents: 42,
        createdAt: new Date(),
        completedAt: new Date(),
      }));
      mockPrisma.agentRun.findMany.mockResolvedValue(rows);
      const result = await controller.listRuns(INST_ID, { limit: '50' });
      expect(result.runs.length).toBe(50);
      expect(result.nextCursor).toBe('run-49');
    });

    it('rejects cursor from different institution', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        createdAt: new Date(),
        institutionId: 'other-inst',
      });
      await expect(
        controller.listRuns(INST_ID, { cursor: 'run-x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('triggerRun', () => {
    it('delegates to runner with institution from path', async () => {
      await controller.triggerRun(INST_ID, {
        agentId: 'ALM_DECISION',
        triggerKind: 'API',
      });
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'ALM_DECISION',
          institutionId: INST_ID,
        }),
      );
    });

    it('URL :institutionId wins over body institutionId (IDOR lock)', async () => {
      // Body-override IDOR: prior implementation used
      // `req.institutionId ?? institutionId` — a caller authorized for
      // INST_ID could set body.institutionId='attacker-target' and run an
      // agent against the other institution. Locked to URL only post-fix.
      await controller.triggerRun(INST_ID, {
        agentId: 'ALM_DECISION',
        triggerKind: 'API',
        institutionId: 'attacker-target-inst',
      });
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'ALM_DECISION',
          institutionId: INST_ID,
        }),
      );
      // Defense-in-depth: the idempotency-key hash must also be derived
      // from URL :institutionId, otherwise a body override could
      // collide-attack another tenant's run history.
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.not.objectContaining({
          institutionId: 'attacker-target-inst',
        }),
      );
    });

    it('rejects invalid body', async () => {
      await expect(controller.triggerRun(INST_ID, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getRunById', () => {
    it('returns run when institution matches', async () => {
      const run = { id: 'run-1', institutionId: INST_ID, status: 'SUCCEEDED' };
      mockPrisma.agentRun.findUnique.mockResolvedValue(run);
      const result = await controller.getRunById(INST_ID, 'run-1');
      expect(result.id).toBe('run-1');
    });

    it('throws 404 for cross-tenant access', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        institutionId: 'other-inst',
      });
      await expect(controller.getRunById(INST_ID, 'run-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when run does not exist', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue(null);
      await expect(controller.getRunById(INST_ID, 'run-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getRunTrace', () => {
    it('returns audit steps for owned run', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        institutionId: INST_ID,
      });
      mockAudit.listForRun.mockResolvedValue([{ id: 's1', stepNumber: 1 }]);
      const result = await controller.getRunTrace(INST_ID, 'run-1');
      expect(result).toHaveLength(1);
    });

    it('throws 404 for cross-tenant trace', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        institutionId: 'other-inst',
      });
      await expect(controller.getRunTrace(INST_ID, 'run-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cost', () => {
    it('returns rollup with budget state', async () => {
      mockPrisma.agentRun.groupBy.mockResolvedValue([
        {
          agentId: 'ALM_DECISION',
          _count: { _all: 5 },
          _sum: { costUsdCents: 200, inputTokens: 50000, outputTokens: 10000 },
        },
      ]);
      const result = await controller.cost(INST_ID, {});
      expect(result.totalRuns).toBe(5);
      expect(result.totalCostUsdCents).toBe(200);
      expect(result.budget.state).toBe('OK');
    });
  });
});
