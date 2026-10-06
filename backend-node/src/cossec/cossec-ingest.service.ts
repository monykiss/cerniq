import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CossecMatchingService } from './cossec-matching.service';
import type {
  CossecIngestPayload,
  IngestResult,
  CategoryStats,
  ExamYearSummary,
} from './cossec.dto';

@Injectable()
export class CossecIngestService {
  private readonly logger = new Logger(CossecIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: CossecMatchingService,
  ) {}

  // ── Main ingest entry point ──────────────────────────────────────────────

  /**
   * Receives parsed findings from the Python microservice, fuzzy-matches
   * institution names, creates CossecExamFinding records, and updates
   * ProspectInstitution aggregate counters.
   */
  async ingestFindings(payload: CossecIngestPayload): Promise<IngestResult> {
    const { examYear, source, findings } = payload;
    this.logger.log(
      `Ingesting ${findings.length} findings for examYear=${examYear} source="${source}"`,
    );

    const result: IngestResult = {
      totalReceived: findings.length,
      matched: 0,
      unmatched: 0,
      created: 0,
      duplicatesSkipped: 0,
      unmatchedInstitutions: [],
    };

    // Track institutions that were updated so we can refresh their counters
    const updatedInstitutionIds = new Set<string>();

    for (const finding of findings) {
      // 1. Fuzzy-match institution name
      const match = await this.matching.matchInstitution(
        finding.institutionName,
      );

      if (!match.matched || !match.prospectInstitutionId) {
        result.unmatched += 1;
        if (!result.unmatchedInstitutions.includes(finding.institutionName)) {
          result.unmatchedInstitutions.push(finding.institutionName);
        }
        continue;
      }

      result.matched += 1;

      // 2. Check for duplicates (same institution + examYear + category + findingText)
      const existing = await this.prisma.cossecExamFinding.findFirst({
        where: {
          prospectInstitutionId: match.prospectInstitutionId,
          examYear,
          category: finding.category,
          findingText: finding.findingText,
        },
      });

      if (existing) {
        result.duplicatesSkipped += 1;
        continue;
      }

      // 3. Create the finding record
      await this.prisma.cossecExamFinding.create({
        data: {
          prospectInstitutionId: match.prospectInstitutionId,
          institutionName: finding.institutionName,
          examYear,
          examDate: finding.examDate ? new Date(finding.examDate) : null,
          category: finding.category,
          severity: finding.severity,
          findingText: finding.findingText,
          findingTextEs: finding.findingTextEs ?? null,
          recommendation: finding.recommendation ?? '',
          recommendationEs: finding.recommendationEs ?? null,
          circularLetterRef: finding.circularLetterRef ?? null,
          rawPdfSource: finding.rawPdfSource ?? null,
          parserConfidence: finding.parserConfidence,
        },
      });

      result.created += 1;
      updatedInstitutionIds.add(match.prospectInstitutionId);
    }

    // 4. Update ProspectInstitution aggregate counters
    for (const instId of updatedInstitutionIds) {
      await this.updateInstitutionStats(instId);
    }

    this.logger.log(
      `Ingest complete: ${result.created} created, ${result.duplicatesSkipped} dupes skipped, ` +
        `${result.unmatched} unmatched (${result.unmatchedInstitutions.length} unique names)`,
    );

    return result;
  }

  // ── Query methods ────────────────────────────────────────────────────────

  async getInstitutionFindings(prospectInstitutionId: string) {
    return this.prisma.cossecExamFinding.findMany({
      where: { prospectInstitutionId },
      orderBy: [{ examYear: 'desc' }, { severity: 'asc' }, { category: 'asc' }],
    });
  }

  async getFindingsByCategory(
    category: string,
    severity?: string,
  ): Promise<CategoryStats> {
    const where: Record<string, unknown> = { category };
    if (severity) where.severity = severity;

    const findings = await this.prisma.cossecExamFinding.findMany({
      where,
      select: {
        severity: true,
        prospectInstitutionId: true,
      },
    });

    const bySeverity: Record<string, number> = {};
    const institutionIds = new Set<string>();

    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      institutionIds.add(f.prospectInstitutionId);
    }

    return {
      category,
      total: findings.length,
      bySeverity,
      institutions: institutionIds.size,
    };
  }

  async getExamYearSummary(examYear: number): Promise<ExamYearSummary> {
    const findings = await this.prisma.cossecExamFinding.findMany({
      where: { examYear },
      select: {
        severity: true,
        category: true,
        prospectInstitutionId: true,
      },
    });

    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const institutionIds = new Set<string>();

    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
      institutionIds.add(f.prospectInstitutionId);
    }

    return {
      examYear,
      totalFindings: findings.length,
      institutionsExamined: institutionIds.size,
      bySeverity,
      byCategory,
    };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private async updateInstitutionStats(
    prospectInstitutionId: string,
  ): Promise<void> {
    const findings = await this.prisma.cossecExamFinding.findMany({
      where: { prospectInstitutionId },
      select: { examYear: true },
    });

    const count = findings.length;
    const maxYear = findings.reduce(
      (max: number, f: { examYear: number }) => Math.max(max, f.examYear),
      0,
    );

    await this.prisma.prospectInstitution.update({
      where: { id: prospectInstitutionId },
      data: {
        cossecFindingsCount: count,
        cossecLastExamYear: maxYear > 0 ? maxYear : null,
      },
    });
  }
}
