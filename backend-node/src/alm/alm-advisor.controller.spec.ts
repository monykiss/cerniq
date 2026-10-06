import { Test, TestingModule } from '@nestjs/testing';
import { AlmAdvisorController } from './alm-advisor.controller';
import { AlmAdvisorService } from './alm-advisor.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

describe('AlmAdvisorController', () => {
  let controller: AlmAdvisorController;
  let advisorService: Record<string, jest.Mock>;

  beforeEach(async () => {
    advisorService = {
      ask: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlmAdvisorController],
      providers: [{ provide: AlmAdvisorService, useValue: advisorService }],
    })
      .overrideGuard(AuthTenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(InstitutionScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AlmAdvisorController>(AlmAdvisorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('askAdvisor', () => {
    it('should call advisor.ask with correct params and return result', async () => {
      const mockResult = { reply: 'AI response' };
      advisorService.ask.mockResolvedValue(mockResult);

      const dto = {
        message: 'What is the risk?',
        conversationHistory: [{ role: 'user' as const, content: 'Hello' }],
        language: 'en' as const,
      };

      const result = await controller.askAdvisor('inst-1', dto);
      expect(result).toEqual(mockResult);
      expect(advisorService.ask).toHaveBeenCalledWith(
        'inst-1',
        'What is the risk?',
        [{ role: 'user', content: 'Hello' }],
        'en',
      );
    });

    it('should default conversationHistory to empty array when not provided', async () => {
      advisorService.ask.mockResolvedValue({ reply: 'response' });

      const dto = { message: 'Hello' } as any;
      await controller.askAdvisor('inst-2', dto);

      expect(advisorService.ask).toHaveBeenCalledWith(
        'inst-2',
        'Hello',
        [],
        'es',
      );
    });

    it('should default language to es when not provided', async () => {
      advisorService.ask.mockResolvedValue({ reply: 'response' });

      const dto = { message: 'Hola', conversationHistory: [] } as any;
      await controller.askAdvisor('inst-3', dto);

      expect(advisorService.ask).toHaveBeenCalledWith(
        'inst-3',
        'Hola',
        [],
        'es',
      );
    });

    it('should propagate service errors', async () => {
      advisorService.ask.mockRejectedValue(new Error('AI unavailable'));

      const dto = { message: 'test' } as any;
      await expect(controller.askAdvisor('inst-1', dto)).rejects.toThrow(
        'AI unavailable',
      );
    });
  });
});
