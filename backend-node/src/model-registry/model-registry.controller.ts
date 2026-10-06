/**
 * ModelRegistryController — REST API for model governance.
 *
 * Routes:
 *   GET    /api/model-registry              — list (filterable by category/status/riskTier)
 *   GET    /api/model-registry/summary      — dashboard counts
 *   GET    /api/model-registry/:id          — single model with artifacts
 *   GET    /api/model-registry/key/:key     — lookup by modelKey
 *   POST   /api/model-registry/:id/approve  — approve for production
 *   POST   /api/model-registry/:id/retire   — retire from production
 *   POST   /api/model-registry/:id/review   — submit DRAFT for validation review
 *   POST   /api/model-registry/:id/artifact — attach validation artifact
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModelRegistryService } from './model-registry.service';
import type {
  ModelCategory,
  ModelStatus,
  ModelRiskTier,
} from './model-registry.types';

@Controller('api/model-registry')
@UseGuards(AuthGuard)
export class ModelRegistryController {
  constructor(private readonly registry: ModelRegistryService) {}

  @Get()
  list(
    @Query('category') category?: ModelCategory,
    @Query('status') status?: ModelStatus,
    @Query('riskTier') riskTier?: ModelRiskTier,
  ) {
    return this.registry.list({ category, status, riskTier });
  }

  @Get('summary')
  getSummary() {
    return this.registry.getSummary();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.registry.getById(id);
  }

  @Get('key/:key')
  getByKey(@Param('key') key: string) {
    return this.registry.getByKey(key);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @Body() body: { approvedBy: string }) {
    return this.registry.approve(id, { approvedBy: body.approvedBy });
  }

  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  retire(
    @Param('id') id: string,
    @Body() body: { retiredBy: string; reason: string },
  ) {
    return this.registry.retire(id, {
      retiredBy: body.retiredBy,
      reason: body.reason,
    });
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  submitForReview(@Param('id') id: string) {
    return this.registry.submitForReview(id);
  }

  @Post(':id/artifact')
  @HttpCode(HttpStatus.CREATED)
  addArtifact(
    @Param('id') id: string,
    @Body()
    body: {
      artifactType: string;
      label: string;
      storageLocator: string;
      checksum?: string;
      producedBy: string;
      producedAt: string;
      validationMetadata?: Record<string, unknown>;
    },
  ) {
    return this.registry.addValidationArtifact(id, {
      ...body,
      producedAt: new Date(body.producedAt),
    });
  }
}
