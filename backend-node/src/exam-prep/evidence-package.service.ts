import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ExamPrepScoringService } from './exam-prep-scoring.service';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface EvidencePackageResult {
  assessmentId: string;
  packageId: string;
  institutionId: string;
  files: EvidenceFile[];
  generatedAt: string;
  downloadUrl: string | null;
  format: 'ZIP' | 'PDF';
  sizeBytes: number;
}

export interface EvidenceFile {
  name: string;
  description: string;
  descriptionEs: string;
  type: 'template' | 'report' | 'documentation';
  sizeBytes: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class EvidencePackageService {
  private readonly logger = new Logger(EvidencePackageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ExamPrepScoringService,
  ) {}

  /**
   * Generate an evidence package ZIP containing all exam preparation
   * documentation for a given assessment.
   *
   * Package contents:
   * 1. ALM Policy Template (pre-populated with institution data)
   * 2. Board Minutes Template (quarterly ALM discussion format)
   * 3. Stress Test Documentation (COSSEC-formatted)
   * 4. Exam Readiness Summary (bilingual A-F grade + remediation plan)
   */
  async generateEvidencePackage(
    assessmentId: string,
  ): Promise<EvidencePackageResult> {
    this.logger.log({
      msg: 'Generating evidence package',
      assessmentId,
    });

    // Retrieve the assessment
    const assessment =
      await this.scoringService.getLatestAssessment(assessmentId);

    // For scaffold, we generate metadata about what the package would contain.
    // In production, this uses archiver/JSZip to create the actual ZIP.
    const packageId = crypto.randomUUID();
    const institutionId = assessment?.institutionId ?? assessmentId;

    const files: EvidenceFile[] = [
      {
        name: 'alm-policy-template.docx',
        description:
          'ALM Policy Template pre-populated with institution data, risk limits, and governance structure.',
        descriptionEs:
          'Plantilla de Politica ALM pre-poblada con datos institucionales, limites de riesgo y estructura de gobernanza.',
        type: 'template',
        sizeBytes: 45_000,
      },
      {
        name: 'board-minutes-template.docx',
        description:
          'Quarterly Board Minutes Template for ALM discussion, including agenda items, risk dashboard review, and action items.',
        descriptionEs:
          'Plantilla de Actas de Junta trimestrales para discusion ALM, incluyendo agenda, revision del tablero de riesgos y acciones.',
        type: 'template',
        sizeBytes: 32_000,
      },
      {
        name: 'stress-test-documentation.pdf',
        description:
          'COSSEC-formatted stress test results documentation with scenario analysis and impact assessment.',
        descriptionEs:
          'Documentacion de pruebas de estres en formato COSSEC con analisis de escenarios y evaluacion de impacto.',
        type: 'documentation',
        sizeBytes: 128_000,
      },
      {
        name: 'exam-readiness-summary.pdf',
        description: `Bilingual exam readiness summary. Grade: ${assessment?.letterGrade ?? 'N/A'}, Score: ${assessment?.overallScore ?? 'N/A'}/100. Includes category breakdown and remediation plan.`,
        descriptionEs: `Resumen bilingue de preparacion para examen. Grado: ${assessment?.letterGrade ?? 'N/A'}, Puntuacion: ${assessment?.overallScore ?? 'N/A'}/100. Incluye desglose por categoria y plan de remediacion.`,
        type: 'report',
        sizeBytes: 85_000,
      },
      {
        name: 'compliance-checklist.xlsx',
        description:
          'COSSEC compliance checklist with 12 assessment categories, current status, and required actions.',
        descriptionEs:
          'Lista de verificacion de cumplimiento COSSEC con 12 categorias de evaluacion, estado actual y acciones requeridas.',
        type: 'documentation',
        sizeBytes: 22_000,
      },
      {
        name: 'risk-limit-framework.pdf',
        description:
          'Risk limit framework document including duration gap, NII sensitivity, EVE, and liquidity thresholds.',
        descriptionEs:
          'Documento de marco de limites de riesgo incluyendo brecha de duracion, sensibilidad NII, EVE y umbrales de liquidez.',
        type: 'documentation',
        sizeBytes: 56_000,
      },
    ];

    const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);

    const result: EvidencePackageResult = {
      assessmentId,
      packageId,
      institutionId,
      files,
      generatedAt: new Date().toISOString(),
      downloadUrl: `/api/exam-prep/${institutionId}/evidence-package/download/${packageId}`,
      format: 'ZIP',
      sizeBytes: totalSize,
    };

    // Store package metadata
    this.packageStore.set(assessmentId, result);

    this.logger.log({
      msg: 'Evidence package generated',
      assessmentId,
      packageId,
      fileCount: files.length,
      totalSize,
    });

    return result;
  }

  /**
   * Get the download URL for a previously generated evidence package.
   * Returns null if no package has been generated for this assessment.
   */
  async getPackageUrl(assessmentId: string): Promise<string | null> {
    const pkg = this.packageStore.get(assessmentId);
    return pkg?.downloadUrl ?? null;
  }

  /**
   * Get the full package metadata for a previously generated evidence package.
   */
  async getPackage(
    assessmentId: string,
  ): Promise<EvidencePackageResult | null> {
    return this.packageStore.get(assessmentId) ?? null;
  }

  // ── In-memory store (replaced by Storage + Prisma in production) ──────────
  private readonly packageStore = new Map<string, EvidencePackageResult>();
}
