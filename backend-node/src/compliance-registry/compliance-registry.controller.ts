import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ComplianceRegistryService } from './compliance-registry.service';
import {
  ComplianceCategory,
  ModuleStatus,
  RegulatoryBody,
} from './compliance-registry.types';
import { AuthGuard } from '../auth/auth.guard';

@Controller('api/compliance-registry')
@UseGuards(AuthGuard)
export class ComplianceRegistryController {
  constructor(private readonly registry: ComplianceRegistryService) {}

  @Get()
  listAll(
    @Query('category') category?: ComplianceCategory,
    @Query('status') status?: ModuleStatus,
    @Query('regulator') regulator?: RegulatoryBody,
    @Query('q') search?: string,
  ) {
    if (search) return this.registry.search(search);
    if (category) return this.registry.filterByCategory(category);
    if (status) return this.registry.filterByStatus(status);
    if (regulator) return this.registry.filterByRegulator(regulator);
    return this.registry.listAll();
  }

  @Get('coverage')
  getCoverageReport() {
    return this.registry.getCoverageReport();
  }

  @Get('gaps')
  getGaps() {
    return this.registry.getGaps();
  }

  @Get('dependencies')
  getDependencyGraph() {
    return this.registry.getDependencyGraph();
  }

  @Get('validated')
  getValidated() {
    return this.registry.getValidated();
  }

  @Get(':moduleId')
  getById(@Param('moduleId') moduleId: string) {
    const mod = this.registry.getById(moduleId);
    if (!mod) {
      return { error: 'MODULE_NOT_FOUND', moduleId };
    }
    return mod;
  }

  @Get(':moduleId/thresholds')
  getThresholds(@Param('moduleId') moduleId: string) {
    const thresholds = this.registry.getThresholds(moduleId);
    if (!thresholds) {
      return { error: 'MODULE_NOT_FOUND', moduleId };
    }
    return thresholds;
  }
}
