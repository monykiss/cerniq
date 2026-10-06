import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { StorageService } from './storage.service';
import { AuthGuard } from '../auth/auth.guard';

interface GenerateUploadUrlDto {
  filename: string;
  contentType: string;
}

@Controller('api/storage')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload-url')
  async generateUploadUrl(
    @Body() dto: GenerateUploadUrlDto,
    @Request() req: any,
  ) {
    // Get organization ID from request context
    // For now using a placeholder - replace with real org context
    const organizationId = req.headers['x-organization-id'] || 'default-org';

    return this.storageService.generateUploadUrl(
      organizationId,
      dto.filename,
      dto.contentType,
    );
  }

  @Get('download-url/:fileKey')
  async generateDownloadUrl(@Param('fileKey') fileKey: string) {
    return {
      downloadUrl: await this.storageService.generateDownloadUrl(fileKey),
    };
  }

  @Delete('file/:fileKey')
  async deleteFile(@Param('fileKey') fileKey: string) {
    await this.storageService.deleteFile(fileKey);
    return { message: 'File deleted successfully' };
  }
}
