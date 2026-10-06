import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import type { SampleReportResult, BatchGenerationResult } from './cossec.dto';

/**
 * Generates pre-built sample ALM reports for prospect institutions.
 *
 * These watermarked reports use only public COSSEC data + our quant models
 * to demonstrate CERNIQ's value. They power the outbound sales motion:
 *   1. Batch-generate 109 prospect reports
 *   2. Attach to personalized outreach emails
 *   3. Prospect clicks → preview token → read-only portal at /demo/preview
 *
 * The actual PDF rendering is delegated to the pipeline module. This service
 * orchestrates the data assembly, triggers generation, and manages preview tokens.
 */

@Injectable()
export class SampleReportService {
  private readonly logger = new Logger(SampleReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ── Single report generation ─────────────────────────────────────────────

  async generateSampleReport(
    prospectInstitutionId: string,
  ): Promise<SampleReportResult> {
    const prospect = await this.prisma.prospectInstitution.findUniqueOrThrow({
      where: { id: prospectInstitutionId },
    });

    // Fetch COSSEC findings for this institution
    const findings = await this.prisma.cossecExamFinding.findMany({
      where: { prospectInstitutionId },
      orderBy: [{ examYear: 'desc' }, { severity: 'asc' }],
    });

    this.logger.log(
      `Generating sample report for "${prospect.name}" ` +
        `(${findings.length} findings, assets=${prospect.estimatedAssets})`,
    );

    // Assemble report data from public sources
    const reportData = this.assembleReportData(prospect, findings);

    // Generate a watermarked report URL
    // In production this would trigger the pipeline module to render a PDF.
    // For now we store a reference URL and mark it as generated.
    const reportUrl = `/api/demo/preview?institution=${prospectInstitutionId}`;
    const now = new Date();

    await this.prisma.prospectInstitution.update({
      where: { id: prospectInstitutionId },
      data: {
        sampleReportUrl: reportUrl,
        sampleReportGeneratedAt: now,
        outreachStatus:
          prospect.outreachStatus === 'not_started'
            ? 'sample_generated'
            : prospect.outreachStatus,
      },
    });

    const result: SampleReportResult = {
      prospectInstitutionId,
      reportUrl,
      generatedAt: now.toISOString(),
      pageCount: this.estimatePageCount(reportData),
    };

    this.logger.log(
      `Sample report generated: ${prospect.name} → ${reportUrl} (${result.pageCount} pages)`,
    );

    return result;
  }

  // ── Batch generation ─────────────────────────────────────────────────────

  async generateAllSampleReports(): Promise<BatchGenerationResult> {
    const prospects = await this.prisma.prospectInstitution.findMany({
      select: {
        id: true,
        name: true,
        sampleReportGeneratedAt: true,
      },
    });

    const result: BatchGenerationResult = {
      total: prospects.length,
      generated: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    this.logger.log(
      `Starting batch sample report generation for ${prospects.length} prospects`,
    );

    for (const prospect of prospects) {
      // Skip if already generated (idempotent)
      if (prospect.sampleReportGeneratedAt) {
        result.skipped += 1;
        continue;
      }

      try {
        await this.generateSampleReport(prospect.id);
        result.generated += 1;
      } catch (err) {
        result.failed += 1;
        result.errors.push({
          id: prospect.id,
          error: (err as Error).message,
        });
        this.logger.error(
          `Failed to generate sample report for "${prospect.name}": ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Batch generation complete: ${result.generated} generated, ` +
        `${result.skipped} skipped, ${result.failed} failed`,
    );

    return result;
  }

  // ── URL + preview token ──────────────────────────────────────────────────

  async getSampleReportUrl(
    prospectInstitutionId: string,
  ): Promise<string | null> {
    const prospect = await this.prisma.prospectInstitution.findUnique({
      where: { id: prospectInstitutionId },
      select: { sampleReportUrl: true },
    });
    return prospect?.sampleReportUrl ?? null;
  }

  async generatePreviewToken(prospectInstitutionId: string): Promise<string> {
    // Verify the prospect and report exist
    const prospect = await this.prisma.prospectInstitution.findUniqueOrThrow({
      where: { id: prospectInstitutionId },
      select: { id: true, name: true, sampleReportUrl: true },
    });

    if (!prospect.sampleReportUrl) {
      throw new Error(
        `No sample report generated for prospect ${prospectInstitutionId}`,
      );
    }

    const token = this.jwt.sign({
      sub: prospectInstitutionId,
      type: 'sample_report_preview',
      institutionName: prospect.name,
    });

    return token;
  }

  /**
   * Validates a preview token and returns the prospect data for rendering.
   */
  async validatePreviewToken(token: string): Promise<{
    prospectInstitutionId: string;
    institutionName: string;
  } | null> {
    try {
      const payload = this.jwt.verify<{
        sub: string;
        type: string;
        institutionName: string;
      }>(token);

      if (payload.type !== 'sample_report_preview') {
        return null;
      }

      return {
        prospectInstitutionId: payload.sub,
        institutionName: payload.institutionName,
      };
    } catch {
      return null;
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private assembleReportData(
    prospect: Record<string, unknown>,
    findings: Array<Record<string, unknown>>,
  ): {
    institution: Record<string, unknown>;
    findings: Array<Record<string, unknown>>;
    sections: string[];
  } {
    // Determine which sections to include based on available data
    const sections: string[] = ['executive_summary', 'institution_overview'];

    if (findings.length > 0) {
      sections.push('cossec_exam_findings');
      sections.push('finding_remediation_map');
    }

    if (prospect.estimatedAssets) {
      sections.push('peer_comparison');
      sections.push('alm_risk_indicators');
    }

    sections.push('cerniq_value_proposition');
    sections.push('next_steps');

    return {
      institution: prospect,
      findings,
      sections,
    };
  }

  private estimatePageCount(reportData: {
    sections: string[];
    findings: Array<Record<string, unknown>>;
  }): number {
    // Base: cover + exec summary + overview + value prop + next steps = 5
    let pages = 5;
    // Each batch of ~4 findings adds a page
    pages += Math.ceil(reportData.findings.length / 4);
    // Peer comparison + ALM indicators
    if (reportData.sections.includes('peer_comparison')) pages += 2;
    return pages;
  }
}
