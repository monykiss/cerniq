import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdminAuditController,
  PortalAuditController,
} from './audit.controller';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminKeyGuard } from '../auth/admin-key.guard';

// Post-AdminKeyGuard refactor: admin-key enforcement lives in the
// guard, fully covered by the 10-case `admin-key.guard.spec.ts`. This
// spec covers (a) wiring lock — reflection asserts `AdminKeyGuard` is
// on the controller class, (b) handler delegation to AuditService.
// Pre-refactor direct calls of `controller.getAuditLogs('wrong-key')`
// no longer detect auth (guards run at HTTP layer, direct invocation
// bypasses them) so they are replaced.

describe('AdminAuditController', () => {
  let controller: AdminAuditController;
  let auditService: Record<string, jest.Mock>;

  beforeEach(async () => {
    auditService = {
      adminQuery: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuditController],
      providers: [{ provide: AuditService, useValue: auditService }],
    })
      .overrideGuard(AdminKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminAuditController>(AdminAuditController);
  });

  it('has AdminKeyGuard wired at the class level (reflection lock)', () => {
    const guards =
      Reflect.getMetadata('__guards__', AdminAuditController) ?? [];
    const names = guards.map((g: { name?: string }) => g?.name ?? String(g));
    expect(names).toContain('AdminKeyGuard');
  });

  describe('getAuditLogs', () => {
    it('should return audit logs and pass query params through', async () => {
      const mockLogs = [{ id: 'log-1', action: 'LOGIN' }];
      auditService.adminQuery.mockResolvedValue(mockLogs);

      const result = await controller.getAuditLogs('inst-1', '50', '10');
      expect(result).toEqual(mockLogs);
      expect(auditService.adminQuery).toHaveBeenCalledWith({
        institutionId: 'inst-1',
        limit: 50,
        offset: 10,
      });
    });

    it('should use defaults for limit and offset', async () => {
      auditService.adminQuery.mockResolvedValue([]);

      await controller.getAuditLogs();
      expect(auditService.adminQuery).toHaveBeenCalledWith({
        institutionId: undefined,
        limit: 100,
        offset: 0,
      });
    });
  });
});

describe('PortalAuditController', () => {
  let controller: PortalAuditController;
  let auditService: Record<string, jest.Mock>;
  let prismaService: any;

  beforeEach(async () => {
    auditService = {
      queryByInstitution: jest.fn(),
      queryByUser: jest.fn(),
    };

    prismaService = {
      user: { findUnique: jest.fn() },
      reportJob: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalAuditController],
      providers: [
        { provide: AuditService, useValue: auditService },
        { provide: PrismaService, useValue: prismaService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PortalAuditController>(PortalAuditController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAuditLog', () => {
    it('should return institution audit log for OWNER role', async () => {
      const req = { user: { userId: 'u1', role: 'OWNER' } };
      prismaService.user.findUnique.mockResolvedValue({ role: 'OWNER' });
      prismaService.reportJob.findFirst.mockResolvedValue({
        institutionId: 'inst-1',
      });
      const mockLogs = [{ id: 'log-1' }];
      auditService.queryByInstitution.mockResolvedValue(mockLogs);

      const result = await controller.getAuditLog(req, '50', '10');
      expect(result).toEqual(mockLogs);
      expect(auditService.queryByInstitution).toHaveBeenCalledWith('inst-1', {
        limit: 50,
        offset: 10,
        daysBack: 90,
      });
    });

    it('should fall back to user audit log when OWNER has no institution', async () => {
      const req = { user: { userId: 'u1', role: 'OWNER' } };
      prismaService.user.findUnique.mockResolvedValue({ role: 'OWNER' });
      prismaService.reportJob.findFirst.mockResolvedValue(null);
      const mockLogs = [{ id: 'user-log' }];
      auditService.queryByUser.mockResolvedValue(mockLogs);

      const result = await controller.getAuditLog(req);
      expect(result).toEqual(mockLogs);
      expect(auditService.queryByUser).toHaveBeenCalledWith('u1', {
        limit: 100,
        offset: 0,
        daysBack: 90,
      });
    });

    it('should return user audit log for non-OWNER role', async () => {
      const req = { user: { userId: 'u2', role: 'MEMBER' } };
      const mockLogs = [{ id: 'user-log' }];
      auditService.queryByUser.mockResolvedValue(mockLogs);

      const result = await controller.getAuditLog(req);
      expect(result).toEqual(mockLogs);
      expect(auditService.queryByUser).toHaveBeenCalledWith('u2', {
        limit: 100,
        offset: 0,
        daysBack: 90,
      });
    });

    it('should use default limit and offset', async () => {
      const req = { user: { userId: 'u2', role: 'MEMBER' } };
      auditService.queryByUser.mockResolvedValue([]);

      await controller.getAuditLog(req);
      expect(auditService.queryByUser).toHaveBeenCalledWith('u2', {
        limit: 100,
        offset: 0,
        daysBack: 90,
      });
    });
  });
});
