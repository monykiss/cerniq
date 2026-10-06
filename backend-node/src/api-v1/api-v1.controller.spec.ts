import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ApiV1Controller } from './api-v1.controller';
import { ApiV1Service } from './api-v1.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiRateLimitGuard } from './guards/api-rate-limit.guard';

describe('ApiV1Controller', () => {
  let controller: ApiV1Controller;
  let apiV1Service: Record<string, jest.Mock>;

  beforeEach(async () => {
    apiV1Service = {
      getFrameworks: jest.fn(),
      getBenchmarks: jest.fn(),
      analyzeFromRows: jest.fn(),
      analyzeFromCSV: jest.fn(),
      getAnalysis: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiV1Controller],
      providers: [{ provide: ApiV1Service, useValue: apiV1Service }],
    })
      .overrideGuard(ApiKeyAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ApiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ApiV1Controller>(ApiV1Controller);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('health', () => {
    it('should return health status', () => {
      const result = controller.health();
      expect(result.status).toBe('ok');
      expect(result.version).toBe('1.0.0');
      expect(result.service).toBe('cerniq-api-v1');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getFrameworks', () => {
    it('should return frameworks from service', () => {
      const frameworks = [{ name: 'COSSEC' }, { name: 'NCUA' }];
      apiV1Service.getFrameworks.mockReturnValue(frameworks);

      expect(controller.getFrameworks()).toEqual(frameworks);
      expect(apiV1Service.getFrameworks).toHaveBeenCalled();
    });
  });

  describe('getBenchmarks', () => {
    it('should return benchmarks from service', () => {
      const benchmarks = { median: 5.0 };
      apiV1Service.getBenchmarks.mockReturnValue(benchmarks);

      expect(controller.getBenchmarks()).toEqual(benchmarks);
      expect(apiV1Service.getBenchmarks).toHaveBeenCalled();
    });
  });

  describe('analyze', () => {
    it('should analyze rows and return result', async () => {
      const mockResult = { analysisId: 'abc', score: 90 };
      apiV1Service.analyzeFromRows.mockResolvedValue(mockResult);

      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const dto = {
        institutionName: 'Test Coop',
        rows: [{ category: 'assets', balance: 1000 }],
      } as any;

      const result = await controller.analyze(req, dto);
      expect(result).toEqual(mockResult);
      expect(apiV1Service.analyzeFromRows).toHaveBeenCalledWith('u1', dto);
    });
  });

  describe('analyzeCSV', () => {
    it('should analyze CSV upload and return result', async () => {
      const mockResult = { analysisId: 'csv-1' };
      apiV1Service.analyzeFromCSV.mockResolvedValue(mockResult);

      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const file = {
        buffer: Buffer.from('col1,col2\nval1,val2'),
        size: 100,
        originalname: 'data.csv',
      } as Express.Multer.File;
      const body = {
        institutionName: 'Test Coop',
        institutionType: 'cooperativa',
        framework: 'cossec',
        period: 'Q1-2026',
      };

      const result = await controller.analyzeCSV(req, file, body);
      expect(result).toEqual(mockResult);
      expect(apiV1Service.analyzeFromCSV).toHaveBeenCalledWith(
        'u1',
        'col1,col2\nval1,val2',
        'Test Coop',
        'cooperativa',
        'cossec',
        'Q1-2026',
      );
    });

    it('should throw BadRequestException when no file provided', async () => {
      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const body = {
        institutionName: 'Test',
        institutionType: 'cooperativa',
        framework: 'cossec',
        period: 'Q1-2026',
      };

      await expect(
        controller.analyzeCSV(req, undefined as any, body),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when required fields missing', async () => {
      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const file = {
        buffer: Buffer.from('data'),
        size: 4,
        originalname: 'data.csv',
      } as Express.Multer.File;

      await expect(
        controller.analyzeCSV(req, file, {
          institutionName: '',
          institutionType: 'cooperativa',
          framework: 'cossec',
          period: 'Q1-2026',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAnalysis', () => {
    it('should retrieve a stored analysis by id', async () => {
      const mockAnalysis = { id: 'abc', score: 90 };
      apiV1Service.getAnalysis.mockResolvedValue(mockAnalysis);

      const req = { apiUser: { userId: 'u1' } };
      const result = await controller.getAnalysis(req, 'abc');
      expect(result).toEqual(mockAnalysis);
      expect(apiV1Service.getAnalysis).toHaveBeenCalledWith('u1', 'abc');
    });
  });

  // ── Coverage: file filter callback (line 206-210) ────────────
  describe('analyzeCSV — file validation', () => {
    it('should throw when all four required fields are missing', async () => {
      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const file = {
        buffer: Buffer.from('data'),
        size: 4,
        originalname: 'data.csv',
      } as Express.Multer.File;
      await expect(
        controller.analyzeCSV(req, file, {
          institutionName: '',
          institutionType: '',
          framework: '',
          period: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('analyzeCSV — missing individual fields', () => {
    it('should throw when institutionType is empty', async () => {
      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const file = {
        buffer: Buffer.from('data'),
        size: 4,
        originalname: 'data.csv',
      } as Express.Multer.File;
      await expect(
        controller.analyzeCSV(req, file, {
          institutionName: 'Test',
          institutionType: '',
          framework: 'cossec',
          period: 'Q1-2026',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when framework is empty', async () => {
      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const file = {
        buffer: Buffer.from('data'),
        size: 4,
        originalname: 'data.csv',
      } as Express.Multer.File;
      await expect(
        controller.analyzeCSV(req, file, {
          institutionName: 'Test',
          institutionType: 'cooperativa',
          framework: '',
          period: 'Q1-2026',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when period is empty', async () => {
      const req = { apiUser: { userId: 'u1', email: 'test@test.com' } };
      const file = {
        buffer: Buffer.from('data'),
        size: 4,
        originalname: 'data.csv',
      } as Express.Multer.File;
      await expect(
        controller.analyzeCSV(req, file, {
          institutionName: 'Test',
          institutionType: 'cooperativa',
          framework: 'cossec',
          period: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
