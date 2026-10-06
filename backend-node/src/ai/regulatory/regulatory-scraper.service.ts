import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

const REGULATORY_SOURCES = [
  {
    regulator: 'COSSEC',
    listUrl: 'https://www.cossec.pr.gov/circulares',
    description: 'COSSEC Circulares & Exam Guidance',
  },
  {
    regulator: 'OCIF',
    listUrl: 'https://ocif.pr.gov/wp/cartas-circulares/',
    description: 'OCIF Cartas Circulares',
  },
  {
    regulator: 'NCUA',
    listUrl:
      'https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance',
    description: 'NCUA Letters to CUs',
  },
];

export interface NewPublication {
  url: string;
  title: string;
  regulator: string;
  publishedAt: Date;
  rawText: string;
}

@Injectable()
export class RegulatoryScraperService {
  private readonly logger = new Logger(RegulatoryScraperService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runDailyScan(): Promise<{
    scanned: number;
    newFound: number;
    errors: string[];
  }> {
    let newFound = 0;
    const errors: string[] = [];
    for (const source of REGULATORY_SOURCES) {
      try {
        const publications = await this.fetchPublications(source);
        for (const pub of publications) {
          const exists = await this.prisma.regulatoryPublication.findUnique({
            where: { url: pub.url },
          });
          if (!exists) {
            await this.prisma.regulatoryPublication.create({
              data: {
                url: pub.url,
                title: pub.title,
                regulator: pub.regulator,
                publishedAt: pub.publishedAt,
                rawText: pub.rawText,
              },
            });
            newFound++;
            this.logger.log(`New: ${pub.regulator} — ${pub.title}`);
          }
        }
      } catch (e: any) {
        this.logger.warn(`Scan failed for ${source.regulator}: ${e.message}`);
        errors.push(`${source.regulator}: ${e.message}`);
      }
    }
    return { scanned: REGULATORY_SOURCES.length, newFound, errors };
  }

  private async fetchPublications(
    source: (typeof REGULATORY_SOURCES)[0],
  ): Promise<NewPublication[]> {
    // In production: Puppeteer headless browser scraping
    // For now: return empty (real scraping requires browser binary on Railway)
    // When Puppeteer is installed: parse HTML, extract titles/links/dates
    try {
      const response = await fetch(source.listUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CERNIQ/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return [];
      const html = await response.text();
      // Extract publication metadata from HTML
      return this.parsePublications(html, source.regulator, source.listUrl);
    } catch {
      return [];
    }
  }

  private parsePublications(
    html: string,
    regulator: string,
    baseUrl: string,
  ): NewPublication[] {
    // Simple regex-based extraction (production: use cheerio)
    const titleRegex = /<(?:h[23]|a)[^>]*>([^<]{10,120})<\/(?:h[23]|a)>/gi;
    const publications: NewPublication[] = [];
    let match;
    let count = 0;
    while ((match = titleRegex.exec(html)) !== null && count < 5) {
      const title = match[1].trim();
      if (title.length > 15 && !title.includes('<')) {
        publications.push({
          url: `${baseUrl}#${encodeURIComponent(title.slice(0, 50))}`,
          title,
          regulator,
          publishedAt: new Date(),
          rawText: title, // full text extraction in production via pdf-parse
        });
        count++;
      }
    }
    return publications;
  }

  getSources() {
    return REGULATORY_SOURCES;
  }
}
