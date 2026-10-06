import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/auth.guard';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: Record<string, jest.Mock>;

  const mockReq = (overrides: any = {}) => ({
    user: { userId: 'user-1' },
    headers: { 'x-organization-id': 'org-1' },
    ...overrides,
  });

  beforeEach(async () => {
    analyticsService = {
      getSummary: jest.fn(),
      getSpendingTrends: jest.fn(),
      getCategoryBreakdown: jest.fn(),
      getTeamComparison: jest.fn(),
      exportExpenses: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: analyticsService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return summary for org', () => {
      const mockSummary = { totalSpend: 1000 };
      analyticsService.getSummary.mockReturnValue(mockSummary);

      const result = controller.getSummary(mockReq());
      expect(result).toEqual(mockSummary);
      expect(analyticsService.getSummary).toHaveBeenCalledWith(
        'org-1',
        'user-1',
      );
    });

    it('should default to default-org when header missing', async () => {
      analyticsService.getSummary.mockReturnValue({});

      await controller.getSummary(mockReq({ headers: {} }));
      expect(analyticsService.getSummary).toHaveBeenCalledWith(
        'default-org',
        'user-1',
      );
    });
  });

  describe('getSpendingTrends', () => {
    it('should pass date range to service', async () => {
      analyticsService.getSpendingTrends.mockReturnValue([]);

      const req = mockReq();
      await controller.getSpendingTrends('2025-01-01', '2025-12-31', req);

      expect(analyticsService.getSpendingTrends).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        { startDate: '2025-01-01', endDate: '2025-12-31' },
      );
    });

    it('should use defaults when dates not provided', async () => {
      analyticsService.getSpendingTrends.mockReturnValue([]);

      const req = mockReq();
      await controller.getSpendingTrends(
        undefined as any,
        undefined as any,
        req,
      );

      const call = analyticsService.getSpendingTrends.mock.calls[0];
      expect(call[0]).toBe('org-1');
      expect(call[1]).toBe('user-1');
      expect(call[2].startDate).toBeDefined();
      expect(call[2].endDate).toBeDefined();
    });
  });

  describe('getCategoryBreakdown', () => {
    it('should pass date range when both provided', async () => {
      analyticsService.getCategoryBreakdown.mockReturnValue([]);

      await controller.getCategoryBreakdown(
        '2025-01-01',
        '2025-12-31',
        mockReq(),
      );
      expect(analyticsService.getCategoryBreakdown).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        { startDate: '2025-01-01', endDate: '2025-12-31' },
      );
    });

    it('should pass undefined range when dates not provided', async () => {
      analyticsService.getCategoryBreakdown.mockReturnValue([]);

      await controller.getCategoryBreakdown(
        undefined as any,
        undefined as any,
        mockReq(),
      );
      expect(analyticsService.getCategoryBreakdown).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        undefined,
      );
    });
  });

  describe('getTeamComparison', () => {
    it('should pass date range when both provided', async () => {
      analyticsService.getTeamComparison.mockReturnValue([]);

      await controller.getTeamComparison('2025-01-01', '2025-12-31', mockReq());
      expect(analyticsService.getTeamComparison).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        { startDate: '2025-01-01', endDate: '2025-12-31' },
      );
    });

    it('should pass undefined range when dates not provided', async () => {
      analyticsService.getTeamComparison.mockReturnValue([]);

      await controller.getTeamComparison(
        undefined as any,
        undefined as any,
        mockReq(),
      );
      expect(analyticsService.getTeamComparison).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        undefined,
      );
    });
  });

  describe('exportExpenses', () => {
    it('should export as CSV when format is csv', async () => {
      const mockData = [{ name: 'Expense 1', amount: 100 }];
      analyticsService.exportExpenses.mockResolvedValue(mockData);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
      };

      await controller.exportExpenses(
        '2025-01-01',
        '2025-12-31',
        'csv',
        mockReq(),
        mockRes,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename=expenses.csv',
      );
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('should handle CSV export with empty data', async () => {
      analyticsService.exportExpenses.mockResolvedValue([]);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
      };

      await controller.exportExpenses(
        '2025-01-01',
        '2025-12-31',
        'csv',
        mockReq(),
        mockRes,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv',
      );
      expect(mockRes.send).toHaveBeenCalledWith('');
    });

    it('should return JSON when format is not csv', async () => {
      const mockData = [{ name: 'Expense 1', amount: 100 }];
      analyticsService.exportExpenses.mockResolvedValue(mockData);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
      };

      await controller.exportExpenses(
        '2025-01-01',
        '2025-12-31',
        'json',
        mockReq(),
        mockRes,
      );

      expect(mockRes.json).toHaveBeenCalledWith(mockData);
    });

    it('should pass undefined range when dates not provided', async () => {
      analyticsService.exportExpenses.mockResolvedValue([]);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
      };

      await controller.exportExpenses(
        undefined as any,
        undefined as any,
        'json',
        mockReq(),
        mockRes,
      );

      expect(analyticsService.exportExpenses).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        undefined,
      );
    });
  });
});
