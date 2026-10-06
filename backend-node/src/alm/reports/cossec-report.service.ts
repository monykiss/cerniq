/**
 * COSSEC Report Generator — push-button regulatory report (Layer 1, #2).
 *
 * Produces the downloadable PDF a cooperativa hands to COSSEC: the 12-ratio
 * compliance matrix (capital adequacy, loan portfolio quality, liquidity),
 * conclusion-first summary, and traffic-light status per ratio.
 *
 * Design contract:
 * - SPANISH-FIRST. The default report is written in PR cooperativa Spanish
 *   (razón de capital, tasa de morosidad, provisión para pérdidas). English
 *   is the secondary `lang=en` variant.
 * - Conclusions first, data second. The first page tells the Presidente
 *   Ejecutivo "Su razón de capital es 12.3% — sobre el mínimo de 8% que
 *   requiere COSSEC", not a wall of numbers.
 * - D1: when the compliance engine reports data_unavailable or carries
 *   gaps, the PDF renders an explicit "DATOS PENDIENTES" section. Never
 *   phantom zeros.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  AlmEnterpriseService,
  type COSSECComplianceResult,
  type CossecRatioResult,
} from '../alm-enterprise.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

export type CossecReportLang = 'es' | 'en';

export interface CossecReportPdf {
  buffer: Buffer;
  filename: string;
  compliance: COSSECComplianceResult;
}

// Traffic-light palette (print-safe).
const COLOR = {
  green: '#1a7f37',
  yellow: '#b58900',
  red: '#b42318',
  gray: '#6b7280',
  ink: '#111827',
  muted: '#4b5563',
  line: '#d1d5db',
  bandGreen: '#e7f5ec',
  bandYellow: '#fdf3d7',
  bandRed: '#fbeae9',
  bandGray: '#f3f4f6',
} as const;

const T = {
  es: {
    title: 'Informe de Cumplimiento Regulatorio COSSEC',
    subtitle:
      'Corporación Pública para la Supervisión y Seguro de Cooperativas de Puerto Rico',
    generated: 'Generado',
    institution: 'Cooperativa',
    reportingDate: 'Fecha de referencia',
    overall: {
      compliant: 'CUMPLE',
      conditional: 'CUMPLE CON OBSERVACIONES',
      'non-compliant': 'NO CUMPLE',
      data_unavailable: 'DATOS INSUFICIENTES',
    } as Record<string, string>,
    overallLead: {
      compliant:
        'La cooperativa cumple con los indicadores regulatorios de COSSEC evaluados en este informe.',
      conditional:
        'La cooperativa cumple en general, con indicadores bajo observación que la Junta debe atender.',
      'non-compliant':
        'Uno o más indicadores regulatorios están fuera del umbral de COSSEC y requieren acción correctiva.',
      data_unavailable:
        'No fue posible calcular los indicadores: faltan datos del balance. Vea la sección "Datos pendientes".',
    } as Record<string, string>,
    conclusionsTitle: 'Conclusiones principales',
    ratioTable: 'Matriz de indicadores COSSEC',
    colIndicator: 'Indicador',
    colValue: 'Valor',
    colThreshold: 'Umbral',
    colStatus: 'Estado',
    status: {
      pass: 'CUMPLE',
      warning: 'OBSERVACIÓN',
      fail: 'NO CUMPLE',
      info: 'INFORMATIVO',
      data_unavailable: 'SIN DATOS',
    } as Record<string, string>,
    sections: {
      capital: 'Suficiencia de capital',
      asset_quality: 'Calidad de la cartera de préstamos',
      liquidity: 'Liquidez',
      sensitivity: 'Sensibilidad a tasas de interés',
      earnings: 'Rendimiento',
    } as Record<string, string>,
    summaryTitle: 'Resumen del balance',
    totalAssets: 'Activos totales',
    equity: 'Capital (patrimonio)',
    totalLoans: 'Cartera de préstamos',
    totalShares: 'Depósitos y acciones de socios',
    liquidAssets: 'Activos líquidos',
    examScore: 'Puntuación de preparación para examen',
    gapsTitle: 'Datos pendientes',
    gapsLead:
      'Los siguientes datos no estaban disponibles al generar este informe. Los indicadores afectados se muestran como "SIN DATOS" — nunca como cero.',
    footer:
      'Generado por CERNIQ — Inteligencia de cumplimiento para cooperativas de Puerto Rico. Este informe es una herramienta de gestión; no sustituye los estados auditados.',
    millions: 'M',
  },
  en: {
    title: 'COSSEC Regulatory Compliance Report',
    subtitle:
      'Public Corporation for the Supervision and Insurance of Cooperatives of Puerto Rico',
    generated: 'Generated',
    institution: 'Cooperative',
    reportingDate: 'As-of date',
    overall: {
      compliant: 'COMPLIANT',
      conditional: 'COMPLIANT WITH OBSERVATIONS',
      'non-compliant': 'NON-COMPLIANT',
      data_unavailable: 'INSUFFICIENT DATA',
    } as Record<string, string>,
    overallLead: {
      compliant:
        'The cooperative meets the COSSEC regulatory indicators evaluated in this report.',
      conditional:
        'The cooperative is broadly compliant, with indicators under observation requiring Board attention.',
      'non-compliant':
        'One or more regulatory indicators are outside COSSEC thresholds and require corrective action.',
      data_unavailable:
        'Indicators could not be computed: balance sheet data is missing. See "Pending data".',
    } as Record<string, string>,
    conclusionsTitle: 'Key conclusions',
    ratioTable: 'COSSEC indicator matrix',
    colIndicator: 'Indicator',
    colValue: 'Value',
    colThreshold: 'Threshold',
    colStatus: 'Status',
    status: {
      pass: 'PASS',
      warning: 'WATCH',
      fail: 'FAIL',
      info: 'INFO',
      data_unavailable: 'NO DATA',
    } as Record<string, string>,
    sections: {
      capital: 'Capital adequacy',
      asset_quality: 'Loan portfolio quality',
      liquidity: 'Liquidity',
      sensitivity: 'Interest rate sensitivity',
      earnings: 'Earnings',
    } as Record<string, string>,
    summaryTitle: 'Balance sheet summary',
    totalAssets: 'Total assets',
    equity: 'Equity (net worth)',
    totalLoans: 'Loan portfolio',
    totalShares: 'Member deposits & shares',
    liquidAssets: 'Liquid assets',
    examScore: 'Exam readiness score',
    gapsTitle: 'Pending data',
    gapsLead:
      'The following inputs were unavailable when this report was generated. Affected indicators render as "NO DATA" — never as zero.',
    footer:
      'Generated by CERNIQ — Compliance intelligence for Puerto Rico cooperatives. This report is a management tool; it does not replace audited statements.',
    millions: 'M',
  },
} as const;

function statusColor(status: CossecRatioResult['status']): string {
  switch (status) {
    case 'pass':
      return COLOR.green;
    case 'warning':
      return COLOR.yellow;
    case 'fail':
      return COLOR.red;
    default:
      return COLOR.gray;
  }
}

function statusBand(status: CossecRatioResult['status']): string {
  switch (status) {
    case 'pass':
      return COLOR.bandGreen;
    case 'warning':
      return COLOR.bandYellow;
    case 'fail':
      return COLOR.bandRed;
    default:
      return COLOR.bandGray;
  }
}

function fmtMoney(v: number, lang: CossecReportLang): string {
  const locale = lang === 'es' ? 'es-PR' : 'en-US';
  return `$${v.toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
}

function fmtValue(r: CossecRatioResult): string {
  if (r.status === 'data_unavailable') return '—';
  const v = Math.round(r.value * 10) / 10;
  return r.unit === '%' ? `${v}%` : `${v}`;
}

@Injectable()
export class CossecReportService {
  private readonly logger = new Logger(CossecReportService.name);

  constructor(private readonly almEnterprise: AlmEnterpriseService) {}

  /**
   * Push-button COSSEC report: compute compliance, render the PDF, return
   * the buffer. Spanish by default; English on request.
   */
  async generateCossecReportPdf(
    institutionId: string,
    lang: CossecReportLang = 'es',
  ): Promise<CossecReportPdf> {
    const compliance =
      await this.almEnterprise.getCOSSECCompliance(institutionId);

    const buffer = await this.renderPdf(compliance, lang);
    const datePart = new Date().toISOString().slice(0, 10);
    const namePart = compliance.institutionName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const filename =
      lang === 'es'
        ? `informe-cossec-${namePart}-${datePart}.pdf`
        : `cossec-report-${namePart}-${datePart}.pdf`;

    this.logger.log({
      event: 'cossec_report_generated',
      institutionId,
      lang,
      overallStatus: compliance.overallStatus,
      bytes: buffer.length,
    });

    return { buffer, filename, compliance };
  }

  /** Conclusion-first sentences for the executive (CEO-readable, no jargon). */
  buildConclusions(
    c: COSSECComplianceResult,
    lang: CossecReportLang,
  ): string[] {
    const t = T[lang];
    const out: string[] = [];
    if (c.overallStatus === 'data_unavailable') {
      out.push(t.overallLead.data_unavailable);
      return out;
    }
    const s = c.summary;
    // Statutory capital ratio (Ley 255 Art. 6.02): capital indivisible (net-worth
    // proxy) ÷ activos sujetos a riesgo. Falls back to the leverage ratio only if
    // the RWA figure is absent. The proxy basis is disclosed in the gaps section.
    const capRatio = s.capitalRatioRWA ?? s.capitalRatio;
    if (lang === 'es') {
      out.push(
        `Su capital (estimado con el patrimonio) es ${capRatio.toFixed(1)}% de los activos sujetos a riesgo — ${
          capRatio >= 8 ? 'sobre' : 'bajo'
        } el mínimo de 8% (Ley 255 Art. 6.02). Estimación — vea "Datos pendientes" para la base de cálculo.`,
      );
      out.push(
        `La liquidez es ${s.liquidityRatio.toFixed(1)}% de los activos — ${
          s.liquidityRatio >= 5 ? 'cumple' : 'no alcanza'
        } el mínimo operacional de 5% (COSSEC CC-2021-02).`,
      );
      out.push(
        `Los préstamos representan ${s.loanToShareRatio.toFixed(0)}% de los depósitos de socios — ${
          s.loanToShareRatio <= 80 ? 'dentro de' : 'por encima de'
        } la meta de 80%.`,
      );
    } else {
      out.push(
        `Your capital (estimated from net worth) is ${capRatio.toFixed(1)}% of risk-weighted assets — ${
          capRatio >= 8 ? 'above' : 'below'
        } the 8% minimum (Act 255 §6.02). Estimate — see "Pending data" for the calculation basis.`,
      );
      out.push(
        `Liquidity stands at ${s.liquidityRatio.toFixed(1)}% of assets — ${
          s.liquidityRatio >= 5 ? 'meeting' : 'short of'
        } the 5% operational minimum (COSSEC CC-2021-02).`,
      );
      out.push(
        `Loans are ${s.loanToShareRatio.toFixed(0)}% of member deposits — ${
          s.loanToShareRatio <= 80 ? 'within' : 'above'
        } the 80% target.`,
      );
    }
    const failing = c.ratios.filter((r) => r.status === 'fail');
    if (failing.length > 0) {
      out.push(
        lang === 'es'
          ? `Atención requerida: ${failing.map((r) => r.nameEs).join(', ')}.`
          : `Attention required: ${failing.map((r) => r.name).join(', ')}.`,
      );
    }
    return out;
  }

  private renderPdf(
    c: COSSECComplianceResult,
    lang: CossecReportLang,
  ): Promise<Buffer> {
    const t = T[lang];
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 54, bottom: 54, left: 54, right: 54 },
        info: { Title: t.title, Author: 'CERNIQ' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const left = doc.page.margins.left;

      // ── Header ──
      doc
        .fillColor(COLOR.ink)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(t.title, { width: pageWidth });
      doc
        .moveDown(0.2)
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLOR.muted)
        .text(t.subtitle, { width: pageWidth });
      doc.moveDown(0.6);
      doc
        .fontSize(10)
        .fillColor(COLOR.ink)
        .text(`${t.institution}: ${c.institutionName}`)
        .text(
          `${t.reportingDate}: ${new Date(c.reportingDate).toLocaleDateString(
            lang === 'es' ? 'es-PR' : 'en-US',
          )}   ·   ${t.generated}: ${new Date().toLocaleDateString(
            lang === 'es' ? 'es-PR' : 'en-US',
          )}`,
        );
      doc.moveDown(0.8);

      // ── Overall status banner (traffic light) ──
      const bannerColor =
        c.overallStatus === 'compliant'
          ? COLOR.green
          : c.overallStatus === 'conditional'
            ? COLOR.yellow
            : c.overallStatus === 'non-compliant'
              ? COLOR.red
              : COLOR.gray;
      const bannerY = doc.y;
      doc
        .rect(left, bannerY, pageWidth, 44)
        .fill(bannerColor)
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text(
          t.overall[c.overallStatus] ?? c.overallStatus,
          left + 14,
          bannerY + 13,
          {
            width: pageWidth - 28,
          },
        );
      doc.y = bannerY + 56;
      doc.x = left;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLOR.ink)
        .text(t.overallLead[c.overallStatus] ?? '', left, doc.y, {
          width: pageWidth,
        });
      doc.moveDown(1);

      // ── Conclusions first ──
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(COLOR.ink)
        .text(t.conclusionsTitle, left, doc.y);
      doc.moveDown(0.4);
      for (const line of this.buildConclusions(c, lang)) {
        doc
          .font('Helvetica')
          .fontSize(10.5)
          .fillColor(COLOR.ink)
          .text(`•  ${line}`, left + 6, doc.y, { width: pageWidth - 12 });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.6);

      // ── Balance sheet summary ──
      if (c.overallStatus !== 'data_unavailable') {
        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .text(t.summaryTitle, left, doc.y);
        doc.moveDown(0.4);
        const s = c.summary;
        const rows: Array<[string, string]> = [
          [t.totalAssets, fmtMoney(s.totalAssets, lang)],
          [t.equity, fmtMoney(s.equity, lang)],
          [t.totalLoans, fmtMoney(s.totalLoans, lang)],
          [t.totalShares, fmtMoney(s.totalShares, lang)],
          [t.liquidAssets, fmtMoney(s.liquidAssets, lang)],
        ];
        for (const [label, value] of rows) {
          const y = doc.y;
          doc
            .font('Helvetica')
            .fontSize(10)
            .fillColor(COLOR.muted)
            .text(label, left + 6, y, { width: pageWidth * 0.6 });
          doc
            .font('Helvetica-Bold')
            .fillColor(COLOR.ink)
            .text(value, left + pageWidth * 0.6, y, {
              width: pageWidth * 0.4 - 6,
              align: 'right',
            });
          doc.moveDown(0.25);
        }
        doc.moveDown(0.8);
      }

      // ── Ratio matrix grouped by section ──
      doc.font('Helvetica-Bold').fontSize(13).text(t.ratioTable, left, doc.y);
      doc.moveDown(0.5);

      const categories = [
        'capital',
        'asset_quality',
        'liquidity',
        'sensitivity',
        'earnings',
      ];
      const catOf = (r: CossecRatioResult): string => {
        // Mirror the framework's categorization by ratio id.
        if (r.id === 1) return 'capital';
        if (r.id === 2 || r.id === 8) return 'asset_quality';
        if (r.id === 3 || r.id === 4 || r.id === 9) return 'liquidity';
        if (r.id === 5 || r.id === 6 || r.id === 7) return 'sensitivity';
        return 'earnings';
      };

      const colW = [
        pageWidth * 0.42,
        pageWidth * 0.16,
        pageWidth * 0.2,
        pageWidth * 0.22,
      ];

      const drawHeaderRow = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLOR.muted);
        doc.text(t.colIndicator, left, y, { width: colW[0] });
        doc.text(t.colValue, left + colW[0], y, {
          width: colW[1],
          align: 'right',
        });
        doc.text(t.colThreshold, left + colW[0] + colW[1] + 8, y, {
          width: colW[2],
        });
        doc.text(t.colStatus, left + colW[0] + colW[1] + colW[2] + 8, y, {
          width: colW[3] - 8,
          align: 'right',
        });
        doc.moveDown(0.2);
        doc
          .moveTo(left, doc.y)
          .lineTo(left + pageWidth, doc.y)
          .strokeColor(COLOR.line)
          .lineWidth(0.5)
          .stroke();
        doc.moveDown(0.25);
      };

      for (const cat of categories) {
        const ratios = c.ratios.filter((r) => catOf(r) === cat);
        if (ratios.length === 0) continue;

        if (doc.y > doc.page.height - 160) doc.addPage();

        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor(COLOR.ink)
          .text(t.sections[cat], left, doc.y);
        doc.moveDown(0.3);
        drawHeaderRow();

        for (const r of ratios) {
          if (doc.y > doc.page.height - 110) doc.addPage();
          const y = doc.y;
          const rowH = 26;
          doc.rect(left, y - 3, pageWidth, rowH).fill(statusBand(r.status));
          doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor(COLOR.ink)
            .text(lang === 'es' ? r.nameEs : r.name, left + 6, y, {
              width: colW[0] - 6,
            });
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .text(fmtValue(r), left + colW[0], y, {
              width: colW[1],
              align: 'right',
            });
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLOR.muted)
            .text(r.threshold, left + colW[0] + colW[1] + 8, y, {
              width: colW[2],
            });
          doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor(statusColor(r.status))
            .text(
              t.status[r.status] ?? r.status,
              left + colW[0] + colW[1] + colW[2] + 8,
              y,
              { width: colW[3] - 8, align: 'right' },
            );
          doc.y = y + rowH;
          doc.x = left;
        }
        doc.moveDown(0.6);
      }

      // ── Exam readiness ──
      if (c.overallStatus !== 'data_unavailable') {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor(COLOR.ink)
          .text(
            `${t.examScore}: ${Math.round(c.examReadinessScore)} / 100`,
            left,
            doc.y,
          );
        doc.moveDown(0.8);
      }

      // ── Data gaps (D1 disclosure) ──
      if (c.gaps && c.gaps.length > 0) {
        if (doc.y > doc.page.height - 180) doc.addPage();
        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .fillColor(COLOR.red)
          .text(t.gapsTitle, left, doc.y);
        doc.moveDown(0.3);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor(COLOR.muted)
          .text(t.gapsLead, left, doc.y, { width: pageWidth });
        doc.moveDown(0.4);
        for (const g of c.gaps) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor(COLOR.ink)
            .text(
              `•  [${g.severity}] ${g.field} — ${g.action}`,
              left + 6,
              doc.y,
              {
                width: pageWidth - 12,
              },
            );
          doc.moveDown(0.25);
        }
      }

      // ── Footer ──
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLOR.gray)
        .text(t.footer, left, doc.page.height - doc.page.margins.bottom - 24, {
          width: pageWidth,
        });

      doc.end();
    });
  }
}
