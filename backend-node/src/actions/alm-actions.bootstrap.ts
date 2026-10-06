/**
 * AlmActionsBootstrap — registers the first wave of ALM actions in the
 * action registry on module init.
 *
 * The pattern: this provider implements `OnModuleInit` and depends on
 * the registry plus the ALM services it wraps. When NestJS finishes
 * constructing the AlmModule, this runs once and registers each action
 * with metadata + a thin handler that delegates to the underlying service.
 *
 * Why a separate bootstrap class instead of decorators on service methods:
 *   - Keeps the registration list inspectable in one file (the audit
 *     manifest of "what can users do via /actions").
 *   - Avoids decorator metadata reflection at runtime (which has CommonJS
 *     interop quirks in this NestJS 11 + nodenext setup).
 *   - Lets the metadata live next to the labels and permissions instead
 *     of being scattered across services.
 *
 * Adding a new action is two lines: a `register()` call here plus a
 * service method to delegate to. The frontend command palette picks it
 * up from `GET /api/actions` automatically.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActionRegistryService } from './action-registry.service';
import { InstitutionSeedService } from '../alm/institution-seed.service';
import { ReportPreflightService } from '../alm/reports/report-preflight.service';
import { StressTestingService } from '../alm/stress-testing/stress-testing.service';
import { ReportsService } from '../alm/reports/reports.service';
import { BoardReportService } from '../alm/board-report.service';

@Injectable()
export class AlmActionsBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AlmActionsBootstrap.name);

  constructor(
    private readonly registry: ActionRegistryService,
    private readonly institutionSeed: InstitutionSeedService,
    private readonly reportPreflight: ReportPreflightService,
    private readonly stressTesting: StressTestingService,
    private readonly reports: ReportsService,
    private readonly boardReport: BoardReportService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        id: 'institution.seed',
        label: {
          en: 'Seed institution from fixture',
          es: 'Sembrar institución desde fixture',
        },
        module: 'alm',
        description: {
          en: 'Idempotent: re-running with the same fixture upserts and reports the delta. Phase 1 contract.',
          es: 'Idempotente: reejecutar con el mismo fixture actualiza y reporta el delta. Contrato Fase 1.',
        },
        requiresConfirm: false,
        audit: true,
        estimatedDurationMs: 1500,
      },
      async (input) => {
        const workspaceId = String(input.workspaceId ?? '');
        const fixture = String(input.fixture ?? '');
        if (!workspaceId || !fixture) {
          return {
            success: false,
            error: 'workspaceId and fixture are required',
            durationMs: 0,
          };
        }
        const result = await this.institutionSeed.seedFromFixture(
          workspaceId,
          fixture,
        );
        return result;
      },
    );

    this.registry.register(
      {
        id: 'alm.preflight',
        label: {
          en: 'Run report preflight',
          es: 'Ejecutar verificación previa del informe',
        },
        module: 'alm',
        description: {
          en: 'Aggregates ALM summary, COSSEC compliance, and regulatory stress into one gap manifest. ready=true means no CRITICAL gaps.',
          es: 'Agrega resumen ALM, cumplimiento COSSEC y estrés regulatorio en un manifiesto de brechas. ready=true significa sin brechas CRÍTICAS.',
        },
        requiresConfirm: false,
        audit: true,
        estimatedDurationMs: 800,
      },
      async (input) => {
        const institutionId = String(input.institutionId ?? '');
        if (!institutionId) {
          return {
            success: false,
            error: 'institutionId is required',
            durationMs: 0,
          };
        }
        const preflight = await this.reportPreflight.check(institutionId);
        return {
          success: preflight.ready,
          data: preflight,
          durationMs: 0, // dispatcher will fill in
          criticalGapCount: preflight.criticalCount,
          warningGapCount: preflight.warningCount,
        };
      },
    );

    // ── Second-wave actions (Bible Vol2 §9 + SESSION_HANDOFF §2.3) ──

    this.registry.register(
      {
        id: 'alm.run-stress-test',
        label: {
          en: 'Run regulatory stress test',
          es: 'Ejecutar prueba de estrés regulatoria',
        },
        module: 'alm',
        description: {
          en: 'Runs COSSEC/Basel regulatory stress scenarios against the institution. Returns scenario results with overall rating.',
          es: 'Ejecuta escenarios de estrés regulatorio COSSEC/Basel contra la institución. Retorna resultados con calificación general.',
        },
        requiresConfirm: true,
        audit: true,
        estimatedDurationMs: 3000,
      },
      async (input) => {
        const institutionId = String(input.institutionId ?? '');
        if (!institutionId) {
          return {
            success: false,
            error: 'institutionId is required',
            durationMs: 0,
          };
        }
        const result =
          await this.stressTesting.runRegulatoryStress(institutionId);
        return {
          success: result.overallRating !== 'data_unavailable',
          data: result,
          durationMs: 0,
        };
      },
    );

    this.registry.register(
      {
        id: 'alm.generate-report',
        label: {
          en: 'Generate ALM report (PDF)',
          es: 'Generar informe ALM (PDF)',
        },
        module: 'alm',
        description: {
          en: 'Generates the full bilingual ALM report PDF. Requires balance sheet data to be uploaded. Returns the PDF buffer URL.',
          es: 'Genera el informe ALM bilingüe completo en PDF. Requiere datos de balance cargados. Retorna la URL del PDF.',
        },
        requiresConfirm: true,
        audit: true,
        estimatedDurationMs: 15000,
      },
      async (input) => {
        const institutionId = String(input.institutionId ?? '');
        const lang = String(input.lang ?? 'es');
        if (!institutionId) {
          return {
            success: false,
            error: 'institutionId is required',
            durationMs: 0,
          };
        }
        const { buffer, artifact } =
          await this.reports.generateAndRecordArtifact(institutionId, {
            language: lang,
            generatedBy: 'action:alm.generate-report',
          });
        return {
          success: Boolean(buffer),
          data: {
            generated: true,
            lang,
            sizeBytes: buffer?.length ?? 0,
            artifactId: artifact?.id,
            checksum: artifact?.contentChecksum,
          },
          durationMs: 0,
        };
      },
    );

    this.registry.register(
      {
        id: 'alm.export-board-package',
        label: {
          en: 'Export board package',
          es: 'Exportar paquete para junta',
        },
        module: 'alm',
        description: {
          en: 'Generates board-ready quarterly report with KPI summary, risk alerts, and regulatory pulse. All data nullable per D1 — no phantom numbers.',
          es: 'Genera informe trimestral para junta con resumen KPI, alertas de riesgo y pulso regulatorio. Todos los datos nulables según D1.',
        },
        requiresConfirm: false,
        audit: true,
        estimatedDurationMs: 5000,
      },
      async (input) => {
        const institutionId = String(input.institutionId ?? '');
        if (!institutionId) {
          return {
            success: false,
            error: 'institutionId is required',
            durationMs: 0,
          };
        }
        const boardData =
          await this.boardReport.generateBoardReportData(institutionId);
        return {
          success: true,
          data: boardData,
          durationMs: 0,
        };
      },
    );

    this.logger.log(
      `AlmActionsBootstrap: registered ${this.registry.list({ module: 'alm' }).length} ALM actions`,
    );
  }
}
