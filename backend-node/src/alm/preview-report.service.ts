import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  createReportFormatter,
  inferMoneyScale,
  REPORT_THEME,
} from './reports/report-formatting';

const PDFDocument = require('pdfkit');

type PreviewSeriesPoint = {
  label: string;
  value: number;
  peer: number;
};

type PreviewShockPoint = {
  scenario: string;
  niiChange: number;
  eveChange: number;
};

export interface PreviewReportDefinition {
  slug: string;
  name: string;
  nameEs: string;
  location: string;
  assets: number;
  capitalRatio: number;
  loanToShare: number;
  lcr: number;
  nim: number;
  durationGap: number;
  niiSensitivity: number;
  camelScore: number;
  niiTrend: PreviewSeriesPoint[];
  rateShock: PreviewShockPoint[];
}

const PREVIEW_REPORTS: Record<string, PreviewReportDefinition> = {
  'cooperativa-ejemplo-este': {
    slug: 'cooperativa-ejemplo-este',
    name: 'Cooperativa de Ahorro y Credito Ejemplo Este',
    nameEs: 'Cooperativa Ejemplo Este',
    location: 'Municipio C, PR',
    assets: 1200,
    capitalRatio: 10.1,
    loanToShare: 68.4,
    lcr: 118,
    nim: 3.62,
    durationGap: 1.8,
    niiSensitivity: -4.2,
    camelScore: 2,
    niiTrend: [
      { label: 'Q1-25', value: 10.2, peer: 9.8 },
      { label: 'Q2-25', value: 10.5, peer: 9.9 },
      { label: 'Q3-25', value: 10.8, peer: 10.1 },
      { label: 'Q4-25', value: 10.4, peer: 10.0 },
      { label: 'Q1-26', value: 10.9, peer: 10.2 },
      { label: 'Q2-26', value: 11.1, peer: 10.3 },
    ],
    rateShock: [
      { scenario: '+200 bps', niiChange: -4.2, eveChange: -8.1 },
      { scenario: '+100 bps', niiChange: -2.1, eveChange: -4.3 },
      { scenario: '-100 bps', niiChange: 1.8, eveChange: 3.5 },
      { scenario: '-200 bps', niiChange: 3.2, eveChange: 6.8 },
    ],
  },
  'cooperativa-ejemplo-centro': {
    slug: 'cooperativa-ejemplo-centro',
    name: 'Cooperativa de Ahorro y Credito Ejemplo Centro',
    nameEs: 'Cooperativa Ejemplo Centro',
    location: 'Municipio A, PR',
    assets: 2800,
    capitalRatio: 11.3,
    loanToShare: 72.1,
    lcr: 125,
    nim: 3.48,
    durationGap: 2.1,
    niiSensitivity: -5.1,
    camelScore: 2,
    niiTrend: [
      { label: 'Q1-25', value: 24.1, peer: 9.8 },
      { label: 'Q2-25', value: 24.8, peer: 9.9 },
      { label: 'Q3-25', value: 25.2, peer: 10.1 },
      { label: 'Q4-25', value: 24.6, peer: 10.0 },
      { label: 'Q1-26', value: 25.5, peer: 10.2 },
      { label: 'Q2-26', value: 25.9, peer: 10.3 },
    ],
    rateShock: [
      { scenario: '+200 bps', niiChange: -5.1, eveChange: -9.4 },
      { scenario: '+100 bps', niiChange: -2.6, eveChange: -4.8 },
      { scenario: '-100 bps', niiChange: 2.2, eveChange: 4.1 },
      { scenario: '-200 bps', niiChange: 3.8, eveChange: 7.6 },
    ],
  },
  'cooperativa-ejemplo-norte': {
    slug: 'cooperativa-ejemplo-norte',
    name: 'Cooperativa de Ahorro y Credito Ejemplo Norte',
    nameEs: 'Cooperativa Ejemplo Norte',
    location: 'Municipio B, PR',
    assets: 950,
    capitalRatio: 9.4,
    loanToShare: 75.3,
    lcr: 108,
    nim: 3.78,
    durationGap: 1.5,
    niiSensitivity: -3.8,
    camelScore: 2,
    niiTrend: [
      { label: 'Q1-25', value: 8.9, peer: 9.8 },
      { label: 'Q2-25', value: 9.1, peer: 9.9 },
      { label: 'Q3-25', value: 9.4, peer: 10.1 },
      { label: 'Q4-25', value: 9.2, peer: 10.0 },
      { label: 'Q1-26', value: 9.6, peer: 10.2 },
      { label: 'Q2-26', value: 9.8, peer: 10.3 },
    ],
    rateShock: [
      { scenario: '+200 bps', niiChange: -3.8, eveChange: -7.2 },
      { scenario: '+100 bps', niiChange: -1.9, eveChange: -3.7 },
      { scenario: '-100 bps', niiChange: 1.5, eveChange: 2.9 },
      { scenario: '-200 bps', niiChange: 2.8, eveChange: 5.6 },
    ],
  },
};

@Injectable()
export class PreviewReportService {
  private readonly logger = new Logger(PreviewReportService.name);

  getPreviewDefinition(slug: string): PreviewReportDefinition {
    const preview = PREVIEW_REPORTS[slug];
    if (!preview) {
      throw new NotFoundException(`Preview report not found for slug ${slug}`);
    }
    return preview;
  }

  async generatePreviewReport(
    slug: string,
    language: 'en' | 'es' = 'es',
    watermark = 'PREVIEW DOCUMENT — FOR REVIEW PURPOSES ONLY',
  ): Promise<Buffer> {
    const preview = this.getPreviewDefinition(slug);
    this.logger.log(`Generating preview report for ${slug} (lang=${language})`);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'letter',
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        info: {
          Title: `PREVIEW — ${preview.name}`,
          Subject:
            'Preview document generated from public data and benchmark assumptions. Not a substitute for a full institution analysis.',
          Author: 'CerniQ ALM Platform',
          Creator: 'CerniQ Preview Report Generator',
          Keywords: 'preview, demonstration, benchmark, CerniQ',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const isEs = language === 'es';
      const t = (en: string, es: string) => (isEs ? es : en);
      const formatter = createReportFormatter(language, {
        moneyScale: inferMoneyScale([preview.assets]),
      });
      const fmtPct = (value: number) => formatter.percent(value, 1);
      const assetsMetric = formatter.moneyWithCompact(preview.assets);

      doc.rect(0, 0, doc.page.width, 96).fill(REPORT_THEME.dark);
      doc
        .fill('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('CERNIQ', 60, 28);
      doc
        .fontSize(12)
        .font('Helvetica')
        .text(
          t(
            'Institution preview document',
            'Documento de vista previa institucional',
          ),
          60,
          58,
        );

      this.drawWatermark(doc, watermark);

      doc
        .fill('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(22)
        .text(t('Preview report', 'Documento de vista previa'), 60, 130);
      doc
        .fontSize(16)
        .fill(REPORT_THEME.brandAlt)
        .text(isEs ? preview.nameEs : preview.name, 60, 164);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fill(REPORT_THEME.body)
        .text(
          `${preview.location} | ${assetsMetric.exact} ${t('in assets', 'en activos')} | ${new Date().toLocaleDateString(
            isEs ? 'es-PR' : 'en-US',
            { year: 'numeric', month: 'long', day: 'numeric' },
          )}`,
          60,
          188,
        );
      if (assetsMetric.compact) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fill(REPORT_THEME.muted)
          .text(
            t(
              `Compact scale: ${assetsMetric.compact}`,
              `Escala compacta: ${assetsMetric.compact}`,
            ),
            60,
            204,
          );
      }

      this.drawKpiGrid(doc, [
        [t('Capital ratio', 'Ratio de capital'), fmtPct(preview.capitalRatio)],
        [t('Loan/share', 'Prestamos/acciones'), fmtPct(preview.loanToShare)],
        ['LCR', fmtPct(preview.lcr)],
        ['NIM', fmtPct(preview.nim)],
        [
          t('Duration gap', 'Brecha de duracion'),
          `${preview.durationGap.toFixed(1)}yr`,
        ],
        [
          t('NII sensitivity', 'Sensibilidad NII'),
          fmtPct(preview.niiSensitivity),
        ],
      ]);

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fill('#0f172a')
        .text(
          t(
            'Trend and scenario highlights',
            'Hallazgos de tendencia y escenario',
          ),
          60,
          350,
        );

      let y = 376;
      for (const point of preview.niiTrend.slice(-4)) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fill(REPORT_THEME.heading)
          .text(
            `${point.label}: ${formatter.money(point.value)} ${t('vs sector median', 'vs mediana sector')} ${formatter.money(point.peer)}`,
            72,
            y,
          );
        y += 18;
      }

      y += 10;
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fill('#0f172a')
        .text(t('Rate shock summary', 'Resumen de shocks de tasa'), 60, y);
      y += 24;
      for (const shock of preview.rateShock) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fill(REPORT_THEME.heading)
          .text(
            `${shock.scenario}: NII ${fmtPct(shock.niiChange)} | EVE ${fmtPct(shock.eveChange)}`,
            72,
            y,
          );
        y += 18;
      }

      doc.addPage();
      this.drawWatermark(doc, watermark);
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fill('#0f172a')
        .text(
          t('What this document is for', 'Para que sirve este documento'),
          60,
          72,
        );
      doc
        .font('Helvetica')
        .fontSize(11)
        .fill('#475569')
        .text(
          t(
            'This preview is designed for team review, stakeholder alignment, and follow-up discussion. It is generated from public data and benchmark assumptions, and it is not a substitute for a full institution run.',
            'Esta vista previa esta diseñada para revision del equipo, alineacion de partes interesadas y discusiones de seguimiento. Se genera con datos publicos y supuestos de benchmark, y no sustituye una corrida completa de la institucion.',
          ),
          60,
          102,
          { width: 492, lineGap: 4 },
        );

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fill('#0f172a')
        .text(
          t(
            'Included in a full CERNIQ delivery',
            'Incluido en una entrega completa de CERNIQ',
          ),
          60,
          176,
        );

      const bullets = [
        t(
          'Bilingual board-ready ALM report',
          'Informe ALM bilingue listo para junta',
        ),
        t(
          'Scenario testing and Monte Carlo analysis',
          'Pruebas de escenarios y analisis Monte Carlo',
        ),
        t(
          'Regulatory framing and institution-specific recommendations',
          'Marco regulatorio y recomendaciones especificas',
        ),
        t(
          'Team-ready download package for review and distribution',
          'Paquete descargable listo para revision y distribucion',
        ),
      ];
      let bulletY = 204;
      for (const bullet of bullets) {
        doc.circle(67, bulletY + 6, 2).fill('#0ea5e9');
        doc
          .font('Helvetica')
          .fontSize(11)
          .fill('#334155')
          .text(bullet, 78, bulletY, { width: 474 });
        bulletY += 26;
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fill('#0f172a')
        .text(t('Disclaimer', 'Aviso'), 60, 336);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#64748b')
        .text(
          t(
            'This preview document is based on public data, benchmark assumptions, and illustrative estimates. Review with qualified finance, risk, and regulatory stakeholders before taking action.',
            'Este documento de vista previa se basa en datos publicos, supuestos de benchmark y estimados ilustrativos. Reviselo con responsables calificados de finanzas, riesgo y regulacion antes de tomar accion.',
          ),
          60,
          356,
          { width: 492, lineGap: 4 },
        );

      doc.end();
    });
  }

  private drawKpiGrid(doc: typeof PDFDocument, items: string[][]) {
    const left = 60;
    const top = 232;
    const cardWidth = 152;
    const cardHeight = 78;
    const gap = 12;

    items.forEach(([label, value], index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const x = left + col * (cardWidth + gap);
      const y = top + row * (cardHeight + gap);
      doc.roundedRect(x, y, cardWidth, cardHeight, 12).fill(REPORT_THEME.panel);
      doc
        .fill(REPORT_THEME.muted)
        .font('Helvetica')
        .fontSize(9)
        .text(label, x + 14, y + 14, { width: cardWidth - 28 });
      doc
        .fill(REPORT_THEME.heading)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(value, x + 14, y + 34, { width: cardWidth - 28 });
    });
  }

  private drawWatermark(doc: typeof PDFDocument, watermark: string) {
    doc.save();
    doc.rotate(-25, { origin: [306, 396] });
    doc
      .fillColor('#cbd5e1')
      .opacity(0.35)
      .font('Helvetica-Bold')
      .fontSize(28)
      .text(watermark, 70, 360, {
        width: 500,
        align: 'center',
      });
    doc.restore();
    doc.opacity(1);
  }
}
