import 'reflect-metadata';
import { MemberLifecycleStage } from '@prisma/client';
import { AuthTenantGuard } from '../../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../../agent-api/guards/institution-scope.guard';
import { Member360Controller } from './member-360.controller';

function buildServiceMock() {
  return {
    listMembers: jest.fn().mockResolvedValue({ members: [] }),
    getMemberProfile: jest.fn().mockResolvedValue({}),
    seedDemoMembers: jest
      .fn()
      .mockResolvedValue({ created: 0, skipped: false }),
  };
}

describe('Member360Controller', () => {
  let service: ReturnType<typeof buildServiceMock>;
  let controller: Member360Controller;

  beforeEach(() => {
    service = buildServiceMock();
    controller = new Member360Controller(service as never);
  });

  it('carries the class-level AuthTenantGuard + InstitutionScopeGuard stack', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      Member360Controller,
    ) as unknown[];
    expect(guards).toBeDefined();
    // UseGuards stores guard classes/refs directly; assert both precedent
    // guards are present, mirroring EwsController's lock on this stack.
    expect(guards).toContain(AuthTenantGuard);
    expect(guards).toContain(InstitutionScopeGuard);
  });

  describe('listMembers', () => {
    it('delegates to the service with parsed filters', async () => {
      await controller.listMembers('inst-1', 'active', '2', '10');
      expect(service.listMembers).toHaveBeenCalledWith('inst-1', {
        stage: MemberLifecycleStage.ACTIVE,
        page: 2,
        pageSize: 10,
      });
    });

    it('ignores an invalid stage query param instead of throwing', async () => {
      await controller.listMembers('inst-1', 'not-a-real-stage');
      expect(service.listMembers).toHaveBeenCalledWith('inst-1', {
        stage: undefined,
        page: undefined,
        pageSize: undefined,
      });
    });

    it('ignores a non-numeric page query param instead of coercing garbage', async () => {
      await controller.listMembers('inst-1', undefined, 'abc');
      expect(service.listMembers).toHaveBeenCalledWith('inst-1', {
        stage: undefined,
        page: undefined,
        pageSize: undefined,
      });
    });
  });

  describe('getMemberProfile', () => {
    it('delegates to the service with both path params', async () => {
      await controller.getMemberProfile('inst-1', 'member-9');
      expect(service.getMemberProfile).toHaveBeenCalledWith(
        'inst-1',
        'member-9',
      );
    });
  });

  describe('seedDemo', () => {
    it('defaults the seed count when none is provided', async () => {
      await controller.seedDemo('inst-1', {});
      expect(service.seedDemoMembers).toHaveBeenCalledWith('inst-1', 50);
    });

    it('clamps an oversized requested count to the documented maximum', async () => {
      await controller.seedDemo('inst-1', { count: 999999 });
      expect(service.seedDemoMembers).toHaveBeenCalledWith('inst-1', 250);
    });

    it('falls back to the default for a non-finite/invalid count', async () => {
      await controller.seedDemo('inst-1', { count: -5 });
      expect(service.seedDemoMembers).toHaveBeenCalledWith('inst-1', 50);
    });
  });
});
