import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentAlertsController } from '../alerts.controller';

describe('AgentAlertsController', () => {
  let controller: AgentAlertsController;
  let mockPrisma: any;

  const INST_ID = 'inst-001';

  beforeEach(() => {
    mockPrisma = {
      agentAlert: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    controller = new AgentAlertsController(mockPrisma);
  });

  describe('list', () => {
    it('returns empty list + zero summary', async () => {
      const result = await controller.list(INST_ID, {});
      expect(result.alerts).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.summary).toEqual({
        open: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
    });

    it('computes severity summary from groupBy', async () => {
      mockPrisma.agentAlert.groupBy.mockResolvedValue([
        { severity: 'CRITICAL', status: 'OPEN', _count: { _all: 2 } },
        { severity: 'HIGH', status: 'OPEN', _count: { _all: 3 } },
        { severity: 'HIGH', status: 'ACKNOWLEDGED', _count: { _all: 1 } },
        { severity: 'MEDIUM', status: 'RESOLVED', _count: { _all: 5 } },
      ]);
      const result = await controller.list(INST_ID, {});
      expect(result.summary.open).toBe(5); // 2 CRITICAL OPEN + 3 HIGH OPEN
      expect(result.summary.critical).toBe(2);
      expect(result.summary.high).toBe(4); // 3 OPEN + 1 ACKNOWLEDGED
      expect(result.summary.medium).toBe(0); // only RESOLVED medium — excluded
    });
  });

  describe('ack', () => {
    it('returns 404 for non-existent alert', async () => {
      mockPrisma.agentAlert.findUnique.mockResolvedValue(null);
      await expect(
        controller.ack(INST_ID, 'alert-x', {}, { user: { userId: 'u1' } }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 when alert belongs to different institution', async () => {
      mockPrisma.agentAlert.findUnique.mockResolvedValue({
        id: 'alert-1',
        institutionId: 'other-inst',
        status: 'OPEN',
      });
      await expect(
        controller.ack(INST_ID, 'alert-1', {}, { user: { userId: 'u1' } }),
      ).rejects.toThrow(NotFoundException);
    });

    it('acknowledges an OPEN alert', async () => {
      mockPrisma.agentAlert.findUnique.mockResolvedValue({
        id: 'alert-1',
        institutionId: INST_ID,
        status: 'OPEN',
      });
      const updatedAlert = { id: 'alert-1', status: 'ACKNOWLEDGED' };
      mockPrisma.agentAlert.update.mockResolvedValue(updatedAlert);

      const result = await controller.ack(
        INST_ID,
        'alert-1',
        {},
        { user: { userId: 'u1' } },
      );
      expect(mockPrisma.agentAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert-1' },
          data: expect.objectContaining({
            status: 'ACKNOWLEDGED',
            acknowledgedBy: 'u1',
          }),
        }),
      );
      expect(result).toEqual(updatedAlert);
    });

    it('resolves an alert with RESOLVED resolution', async () => {
      mockPrisma.agentAlert.findUnique.mockResolvedValue({
        id: 'alert-2',
        institutionId: INST_ID,
        status: 'OPEN',
      });
      mockPrisma.agentAlert.update.mockResolvedValue({
        id: 'alert-2',
        status: 'RESOLVED',
      });

      await controller.ack(
        INST_ID,
        'alert-2',
        { resolution: 'RESOLVED' },
        { user: { userId: 'u1' } },
      );
      expect(mockPrisma.agentAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedAt: expect.any(Date),
          }),
        }),
      );
    });
  });
});
