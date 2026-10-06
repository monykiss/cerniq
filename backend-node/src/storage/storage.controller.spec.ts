import { Test, TestingModule } from '@nestjs/testing';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { AuthGuard } from '../auth/auth.guard';

describe('StorageController', () => {
  let controller: StorageController;
  let storageService: Record<string, jest.Mock>;

  beforeEach(async () => {
    storageService = {
      generateUploadUrl: jest.fn(),
      generateDownloadUrl: jest.fn(),
      deleteFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [{ provide: StorageService, useValue: storageService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StorageController>(StorageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('generateUploadUrl', () => {
    it('should generate upload URL with org from header', async () => {
      const mockResult = {
        url: 'https://s3.example.com/upload',
        key: 'file-key',
      };
      storageService.generateUploadUrl.mockResolvedValue(mockResult);

      const dto = { filename: 'report.pdf', contentType: 'application/pdf' };
      const req = { headers: { 'x-organization-id': 'org-1' } };

      const result = await controller.generateUploadUrl(dto, req);
      expect(result).toEqual(mockResult);
      expect(storageService.generateUploadUrl).toHaveBeenCalledWith(
        'org-1',
        'report.pdf',
        'application/pdf',
      );
    });

    it('should default to default-org when header not present', async () => {
      storageService.generateUploadUrl.mockResolvedValue({ url: 'url' });

      const dto = { filename: 'file.csv', contentType: 'text/csv' };
      const req = { headers: {} };

      await controller.generateUploadUrl(dto, req);
      expect(storageService.generateUploadUrl).toHaveBeenCalledWith(
        'default-org',
        'file.csv',
        'text/csv',
      );
    });
  });

  describe('generateDownloadUrl', () => {
    it('should generate download URL', async () => {
      storageService.generateDownloadUrl.mockResolvedValue(
        'https://s3.example.com/download',
      );

      const result = await controller.generateDownloadUrl('file-key');
      expect(result).toEqual({
        downloadUrl: 'https://s3.example.com/download',
      });
      expect(storageService.generateDownloadUrl).toHaveBeenCalledWith(
        'file-key',
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete a file and return success message', async () => {
      storageService.deleteFile.mockResolvedValue(undefined);

      const result = await controller.deleteFile('file-key');
      expect(result).toEqual({ message: 'File deleted successfully' });
      expect(storageService.deleteFile).toHaveBeenCalledWith('file-key');
    });

    it('should propagate service errors', async () => {
      storageService.deleteFile.mockRejectedValue(new Error('Not found'));

      await expect(controller.deleteFile('bad-key')).rejects.toThrow(
        'Not found',
      );
    });
  });
});
