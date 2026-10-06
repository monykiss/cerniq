import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface ComplianceDeadline {
  id: string;
  title: string;
  titleEs: string;
  deadlineDate: Date;
  category: 'exam' | 'report' | 'meeting' | 'tax' | 'internal';
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OVERDUE';
  description: string;
  descriptionEs: string;
  relatedModule: string;
}

@Injectable()
export class ComplianceCalendarService {
  private readonly logger = new Logger(ComplianceCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getUpcomingDeadlines(
    institutionId: string,
  ): Promise<{ events: ComplianceDeadline[]; warning?: string }> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (!institution) {
      return {
        events: [],
        warning: 'Institution not found — no compliance events generated',
      };
    }

    const deadlines: ComplianceDeadline[] = [];
    const now = new Date();

    // ── COSSEC Exam ──────────────────────────────────────────────────
    if (institution.nextExamDate) {
      deadlines.push({
        id: 'cossec-exam',
        title: 'COSSEC Examination',
        titleEs: 'Examen COSSEC',
        deadlineDate: institution.nextExamDate,
        category: 'exam',
        urgency: this.calculateUrgency(institution.nextExamDate, now),
        description: 'Annual COSSEC regulatory examination',
        descriptionEs: 'Examen regulatorio anual de COSSEC',
        relatedModule: '/alm',
      });
    } else if (institution.lastExamDate) {
      // Estimate next exam: lastExamDate + 15 months
      const estimated = new Date(institution.lastExamDate);
      estimated.setMonth(estimated.getMonth() + 15);
      deadlines.push({
        id: 'cossec-exam-estimated',
        title: 'COSSEC Examination (Estimated)',
        titleEs: 'Examen COSSEC (Estimado)',
        deadlineDate: estimated,
        category: 'exam',
        urgency: this.calculateUrgency(estimated, now),
        description: 'Estimated COSSEC exam based on last exam + 15 months',
        descriptionEs:
          'Examen COSSEC estimado basado en último examen + 15 meses',
        relatedModule: '/alm',
      });
    }

    // ── ALCO Meetings ────────────────────────────────────────────────
    // Generate next 3 ALCO meeting dates based on frequency
    const alcoFrequency = institution.alcoMeetingFrequency || 'monthly';
    const alcoMonthsStep = alcoFrequency === 'quarterly' ? 3 : 1;

    let alcoBase: Date;
    if (institution.alcoNextDate) {
      alcoBase = new Date(institution.alcoNextDate);
      // If alcoNextDate is in the past, advance it to the present/future
      while (alcoBase < now) {
        alcoBase.setMonth(alcoBase.getMonth() + alcoMonthsStep);
      }
    } else {
      // Default: next occurrence on 3rd Wednesday of the month
      alcoBase = this.getNextThirdWednesday(now);
    }

    for (let i = 0; i < 3; i++) {
      const meetingDate = new Date(alcoBase);
      meetingDate.setMonth(meetingDate.getMonth() + i * alcoMonthsStep);
      deadlines.push({
        id: `alco-meeting-${i + 1}`,
        title: `ALCO Meeting #${i + 1}`,
        titleEs: `Reunion ALCO #${i + 1}`,
        deadlineDate: meetingDate,
        category: 'meeting',
        urgency: this.calculateUrgency(meetingDate, now),
        description: `${alcoFrequency === 'quarterly' ? 'Quarterly' : 'Monthly'} ALCO committee meeting`,
        descriptionEs: `Reunion del comite ALCO ${alcoFrequency === 'quarterly' ? 'trimestral' : 'mensual'}`,
        relatedModule: '/alm',
      });
    }

    // ── Quarterly COSSEC Reports ─────────────────────────────────────
    // Fixed deadlines: Q1=Apr 15, Q2=Jul 15, Q3=Oct 15, Q4=Jan 15
    const quarterlyDeadlines = [
      { month: 0, day: 15, quarter: 'Q4', prev: 'Oct-Dec' }, // Jan 15 = Q4 report
      { month: 3, day: 15, quarter: 'Q1', prev: 'Jan-Mar' }, // Apr 15 = Q1 report
      { month: 6, day: 15, quarter: 'Q2', prev: 'Apr-Jun' }, // Jul 15 = Q2 report
      { month: 9, day: 15, quarter: 'Q3', prev: 'Jul-Sep' }, // Oct 15 = Q3 report
    ];

    const currentYear = now.getFullYear();
    // Check this year and next year for upcoming deadlines
    for (const yearOffset of [0, 1]) {
      const year = currentYear + yearOffset;
      for (const qd of quarterlyDeadlines) {
        const deadline = new Date(year, qd.month, qd.day);
        if (deadline > now) {
          deadlines.push({
            id: `cossec-report-${qd.quarter}-${year}`,
            title: `COSSEC ${qd.quarter} ${year} Report`,
            titleEs: `Informe COSSEC ${qd.quarter} ${year}`,
            deadlineDate: deadline,
            category: 'report',
            urgency: this.calculateUrgency(deadline, now),
            description: `Quarterly COSSEC regulatory report for ${qd.prev} ${qd.quarter === 'Q4' ? year - 1 : year}`,
            descriptionEs: `Informe regulatorio trimestral COSSEC para ${qd.prev} ${qd.quarter === 'Q4' ? year - 1 : year}`,
            relatedModule: '/alm',
          });
        }
      }
    }

    // ── Fiscal Year End Report ────────────────────────────────────────
    if (institution.fiscalYearEnd) {
      const fyeMonth = this.parseFiscalYearEndMonth(institution.fiscalYearEnd);
      if (fyeMonth !== null) {
        // Fiscal year-end report typically due 90 days after FYE
        let fyeDate = new Date(currentYear, fyeMonth, 1);
        // Last day of the month
        fyeDate = new Date(currentYear, fyeMonth + 1, 0);
        // Report due 90 days after
        const reportDue = new Date(fyeDate);
        reportDue.setDate(reportDue.getDate() + 90);

        // If due date is in the past, use next year
        if (reportDue < now) {
          fyeDate = new Date(currentYear + 1, fyeMonth + 1, 0);
          reportDue.setFullYear(currentYear + 1);
          reportDue.setMonth(fyeMonth + 1);
          reportDue.setDate(fyeDate.getDate());
          reportDue.setDate(reportDue.getDate() + 90);
          // Recalculate properly
          const nextFye = new Date(currentYear + 1, fyeMonth + 1, 0);
          const nextReportDue = new Date(nextFye);
          nextReportDue.setDate(nextReportDue.getDate() + 90);
          deadlines.push({
            id: `fiscal-year-end-${currentYear + 1}`,
            title: `Fiscal Year-End Report ${currentYear + 1}`,
            titleEs: `Informe de Cierre Fiscal ${currentYear + 1}`,
            deadlineDate: nextReportDue,
            category: 'report',
            urgency: this.calculateUrgency(nextReportDue, now),
            description:
              'Annual fiscal year-end regulatory filing due 90 days after FYE',
            descriptionEs:
              'Informe regulatorio de cierre fiscal anual, debido 90 días después del cierre',
            relatedModule: '/alm',
          });
        } else {
          deadlines.push({
            id: `fiscal-year-end-${currentYear}`,
            title: `Fiscal Year-End Report ${currentYear}`,
            titleEs: `Informe de Cierre Fiscal ${currentYear}`,
            deadlineDate: reportDue,
            category: 'report',
            urgency: this.calculateUrgency(reportDue, now),
            description:
              'Annual fiscal year-end regulatory filing due 90 days after FYE',
            descriptionEs:
              'Informe regulatorio de cierre fiscal anual, debido 90 días después del cierre',
            relatedModule: '/alm',
          });
        }
      }
    }

    // Sort by deadlineDate ascending and return
    return {
      events: deadlines.sort(
        (a, b) => a.deadlineDate.getTime() - b.deadlineDate.getTime(),
      ),
    };
  }

  /**
   * Returns institutions with deadlines within the specified number of days.
   * Used by the daily reminder cron.
   */
  async getInstitutionsWithUpcomingDeadlines(
    withinDays: number,
    /** Restrict to a single workspace for tenant isolation */
    workspaceId?: string,
  ): Promise<
    Array<{
      institutionId: string;
      contactEmail: string | null;
      contactName: string | null;
      institutionName: string;
      deadlines: ComplianceDeadline[];
    }>
  > {
    const where = workspaceId ? { workspaceId } : {};
    const institutions = await this.prisma.institution.findMany({
      where,
      select: {
        id: true,
        name: true,
        contactEmail: true,
        contactName: true,
      },
      take: 100,
    });

    const results: Array<{
      institutionId: string;
      contactEmail: string | null;
      contactName: string | null;
      institutionName: string;
      deadlines: ComplianceDeadline[];
    }> = [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);

    for (const inst of institutions) {
      const result = await this.getUpcomingDeadlines(inst.id);
      const upcoming = result.events.filter(
        (d) =>
          d.deadlineDate <= cutoff &&
          (d.urgency === 'CRITICAL' ||
            d.urgency === 'HIGH' ||
            d.urgency === 'OVERDUE'),
      );
      if (upcoming.length > 0) {
        results.push({
          institutionId: inst.id,
          contactEmail: inst.contactEmail,
          contactName: inst.contactName,
          institutionName: inst.name,
          deadlines: upcoming,
        });
      }
    }

    return results;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  calculateUrgency(
    deadline: Date,
    now: Date,
  ): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OVERDUE' {
    const days = Math.floor((deadline.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) return 'OVERDUE';
    if (days <= 14) return 'CRITICAL';
    if (days <= 30) return 'HIGH';
    if (days <= 90) return 'MEDIUM';
    return 'LOW';
  }

  private getNextThirdWednesday(from: Date): Date {
    const d = new Date(from.getFullYear(), from.getMonth(), 1);
    // Find first Wednesday
    while (d.getDay() !== 3) {
      d.setDate(d.getDate() + 1);
    }
    // Third Wednesday = first Wednesday + 14 days
    d.setDate(d.getDate() + 14);
    // If already past, go to next month
    if (d <= from) {
      const nextMonth = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      return this.getNextThirdWednesday(nextMonth);
    }
    return d;
  }

  private parseFiscalYearEndMonth(fye: string): number | null {
    const map: Record<string, number> = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    };
    return map[fye.toLowerCase()] ?? null;
  }
}
