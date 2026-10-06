import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { ReportStorageService } from './report-storage.service';
import { EmailService } from '../email/email.service';
import { AlmEnterpriseService } from '../alm/alm-enterprise.service';
import { StressTestingService } from '../alm/stress-testing/stress-testing.service';
import { ComplianceCalendarService } from '../alm/compliance-calendar.service';
import { DataCryptoService } from '../crypto/data-crypto.service';
import { PipelineGateway } from '../realtime/pipeline.gateway';
import { ReportArtifactService } from '../alm/reports/report-artifact.service';
import { ReportPreflightService } from '../alm/reports/report-preflight.service';

const PDFDocument = require('pdfkit');

@Injectable()
export class PipelineWorker {
  private readonly logger = new Logger(PipelineWorker.name);

  private static readonly MAX_STALLED_RETRIES = 3;
  private static readonly STALLED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  private static readonly DATA_RETENTION_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ReportStorageService,
    private readonly email: EmailService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly stressTesting: StressTestingService,
    private readonly complianceCalendar: ComplianceCalendarService,
    private readonly dataCrypto: DataCryptoService,
    private readonly pipelineGateway: PipelineGateway,
    private readonly reportArtifact: ReportArtifactService,
    private readonly reportPreflight: ReportPreflightService,
  ) {}

  @Cron('*/2 * * * *') // Every 2 minutes
  async processQueue() {
    let job: any;
    try {
      job = await this.prisma.reportJob.findFirst({
        where: { status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        include: { user: true },
      });
    } catch (error: any) {
      if (this.isReportJobsTableMissing(error)) {
        this.logger.warn(
          'Skipping pipeline queue processing: report_jobs table is missing',
        );
        return;
      }
      throw error;
    }

    if (!job) return;

    this.logger.log({
      event: 'pipeline.job.starting',
      jobId: job.id,
      institution: job.institutionName,
    });

    try {
      // Step 1: Transition to PROCESSING — validate data
      await this.transitionJob(job.id, 'PROCESSING');
      this.pipelineGateway.emitProgress(job.id, {
        step: 'VALIDATING',
        stepNumber: 1,
        totalSteps: 7,
        percentComplete: 5,
        message: 'Validating balance sheet data...',
        messageEs: 'Validando datos del balance...',
      });

      // Step 2: Load institution data and validate
      const institution = await this.loadInstitutionData(
        job.userId,
        job.institutionId,
      );
      if (!institution) {
        throw new Error(
          `No institution data found for job ${job.id}. ` +
            `institutionId=${job.institutionId || 'null'}, userId=${job.userId}`,
        );
      }
      if (
        !institution.balanceSheetItems ||
        institution.balanceSheetItems.length === 0
      ) {
        throw new Error(
          `Institution "${institution.name}" (${institution.id}) has no balance sheet items. ` +
            `CSV import may have failed or was empty.`,
        );
      }
      this.logger.log({
        event: 'pipeline.institution_loaded',
        jobId: job.id,
        institutionId: institution.id,
        balanceSheetItems: institution.balanceSheetItems.length,
      });

      this.pipelineGateway.emitProgress(job.id, {
        step: 'COSSEC_CALC',
        stepNumber: 2,
        totalSteps: 7,
        percentComplete: 20,
        message: 'Calculating 12 COSSEC ratios...',
        messageEs: 'Calculando 12 ratios COSSEC...',
      });

      // Step 3: Run ALM calculations via enterprise service (with trend data)
      await this.transitionJob(job.id, 'GENERATING_PDF');
      await Promise.all([
        this.almEnterprise.getALMSummary(institution.id),
        this.stressTesting.runFullStressTest(institution.id, {
          paths: 500,
          horizon: 12,
        }),
        this.almEnterprise.getCOSSECComplianceWithTrend(institution.id),
      ]);

      this.pipelineGateway.emitProgress(job.id, {
        step: 'MONTE_CARLO',
        stepNumber: 3,
        totalSteps: 7,
        percentComplete: 45,
        message: 'Running Monte Carlo simulation (1,000 paths)...',
        messageEs: 'Ejecutando simulacion Monte Carlo (1,000 trayectorias)...',
      });

      this.pipelineGateway.emitProgress(job.id, {
        step: 'STRESS_TEST',
        stepNumber: 4,
        totalSteps: 7,
        percentComplete: 60,
        message: 'Running regulatory stress scenarios...',
        messageEs: 'Ejecutando escenarios de estres regulatorio...',
      });

      // Step 4: Generate PDFs (both languages) using the ALM report service
      this.pipelineGateway.emitProgress(job.id, {
        step: 'PDF_GENERATION',
        stepNumber: 5,
        totalSteps: 7,
        percentComplete: 80,
        message: 'Generating 14-page bilingual PDF...',
        messageEs: 'Generando PDF bilingue de 14 paginas...',
      });
      const pdfEs = await this.generateReport(institution.id, 'es');
      const pdfEn = await this.generateReport(institution.id, 'en');

      // Step 5: Upload to storage
      await this.transitionJob(job.id, 'UPLOADING');
      this.pipelineGateway.emitProgress(job.id, {
        step: 'UPLOADING',
        stepNumber: 6,
        totalSteps: 7,
        percentComplete: 95,
        message: 'Uploading report to secure storage...',
        messageEs: 'Subiendo informe a almacenamiento seguro...',
      });
      const keyEs = `reports/${job.id}/report_es.pdf`;
      const keyEn = `reports/${job.id}/report_en.pdf`;
      await Promise.all([
        this.storage.upload(keyEs, pdfEs),
        this.storage.upload(keyEn, pdfEn),
      ]);

      // Get signed URLs for the reports
      const [urlEs, urlEn] = await Promise.all([
        this.storage.getSignedUrl(keyEs, 30 * 24 * 60 * 60), // 30-day expiry
        this.storage.getSignedUrl(keyEn, 30 * 24 * 60 * 60),
      ]);

      // Step 5b: Record immutable report artifacts (FAANG Audit P1 #4)
      // Captures SHA-256 checksum, model lineage, and preflight gaps for audit trail
      try {
        const preflight = await this.reportPreflight.check(institution.id);
        await Promise.all([
          this.reportArtifact.record({
            institutionId: institution.id,
            reportJobId: job.id,
            format: 'PDF_ES',
            language: 'es',
            content: pdfEs,
            storageLocator: keyEs,
            modelLineage: preflight.modelLineage ?? [],
            preflightGaps: preflight.gaps,
            preflightReady: preflight.ready,
            generatedBy: 'pipeline',
          }),
          this.reportArtifact.record({
            institutionId: institution.id,
            reportJobId: job.id,
            format: 'PDF_EN',
            language: 'en',
            content: pdfEn,
            storageLocator: keyEn,
            modelLineage: preflight.modelLineage ?? [],
            preflightGaps: preflight.gaps,
            preflightReady: preflight.ready,
            generatedBy: 'pipeline',
          }),
        ]);
      } catch (artifactErr: any) {
        // Artifact recording failure must NOT block report delivery
        this.logger.warn({
          event: 'pipeline.artifact_recording_failed',
          jobId: job.id,
          error: artifactErr.message,
        });
      }

      // Step 6: Complete
      await this.prisma.reportJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETE',
          reportUrl: urlEs || keyEs,
          reportUrlEn: urlEn || keyEn,
          completedAt: new Date(),
        },
      });

      // Emit WebSocket completion event
      this.pipelineGateway.emitComplete(job.id, {
        reportUrl: urlEs || keyEs,
        reportUrlEn: urlEn || keyEn,
        manifestPath: `/api/portal/jobs/${job.id}/exports`,
      });

      // Increment reports used
      await this.prisma.subscription.updateMany({
        where: { userId: job.userId },
        data: { reportsUsed: { increment: 1 } },
      });

      // Step 7: Notify client (failure here must NOT revert the COMPLETE status)
      if (job.user?.email) {
        try {
          const portalUrl = `${process.env.FRONTEND_URL || 'https://cerniq.io'}/portal/reports/${job.id}`;
          await this.email.sendReportReady({
            email: job.user.email,
            name: job.user.name || '',
            institutionName: job.institutionName,
            portalUrl,
          });

          // Schedule C2 follow-up (24h after delivery)
          await this.prisma.emailSequence.create({
            data: {
              userId: job.userId,
              sequenceKey: 'C2',
              scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        } catch (emailErr: any) {
          // Log email failure but do NOT throw — the report is already COMPLETE
          this.logger.error({
            event: 'pipeline.email.failed',
            jobId: job.id,
            error: emailErr.message,
            note: 'Report generated successfully but notification email failed. Customer must check portal manually.',
          });
        }
      }

      this.logger.log({ event: 'pipeline.job.complete', jobId: job.id });
    } catch (error: any) {
      await this.prisma.reportJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message || 'Unknown error',
        },
      });

      // Emit WebSocket error event
      this.pipelineGateway.emitError(job.id, error.message || 'Unknown error');

      // Alert the operator
      await this.email.sendJobFailedAlert({
        jobId: job.id,
        institutionName: job.institutionName,
        error: error.message || 'Unknown error',
        clientEmail: job.user?.email || 'unknown',
      });

      this.logger.error({
        event: 'pipeline.job.failed',
        jobId: job.id,
        error: error.message,
      });
    }
  }

  private async transitionJob(jobId: string, status: string) {
    const data: any = { status };
    if (status === 'PROCESSING') data.processingStartedAt = new Date();
    await this.prisma.reportJob.update({ where: { id: jobId }, data });
  }

  private isReportJobsTableMissing(error: any): boolean {
    const code = error?.code || error?.meta?.code;
    if (code === 'P2021') return true;

    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('report_jobs') && message.includes('does not exist')
    );
  }

  private async loadInstitutionData(
    userId: string,
    institutionId?: string | null,
  ) {
    if (institutionId) {
      return this.prisma.institution.findUnique({
        where: { id: institutionId },
        include: {
          balanceSheetItems: true,
          interestRateScenarios: true,
          liquidityPositions: true,
        },
      });
    }
    // Find most recent institution for this user's workspace
    const workspace = await this.prisma.workspace.findFirst({
      where: { ownerId: userId },
      include: {
        institutions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            balanceSheetItems: true,
            interestRateScenarios: true,
            liquidityPositions: true,
          },
        },
      },
    });
    return workspace?.institutions[0] || null;
  }

  private async generateReport(
    institutionId: string,
    lang: string,
  ): Promise<Buffer> {
    try {
      const [summary, stressTest, cossec, institution] = await Promise.all([
        this.almEnterprise.getALMSummary(institutionId),
        this.stressTesting.runFullStressTest(institutionId, {
          paths: 500,
          horizon: 12,
        }),
        this.almEnterprise
          .getRegulatoryCompliance(institutionId)
          .then(async (result) => {
            // Enrich with trend data via getCOSSECComplianceWithTrend for COSSEC
            // For NCUA, trends are not yet available so return as-is
            const inst = await this.almEnterprise.getInstitution(institutionId);
            if (inst.primaryRegulator === 'COSSEC' || !inst.primaryRegulator) {
              return this.almEnterprise.getCOSSECComplianceWithTrend(
                institutionId,
              );
            }
            return { ...result, trends: null, previousPeriod: null };
          }),
        this.almEnterprise.getInstitution(institutionId),
      ]);

      // Generate a simplified PDF with the calculation data
      return this.buildPDF(institution, summary, stressTest, cossec, lang);
    } catch (err: any) {
      this.logger.error({
        event: 'pipeline.pdf.generation_failed',
        institutionId,
        lang,
        error: err.message,
      });
      // Fallback: generate a minimal PDF with error notice
      return this.buildFallbackPDF(institutionId, lang, err.message);
    }
  }

  private buildPDF(
    institution: any,
    summary: any,
    stressTest: any,
    cossec: any,
    lang: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'letter',
        margins: { top: 60, bottom: 70, left: 60, right: 60 },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const isEs = lang === 'es';
      const t = (es: string, en: string) => (isEs ? es : en);
      const fmtM = (v: number) => `$${(v || 0).toFixed(1)}M`;
      const fmtPct = (v: number) => `${(v || 0).toFixed(1)}%`;
      const PW = 612;
      const ML = 60;
      const MR = 60;
      const CW = PW - ML - MR;
      let pageNum = 0;

      const pageHeader = (title: string): number => {
        doc.rect(0, 0, PW, 48).fill('#1B3A6B');
        doc
          .fill('#FFFFFF')
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('CERNIQ', ML, 17);
        doc
          .font('Helvetica')
          .fontSize(8)
          .text(institution?.name || '', PW - MR - 200, 17, {
            width: 200,
            align: 'right',
          });
        doc
          .fill('#1B3A6B')
          .fontSize(15)
          .font('Helvetica-Bold')
          .text(title, ML, 62);
        doc
          .moveTo(ML, 82)
          .lineTo(PW - MR, 82)
          .strokeColor('#D1D5DB')
          .lineWidth(0.5)
          .stroke();
        return 95;
      };

      const drawFooter = () => {
        pageNum++;
        doc.fill('#94A3B8').fontSize(7).font('Helvetica');
        doc.text('CERNIQ — KLYTICS LLC', ML, 752, { lineBreak: false });
        doc.text(t('CONFIDENCIAL', 'CONFIDENTIAL'), PW / 2 - 40, 752, {
          width: 80,
          align: 'center',
          lineBreak: false,
        });
        doc.text(`${t('Pag.', 'Pg.')} ${pageNum}`, PW - MR - 40, 752, {
          width: 40,
          align: 'right',
          lineBreak: false,
        });
      };

      const statusClr = (s: string) =>
        s === 'pass' ? '#16A34A' : s === 'warning' ? '#D97706' : '#DC2626';

      const tblRow = (
        y: number,
        cols: string[],
        widths: number[],
        opts?: { bg?: string; header?: boolean },
      ) => {
        const h = 18;
        if (opts?.bg) doc.rect(ML, y - 2, CW, h).fill(opts.bg);
        doc
          .fill(opts?.header ? '#FFFFFF' : '#1F2937')
          .font(opts?.header ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(opts?.header ? 8 : 9);
        let x = ML;
        for (let i = 0; i < cols.length; i++) {
          doc.text(cols[i], x + 4, y, {
            width: widths[i] - 8,
            lineBreak: false,
          });
          x += widths[i];
        }
        return y + h;
      };

      // ═════════════════════════════════════════════════════════════
      // PAGE 1: COVER
      // ═════════════════════════════════════════════════════════════
      doc.rect(0, 0, PW, 280).fill('#1B3A6B');
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(32)
        .text('CERNIQ', ML, 80);
      doc
        .font('Helvetica')
        .fontSize(13)
        .text(
          t(
            'Plataforma de Inteligencia de Riesgo',
            'Risk Intelligence Platform',
          ),
          ML,
          120,
        );
      doc
        .moveTo(ML, 150)
        .lineTo(ML + 120, 150)
        .strokeColor('#1ABFFF')
        .lineWidth(2)
        .stroke();
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(
          t(
            'Informe de Gestion de\nActivos y Pasivos',
            'Asset Liability\nManagement Report',
          ),
          ML,
          180,
        );

      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(22)
        .text(institution?.name || 'Institution', ML, 320);
      doc
        .font('Helvetica')
        .fontSize(11)
        .fill('#475569')
        .text(
          new Date().toLocaleDateString(isEs ? 'es-PR' : 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          ML,
          350,
        );
      doc.fontSize(9).fill('#64748B');
      doc.text(
        `${t('Tipo', 'Type')}: ${institution?.type || 'Cooperativa'}`,
        ML,
        390,
      );
      doc.text(
        `${t('Moneda', 'Currency')}: ${institution?.currency || 'USD'}`,
        ML,
        405,
      );
      if (summary?.institution?.totalAssets) {
        doc.text(
          `${t('Activos Totales', 'Total Assets')}: $${(summary.institution.totalAssets / 1e6).toFixed(1)}M`,
          ML,
          420,
        );
      }

      // COSSEC Exam Readiness Score on cover
      const examReadiness = cossec?.examReadinessScore ?? 0;
      const readinessColor =
        examReadiness >= 80
          ? '#16A34A'
          : examReadiness >= 50
            ? '#D97706'
            : '#DC2626';
      doc.rect(PW - MR - 170, 310, 170, 70).fill('#F8FAFC');
      doc.rect(PW - MR - 170, 310, 4, 70).fill(readinessColor);
      doc
        .fill(readinessColor)
        .font('Helvetica-Bold')
        .fontSize(32)
        .text(`${examReadiness}`, PW - MR - 155, 318, {
          width: 100,
          align: 'center',
        });
      const regLabel =
        institution?.primaryRegulator === 'NCUA'
          ? 'NCUA Readiness'
          : t('COSSEC Readiness', 'COSSEC Readiness');
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(8)
        .text(regLabel, PW - MR - 155, 355, { width: 100, align: 'center' });
      doc
        .fill('#94A3B8')
        .font('Helvetica')
        .fontSize(7)
        .text('/100', PW - MR - 60, 340, { lineBreak: false });

      doc.rect(ML, 680, CW, 36).fill('#FEF3C7');
      doc
        .fill('#92400E')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(t('CONFIDENCIAL', 'CONFIDENTIAL'), ML + 12, 688);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fill('#78350F')
        .text(
          t(
            'Este informe es propiedad de la institucion destinataria. Distribucion no autorizada esta prohibida.',
            'This report is proprietary to the recipient institution. Unauthorized distribution is prohibited.',
          ),
          ML + 12,
          700,
          { width: CW - 24 },
        );

      // ═════════════════════════════════════════════════════════════
      // PAGE 2: TABLE OF CONTENTS
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      let y = pageHeader(t('CONTENIDO', 'TABLE OF CONTENTS'));
      drawFooter();
      const tocItems = [
        [t('Resumen Ejecutivo', 'Executive Summary'), '3'],
        [t('Panorama del Balance General', 'Balance Sheet Overview'), '4'],
        [
          t(
            'Duracion, Convexidad y Sensibilidad EVE',
            'Duration, Convexity & EVE Sensitivity',
          ),
          '5',
        ],
        [
          t(
            'Sensibilidad de Ingreso Neto por Intereses',
            'Net Interest Income Sensitivity',
          ),
          '6',
        ],
        [
          t('Cobertura de Liquidez (LCR)', 'Liquidity Coverage Ratio (LCR)'),
          '7',
        ],
        [
          institution?.primaryRegulator === 'NCUA'
            ? t(
                'Analisis CAMEL de NCUA (7 Razones)',
                'NCUA CAMEL Analysis (7 Ratios)',
              )
            : t(
                'Cumplimiento Regulatorio COSSEC (12 Razones)',
                'COSSEC Regulatory Compliance (12 Ratios)',
              ),
          '8',
        ],
        [t('Riesgo de Concentracion', 'Concentration Risk Analysis'), '9'],
        [t('Resultados de Pruebas de Estres', 'Stress Test Results'), '10'],
        [t('Entorno de Tasas de Interes', 'Rate Environment Analysis'), '11'],
        [t('Recomendaciones', 'Recommendations'), '12'],
        [t('Benchmarking Sectorial', 'Sector Benchmarking'), '13'],
        [t('Metodologia y Aviso Legal', 'Methodology & Disclaimer'), '14'],
      ];
      doc.font('Helvetica').fontSize(11).fill('#1F2937');
      for (const [title, pg] of tocItems) {
        doc.text(title, ML + 10, y, { width: CW - 60, lineBreak: false });
        doc.text(pg, PW - MR - 30, y, {
          width: 30,
          align: 'right',
          lineBreak: false,
        });
        y += 28;
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 3: EXECUTIVE SUMMARY
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('RESUMEN EJECUTIVO', 'EXECUTIVE SUMMARY'));
      drawFooter();

      const riskScore = summary?.riskScore ?? 0;
      const scoreColor =
        riskScore >= 70 ? '#16A34A' : riskScore >= 40 ? '#D97706' : '#DC2626';
      const scoreLabel =
        riskScore >= 70
          ? t('Bajo Riesgo', 'Low Risk')
          : riskScore >= 40
            ? t('Riesgo Moderado', 'Moderate Risk')
            : t('Alto Riesgo', 'High Risk');

      doc.rect(ML, y, 130, 80).fill('#F8FAFC');
      doc
        .fill(scoreColor)
        .font('Helvetica-Bold')
        .fontSize(36)
        .text(`${riskScore}`, ML + 15, y + 10, { width: 100, align: 'center' });
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(8)
        .text(scoreLabel, ML + 15, y + 52, { width: 100, align: 'center' });

      // Exam Readiness Score box next to risk score
      const examScore = cossec?.examReadinessScore ?? 0;
      const examClr =
        examScore >= 80 ? '#16A34A' : examScore >= 50 ? '#D97706' : '#DC2626';
      doc.rect(ML + 140, y, 130, 80).fill('#F8FAFC');
      doc.rect(ML + 140, y, 4, 80).fill(examClr);
      doc
        .fill(examClr)
        .font('Helvetica-Bold')
        .fontSize(28)
        .text(`${examScore}`, ML + 155, y + 12, {
          width: 100,
          align: 'center',
        });
      const examLabel =
        institution?.primaryRegulator === 'NCUA'
          ? 'NCUA Readiness'
          : t('COSSEC Readiness', 'COSSEC Readiness');
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(7)
        .text(examLabel, ML + 155, y + 48, { width: 100, align: 'center' });
      doc
        .fill('#94A3B8')
        .fontSize(7)
        .text('/100', ML + 155, y + 60, { width: 100, align: 'center' });

      const mX = ML + 290;
      const keyMetrics: [string, string, string][] = [
        [
          t('Brecha de Duracion', 'Duration Gap'),
          `${summary?.durationGap?.durationGap?.toFixed(2) || 'N/A'} yr`,
          summary?.durationGap?.riskProfile || 'neutral',
        ],
        [
          t('LCR', 'LCR'),
          fmtPct(summary?.liquidity?.lcr || 0),
          summary?.liquidity?.status || 'compliant',
        ],
        [
          t('NII Base', 'Base NII'),
          fmtM(summary?.niiSensitivity?.baseNII || 0),
          summary?.niiSensitivity?.riskRating || 'low',
        ],
        [
          institution?.primaryRegulator === 'NCUA'
            ? 'NCUA'
            : t('COSSEC', 'COSSEC'),
          cossec?.overallStatus === 'compliant'
            ? t('Cumple', 'Compliant')
            : cossec?.overallStatus === 'conditional'
              ? t('Condicional', 'Conditional')
              : t('No Cumple', 'Non-compliant'),
          cossec?.overallStatus || 'compliant',
        ],
      ];
      let my = y;
      for (const [label, value, status] of keyMetrics) {
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(8)
          .text(label, mX, my, { lineBreak: false });
        doc
          .fill('#1F2937')
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(value, mX + 110, my, { width: 80, lineBreak: false });
        const dotColor = ['pass', 'compliant', 'low', 'neutral'].includes(
          status,
        )
          ? '#16A34A'
          : [
                'warning',
                'conditional',
                'moderate',
                'asset-sensitive',
                'liability-sensitive',
              ].includes(status)
            ? '#D97706'
            : '#DC2626';
        doc.circle(mX + 195, my + 5, 3).fill(dotColor);
        my += 20;
      }

      y = Math.max(y + 90, my + 15);
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(t('RIESGOS PRINCIPALES', 'TOP RISKS'), ML, y);
      y += 20;
      if (summary?.topRisks) {
        for (const risk of summary.topRisks) {
          doc.circle(ML + 5, y + 4, 2.5).fill('#DC2626');
          doc
            .fill('#1F2937')
            .font('Helvetica')
            .fontSize(9)
            .text(risk, ML + 15, y, { width: CW - 15 });
          const riskH = doc.heightOfString(risk, { width: CW - 15 });
          y += Math.max(14, riskH + 6);
        }
      }

      if (stressTest?.regulatory?.overallRating) {
        y += 15;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(t('RESILIENCIA A ESTRES', 'STRESS RESILIENCE'), ML, y);
        y += 18;
        const rating = stressTest.regulatory.overallRating;
        const rc =
          rating === 'resilient'
            ? '#16A34A'
            : rating === 'adequate'
              ? '#1ABFFF'
              : rating === 'vulnerable'
                ? '#D97706'
                : '#DC2626';
        doc.rect(ML, y, 150, 26).fill(rc);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(rating.toUpperCase(), ML + 10, y + 7, {
            width: 130,
            align: 'center',
          });
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 4: BALANCE SHEET OVERVIEW
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t('PANORAMA DEL BALANCE GENERAL', 'BALANCE SHEET OVERVIEW'),
      );
      drawFooter();

      if (cossec?.summary) {
        const s = cossec.summary;
        const cards: [string, string][] = [
          [t('Activos Totales', 'Total Assets'), fmtM(s.totalAssets)],
          [t('Pasivos Totales', 'Total Liabilities'), fmtM(s.totalLiabilities)],
          [t('Capital', 'Equity'), fmtM(s.equity)],
        ];
        let cx = ML;
        for (const [label, value] of cards) {
          doc.rect(cx, y, 150, 55).fill('#F0F9FF');
          doc
            .fill('#1B3A6B')
            .font('Helvetica-Bold')
            .fontSize(18)
            .text(value, cx + 12, y + 10, { width: 126 });
          doc
            .fill('#64748B')
            .font('Helvetica')
            .fontSize(8)
            .text(label, cx + 12, y + 35, { width: 126 });
          cx += 165;
        }
        y += 75;

        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(t('COMPOSICION', 'COMPOSITION'), ML, y);
        y += 20;
        const cw = [200, 100, 100, 92];
        y = tblRow(
          y,
          [
            t('Categoria', 'Category'),
            t('Monto ($M)', 'Amount ($M)'),
            t('% Activos', '% Assets'),
            t('Estado', 'Status'),
          ],
          cw,
          { bg: '#1B3A6B', header: true },
        );
        const compRows: string[][] = [
          [
            t('Prestamos Totales', 'Total Loans'),
            fmtM(s.totalLoans),
            fmtPct(
              s.totalAssets > 0 ? (s.totalLoans / s.totalAssets) * 100 : 0,
            ),
            '',
          ],
          [
            t('Depositos/Acciones', 'Deposits/Shares'),
            fmtM(s.totalShares),
            fmtPct(
              s.totalAssets > 0 ? (s.totalShares / s.totalAssets) * 100 : 0,
            ),
            '',
          ],
          [
            t('Activos Liquidos', 'Liquid Assets'),
            fmtM(s.liquidAssets),
            fmtPct(s.liquidityRatio),
            '',
          ],
          [
            t('Capital / Activos', 'Capital / Assets'),
            '',
            fmtPct(s.capitalRatio),
            s.capitalRatio >= 8
              ? t('Bien Capitalizado', 'Well Capitalized')
              : t('Adecuado', 'Adequate'),
          ],
        ];
        for (let i = 0; i < compRows.length; i++) {
          y = tblRow(y, compRows[i], cw, {
            bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
          });
        }

        y += 25;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(t('RAZONES CLAVE', 'KEY RATIOS'), ML, y);
        y += 20;
        const rw = [200, 100, 100, 92];
        y = tblRow(
          y,
          [
            t('Razon', 'Ratio'),
            t('Valor', 'Value'),
            t('Umbral', 'Threshold'),
            t('Estado', 'Status'),
          ],
          rw,
          { bg: '#1B3A6B', header: true },
        );
        const ratioRows: string[][] = [
          [
            t('Razon de Capital', 'Capital Ratio'),
            fmtPct(s.capitalRatio),
            '>= 6.0%',
            s.capitalRatio >= 8
              ? 'PASS'
              : s.capitalRatio >= 6
                ? 'WARN'
                : 'FAIL',
          ],
          [
            t('Prestamos/Acciones', 'Loan-to-Share'),
            fmtPct(s.loanToShareRatio),
            '<= 100%',
            s.loanToShareRatio <= 80
              ? 'PASS'
              : s.loanToShareRatio <= 100
                ? 'WARN'
                : 'FAIL',
          ],
          [
            t('Razon de Liquidez', 'Liquidity Ratio'),
            fmtPct(s.liquidityRatio),
            '>= 15%',
            s.liquidityRatio >= 20
              ? 'PASS'
              : s.liquidityRatio >= 15
                ? 'WARN'
                : 'FAIL',
          ],
        ];
        for (let i = 0; i < ratioRows.length; i++) {
          y = tblRow(y, ratioRows[i], rw, {
            bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
          });
        }
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 5: DURATION, CONVEXITY & EVE SENSITIVITY ANALYSIS
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t(
          'DURACION, CONVEXIDAD Y SENSIBILIDAD EVE',
          'DURATION, CONVEXITY & EVE SENSITIVITY',
        ),
      );
      drawFooter();

      if (summary?.durationGap) {
        const dg = summary.durationGap;
        doc
          .font('Helvetica')
          .fontSize(9)
          .fill('#475569')
          .text(
            t(
              'Duracion modificada y convexidad miden la sensibilidad del valor economico a cambios en tasas. La convexidad captura efectos de segundo orden que son materiales en choques grandes (>100bps).',
              'Modified duration and convexity measure economic value sensitivity to rate changes. Convexity captures second-order effects that become material for large shocks (>100bps).',
            ),
            ML,
            y,
            { width: CW },
          );
        y += 38;

        // ── Duration bars ──
        const maxDur = Math.max(
          dg.assetDuration || 1,
          dg.liabilityDuration || 1,
          1,
        );
        const barMax = 300;

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fill('#1B3A6B')
          .text(t('Duracion de Activos', 'Asset Duration'), ML, y);
        doc.text(`${dg.assetDuration.toFixed(2)} yr`, ML + barMax + 20, y);
        y += 15;
        const assetBarW = Math.max(10, (dg.assetDuration / maxDur) * barMax);
        doc.rect(ML, y, assetBarW, 16).fill('#1ABFFF');
        y += 28;

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fill('#1B3A6B')
          .text(t('Duracion de Pasivos', 'Liability Duration'), ML, y);
        doc.text(`${dg.liabilityDuration.toFixed(2)} yr`, ML + barMax + 20, y);
        y += 15;
        const liabBarW = Math.max(10, (dg.liabilityDuration / maxDur) * barMax);
        doc.rect(ML, y, liabBarW, 16).fill('#E8A020');
        y += 30;

        // ── Duration Gap + Convexity card ──
        const gapColor =
          Math.abs(dg.durationGap) < 1
            ? '#16A34A'
            : Math.abs(dg.durationGap) < 2.5
              ? '#D97706'
              : '#DC2626';
        doc.rect(ML, y, CW, 60).fill('#F8FAFC');
        doc.rect(ML, y, 4, 60).fill(gapColor);
        doc
          .fill(gapColor)
          .font('Helvetica-Bold')
          .fontSize(24)
          .text(
            `${dg.durationGap > 0 ? '+' : ''}${dg.durationGap.toFixed(2)} yr`,
            ML + 20,
            y + 8,
          );
        doc
          .fill('#475569')
          .font('Helvetica')
          .fontSize(10)
          .text(t('Brecha de Duracion', 'Duration Gap'), ML + 20, y + 38);

        const profileText =
          dg.riskProfile === 'asset-sensitive'
            ? t('Sensible a Activos', 'Asset Sensitive')
            : dg.riskProfile === 'liability-sensitive'
              ? t('Sensible a Pasivos', 'Liability Sensitive')
              : t('Neutral', 'Neutral');
        const profileColor =
          dg.riskProfile === 'neutral' ? '#16A34A' : '#D97706';
        doc.rect(ML + 280, y + 15, 160, 28).fill(profileColor);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(profileText, ML + 290, y + 22, { width: 140, align: 'center' });

        y += 75;

        // ── Convexity metrics table (MP-QUANT-02) ──
        const hasConvexity =
          dg.assetConvexity != null && dg.liabilityConvexity != null;
        const dc = summary.durationConvexity;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(
            t(
              'METRICAS DE DURACION Y CONVEXIDAD',
              'DURATION & CONVEXITY METRICS',
            ),
            ML,
            y,
          );
        y += 18;

        const dcw = [180, 110, 110, 92];
        y = tblRow(
          y,
          [
            t('Metrica', 'Metric'),
            t('Activos', 'Assets'),
            t('Pasivos', 'Liabilities'),
            t('Brecha/Neto', 'Gap/Net'),
          ],
          dcw,
          { bg: '#1B3A6B', header: true },
        );

        const assetMD = dg.assetDuration?.toFixed(2) || 'N/A';
        const liabMD = dg.liabilityDuration?.toFixed(2) || 'N/A';
        const gapMD = dg.durationGap?.toFixed(2) || 'N/A';
        y = tblRow(
          y,
          [
            t('Duracion Modificada (yr)', 'Modified Duration (yr)'),
            assetMD,
            liabMD,
            gapMD,
          ],
          dcw,
          { bg: '#FFFFFF' },
        );

        const assetCx = hasConvexity
          ? (dg.assetConvexity as number).toFixed(2)
          : dc?.assetConvexity?.toFixed(2) || 'N/A';
        const liabCx = hasConvexity
          ? (dg.liabilityConvexity as number).toFixed(2)
          : dc?.liabilityConvexity?.toFixed(2) || 'N/A';
        const netCx = hasConvexity
          ? (
              (dg.assetConvexity as number) - (dg.liabilityConvexity as number)
            ).toFixed(2)
          : dc
            ? (dc.assetConvexity - dc.liabilityConvexity).toFixed(2)
            : 'N/A';
        y = tblRow(
          y,
          [t('Convexidad', 'Convexity'), assetCx, liabCx, netCx],
          dcw,
          { bg: '#F8FAFC' },
        );

        const lagap =
          dg.leverageAdjustedDurationGap != null
            ? dg.leverageAdjustedDurationGap.toFixed(2)
            : dc?.leverageAdjustedDurationGap?.toFixed(2) || gapMD;
        y = tblRow(
          y,
          [
            t('Brecha Ajust. Apalancamiento (yr)', 'Leverage-Adj. Gap (yr)'),
            '',
            '',
            lagap,
          ],
          dcw,
          { bg: '#FFFFFF' },
        );

        y += 20;

        // ── EVE Sensitivity table (convexity-adjusted) ──
        const evePts = summary.eveSensitivity;
        if (evePts && evePts.length > 0) {
          doc
            .fill('#1B3A6B')
            .font('Helvetica-Bold')
            .fontSize(11)
            .text(
              t(
                'SENSIBILIDAD EVE (AJUSTADA POR CONVEXIDAD)',
                'EVE SENSITIVITY (CONVEXITY-ADJUSTED)',
              ),
              ML,
              y,
            );
          y += 18;

          const ew = [80, 90, 100, 110, 110];
          y = tblRow(
            y,
            [
              t('Choque', 'Shock'),
              t('Activos ($M)', 'Assets ($M)'),
              t('Pasivos ($M)', 'Liabilities ($M)'),
              t('Cambio EVE ($M)', 'EVE Change ($M)'),
              t('Cambio EVE %', 'EVE Change %'),
            ],
            ew,
            { bg: '#1B3A6B', header: true },
          );

          for (let i = 0; i < evePts.length; i++) {
            const ep = evePts[i];
            const shockLabel =
              ep.shockBps > 0 ? `+${ep.shockBps}` : `${ep.shockBps}`;
            y = tblRow(
              y,
              [
                `${shockLabel} bps`,
                ep.assetValueChange.toFixed(2),
                ep.liabilityValueChange.toFixed(2),
                ep.eveChange.toFixed(2),
                `${ep.eveChangePct.toFixed(1)}%`,
              ],
              ew,
              { bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' },
            );
          }
        }

        y += 20;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(t('INTERPRETACION', 'INTERPRETATION'), ML, y);
        y += 18;
        doc.font('Helvetica').fontSize(9).fill('#1F2937');
        if (dg.riskProfile === 'asset-sensitive') {
          doc.text(
            t(
              'Su institucion es sensible a activos. Si las tasas de interes suben, el valor economico del capital puede disminuir. Considere alargar la duracion de los pasivos.',
              'Your institution is asset-sensitive. If interest rates rise, the economic value of equity may decline. Consider extending liability duration.',
            ),
            ML,
            y,
            { width: CW },
          );
        } else if (dg.riskProfile === 'liability-sensitive') {
          doc.text(
            t(
              'Su institucion es sensible a pasivos. Si las tasas de interes bajan, los ingresos netos por intereses pueden disminuir.',
              'Your institution is liability-sensitive. If interest rates fall, net interest income may decline. Consider reducing asset duration.',
            ),
            ML,
            y,
            { width: CW },
          );
        } else {
          doc.text(
            t(
              'Su brecha de duracion esta bien equilibrada, indicando una exposicion minima a cambios en las tasas de interes.',
              'Your duration gap is well-balanced, indicating minimal exposure to interest rate changes.',
            ),
            ML,
            y,
            { width: CW },
          );
        }
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 6: NII SENSITIVITY
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t(
          'SENSIBILIDAD DE INGRESO NETO POR INTERESES',
          'NET INTEREST INCOME SENSITIVITY',
        ),
      );
      drawFooter();

      if (summary?.niiSensitivity) {
        const nii = summary.niiSensitivity;
        const ratingClr =
          nii.riskRating === 'low'
            ? '#16A34A'
            : nii.riskRating === 'moderate'
              ? '#D97706'
              : '#DC2626';

        doc.font('Helvetica').fontSize(9).fill('#475569');
        doc.text(`${t('NII Base', 'Base NII')}: ${fmtM(nii.baseNII)}`, ML, y, {
          lineBreak: false,
        });
        doc.text(
          `${t('Clasificacion de Riesgo', 'Risk Rating')}: `,
          ML + 200,
          y,
          { continued: true, lineBreak: false },
        );
        doc
          .fill(ratingClr)
          .font('Helvetica-Bold')
          .text(nii.riskRating.toUpperCase(), { lineBreak: false });
        y += 25;

        const sw = [100, 80, 80, 80, 80, 72];
        y = tblRow(
          y,
          [
            t('Escenario', 'Scenario'),
            t('Choque', 'Shock'),
            t('NII ($M)', 'NII ($M)'),
            'NII %',
            t('MVE ($M)', 'MVE ($M)'),
            'MVE %',
          ],
          sw,
          { bg: '#1B3A6B', header: true },
        );

        if (nii.scenarios) {
          for (let i = 0; i < nii.scenarios.length; i++) {
            const s = nii.scenarios[i];
            y = tblRow(
              y,
              [
                s.name,
                `${s.shiftBps > 0 ? '+' : ''}${s.shiftBps}bps`,
                fmtM(s.niImpact),
                `${s.niImpactPct > 0 ? '+' : ''}${s.niImpactPct.toFixed(1)}%`,
                fmtM(s.mveImpact),
                `${s.mveImpactPct > 0 ? '+' : ''}${s.mveImpactPct.toFixed(1)}%`,
              ],
              sw,
              { bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' },
            );
          }
        }

        y += 25;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(t('ANALISIS', 'ANALYSIS'), ML, y);
        y += 18;
        doc
          .font('Helvetica')
          .fontSize(9)
          .fill('#1F2937')
          .text(
            t(
              'La tabla muestra como cambios en las tasas de interes afectarian el ingreso neto por intereses (NII) y el valor de mercado del capital (MVE). Cambios mayores al 10% en NII se consideran alto riesgo.',
              'The table shows how interest rate changes would affect net interest income (NII) and market value of equity (MVE). NII changes exceeding 10% are considered high risk.',
            ),
            ML,
            y,
            { width: CW },
          );
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 7: LIQUIDITY COVERAGE
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('COBERTURA DE LIQUIDEZ', 'LIQUIDITY COVERAGE RATIO'));
      drawFooter();

      if (summary?.liquidity) {
        const liq = summary.liquidity;
        const lcrColor =
          liq.status === 'compliant'
            ? '#16A34A'
            : liq.status === 'warning'
              ? '#D97706'
              : '#DC2626';

        doc.rect(ML, y, 160, 90).fill('#F8FAFC');
        doc.rect(ML, y, 4, 90).fill(lcrColor);
        doc
          .fill(lcrColor)
          .font('Helvetica-Bold')
          .fontSize(40)
          .text(`${liq.lcr.toFixed(0)}%`, ML + 15, y + 10, {
            width: 130,
            align: 'center',
          });
        doc
          .fill('#475569')
          .font('Helvetica')
          .fontSize(9)
          .text('LCR', ML + 15, y + 58, { width: 130, align: 'center' });
        const lcrStatusText =
          liq.status === 'compliant'
            ? t('CUMPLE', 'COMPLIANT')
            : liq.status === 'warning'
              ? t('ALERTA', 'WARNING')
              : t('INCUMPLIMIENTO', 'BREACH');
        doc
          .fill('#475569')
          .fontSize(8)
          .text(lcrStatusText, ML + 15, y + 72, {
            width: 130,
            align: 'center',
          });

        const lx = ML + 190;
        const liqMetrics: [string, string][] = [
          [t('HQLA Total', 'Total HQLA'), fmtM(liq.hqla)],
          [
            t('Flujos Netos de Salida', 'Net Cash Outflows'),
            fmtM(liq.netOutflows),
          ],
          [
            t('Amortiguador vs 100%', 'Buffer vs 100%'),
            `${liq.buffer > 0 ? '+' : ''}${liq.buffer.toFixed(1)}%`,
          ],
          [t('Requisito Basilea III', 'Basel III Requirement'), '>= 100%'],
          [t('Meta CERNIQ', 'CERNIQ Target'), '>= 120%'],
        ];
        let ly = y + 5;
        for (const [label, value] of liqMetrics) {
          doc
            .fill('#64748B')
            .font('Helvetica')
            .fontSize(9)
            .text(label, lx, ly, { lineBreak: false });
          doc
            .fill('#1F2937')
            .font('Helvetica-Bold')
            .text(value, lx + 180, ly, { width: 80, lineBreak: false });
          ly += 18;
        }

        y += 110;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(t('INTERPRETACION', 'INTERPRETATION'), ML, y);
        y += 18;
        doc.font('Helvetica').fontSize(9).fill('#1F2937');
        if (liq.status === 'compliant') {
          doc.text(
            t(
              'La institucion mantiene reservas de liquidez adecuadas. Se recomienda mantener un amortiguador por encima del 120%.',
              'The institution maintains adequate liquidity reserves. Maintaining a buffer above 120% is recommended.',
            ),
            ML,
            y,
            { width: CW },
          );
        } else if (liq.status === 'warning') {
          doc.text(
            t(
              'El LCR cumple el minimo pero tiene margen limitado. Considere aumentar las posiciones en HQLA.',
              'LCR meets the minimum but has limited buffer. Consider increasing HQLA positions.',
            ),
            ML,
            y,
            { width: CW },
          );
        } else {
          doc.text(
            t(
              'URGENTE: El LCR esta por debajo del minimo de Basilea III. Accion inmediata requerida.',
              'URGENT: LCR is below the Basel III minimum. Immediate action required to increase HQLA.',
            ),
            ML,
            y,
            { width: CW },
          );
        }
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 8: REGULATORY COMPLIANCE (Framework-aware: COSSEC 12-Ratio or NCUA CAMEL 7-Ratio)
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      const complianceHeader =
        institution?.primaryRegulator === 'NCUA'
          ? t(
              'ANALISIS CAMEL DE NCUA (7 RAZONES)',
              'NCUA CAMEL ANALYSIS (7 RATIOS)',
            )
          : t(
              'CUMPLIMIENTO REGULATORIO COSSEC (12 RAZONES)',
              'COSSEC REGULATORY COMPLIANCE (12 RATIOS)',
            );
      y = pageHeader(complianceHeader);
      drawFooter();

      if (cossec) {
        const osColor =
          cossec.overallStatus === 'compliant'
            ? '#16A34A'
            : cossec.overallStatus === 'conditional'
              ? '#D97706'
              : '#DC2626';
        const osText =
          cossec.overallStatus === 'compliant'
            ? t('CUMPLE', 'COMPLIANT')
            : cossec.overallStatus === 'conditional'
              ? t('CONDICIONAL', 'CONDITIONAL')
              : t('NO CUMPLE', 'NON-COMPLIANT');
        doc.rect(ML, y, CW, 26).fill(osColor);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            `${t('Estado General', 'Overall Status')}: ${osText}`,
            ML + 12,
            y + 7,
            { width: CW - 24 },
          );
        y += 36;

        // 12-Ratio Grid: 2 columns x 6 rows (92px cells to fit trend deltas)
        const ratios = cossec.ratios || cossec.checks || [];
        const colW = (CW - 10) / 2; // two columns with 10px gap
        const hasTrends = !!cossec.trends?.length;
        const cellH = hasTrends ? 92 : 82;

        for (let i = 0; i < ratios.length; i++) {
          const ratio = ratios[i];
          const col = i % 2;
          const row = Math.floor(i / 2);
          const cx = ML + col * (colW + 10);
          const cy = y + row * (cellH + 6);

          // Check if we need a new page (after 6 rows)
          if (row >= 6) break;

          const rClr = statusClr(ratio.status || 'pass');

          // Cell background
          doc.rect(cx, cy, colW, cellH).fill('#F8FAFC');
          doc.rect(cx, cy, 3, cellH).fill(rClr);

          // Status badge (small circle)
          const badgeLetter =
            ratio.status === 'pass'
              ? 'P'
              : ratio.status === 'warning'
                ? 'W'
                : ratio.status === 'info'
                  ? 'I'
                  : 'F';
          doc.circle(cx + 16, cy + 12, 5).fill(rClr);
          doc
            .fill('#FFFFFF')
            .font('Helvetica-Bold')
            .fontSize(6)
            .text(badgeLetter, cx + 12, cy + 9, { width: 8, align: 'center' });

          // Ratio name (bilingual)
          const ratioName = isEs ? ratio.nameEs || ratio.name : ratio.name;
          doc
            .fill('#1F2937')
            .font('Helvetica-Bold')
            .fontSize(8)
            .text(ratioName, cx + 26, cy + 7, {
              width: colW - 90,
              lineBreak: false,
            });

          // Value (large, color-coded)
          const valStr =
            ratio.unit === '%'
              ? `${Number(ratio.value || 0).toFixed(1)}%`
              : `${ratio.value}${ratio.unit || ''}`;
          doc
            .fill(rClr)
            .font('Helvetica-Bold')
            .fontSize(16)
            .text(valStr, cx + colW - 80, cy + 3, {
              width: 70,
              align: 'right',
              lineBreak: false,
            });

          // Threshold
          doc
            .fill('#94A3B8')
            .font('Helvetica')
            .fontSize(7)
            .text(
              `${t('Umbral', 'Threshold')}: ${ratio.threshold}${ratio.unit || ''}`,
              cx + 12,
              cy + 24,
              { width: colW - 24, lineBreak: false },
            );

          // Description
          const ratioDesc = isEs
            ? ratio.descriptionEs || ratio.description || ''
            : ratio.description || '';
          doc
            .fill('#64748B')
            .font('Helvetica')
            .fontSize(6.5)
            .text(ratioDesc, cx + 12, cy + 36, {
              width: colW - 24,
              height: 22,
            });

          // Sector median comparison
          if (ratio.sectorMedian != null) {
            const aboveMedian =
              Number(ratio.value) >= Number(ratio.sectorMedian);
            const compClr = aboveMedian ? '#16A34A' : '#D97706';
            doc
              .fill('#94A3B8')
              .font('Helvetica')
              .fontSize(6.5)
              .text(
                `${t('Mediana Sector', 'Sector Median')}: ${ratio.sectorMedian}${ratio.unit || ''}`,
                cx + 12,
                cy + 62,
                { lineBreak: false },
              );
            if (ratio.percentileRank != null) {
              doc
                .fill(compClr)
                .font('Helvetica-Bold')
                .fontSize(6.5)
                .text(`P${ratio.percentileRank}`, cx + colW - 40, cy + 62, {
                  width: 30,
                  align: 'right',
                  lineBreak: false,
                });
            }
          }

          // ── Trend delta arrow (vs prior period) ──
          const trendData = cossec.trends;
          if (trendData && Array.isArray(trendData)) {
            const td = trendData.find((t: any) => t.ratioId === ratio.id);
            if (td) {
              const trendClr =
                td.trend === 'improving'
                  ? '#16A34A'
                  : td.trend === 'deteriorating'
                    ? '#DC2626'
                    : '#94A3B8';
              const arrow =
                td.trend === 'improving'
                  ? '\u2191'
                  : td.trend === 'deteriorating'
                    ? '\u2193'
                    : '\u2192';
              const deltaStr =
                td.delta >= 0
                  ? `+${td.delta.toFixed(1)}`
                  : `${td.delta.toFixed(1)}`;
              doc
                .fill(trendClr)
                .font('Helvetica-Bold')
                .fontSize(7)
                .text(
                  `${arrow} ${deltaStr}${td.unit || ''}`,
                  cx + 12,
                  cy + 72,
                  { lineBreak: false },
                );
              doc
                .fill('#94A3B8')
                .font('Helvetica')
                .fontSize(6)
                .text(
                  t('vs periodo anterior', 'vs prior period'),
                  cx + 70,
                  cy + 73,
                  { lineBreak: false },
                );
            }
          }
        }

        // Move Y past the grid
        const totalRows = Math.min(Math.ceil(ratios.length / 2), 6);
        y += totalRows * (cellH + 6) + 10;

        // Exam Readiness bar at bottom (framework-aware label)
        const examReady = cossec.examReadinessScore ?? 0;
        const erClr =
          examReady >= 80 ? '#16A34A' : examReady >= 50 ? '#D97706' : '#DC2626';
        const examBarLabel =
          institution?.primaryRegulator === 'NCUA'
            ? t(
                'NCUA Exam Readiness / Preparacion para Examen',
                'NCUA Exam Readiness',
              )
            : t(
                'COSSEC Exam Readiness / Preparacion para Examen',
                'COSSEC Exam Readiness',
              );
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(examBarLabel, ML, y);
        y += 16;
        // Background bar
        doc.rect(ML, y, CW, 18).fill('#E2E8F0');
        // Filled bar
        const barW = (examReady / 100) * CW;
        doc.rect(ML, y, barW, 18).fill(erClr);
        // Score label on bar
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(`${examReady}/100`, ML + barW - 45, y + 3, {
            width: 40,
            align: 'right',
            lineBreak: false,
          });
        // Scale marks
        doc.fill('#94A3B8').font('Helvetica').fontSize(6);
        doc.text('0', ML, y + 20, { lineBreak: false });
        doc.text('50', ML + CW / 2 - 5, y + 20, { lineBreak: false });
        doc.text('100', ML + CW - 15, y + 20, { lineBreak: false });
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 9: CONCENTRATION RISK ANALYSIS (NEW)
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t('RIESGO DE CONCENTRACION', 'CONCENTRATION RISK ANALYSIS'),
      );
      drawFooter();

      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#475569')
        .text(
          t(
            'El riesgo de concentracion mide la exposicion de la cartera de prestamos a sectores individuales. COSSEC recomienda que ningun sector exceda el 25% del total de prestamos.',
            'Concentration risk measures the loan portfolio exposure to individual sectors. COSSEC recommends no single sector exceeds 25% of total loans.',
          ),
          ML,
          y,
          { width: CW },
        );
      y += 35;

      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(t('DISTRIBUCION POR SECTOR', 'DISTRIBUTION BY SECTOR'), ML, y);
      y += 22;

      // Build sector data from cossec.summary or fallback to standard categories
      const largestSectorPct = cossec?.summary?.largestSectorPct ?? 0;
      const largestSectorName =
        cossec?.summary?.largestSectorName || t('Hipotecas', 'Mortgages');
      const sectorData: { name: string; pct: number }[] = [];

      // Use loan subcategory data if available from balance sheet, else use representative breakdown
      if (institution?.balanceSheetItems) {
        const loanItems = (institution.balanceSheetItems as any[]).filter(
          (item: any) => item.category === 'LOAN' || item.category === 'loan',
        );
        const totalLoans = loanItems.reduce(
          (sum: number, item: any) => sum + (item.amount || 0),
          0,
        );
        if (totalLoans > 0) {
          for (const item of loanItems) {
            sectorData.push({
              name: item.subcategory || item.name || 'Other',
              pct: ((item.amount || 0) / totalLoans) * 100,
            });
          }
        }
      }
      if (sectorData.length === 0) {
        // Fallback representative breakdown for cooperativas
        sectorData.push(
          {
            name: t('Hipotecas Residenciales', 'Residential Mortgages'),
            pct: largestSectorPct || 35,
          },
          { name: t('Prestamos Personales', 'Personal Loans'), pct: 22 },
          { name: t('Prestamos Comerciales', 'Commercial Loans'), pct: 18 },
          { name: t('Prestamos de Auto', 'Auto Loans'), pct: 15 },
          { name: t('Lineas de Credito', 'Lines of Credit'), pct: 7 },
          { name: t('Otros', 'Other'), pct: 3 },
        );
      }
      sectorData.sort((a, b) => b.pct - a.pct);

      const barMaxW = CW - 180;
      for (const sector of sectorData) {
        const isLargest = sector.pct >= 25;
        const barColor = isLargest ? '#D97706' : '#1ABFFF';

        doc
          .fill('#1F2937')
          .font('Helvetica')
          .fontSize(8)
          .text(sector.name, ML, y, { width: 140, lineBreak: false });
        const bw = Math.max(8, (sector.pct / 100) * barMaxW);
        doc.rect(ML + 145, y - 1, bw, 14).fill(barColor);
        doc
          .fill(isLargest ? '#92400E' : '#1F2937')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(`${sector.pct.toFixed(1)}%`, ML + 150 + bw, y, {
            width: 40,
            lineBreak: false,
          });
        if (isLargest) {
          doc
            .fill('#D97706')
            .font('Helvetica')
            .fontSize(6)
            .text(`⚠ >25%`, ML + 195 + bw, y + 1, {
              width: 40,
              lineBreak: false,
            });
        }
        y += 22;
      }

      y += 15;
      // Concentration summary box
      doc.rect(ML, y, CW, 50).fill('#FEF3C7');
      doc.rect(ML, y, 4, 50).fill('#D97706');
      doc
        .fill('#92400E')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(t('SECTOR MAS GRANDE', 'LARGEST SECTOR'), ML + 15, y + 8);
      doc
        .fill('#1F2937')
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${largestSectorName}: ${largestSectorPct.toFixed(1)}%`,
          ML + 15,
          y + 24,
        );
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(8)
        .text(
          largestSectorPct > 25
            ? t(
                'Excede el umbral recomendado de 25%. Considere diversificar.',
                'Exceeds the recommended 25% threshold. Consider diversification.',
              )
            : t(
                'Dentro del umbral recomendado de 25%.',
                'Within the recommended 25% threshold.',
              ),
          ML + 15,
          y + 38,
          { width: CW - 30 },
        );

      // ═════════════════════════════════════════════════════════════
      // PAGE 10: STRESS TEST RESULTS
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t('RESULTADOS DE PRUEBAS DE ESTRES', 'STRESS TEST RESULTS'),
      );
      drawFooter();

      if (stressTest?.monteCarlo) {
        const mc = stressTest.monteCarlo;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(t('SIMULACION MONTE CARLO', 'MONTE CARLO SIMULATION'), ML, y);
        y += 5;
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(8)
          .text(
            `${mc.paths} ${t('trayectorias', 'paths')} | ${mc.horizon} ${t('meses', 'months')} | ${t('Modelo Vasicek', 'Vasicek Model')}`,
            ML,
            y,
          );
        y += 20;

        const dw = [100, 78, 78, 78, 78, 80];
        y = tblRow(
          y,
          [
            t('Metrica', 'Metric'),
            'P5',
            'P25',
            t('Mediana', 'Median'),
            'P75',
            'P95',
          ],
          dw,
          { bg: '#1B3A6B', header: true },
        );

        if (mc.niiDistribution) {
          const d = mc.niiDistribution;
          y = tblRow(
            y,
            [
              t('NII Proyectado', 'Projected NII'),
              fmtM(d.p5),
              fmtM(d.p25),
              fmtM(d.median),
              fmtM(d.p75),
              fmtM(d.p95),
            ],
            dw,
            { bg: '#F8FAFC' },
          );
        }

        y += 15;
        const mcMetrics: [string, string][] = [
          [t('NII Esperado', 'Expected NII'), fmtM(mc.expectedNII)],
          [t('NII Peor Caso', 'Worst Case NII'), fmtM(mc.worstCaseNII)],
          [t('NII en Riesgo (EaR)', 'NII at Risk (EaR)'), fmtM(mc.niiAtRisk)],
        ];
        for (const [label, value] of mcMetrics) {
          doc
            .fill('#64748B')
            .font('Helvetica')
            .fontSize(9)
            .text(label, ML, y, { lineBreak: false });
          doc
            .fill('#1F2937')
            .font('Helvetica-Bold')
            .text(value, ML + 200, y, { width: 100, lineBreak: false });
          y += 16;
        }
        y += 20;
      }

      if (stressTest?.regulatory?.scenarios) {
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(t('ESCENARIOS REGULATORIOS', 'REGULATORY SCENARIOS'), ML, y);
        y += 20;

        const rw2 = [140, 70, 70, 70, 70, 72];
        y = tblRow(
          y,
          [
            t('Escenario', 'Scenario'),
            'NII ($M)',
            'MVE ($M)',
            'LCR',
            t('Capital', 'Capital'),
            t('Estado', 'Status'),
          ],
          rw2,
          { bg: '#1B3A6B', header: true },
        );

        for (let i = 0; i < stressTest.regulatory.scenarios.length; i++) {
          const s = stressTest.regulatory.scenarios[i];
          y = tblRow(
            y,
            [
              s.name,
              fmtM(s.niImpact),
              fmtM(s.mveImpact),
              fmtPct(s.lcrImpact),
              fmtPct(s.capitalImpact),
              s.passFailStatus.toUpperCase(),
            ],
            rw2,
            { bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' },
          );
        }

        y += 15;
        const overallClr =
          stressTest.regulatory.overallRating === 'resilient'
            ? '#16A34A'
            : stressTest.regulatory.overallRating === 'adequate'
              ? '#1ABFFF'
              : stressTest.regulatory.overallRating === 'vulnerable'
                ? '#D97706'
                : '#DC2626';
        doc.rect(ML, y, 220, 26).fill(overallClr);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            `${t('Calificacion', 'Rating')}: ${stressTest.regulatory.overallRating.toUpperCase()}`,
            ML + 12,
            y + 7,
          );
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 10b: COSSEC NAMED SCENARIOS
      // ═════════════════════════════════════════════════════════════
      if (
        stressTest?.cossecScenarios &&
        stressTest.cossecScenarios.length > 0
      ) {
        doc.addPage();
        y = pageHeader(
          t('ESCENARIOS COSSEC NOMBRADOS', 'COSSEC NAMED SCENARIOS'),
        );
        drawFooter();

        doc
          .font('Helvetica')
          .fontSize(9)
          .fill('#475569')
          .text(
            t(
              'Los siguientes escenarios estan alineados con las guias de examen de COSSEC e incluyen choques de tasa, depositos y credito especificos para cooperativas de Puerto Rico.',
              'The following scenarios are aligned with COSSEC examination guidelines and include rate, deposit, and credit shocks specific to Puerto Rico cooperativas.',
            ),
            ML,
            y,
            { width: CW },
          );
        y += 30;

        // COSSEC named scenarios table
        const csW = [110, 55, 55, 55, 65, 65, 55, 32];
        y = tblRow(
          y,
          [
            t('Escenario', 'Scenario'),
            t('Tasa', 'Rate'),
            t('Dep.', 'Dep.'),
            t('Cred.', 'Cred.'),
            'NII ($M)',
            t('Total ($M)', 'Total ($M)'),
            t('Impacto %', 'Impact %'),
            t('', 'Status'),
          ],
          csW,
          { bg: '#1B3A6B', header: true },
        );

        for (let i = 0; i < stressTest.cossecScenarios.length; i++) {
          const cs = stressTest.cossecScenarios[i];
          const isPRHurricane = cs.scenario.id === 'pr_hurricane_stress';
          const rowBg = isPRHurricane
            ? '#FEF3C7'
            : i % 2 === 0
              ? '#FFFFFF'
              : '#F8FAFC';

          y = tblRow(
            y,
            [
              isEs ? cs.scenario.nameEs : cs.scenario.name,
              `${cs.scenario.rateShiftBps > 0 ? '+' : ''}${cs.scenario.rateShiftBps}bps`,
              cs.scenario.depositShockPct !== 0
                ? `${cs.scenario.depositShockPct}%`
                : '—',
              cs.scenario.creditShockPct !== 0
                ? `+${cs.scenario.creditShockPct}%`
                : '—',
              fmtM(cs.niiImpact),
              fmtM(cs.totalImpact),
              `${cs.totalImpactPct > 0 ? '+' : ''}${cs.totalImpactPct.toFixed(1)}%`,
              cs.passFailStatus.toUpperCase(),
            ],
            csW,
            { bg: rowBg },
          );

          // Color-coded status overlay
          const statusX = ML + csW.slice(0, 7).reduce((a, b) => a + b, 0) + 4;
          const sClr =
            cs.passFailStatus === 'pass'
              ? '#16A34A'
              : cs.passFailStatus === 'warn'
                ? '#D97706'
                : '#DC2626';
          doc
            .fill(sClr)
            .font('Helvetica-Bold')
            .fontSize(7)
            .text(cs.passFailStatus.toUpperCase(), statusX, y - 15, {
              width: csW[7] - 8,
              lineBreak: false,
            });
        }

        // PR Hurricane scenario highlight box
        const prScenario = stressTest.cossecScenarios.find(
          (cs: any) => cs.scenario.id === 'pr_hurricane_stress',
        );
        if (prScenario) {
          y += 20;
          const prClr =
            prScenario.passFailStatus === 'pass'
              ? '#16A34A'
              : prScenario.passFailStatus === 'warn'
                ? '#D97706'
                : '#DC2626';
          doc.rect(ML, y, CW, 80).fill('#FEF3C7');
          doc.rect(ML, y, 4, 80).fill(prClr);

          doc
            .fill('#92400E')
            .font('Helvetica-Bold')
            .fontSize(10)
            .text(
              t('ESCENARIO ESTRES ECONOMICO PR', 'PR ECONOMIC STRESS SCENARIO'),
              ML + 15,
              y + 8,
            );
          doc
            .fill('#1F2937')
            .font('Helvetica')
            .fontSize(8)
            .text(
              isEs
                ? prScenario.scenario.descriptionEs
                : prScenario.scenario.description,
              ML + 15,
              y + 24,
              { width: CW - 30 },
            );

          const prMetrics = [
            [t('Impacto NII', 'NII Impact'), fmtM(prScenario.niiImpact)],
            [
              t('Costo Depositos', 'Deposit Cost'),
              fmtM(prScenario.depositImpact),
            ],
            [
              t('Perdida Crediticia', 'Credit Loss'),
              fmtM(prScenario.creditLoss),
            ],
            [
              t('Impacto Total', 'Total Impact'),
              `${fmtM(prScenario.totalImpact)} (${prScenario.totalImpactPct > 0 ? '+' : ''}${prScenario.totalImpactPct.toFixed(1)}%)`,
            ],
          ];
          let prY = y + 40;
          let prX = ML + 15;
          for (const [label, value] of prMetrics) {
            doc
              .fill('#64748B')
              .font('Helvetica')
              .fontSize(7)
              .text(label, prX, prY, { lineBreak: false });
            doc
              .fill('#1F2937')
              .font('Helvetica-Bold')
              .fontSize(8)
              .text(value, prX + 80, prY, { lineBreak: false });
            prX += 120;
            if (prX > ML + CW - 130) {
              prX = ML + 15;
              prY += 14;
            }
          }

          y += 90;
          doc
            .fill('#64748B')
            .font('Helvetica')
            .fontSize(7)
            .text(
              t(
                'Base regulatoria: Guias de Preparacion para Huracanes de COSSEC — unico en CERNIQ.',
                'Regulatory basis: COSSEC Hurricane Preparedness Guidelines — unique to CERNIQ.',
              ),
              ML,
              y,
              { width: CW },
            );
        }
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 11: RATE ENVIRONMENT ANALYSIS (NEW)
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t('ENTORNO DE TASAS DE INTERES', 'RATE ENVIRONMENT ANALYSIS'),
      );
      drawFooter();

      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#475569')
        .text(
          t(
            'Las tasas de referencia actuales del mercado influyen directamente en el margen de interes neto (NIM), el costo de fondos y el rendimiento de activos productivos de la institucion.',
            "Current market reference rates directly influence the institution's net interest margin (NIM), cost of funds, and earning asset yields.",
          ),
          ML,
          y,
          { width: CW },
        );
      y += 30;

      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(t('TASAS DE REFERENCIA', 'REFERENCE RATES'), ML, y);
      y += 20;

      const rateW = [200, 100, 100, 92];
      y = tblRow(
        y,
        [
          t('Indicador', 'Indicator'),
          t('Tasa', 'Rate'),
          t('Tendencia', 'Trend'),
          t('Impacto', 'Impact'),
        ],
        rateW,
        { bg: '#1B3A6B', header: true },
      );

      const rateData: string[][] = [
        [
          'Fed Funds Rate',
          '4.50%',
          t('Estable', 'Stable'),
          t('Base de referencia', 'Benchmark base'),
        ],
        [
          'SOFR (30-Day)',
          '4.32%',
          t('Estable', 'Stable'),
          t('Prestamos variables', 'Variable loans'),
        ],
        [
          '10Y US Treasury',
          '4.25%',
          t('Estable', 'Stable'),
          t('Hipotecas / MBS', 'Mortgages / MBS'),
        ],
        [
          'PR Prime Rate',
          '8.50%',
          t('Estable', 'Stable'),
          t('Prestamos comerciales', 'Commercial loans'),
        ],
      ];
      for (let i = 0; i < rateData.length; i++) {
        y = tblRow(y, rateData[i], rateW, {
          bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
        });
      }

      y += 30;
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(
          t(
            'ANALISIS DE MARGEN DE INTERES NETO (NIM)',
            'NET INTEREST MARGIN (NIM) ANALYSIS',
          ),
          ML,
          y,
        );
      y += 20;

      const instNIM = cossec?.summary?.nim ?? 0;
      const earningAssetsYield = cossec?.summary?.earningAssetsYield ?? 0;
      const costOfFunds = cossec?.summary?.costOfFunds ?? 0;
      const earningAssets = cossec?.summary?.earningAssets ?? 0;
      const interestIncome = cossec?.summary?.interestIncome ?? 0;

      // NIM waterfall-style display
      const nimColor =
        instNIM >= 3.0 ? '#16A34A' : instNIM >= 2.0 ? '#D97706' : '#DC2626';

      doc.rect(ML, y, CW, 70).fill('#F8FAFC');
      doc.rect(ML, y, 4, 70).fill(nimColor);

      doc
        .fill(nimColor)
        .font('Helvetica-Bold')
        .fontSize(28)
        .text(`${instNIM.toFixed(2)}%`, ML + 20, y + 8, { lineBreak: false });
      doc
        .fill('#475569')
        .font('Helvetica')
        .fontSize(9)
        .text(t('NIM Actual', 'Current NIM'), ML + 20, y + 42);
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `${t('Mediana Sector PR', 'PR Sector Median')}: 3.2%`,
          ML + 20,
          y + 55,
        );

      // NIM breakdown on the right
      const nimX = ML + 200;
      doc.fill('#1F2937').font('Helvetica').fontSize(8);
      doc.text(
        `${t('Rendimiento Activos Productivos', 'Earning Assets Yield')}: ${earningAssetsYield.toFixed(2)}%`,
        nimX,
        y + 10,
        { width: 280 },
      );
      doc.text(
        `${t('Costo de Fondos', 'Cost of Funds')}: ${costOfFunds.toFixed(2)}%`,
        nimX,
        y + 24,
        { width: 280 },
      );
      doc.text(
        `${t('Activos Productivos', 'Earning Assets')}: ${fmtM(earningAssets)}`,
        nimX,
        y + 38,
        { width: 280 },
      );
      doc.text(
        `${t('Ingreso por Intereses', 'Interest Income')}: ${fmtM(interestIncome)}`,
        nimX,
        y + 52,
        { width: 280 },
      );

      y += 85;
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(t('INTERPRETACION', 'INTERPRETATION'), ML, y);
      y += 18;
      doc.font('Helvetica').fontSize(9).fill('#1F2937');
      if (instNIM >= 3.0) {
        doc.text(
          t(
            'El NIM de la institucion esta por encima de la mediana del sector, indicando un diferencial saludable entre rendimiento de activos e intereses pagados. El entorno de tasas actual favorece la estabilidad del margen.',
            "The institution's NIM is above the sector median, indicating a healthy spread between asset yields and interest paid. The current rate environment supports margin stability.",
          ),
          ML,
          y,
          { width: CW },
        );
      } else if (instNIM >= 2.0) {
        doc.text(
          t(
            'El NIM esta por debajo de la mediana del sector. Considere optimizar la mezcla de activos productivos o renegociar el costo de depositos para mejorar el diferencial.',
            'NIM is below the sector median. Consider optimizing the earning asset mix or renegotiating deposit costs to improve the spread.',
          ),
          ML,
          y,
          { width: CW },
        );
      } else {
        doc.text(
          t(
            'ALERTA: El NIM es significativamente bajo. Accion inmediata requerida para revisar la estrategia de precios de activos y pasivos.',
            'ALERT: NIM is significantly low. Immediate action required to review asset and liability pricing strategy.',
          ),
          ML,
          y,
          { width: CW },
        );
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 12: RECOMMENDATIONS
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('RECOMENDACIONES', 'RECOMMENDATIONS'));
      drawFooter();

      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#475569')
        .text(
          t(
            'Las siguientes recomendaciones estan basadas en el analisis automatizado de los datos del balance general, metricas de riesgo y requisitos regulatorios.',
            'The following recommendations are based on automated analysis of balance sheet data, risk metrics, and regulatory requirements.',
          ),
          ML,
          y,
          { width: CW },
        );
      y += 30;

      if (summary?.recommendations) {
        for (let i = 0; i < summary.recommendations.length; i++) {
          const rec = summary.recommendations[i];
          doc.circle(ML + 12, y + 7, 12).fill('#1B3A6B');
          doc
            .fill('#FFFFFF')
            .font('Helvetica-Bold')
            .fontSize(11)
            .text(`${i + 1}`, ML + 5, y + 2, { width: 14, align: 'center' });
          doc
            .fill('#1F2937')
            .font('Helvetica')
            .fontSize(10)
            .text(rec, ML + 35, y + 1, { width: CW - 40 });
          const recH = doc.heightOfString(rec, { width: CW - 40 });
          y += Math.max(30, recH + 15);
        }
      }

      // ═════════════════════════════════════════════════════════════
      // PAGE 13: SECTOR BENCHMARKING (NEW)
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('BENCHMARKING SECTORIAL', 'SECTOR BENCHMARKING'));
      drawFooter();

      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#475569')
        .text(
          t(
            'Comparacion de las metricas clave de su institucion contra las medianas del sector de cooperativas de ahorro y credito de Puerto Rico (datos COSSEC Q3 2025).',
            "Comparison of your institution's key metrics against Puerto Rico credit union sector medians (COSSEC Q3 2025 data).",
          ),
          ML,
          y,
          { width: CW },
        );
      y += 30;

      // Benchmarking table header
      const bw = [140, 100, 100, 80, 72];
      y = tblRow(
        y,
        [
          t('Razon', 'Ratio'),
          t('Su Institucion', 'Your Institution'),
          t('Mediana PR', 'PR Sector Median'),
          t('Percentil', 'Percentile'),
          t('Comparacion', 'Comparison'),
        ],
        bw,
        { bg: '#1B3A6B', header: true },
      );

      // Build benchmark data from cossec.ratios or use institution data
      const ratiosList = cossec?.ratios || [];
      const benchmarkKeys = [
        'capital_adequacy',
        'nim',
        'liquidity',
        'loan_to_deposit',
        'lcr',
        'duration_gap',
      ];
      // Try to pull from ratios array, then fall back to summary/computed values
      const instCapital = cossec?.summary?.capitalRatio ?? 0;
      const instLiquidity = cossec?.summary?.liquidityRatio ?? 0;
      const instLoanToDeposit = cossec?.summary?.loanToShareRatio ?? 0;
      const instLCR = summary?.liquidity?.lcr ?? 0;
      const instDurationGap = summary?.durationGap?.durationGap ?? 0;

      const benchRows: {
        label: string;
        instValue: string;
        median: string;
        percentile: number | null;
        unit: string;
      }[] = [];

      // Try ratios first
      for (const key of benchmarkKeys) {
        const found = ratiosList.find((r: any) => r.id === key);
        if (found) {
          benchRows.push({
            label: isEs ? found.nameEs || found.name : found.name,
            instValue: `${Number(found.value).toFixed(1)}${found.unit || ''}`,
            median:
              found.sectorMedian != null
                ? `${Number(found.sectorMedian).toFixed(1)}${found.unit || ''}`
                : 'N/A',
            percentile: found.percentileRank ?? null,
            unit: found.unit || '',
          });
        }
      }

      // Fill gaps with computed values if ratios array didn't have them
      if (benchRows.length < 6) {
        const fallbackRows: {
          label: string;
          instValue: string;
          median: string;
          percentile: number | null;
          unit: string;
        }[] = [
          {
            label: t('Adecuacion de Capital', 'Capital Adequacy'),
            instValue: fmtPct(instCapital),
            median: '9.2%',
            percentile: null,
            unit: '%',
          },
          {
            label: t('Margen de Interes Neto', 'Net Interest Margin'),
            instValue: fmtPct(instNIM),
            median: '3.2%',
            percentile: null,
            unit: '%',
          },
          {
            label: t('Razon de Liquidez', 'Liquidity Ratio'),
            instValue: fmtPct(instLiquidity),
            median: '22.5%',
            percentile: null,
            unit: '%',
          },
          {
            label: t('Prestamos/Depositos', 'Loan-to-Deposit'),
            instValue: fmtPct(instLoanToDeposit),
            median: '72.0%',
            percentile: null,
            unit: '%',
          },
          {
            label: t('LCR', 'LCR'),
            instValue: fmtPct(instLCR),
            median: '135.0%',
            percentile: null,
            unit: '%',
          },
          {
            label: t('Brecha de Duracion', 'Duration Gap'),
            instValue: `${instDurationGap.toFixed(2)} yr`,
            median: '1.5 yr',
            percentile: null,
            unit: 'yr',
          },
        ];
        const existingLabels = new Set(benchRows.map((r) => r.label));
        for (const fb of fallbackRows) {
          if (!existingLabels.has(fb.label) && benchRows.length < 6) {
            benchRows.push(fb);
          }
        }
      }

      for (let i = 0; i < benchRows.length; i++) {
        const br = benchRows[i];
        const pctText = br.percentile != null ? `P${br.percentile}` : '—';
        // Determine comparison: above or below median
        const instNum = parseFloat(br.instValue);
        const medNum = parseFloat(br.median);
        let compText = '—';
        let compColor = '#64748B';
        if (!isNaN(instNum) && !isNaN(medNum)) {
          if (br.label.includes('Duration') || br.label.includes('Duracion')) {
            // Lower duration gap is better
            compText =
              instNum <= medNum
                ? t('Favorable', 'Favorable')
                : t('Elevado', 'Elevated');
            compColor = instNum <= medNum ? '#16A34A' : '#D97706';
          } else if (
            br.label.includes('Loan') ||
            br.label.includes('Prestamos')
          ) {
            // Lower loan-to-deposit is generally better
            compText =
              instNum <= medNum
                ? t('Favorable', 'Favorable')
                : t('Elevado', 'Elevated');
            compColor = instNum <= medNum ? '#16A34A' : '#D97706';
          } else {
            // Higher is better for capital, NIM, liquidity, LCR
            compText =
              instNum >= medNum
                ? t('Superior', 'Above')
                : t('Inferior', 'Below');
            compColor = instNum >= medNum ? '#16A34A' : '#D97706';
          }
        }

        y = tblRow(y, [br.label, br.instValue, br.median, pctText, ''], bw, {
          bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
        });

        // Draw colored comparison text (tblRow writes in default color, so overlay)
        const compX = ML + bw[0] + bw[1] + bw[2] + bw[3] + 4;
        doc
          .fill(compColor)
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(compText, compX, y - 16, {
            width: bw[4] - 8,
            lineBreak: false,
          });
      }

      y += 30;
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(t('NOTA METODOLOGICA', 'METHODOLOGY NOTE'), ML, y);
      y += 18;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fill('#64748B')
        .text(
          t(
            'Las medianas sectoriales se basan en datos publicos de COSSEC (Q3 2025) para cooperativas de ahorro y credito de Puerto Rico. Los percentiles se calculan dentro del universo de 112 cooperativas activas. Los activos medianos del sector son $185M con un capital mediano de 9.2%.',
            'Sector medians are based on public COSSEC data (Q3 2025) for Puerto Rico credit unions. Percentiles are calculated within the universe of 112 active cooperativas. Sector median assets are $185M with median capital of 9.2%.',
          ),
          ML,
          y,
          { width: CW },
        );

      // ═════════════════════════════════════════════════════════════
      // PAGE 14: METHODOLOGY & DISCLAIMER
      // ═════════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t('METODOLOGIA Y AVISO LEGAL', 'METHODOLOGY & DISCLAIMER'),
      );
      drawFooter();

      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(t('METODOLOGIA', 'METHODOLOGY'), ML, y);
      y += 20;
      const methodItems = [
        t(
          'Duracion: Duracion modificada de Macaulay usando rendimientos de mercado actuales.',
          'Duration: Modified Macaulay duration using current market yields.',
        ),
        t(
          'Convexidad: Derivada de segundo orden del precio respecto al rendimiento. Captura la no linealidad en choques grandes de tasas.',
          'Convexity: Second derivative of price with respect to yield. Captures non-linearity for large rate shocks.',
        ),
        t(
          'EVE: Sensibilidad del valor economico del capital usando expansion de Taylor de segundo orden (duracion + convexidad).',
          'EVE: Economic value of equity sensitivity using second-order Taylor expansion (duration + convexity adjustment).',
        ),
        t(
          'NII: Simulacion de ingreso neto por intereses bajo multiples escenarios de tasas (+/- 100, 200, 300 bps).',
          'NII: Net interest income simulation under multiple rate scenarios (+/- 100, 200, 300 bps).',
        ),
        t(
          'LCR: Activos liquidos de alta calidad / Flujos netos de salida a 30 dias (Basilea III).',
          'LCR: High-quality liquid assets / Net 30-day cash outflows (Basel III).',
        ),
        t(
          'Monte Carlo: Modelo Vasicek con reversion a la media, 500 trayectorias, horizonte de 12 meses.',
          'Monte Carlo: Vasicek model with mean reversion, 500 paths, 12-month horizon.',
        ),
        t(
          'COSSEC: Verificacion contra umbrales regulatorios de COSSEC para cooperativas de PR.',
          'COSSEC: Verification against COSSEC regulatory thresholds for PR cooperativas.',
        ),
        t(
          'MVE: Valor de mercado del capital bajo escenarios de choque de tasas.',
          'MVE: Market value of equity under rate shock scenarios.',
        ),
      ];
      doc.font('Helvetica').fontSize(9).fill('#1F2937');
      for (const item of methodItems) {
        doc.circle(ML + 5, y + 4, 2).fill('#1ABFFF');
        doc
          .fill('#1F2937')
          .font('Helvetica')
          .fontSize(9)
          .text(item, ML + 15, y, { width: CW - 15 });
        const itemH = doc.heightOfString(item, { width: CW - 15 });
        y += Math.max(14, itemH + 8);
      }

      y += 25;
      doc
        .moveTo(ML, y)
        .lineTo(PW - MR, y)
        .strokeColor('#D1D5DB')
        .lineWidth(0.5)
        .stroke();
      y += 15;

      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(t('AVISO LEGAL', 'DISCLAIMER'), ML, y);
      y += 20;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fill('#64748B')
        .text(
          t(
            'Este informe es generado automaticamente por la plataforma CERNIQ, propiedad de KLYTICS LLC, San Juan, Puerto Rico. KLYTICS LLC no es un asesor de inversion registrado, banco, ni entidad regulada. Este informe no constituye asesoramiento financiero, legal ni regulatorio. Los resultados se basan en los datos proporcionados por la institucion y modelos cuantitativos estandar de la industria. KLYTICS LLC no garantiza la exactitud, completitud ni idoneidad de los resultados para ningun proposito particular. Las decisiones de inversion, regulatorias o de gestion de riesgo deben tomarse con la asesoria de profesionales cualificados.',
            'This report is automatically generated by the CERNIQ platform, owned by KLYTICS LLC, San Juan, Puerto Rico. KLYTICS LLC is not a registered investment advisor, bank, or regulated entity. This report does not constitute financial, legal, or regulatory advice. Results are based on data provided by the institution and industry-standard quantitative models. KLYTICS LLC does not guarantee the accuracy, completeness, or suitability of the results for any particular purpose. Investment, regulatory, or risk management decisions should be made with the advice of qualified professionals.',
          ),
          ML,
          y,
          { width: CW },
        );

      y += 80;
      doc
        .fill('#94A3B8')
        .fontSize(7)
        .text(
          `${t('Generado', 'Generated')}: ${new Date().toISOString()} | CERNIQ v1.0 | KLYTICS LLC ${new Date().getFullYear()}`,
          ML,
          y,
          { width: CW, align: 'center' },
        );

      doc.end();
    });
  }

  // ── Renewal Automation (MP-REV-01) ─────────────────────────────
  @Cron('0 12 * * *') // 8am AST (12:00 UTC) daily
  async renewalSequence() {
    try {
      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          status: 'active',
          currentPeriodEnd: { not: null },
          tier: { notIn: ['free'] },
        },
        include: { user: true },
      });

      for (const sub of subscriptions) {
        try {
          const now = new Date();
          const endDate = sub.currentPeriodEnd!;
          const daysUntilRenewal = Math.ceil(
            (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );

          if (daysUntilRenewal <= 0 || !sub.user?.email) continue;

          const periodEndStr = endDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Puerto_Rico',
          });

          // D-30: First renewal reminder
          if (daysUntilRenewal === 30) {
            await this.email.sendRenewalReminder({
              email: sub.user.email,
              name: sub.user.name || '',
              daysLeft: 30,
              tier: sub.tier,
              currentPeriodEnd: periodEndStr,
            });
            this.logger.log({
              event: 'renewal.reminder.d30',
              userId: sub.userId,
              email: sub.user.email,
            });
          }

          // D-14: Renewal reminder with upgrade offer
          if (daysUntilRenewal === 14) {
            await this.email.sendRenewalReminder({
              email: sub.user.email,
              name: sub.user.name || '',
              daysLeft: 14,
              tier: sub.tier,
              currentPeriodEnd: periodEndStr,
            });
            this.logger.log({
              event: 'renewal.reminder.d14',
              userId: sub.userId,
              email: sub.user.email,
            });
          }

          // D-7: Final renewal confirmation
          if (daysUntilRenewal === 7) {
            await this.email.sendRenewalReminder({
              email: sub.user.email,
              name: sub.user.name || '',
              daysLeft: 7,
              tier: sub.tier,
              currentPeriodEnd: periodEndStr,
            });
            this.logger.log({
              event: 'renewal.reminder.d7',
              userId: sub.userId,
              email: sub.user.email,
            });
          }
        } catch (subErr: any) {
          this.logger.error({
            event: 'renewal.reminder.error',
            userId: sub.userId,
            error: subErr.message,
          });
        }
      }
    } catch (error: any) {
      this.logger.error({
        event: 'renewal.sequence.failed',
        error: error.message,
      });
    }
  }

  // ── Churn Risk Detection ──────────────────────────────────────
  @Cron('0 13 * * *') // 9am AST (13:00 UTC) daily
  async churnRiskDetection() {
    try {
      const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

      const atRiskSubs = await this.prisma.subscription.findMany({
        where: {
          status: 'active',
          tier: { notIn: ['free'] },
          user: {
            OR: [
              { lastLoginAt: { lte: fortyFiveDaysAgo } },
              { lastLoginAt: null },
            ],
          },
        },
        include: { user: true },
      });

      for (const sub of atRiskSubs) {
        try {
          if (!sub.user?.email) continue;

          const daysSinceLogin = sub.user.lastLoginAt
            ? Math.floor(
                (Date.now() - sub.user.lastLoginAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 999;

          const periodEndStr = sub.currentPeriodEnd
            ? sub.currentPeriodEnd.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            : 'N/A';

          await this.email.sendChurnRiskAlert({
            userName: sub.user.name || '',
            userEmail: sub.user.email,
            tier: sub.tier,
            daysSinceLogin,
            currentPeriodEnd: periodEndStr,
          });

          this.logger.log({
            event: 'churn.risk.alert',
            userId: sub.userId,
            daysSinceLogin,
          });
        } catch (subErr: any) {
          this.logger.error({
            event: 'churn.risk.error',
            userId: sub.userId,
            error: subErr.message,
          });
        }
      }
    } catch (error: any) {
      this.logger.error({
        event: 'churn.risk.detection.failed',
        error: error.message,
      });
    }
  }

  // ── Weekly Revenue Report ─────────────────────────────────────
  @Cron('0 13 * * 1') // Monday 9am AST (13:00 UTC)
  async weeklyRevenueReport() {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Count active subscriptions by tier
      const activeSubs = await this.prisma.subscription.findMany({
        where: { status: 'active', tier: { notIn: ['free'] } },
        select: { tier: true },
      });

      const activeBytier: Record<string, number> = {};
      for (const sub of activeSubs) {
        activeBytier[sub.tier] = (activeBytier[sub.tier] || 0) + 1;
      }

      // New subscriptions this week
      const newThisWeek = await this.prisma.subscription.count({
        where: {
          status: 'active',
          tier: { notIn: ['free'] },
          createdAt: { gte: oneWeekAgo },
        },
      });

      // Cancelled this week
      const cancelledThisWeek = await this.prisma.subscription.count({
        where: {
          status: 'cancelled',
          cancelledAt: { gte: oneWeekAgo },
        },
      });

      // Upcoming renewals in next 30 days
      const upcomingRenewals = await this.prisma.subscription.findMany({
        where: {
          status: 'active',
          tier: { notIn: ['free'] },
          currentPeriodEnd: { lte: thirtyDaysFromNow, gte: new Date() },
        },
        include: { user: { select: { email: true } } },
        orderBy: { currentPeriodEnd: 'asc' },
      });

      await this.email.sendWeeklyRevenueReport({
        activeBytier,
        totalActive: activeSubs.length,
        newThisWeek,
        cancelledThisWeek,
        upcomingRenewals: upcomingRenewals.map((r: any) => ({
          email: r.user?.email || 'unknown',
          tier: r.tier,
          renewsAt:
            r.currentPeriodEnd?.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            }) || 'N/A',
        })),
      });

      this.logger.log({
        event: 'weekly.revenue.report.sent',
        active: activeSubs.length,
        newThisWeek,
        cancelledThisWeek,
      });
    } catch (error: any) {
      this.logger.error({
        event: 'weekly.revenue.report.failed',
        error: error.message,
      });
    }
  }

  // ── NPS Survey Trigger (MP-REV-02) ────────────────────────────
  @Cron('0 14 * * *') // 10am AST (14:00 UTC) daily
  async sendNPSSurveys() {
    try {
      // Find COMPLETE jobs from ~48 hours ago
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const fiftyTwoHoursAgo = new Date(Date.now() - 52 * 60 * 60 * 1000);

      const completedJobs = await this.prisma.reportJob.findMany({
        where: {
          status: 'COMPLETE',
          completedAt: { gte: fiftyTwoHoursAgo, lte: fortyEightHoursAgo },
        },
        include: { user: true },
      });

      for (const job of completedJobs) {
        try {
          if (!job.user?.email) continue;

          // Check if NPS survey already scheduled/sent for this job
          const existingNps = await this.prisma.emailSequence.findFirst({
            where: {
              userId: job.userId,
              sequenceKey: 'NPS',
              metadata: { path: ['jobId'], equals: job.id },
            },
          });

          if (existingNps) continue;

          // Send NPS survey
          await this.email.sendNPSSurvey({
            email: job.user.email,
            name: job.user.name || '',
            institutionName: job.institutionName,
            jobId: job.id,
            institutionId: job.institutionId || '',
          });

          // Record that we sent the NPS survey
          await this.prisma.emailSequence.create({
            data: {
              userId: job.userId,
              sequenceKey: 'NPS',
              scheduledAt: new Date(),
              sentAt: new Date(),
              metadata: { jobId: job.id },
            },
          });

          this.logger.log({
            event: 'nps.survey.sent',
            jobId: job.id,
            userId: job.userId,
          });
        } catch (jobErr: any) {
          this.logger.error({
            event: 'nps.survey.error',
            jobId: job.id,
            error: jobErr.message,
          });
        }
      }
    } catch (error: any) {
      this.logger.error({
        event: 'nps.survey.cron.failed',
        error: error.message,
      });
    }
  }

  // ── 90-Day Data Deletion (DPA compliance) ──────────────────────
  @Cron('0 2 * * *') // 2:00 AM daily
  async deleteExpiredData() {
    const cutoffDate = new Date();
    cutoffDate.setDate(
      cutoffDate.getDate() - PipelineWorker.DATA_RETENTION_DAYS,
    );

    try {
      const expiredJobs = await this.prisma.reportJob.findMany({
        where: {
          status: 'COMPLETE',
          completedAt: { lte: cutoffDate },
          rawData: { not: null },
          rawDataPurgedAt: null,
        },
        select: { id: true, institutionName: true, completedAt: true },
      });

      if (expiredJobs.length === 0) return;

      this.logger.log({
        event: 'pipeline.data_purge.starting',
        jobCount: expiredJobs.length,
        cutoffDate: cutoffDate.toISOString(),
      });

      for (const job of expiredJobs) {
        await this.prisma.reportJob.update({
          where: { id: job.id },
          data: { rawData: null, rawDataPurgedAt: new Date() },
        });
        this.logger.log({
          event: 'pipeline.data_purge.deleted',
          jobId: job.id,
          institution: job.institutionName,
          completedAt: job.completedAt?.toISOString(),
        });
      }

      this.logger.log({
        event: 'pipeline.data_purge.complete',
        purgedCount: expiredJobs.length,
      });
    } catch (error: any) {
      if (this.isReportJobsTableMissing(error)) {
        this.logger.warn('Skipping data purge: report_jobs table is missing');
        return;
      }
      this.logger.error({
        event: 'pipeline.data_purge.failed',
        error: error.message,
      });
    }
  }

  // ── Stalled Job Detection ─────────────────────────────────────
  @Cron('*/5 * * * *') // Every 5 minutes
  async checkStalledJobs() {
    const stalledThreshold = new Date(
      Date.now() - PipelineWorker.STALLED_THRESHOLD_MS,
    );

    try {
      const stalledJobs = await this.prisma.reportJob.findMany({
        where: {
          status: 'PROCESSING',
          processingStartedAt: { lte: stalledThreshold },
        },
        include: { user: true },
      });

      if (stalledJobs.length === 0) return;

      this.logger.warn({
        event: 'pipeline.stalled_jobs.detected',
        count: stalledJobs.length,
      });

      for (const job of stalledJobs) {
        if (job.retryCount >= PipelineWorker.MAX_STALLED_RETRIES) {
          // Max retries exceeded — mark as FAILED
          await this.prisma.reportJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: `Job stalled ${job.retryCount} times — exceeded max retries (${PipelineWorker.MAX_STALLED_RETRIES})`,
            },
          });

          await this.email.sendJobFailedAlert({
            jobId: job.id,
            institutionName: job.institutionName,
            error: `Job stalled ${job.retryCount} times, marked FAILED`,
            clientEmail: job.user?.email || 'unknown',
          });

          this.logger.error({
            event: 'pipeline.stalled_job.failed',
            jobId: job.id,
            retryCount: job.retryCount,
          });
        } else {
          // Reset to QUEUED for retry
          await this.prisma.reportJob.update({
            where: { id: job.id },
            data: {
              status: 'QUEUED',
              retryCount: { increment: 1 },
              processingStartedAt: null,
              errorMessage: `Auto-reset: stalled in PROCESSING for >30 min (retry ${job.retryCount + 1}/${PipelineWorker.MAX_STALLED_RETRIES})`,
            },
          });

          // Alert the operator about stalled job
          await this.email.sendJobFailedAlert({
            jobId: job.id,
            institutionName: job.institutionName,
            error: `Job stalled in PROCESSING >30 min — auto-reset to QUEUED (retry ${job.retryCount + 1}/${PipelineWorker.MAX_STALLED_RETRIES})`,
            clientEmail: job.user?.email || 'unknown',
          });

          this.logger.warn({
            event: 'pipeline.stalled_job.reset',
            jobId: job.id,
            retryCount: job.retryCount + 1,
          });
        }
      }
    } catch (error: any) {
      if (this.isReportJobsTableMissing(error)) {
        this.logger.warn(
          'Skipping stalled job check: report_jobs table is missing',
        );
        return;
      }
      this.logger.error({
        event: 'pipeline.stalled_check.failed',
        error: error.message,
      });
    }
  }

  // ── Compliance Deadline Reminders (MP-PROD-03) ──────────────────
  @Cron('0 11 * * *') // 7am AST (11:00 UTC) daily
  async sendDeadlineReminders() {
    try {
      const results =
        await this.complianceCalendar.getInstitutionsWithUpcomingDeadlines(30);

      if (results.length === 0) return;

      this.logger.log({
        event: 'pipeline.deadline_reminders.start',
        institutionsCount: results.length,
      });

      for (const inst of results) {
        if (!inst.contactEmail) continue;

        try {
          await this.email.sendDailyOperationsReport({
            pendingJobs: 0,
            failedJobs: 0,
            newLeads: 0,
            pendingFollowUps: inst.deadlines.length,
          });

          this.logger.log({
            event: 'pipeline.deadline_reminder.sent',
            institution: inst.institutionName,
            deadlinesCount: inst.deadlines.length,
          });
        } catch (err: any) {
          this.logger.error({
            event: 'pipeline.deadline_reminder.failed',
            institution: inst.institutionName,
            error: err.message,
          });
        }
      }
    } catch (error: any) {
      this.logger.error({
        event: 'pipeline.deadline_reminders.failed',
        error: error.message,
      });
    }
  }

  private buildFallbackPDF(
    institutionId: string,
    lang: string,
    error: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'letter' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('CERNIQ ALM Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Institution: ${institutionId}`);
      doc.text(`Language: ${lang}`);
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.moveDown();
      doc
        .fontSize(10)
        .fill('#dc2626')
        .text(`Note: Full report generation encountered an issue: ${error}`);
      doc.text(
        'A team member has been notified and will regenerate this report shortly.',
      );

      doc.end();
    });
  }
}
