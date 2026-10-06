import { Injectable, Logger } from '@nestjs/common';
import { RegulatoryScraperService } from './regulatory-scraper.service';
import { ImpactExtractorService } from './impact-extractor.service';
import { AlertDeliveryService } from './alert-delivery.service';
import { PrismaService } from '../../prisma.service';

export interface PipelineResult {
  scanned: number;
  newPublications: number;
  alertsDelivered: number;
  extractionFailures: number;
  deliveryFailures: number;
  failedPublicationIds: string[];
}

@Injectable()
export class RegulatoryAlertService {
  private readonly logger = new Logger(RegulatoryAlertService.name);

  constructor(
    private readonly scraper: RegulatoryScraperService,
    private readonly extractor: ImpactExtractorService,
    private readonly delivery: AlertDeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  async runFullPipeline(): Promise<PipelineResult> {
    this.logger.log('Starting regulatory alert pipeline...');
    const { scanned, newFound } = await this.scraper.runDailyScan();

    let totalAlerts = 0;
    let extractionFailures = 0;
    let deliveryFailures = 0;
    const failedPublicationIds: string[] = [];

    if (newFound > 0) {
      const unprocessed = await this.prisma.regulatoryPublication.findMany({
        where: { processedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      for (const pub of unprocessed) {
        try {
          const impact = await this.extractor.extract(pub.id);
          const delivered = await this.delivery.mapAndDeliverToAllInstitutions(
            pub.id,
            impact,
          );
          totalAlerts += delivered;

          await this.markProcessed(pub.id, impact);
        } catch (err) {
          extractionFailures++;
          failedPublicationIds.push(pub.id);
          const errorMessage = err instanceof Error ? err.message : String(err);

          this.logger.error(
            `Extract failed for publication ${pub.id} (${pub.title ?? 'untitled'}): ${errorMessage}`,
          );

          // Record failure metadata so the publication isn't retried
          // indefinitely — the daily scan already found it; blindly
          // retrying without fixing the root cause just burns cycles.
          await this.markProcessed(pub.id, {
            extractionFailed: true,
            error: errorMessage,
            failedAt: new Date().toISOString(),
            severity: 'UNKNOWN',
          });

          // Deliver fallback alert that clearly communicates the gap
          try {
            const fallbackImpact = {
              severity: 'UNKNOWN' as const,
              requirements: [],
              affectedSubcategories: [],
              deadline: null,
              keyQuote: null,
              _extractionFailed: true,
              _failureReason: errorMessage,
            };
            const delivered =
              await this.delivery.mapAndDeliverToAllInstitutions(
                pub.id,
                fallbackImpact,
              );
            totalAlerts += delivered;
          } catch (deliveryErr) {
            deliveryFailures++;
            this.logger.error(
              `Fallback delivery also failed for publication ${pub.id}: ${deliveryErr}`,
            );
          }
        }
      }
    }

    if (extractionFailures > 0) {
      this.logger.warn(
        `Pipeline completed with ${extractionFailures} extraction failure(s): [${failedPublicationIds.join(', ')}]`,
      );
    }

    this.logger.log(
      `Pipeline complete: ${scanned} scanned, ${newFound} new, ${totalAlerts} alerts, ${extractionFailures} extraction failures, ${deliveryFailures} delivery failures`,
    );

    return {
      scanned,
      newPublications: newFound,
      alertsDelivered: totalAlerts,
      extractionFailures,
      deliveryFailures,
      failedPublicationIds,
    };
  }

  async getRecentPublications(limit: number = 20) {
    return this.prisma.regulatoryPublication.findMany({
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
  }

  /** Mark a publication as processed with its impact or error metadata. */
  private async markProcessed(
    publicationId: string,
    impactJson: object,
  ): Promise<void> {
    try {
      await this.prisma.regulatoryPublication.update({
        where: { id: publicationId },
        data: {
          processedAt: new Date(),
          impactJson: impactJson as any,
        },
      });
    } catch (updateErr) {
      this.logger.error(
        `Failed to mark publication ${publicationId} as processed: ${updateErr}`,
      );
    }
  }
}
