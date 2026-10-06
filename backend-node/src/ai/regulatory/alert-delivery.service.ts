import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RegulatoryImpact } from './impact-extractor.service';

export interface PersonalizedAlert {
  institutionId: string;
  publicationId: string;
  severity: string;
  alertTextEs: string;
  alertTextEn: string;
  affectedItems: string[];
  recommendedAction: string;
}

@Injectable()
export class AlertDeliveryService {
  private readonly logger = new Logger(AlertDeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async mapAndDeliverToAllInstitutions(
    publicationId: string,
    impact: RegulatoryImpact,
  ): Promise<number> {
    const institutions = await this.prisma.institution.findMany({
      include: { balanceSheetItems: { select: { subcategory: true } } },
      take: 100,
    });

    let delivered = 0;

    for (const inst of institutions) {
      const instSubcategories = new Set<string>(
        inst.balanceSheetItems
          .map((i: any) => i.subcategory)
          .filter(
            (subcategory: any): subcategory is string =>
              typeof subcategory === 'string' && subcategory.length > 0,
          )
          .map((subcategory: any) => subcategory.toLowerCase()),
      );
      const affected = impact.affectedSubcategories.filter((sub) => {
        const subLower = sub.toLowerCase();
        if (subLower === 'liquidity') return true; // affects all
        if (subLower === 'capital') return true;
        if (subLower === 'interest_rate') return true;
        return Array.from(instSubcategories).some(
          (is) => is.includes(subLower) || subLower.includes(is),
        );
      });

      if (affected.length === 0 && impact.severity !== 'HIGH') continue;

      const alert: PersonalizedAlert = {
        institutionId: inst.id,
        publicationId,
        severity: impact.severity,
        alertTextEs: `Nueva regulación ${impact.severity}: ${impact.requirements[0] ?? impact.keyQuote}. Afecta: ${affected.join(', ') || 'general'}.`,
        alertTextEn: `New ${impact.severity} regulation: ${impact.requirements[0] ?? impact.keyQuote}. Affects: ${affected.join(', ') || 'general'}.`,
        affectedItems: affected,
        recommendedAction:
          impact.requirements.length > 1
            ? impact.requirements.slice(1).join('; ')
            : `Review the full regulation and assess impact on ${affected[0] ?? 'operations'}.`,
      };

      await this.prisma.institutionAlert.create({
        data: {
          institutionId: alert.institutionId,
          publicationId: alert.publicationId,
          severity: alert.severity,
          alertTextEs: alert.alertTextEs,
          alertTextEn: alert.alertTextEn,
          affectedItems: alert.affectedItems,
          recommendedAction: alert.recommendedAction,
        },
      });
      delivered++;
    }

    this.logger.log(
      `Delivered ${delivered} alerts for publication ${publicationId}`,
    );
    return delivered;
  }

  async getInstitutionAlerts(
    institutionId: string,
    unreadOnly: boolean = false,
  ) {
    return this.prisma.institutionAlert.findMany({
      where: {
        institutionId,
        ...(unreadOnly ? { readAt: null, dismissedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(alertId: string) {
    return this.prisma.institutionAlert.update({
      where: { id: alertId },
      data: { readAt: new Date() },
    });
  }

  async dismiss(alertId: string) {
    return this.prisma.institutionAlert.update({
      where: { id: alertId },
      data: { dismissedAt: new Date() },
    });
  }
}
