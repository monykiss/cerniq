import { Test, TestingModule } from '@nestjs/testing';
import { AlmAdvisorV2Controller } from './alm-advisor-v2.controller';
import { AlmAdvisorV2Service } from './alm-advisor-v2.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

describe('AlmAdvisorV2Controller', () => {
  let controller: AlmAdvisorV2Controller;
  let advisorV2Service: Record<string, jest.Mock>;

  beforeEach(async () => {
    advisorV2Service = {
      streamNarrative: jest.fn(),
      computeHealthScore: jest.fn(),
      getStaticNarrative: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlmAdvisorV2Controller],
      providers: [{ provide: AlmAdvisorV2Service, useValue: advisorV2Service }],
    })
      .overrideGuard(AuthTenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(InstitutionScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AlmAdvisorV2Controller>(AlmAdvisorV2Controller);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('streamAdvisor', () => {
    it('should return an Observable for SSE streaming', () => {
      async function* fakeGen() {
        yield 'chunk1';
      }
      advisorV2Service.streamNarrative.mockReturnValue(fakeGen());

      const result = controller.streamAdvisor('inst-1', 'en');
      expect(result).toBeDefined();
      expect(advisorV2Service.streamNarrative).toHaveBeenCalledWith(
        'inst-1',
        'en',
      );
    });

    it('should pass lang parameter through to service', () => {
      async function* fakeGen() {
        yield 'chunk';
      }
      advisorV2Service.streamNarrative.mockReturnValue(fakeGen());

      controller.streamAdvisor('inst-2', 'es');
      expect(advisorV2Service.streamNarrative).toHaveBeenCalledWith(
        'inst-2',
        'es',
      );
    });
  });

  describe('getHealthScore', () => {
    it('should return health score for an institution', async () => {
      const mockScore = { score: 85, grade: 'A' };
      advisorV2Service.computeHealthScore.mockResolvedValue(mockScore);

      const result = await controller.getHealthScore('inst-1');
      expect(result).toEqual(mockScore);
      expect(advisorV2Service.computeHealthScore).toHaveBeenCalledWith(
        'inst-1',
      );
    });

    it('should propagate errors from service', async () => {
      advisorV2Service.computeHealthScore.mockRejectedValue(
        new Error('Not found'),
      );

      await expect(controller.getHealthScore('bad-id')).rejects.toThrow(
        'Not found',
      );
    });
  });

  describe('getStaticNarrative', () => {
    it('should return static narrative for an institution', async () => {
      const mockNarrative = { narrative: 'All good' };
      advisorV2Service.getStaticNarrative.mockResolvedValue(mockNarrative);

      const result = await controller.getStaticNarrative('inst-1', 'es');
      expect(result).toEqual(mockNarrative);
      expect(advisorV2Service.getStaticNarrative).toHaveBeenCalledWith(
        'inst-1',
        'es',
      );
    });

    it('should handle default lang parameter', async () => {
      advisorV2Service.getStaticNarrative.mockResolvedValue({ narrative: '' });

      await controller.getStaticNarrative('inst-1', 'en');
      expect(advisorV2Service.getStaticNarrative).toHaveBeenCalledWith(
        'inst-1',
        'en',
      );
    });
  });
});
