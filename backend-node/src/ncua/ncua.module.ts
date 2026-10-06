import { Module } from '@nestjs/common';
import { NcuaController } from './ncua.controller';
import { NcuaApiService } from './ncua-api.service';
import { NcuaFieldMapperService } from './ncua-field-mapper.service';
import { NcuaImportService } from './ncua-import.service';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

/**
 * NCUA Integration Module — W3-3
 *
 * Provides NCUA Form 5300 (Call Report) data integration:
 * - API client for fetching credit union data and quarterly call reports
 * - Field mapper translating 900+ NCUA ACCT codes to CERNIQ schema
 * - Import orchestrator for creating institutions from NCUA data
 *
 * PrismaModule is @Global so it does not need an explicit import.
 * AuthModule is @Global so AuthTenantGuard resolves without explicit import.
 * InstitutionScopeGuard provided locally because AgentApiModule isn't @Global —
 * mirrors AlmModule/ExamPrepModule pattern.
 */
@Module({
  controllers: [NcuaController],
  providers: [
    NcuaApiService,
    NcuaFieldMapperService,
    NcuaImportService,
    InstitutionScopeGuard,
  ],
  exports: [NcuaImportService],
})
export class NcuaModule {}
