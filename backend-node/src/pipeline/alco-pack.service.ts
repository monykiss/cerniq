import { Injectable, Logger } from '@nestjs/common';
import {
  AlmEnterpriseService,
  COSSECComplianceResult,
  ALMSummaryResult,
} from '../alm/alm-enterprise.service';
import {
  StressTestingService,
  StressTestResult,
} from '../alm/stress-testing/stress-testing.service';
import { PrismaService } from '../prisma.service';
import {
  createReportFormatter,
  inferMoneyScale,
} from '../alm/reports/report-formatting';

const PDFDocument = require('pdfkit');

@Injectable()
export class AlcoPackService {
  private readonly logger = new Logger(AlcoPackService.name);

  constructor(
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly stressTesting: StressTestingService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Build the 8-page ALCO Meeting Pack PDF on demand.
   * Presentation format: big numbers, traffic lights, minimal text.
   */
  async buildALCOPack(
    institutionId: string,
    language: string,
  ): Promise<Buffer> {
    this.logger.log({
      event: 'alco_pack.build.start',
      institutionId,
      language,
    });

    const [cossec, summary, stressTest, institution] = await Promise.all([
      this.almEnterprise.getCOSSECCompliance(institutionId),
      this.almEnterprise.getALMSummary(institutionId),
      this.stressTesting.runFullStressTest(institutionId, {
        paths: 500,
        horizon: 12,
      }),
      this.almEnterprise.getInstitution(institutionId),
    ]);

    const pdf = await this.generatePDF(
      institution,
      cossec,
      summary,
      stressTest,
      language,
    );
    this.logger.log({
      event: 'alco_pack.build.complete',
      institutionId,
      pages: 8,
    });
    return pdf;
  }

  private generatePDF(
    institution: any,
    cossec: COSSECComplianceResult,
    summary: ALMSummaryResult,
    stressTest: StressTestResult,
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
      const formatter = createReportFormatter(isEs ? 'es' : 'en', {
        moneyScale: inferMoneyScale([
          institution?.totalAssets,
          summary?.institution?.totalAssets,
          cossec?.summary?.totalAssets,
          summary?.liquidity?.hqla,
          summary?.liquidity?.netOutflows,
        ]),
      });
      // D1: nullable fmtM. Renders `—` for missing inputs (D1 contract). The
      // `|| 0` collapse pattern is exactly what we're killing — it would
      // silently print "$0.0M" for a missing field.
      const fmtM = (v: number | null | undefined) =>
        v === null || v === undefined ? '—' : formatter.money(v);
      // D1: nullable fmtPct so missing fields render as `—` instead of `0.0%`.
      // The presenter is the last line of defense — silent zero here would
      // sneak past the gap manifest. Always render `—` when input is null.
      const fmtPct = (v: number | null | undefined) =>
        v === null || v === undefined ? '—' : `${v.toFixed(1)}%`;
      const PW = 612;
      const ML = 60;
      const MR = 60;
      const CW = PW - ML - MR;
      let pageNum = 0;

      // ── Reusable helpers (same style as pipeline.worker.ts) ──

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
        doc.text(
          t('PAQUETE ALCO — CONFIDENCIAL', 'ALCO PACK — CONFIDENTIAL'),
          PW / 2 - 60,
          752,
          { width: 120, align: 'center', lineBreak: false },
        );
        doc.text(`${t('Pag.', 'Pg.')} ${pageNum}/8`, PW - MR - 40, 752, {
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

      // Helper: draw a traffic light square
      const trafficLight = (
        x: number,
        y: number,
        w: number,
        h: number,
        label: string,
        value: string,
        status: string,
      ) => {
        const clr = statusClr(status);
        doc.rect(x, y, w, h).fill(clr);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(22)
          .text(value, x, y + 15, { width: w, align: 'center' });
        doc
          .fill('#FFFFFF')
          .font('Helvetica')
          .fontSize(9)
          .text(label, x, y + h - 28, { width: w, align: 'center' });
        // Small status label at bottom
        const statusLabel =
          status === 'pass'
            ? t('CUMPLE', 'PASS')
            : status === 'warning'
              ? t('ALERTA', 'WARN')
              : t('FALLO', 'FAIL');
        doc
          .fill('rgba(255,255,255,0.7)')
          .font('Helvetica')
          .fontSize(7)
          .text(statusLabel, x, y + h - 14, { width: w, align: 'center' });
      };

      // ═══════════════════════════════════════════════════════════
      // PAGE 1: INSTITUTION STATUS DASHBOARD
      // ═══════════════════════════════════════════════════════════
      // Full navy header band for cover
      doc.rect(0, 0, PW, 120).fill('#1B3A6B');
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('CERNIQ', ML, 20);
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(24)
        .text(t('PAQUETE ALCO', 'ALCO MEETING PACK'), ML, 50);
      doc
        .fill('#FFFFFF')
        .font('Helvetica')
        .fontSize(10)
        .text(
          t('Comite de Activos y Pasivos', 'Asset Liability Committee'),
          ML,
          82,
        );
      doc
        .fill('#FFFFFF')
        .font('Helvetica')
        .fontSize(9)
        .text(
          new Date().toLocaleDateString(isEs ? 'es-PR' : 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          PW - MR - 200,
          82,
          { width: 200, align: 'right' },
        );
      drawFooter();

      // Institution name
      let y = 140;
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(institution?.name || 'Institution', ML, y);
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(10)
        .text(
          `${institution?.type || 'Cooperativa'} | ${institution?.currency || 'USD'}`,
          ML,
          y + 28,
        );
      y += 55;

      // COSSEC Readiness Score — large circular gauge
      const examReadiness = cossec.examReadinessScore ?? 0;
      const readinessColor =
        examReadiness >= 80
          ? '#16A34A'
          : examReadiness >= 50
            ? '#D97706'
            : '#DC2626';

      // Draw gauge circle
      const gaugeX = ML + 60;
      const gaugeY = y + 60;
      const gaugeR = 55;
      doc.circle(gaugeX, gaugeY, gaugeR).fill('#F1F5F9');
      // Progress arc (fill a wedge) - simulated with a colored inner circle
      doc.circle(gaugeX, gaugeY, gaugeR - 5).fill(readinessColor);
      doc.circle(gaugeX, gaugeY, gaugeR - 14).fill('#FFFFFF');
      // Score number
      doc
        .fill(readinessColor)
        .font('Helvetica-Bold')
        .fontSize(32)
        .text(`${examReadiness}`, gaugeX - 30, gaugeY - 18, {
          width: 60,
          align: 'center',
        });
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(7)
        .text('/100', gaugeX - 20, gaugeY + 16, { width: 40, align: 'center' });
      doc
        .fill('#64748B')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(
          t('COSSEC Readiness', 'COSSEC Readiness'),
          gaugeX - 50,
          gaugeY + gaugeR + 10,
          { width: 100, align: 'center' },
        );

      // 4 traffic light squares (2x2 grid)
      const gridX = ML + 180;
      const gridY = y;
      const sqW = 130;
      const sqH = 60;
      const sqGap = 10;

      // Determine statuses
      const capitalStatus =
        cossec.summary.capitalRatio >= 8
          ? 'pass'
          : cossec.summary.capitalRatio >= 6
            ? 'warning'
            : 'fail';
      const liquidityStatus =
        summary.liquidity.status === 'compliant'
          ? 'pass'
          : summary.liquidity.status === 'warning'
            ? 'warning'
            : 'fail';
      const rateRiskStatus =
        summary.niiSensitivity.riskRating === 'low'
          ? 'pass'
          : summary.niiSensitivity.riskRating === 'moderate'
            ? 'warning'
            : 'fail';
      // Credit quality: use asset quality ratio if available, default pass
      const assetQualityRatio = cossec.ratios?.find((r) => r.id === 2);
      const creditStatus = assetQualityRatio
        ? assetQualityRatio.status === 'info'
          ? 'pass'
          : assetQualityRatio.status
        : 'pass';

      trafficLight(
        gridX,
        gridY,
        sqW,
        sqH,
        t('Capital', 'Capital'),
        fmtPct(cossec.summary.capitalRatio),
        capitalStatus,
      );
      trafficLight(
        gridX + sqW + sqGap,
        gridY,
        sqW,
        sqH,
        t('Liquidez', 'Liquidity'),
        fmtPct(summary.liquidity.lcr),
        liquidityStatus,
      );
      trafficLight(
        gridX,
        gridY + sqH + sqGap,
        sqW,
        sqH,
        t('Riesgo de Tasa', 'Rate Risk'),
        summary.niiSensitivity.riskRating.toUpperCase(),
        rateRiskStatus,
      );
      trafficLight(
        gridX + sqW + sqGap,
        gridY + sqH + sqGap,
        sqW,
        sqH,
        t('Calidad Crediticia', 'Credit Quality'),
        creditStatus === 'pass' ? t('SANO', 'SOUND') : t('REVISE', 'REVIEW'),
        creditStatus,
      );

      y += 160;

      // Overall status bar
      const overallClr =
        cossec.overallStatus === 'compliant'
          ? '#16A34A'
          : cossec.overallStatus === 'conditional'
            ? '#D97706'
            : '#DC2626';
      const overallLabel =
        cossec.overallStatus === 'compliant'
          ? t(
              'CUMPLE — Listo para Examen COSSEC',
              'COMPLIANT — COSSEC Exam Ready',
            )
          : cossec.overallStatus === 'conditional'
            ? t(
                'CONDICIONAL — Requiere Atencion',
                'CONDITIONAL — Attention Required',
              )
            : t(
                'NO CUMPLE — Accion Inmediata',
                'NON-COMPLIANT — Immediate Action',
              );
      doc.rect(ML, y, CW, 30).fill(overallClr);
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(overallLabel, ML + 15, y + 8, { width: CW - 30 });

      // ═══════════════════════════════════════════════════════════
      // PAGE 2: BALANCE SHEET SNAPSHOT
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('PANORAMA DEL BALANCE', 'BALANCE SHEET SNAPSHOT'));
      drawFooter();

      const s = cossec.summary;

      // 3 summary metric cards
      const cardData: [string, string, string][] = [
        [t('Activos Totales', 'Total Assets'), fmtM(s.totalAssets), '#1ABFFF'],
        [
          t('Pasivos Totales', 'Total Liabilities'),
          fmtM(s.totalLiabilities),
          '#E8A020',
        ],
        [t('Capital', 'Equity'), fmtM(s.equity), '#16A34A'],
      ];
      let cx = ML;
      for (const [label, value, accent] of cardData) {
        doc.rect(cx, y, 150, 65).fill('#F0F9FF');
        doc.rect(cx, y, 4, 65).fill(accent);
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(22)
          .text(value, cx + 16, y + 10, { width: 126 });
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(9)
          .text(label, cx + 16, y + 40, { width: 126 });
        cx += 165;
      }
      y += 85;

      // 6-ratio comparison table
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(t('RAZONES CLAVE', 'KEY RATIOS'), ML, y);
      y += 20;

      const rw = [160, 90, 100, 80, 62];
      y = tblRow(
        y,
        [
          t('Razon', 'Ratio'),
          t('Valor', 'Value'),
          t('Umbral', 'Threshold'),
          t('Estado', 'Status'),
          '',
        ],
        rw,
        { bg: '#1B3A6B', header: true },
      );

      const ratioRows: [string, string, string, string, string][] = [
        [
          t('Adecuacion de Capital', 'Capital Adequacy'),
          fmtPct(s.capitalRatio),
          '>= 8.0%',
          s.capitalRatio >= 8 ? 'PASS' : s.capitalRatio >= 6 ? 'WARN' : 'FAIL',
          s.capitalRatio >= 8
            ? 'pass'
            : s.capitalRatio >= 6
              ? 'warning'
              : 'fail',
        ],
        [
          t('Prestamos / Depositos', 'Loan-to-Deposit'),
          fmtPct(s.loanToShareRatio),
          '<= 80%',
          s.loanToShareRatio <= 80
            ? 'PASS'
            : s.loanToShareRatio <= 100
              ? 'WARN'
              : 'FAIL',
          s.loanToShareRatio <= 80
            ? 'pass'
            : s.loanToShareRatio <= 100
              ? 'warning'
              : 'fail',
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
          s.liquidityRatio >= 20
            ? 'pass'
            : s.liquidityRatio >= 15
              ? 'warning'
              : 'fail',
        ],
        // D1: when LCR is null (data unavailable), render as DATA UNAVAILABLE
        // and route to neutral status. The presenter no longer pretends a
        // missing input is a "fail" — that signal would conflict with the
        // gap manifest the user is meant to see at the top of the report.
        [
          'LCR (Basel III)',
          fmtPct(summary.liquidity.lcr),
          '>= 100%',
          summary.liquidity.lcr === null
            ? 'DATA UNAVAILABLE'
            : summary.liquidity.lcr >= 120
              ? 'PASS'
              : summary.liquidity.lcr >= 100
                ? 'WARN'
                : 'FAIL',
          summary.liquidity.lcr === null
            ? 'info'
            : summary.liquidity.lcr >= 120
              ? 'pass'
              : summary.liquidity.lcr >= 100
                ? 'warning'
                : 'fail',
        ],
        [
          t('Margen de Interes Neto', 'Net Interest Margin'),
          fmtPct(s.nim),
          '>= 2.5%',
          s.nim >= 2.5 ? 'PASS' : s.nim >= 2.0 ? 'WARN' : 'FAIL',
          s.nim >= 2.5 ? 'pass' : s.nim >= 2.0 ? 'warning' : 'fail',
        ],
        [
          t('Brecha de Duracion', 'Duration Gap'),
          `${summary.durationGap.durationGap.toFixed(2)} yr`,
          '-1 to +3 yr',
          Math.abs(summary.durationGap.durationGap) <= 1
            ? 'PASS'
            : Math.abs(summary.durationGap.durationGap) <= 3
              ? 'WARN'
              : 'FAIL',
          Math.abs(summary.durationGap.durationGap) <= 1
            ? 'pass'
            : Math.abs(summary.durationGap.durationGap) <= 3
              ? 'warning'
              : 'fail',
        ],
      ];

      for (let i = 0; i < ratioRows.length; i++) {
        const [label, value, threshold, statusLabel, status] = ratioRows[i];
        y = tblRow(y, [label, value, threshold, statusLabel, ''], rw, {
          bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
        });
        // Color dot overlay for status column
        const dotX = ML + rw[0] + rw[1] + rw[2] + rw[3] + 10;
        doc.circle(dotX, y - 10, 5).fill(statusClr(status));
      }

      // ═══════════════════════════════════════════════════════════
      // PAGE 3: RATE RISK ANALYSIS
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('ANALISIS DE RIESGO DE TASA', 'RATE RISK ANALYSIS'));
      drawFooter();

      const nii = summary.niiSensitivity;
      const niiRatingClr =
        nii.riskRating === 'low'
          ? '#16A34A'
          : nii.riskRating === 'moderate'
            ? '#D97706'
            : '#DC2626';

      // Base NII + risk rating big display
      doc.rect(ML, y, 200, 60).fill('#F8FAFC');
      doc.rect(ML, y, 4, 60).fill('#1ABFFF');
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(28)
        .text(fmtM(nii.baseNII), ML + 18, y + 8);
      doc
        .fill('#64748B')
        .font('Helvetica')
        .fontSize(9)
        .text(t('NII Base', 'Base NII'), ML + 18, y + 40);

      doc.rect(ML + 220, y, 160, 60).fill(niiRatingClr);
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(nii.riskRating.toUpperCase(), ML + 220, y + 10, {
          width: 160,
          align: 'center',
        });
      doc
        .fill('#FFFFFF')
        .font('Helvetica')
        .fontSize(9)
        .text(t('Clasificacion de Riesgo', 'Risk Rating'), ML + 220, y + 38, {
          width: 160,
          align: 'center',
        });
      y += 80;

      // NII sensitivity table
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(t('SENSIBILIDAD NII', 'NII SENSITIVITY'), ML, y);
      y += 18;

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
          const sc = nii.scenarios[i];
          y = tblRow(
            y,
            [
              sc.name,
              `${sc.shiftBps > 0 ? '+' : ''}${sc.shiftBps}bps`,
              fmtM(sc.niImpact),
              `${sc.niImpactPct > 0 ? '+' : ''}${sc.niImpactPct.toFixed(1)}%`,
              fmtM(sc.mveImpact),
              `${sc.mveImpactPct > 0 ? '+' : ''}${sc.mveImpactPct.toFixed(1)}%`,
            ],
            sw,
            { bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' },
          );
        }
      }

      y += 25;

      // Duration gap visual (asset bar vs liability bar)
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(t('BRECHA DE DURACION', 'DURATION GAP'), ML, y);
      y += 18;

      const dg = summary.durationGap;
      const maxDur = Math.max(
        dg.assetDuration || 1,
        dg.liabilityDuration || 1,
        1,
      );
      const barMax = 300;

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fill('#1B3A6B')
        .text(t('Activos', 'Assets'), ML, y);
      doc.text(`${dg.assetDuration.toFixed(2)} yr`, ML + barMax + 20, y);
      y += 13;
      const assetBarW = Math.max(10, (dg.assetDuration / maxDur) * barMax);
      doc.rect(ML, y, assetBarW, 14).fill('#1ABFFF');
      y += 22;

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fill('#1B3A6B')
        .text(t('Pasivos', 'Liabilities'), ML, y);
      doc.text(`${dg.liabilityDuration.toFixed(2)} yr`, ML + barMax + 20, y);
      y += 13;
      const liabBarW = Math.max(10, (dg.liabilityDuration / maxDur) * barMax);
      doc.rect(ML, y, liabBarW, 14).fill('#E8A020');
      y += 25;

      const gapColor =
        Math.abs(dg.durationGap) < 1
          ? '#16A34A'
          : Math.abs(dg.durationGap) < 2.5
            ? '#D97706'
            : '#DC2626';
      doc.rect(ML, y, 200, 36).fill('#F8FAFC');
      doc.rect(ML, y, 4, 36).fill(gapColor);
      doc
        .fill(gapColor)
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(
          `${t('Brecha', 'Gap')}: ${dg.durationGap > 0 ? '+' : ''}${dg.durationGap.toFixed(2)} yr`,
          ML + 16,
          y + 8,
        );

      // ═══════════════════════════════════════════════════════════
      // PAGE 4: RATE ENVIRONMENT CONTEXT
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('ENTORNO DE TASAS', 'RATE ENVIRONMENT'));
      drawFooter();

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

      // NIM impact analysis
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(
          t('IMPACTO EN MARGEN DE INTERES (NIM)', 'NIM IMPACT ANALYSIS'),
          ML,
          y,
        );
      y += 20;

      const instNIM = s.nim ?? 0;
      const nimColor =
        instNIM >= 3.0 ? '#16A34A' : instNIM >= 2.0 ? '#D97706' : '#DC2626';

      doc.rect(ML, y, CW, 70).fill('#F8FAFC');
      doc.rect(ML, y, 4, 70).fill(nimColor);
      doc
        .fill(nimColor)
        .font('Helvetica-Bold')
        .fontSize(32)
        .text(`${instNIM.toFixed(2)}%`, ML + 20, y + 8);
      doc
        .fill('#475569')
        .font('Helvetica')
        .fontSize(10)
        .text(t('NIM Actual', 'Current NIM'), ML + 20, y + 44);

      const nimMX = ML + 200;
      doc.fill('#1F2937').font('Helvetica').fontSize(9);
      doc.text(
        `${t('Rendimiento Activos', 'Earning Assets Yield')}: ${(s.earningAssetsYield || 0).toFixed(2)}%`,
        nimMX,
        y + 12,
        { width: 280 },
      );
      doc.text(
        `${t('Costo de Fondos', 'Cost of Funds')}: ${(s.costOfFunds || 0).toFixed(2)}%`,
        nimMX,
        y + 28,
        { width: 280 },
      );
      doc.text(
        `${t('Mediana Sector PR', 'PR Sector Median')}: 3.2%`,
        nimMX,
        y + 44,
        { width: 280 },
      );

      y += 90;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#475569')
        .text(
          t(
            'Las tasas de referencia actuales del mercado influyen directamente en el margen de interes neto (NIM) y el costo de fondos de la institucion. Un entorno de tasas estables favorece la previsibilidad del margen.',
            "Current market reference rates directly influence the institution's net interest margin (NIM) and cost of funds. A stable rate environment supports margin predictability.",
          ),
          ML,
          y,
          { width: CW },
        );

      // ═══════════════════════════════════════════════════════════
      // PAGE 5: LIQUIDITY POSITION
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('POSICION DE LIQUIDEZ', 'LIQUIDITY POSITION'));
      drawFooter();

      const liq = summary.liquidity;
      // D1: when liquidity is data_unavailable, render the LCR page with an
      // explicit DATA UNAVAILABLE big-number panel + a banner directing the
      // user to the gap manifest. Never paint the green/amber/red traffic
      // light on phantom data.
      const isLcrUnavailable =
        liq.status === 'data_unavailable' || liq.lcr === null;
      const lcrColor = isLcrUnavailable
        ? '#64748B'
        : liq.status === 'compliant'
          ? '#16A34A'
          : liq.status === 'warning'
            ? '#D97706'
            : '#DC2626';

      // LCR big number
      doc.rect(ML, y, 180, 100).fill('#F8FAFC');
      doc.rect(ML, y, 4, 100).fill(lcrColor);
      doc
        .fill(lcrColor)
        .font('Helvetica-Bold')
        .fontSize(isLcrUnavailable ? 16 : 48)
        .text(
          isLcrUnavailable || liq.lcr === null
            ? t('DATOS NO DISPONIBLES', 'DATA UNAVAILABLE')
            : `${liq.lcr.toFixed(0)}%`,
          ML + 15,
          y + (isLcrUnavailable ? 35 : 10),
          { width: 150, align: 'center' },
        );
      doc
        .fill('#475569')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('LCR', ML + 15, y + 65, { width: 150, align: 'center' });
      const lcrStatusText = isLcrUnavailable
        ? t('SIN DATOS', 'NO DATA')
        : liq.status === 'compliant'
          ? t('CUMPLE', 'COMPLIANT')
          : liq.status === 'warning'
            ? t('ALERTA', 'WARNING')
            : t('INCUMPLIMIENTO', 'BREACH');
      doc
        .fill('#475569')
        .fontSize(9)
        .text(lcrStatusText, ML + 15, y + 82, { width: 150, align: 'center' });

      // Metrics column
      const lx = ML + 210;
      const liqMetrics: [string, string][] = [
        [t('HQLA Total', 'Total HQLA'), fmtM(liq.hqla)],
        [t('Flujos Netos', 'Net Outflows'), fmtM(liq.netOutflows)],
        [
          t('Amortiguador', 'Buffer vs 100%'),
          liq.buffer === null
            ? '—'
            : `${liq.buffer > 0 ? '+' : ''}${liq.buffer.toFixed(1)}%`,
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
          .text(value, lx + 170, ly, { width: 80, lineBreak: false });
        ly += 19;
      }

      y += 120;

      // Visual gauge bar for LCR. When LCR is unavailable, draw an empty
      // grey bar with a label instead of a phantom-zero red bar — that
      // would tell the regulator the cooperativa is in breach when it
      // actually means we just don't have data.
      doc
        .fill('#1B3A6B')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(t('NIVEL LCR', 'LCR LEVEL'), ML, y);
      y += 16;
      doc.rect(ML, y, CW, 22).fill('#E2E8F0');
      const lcrBarW =
        liq.lcr === null ? 0 : Math.min(CW, Math.max(10, (liq.lcr / 200) * CW));
      if (lcrBarW > 0) {
        doc.rect(ML, y, lcrBarW, 22).fill(lcrColor);
      }
      // Threshold markers
      const mark100 = (100 / 200) * CW;
      const mark120 = (120 / 200) * CW;
      doc
        .moveTo(ML + mark100, y)
        .lineTo(ML + mark100, y + 22)
        .strokeColor('#DC2626')
        .lineWidth(1.5)
        .stroke();
      doc
        .moveTo(ML + mark120, y)
        .lineTo(ML + mark120, y + 22)
        .strokeColor('#D97706')
        .lineWidth(1)
        .stroke();
      doc.fill('#94A3B8').font('Helvetica').fontSize(6);
      doc.text('100%', ML + mark100 - 10, y + 24, {
        width: 30,
        align: 'center',
      });
      doc.text('120%', ML + mark120 - 10, y + 24, {
        width: 30,
        align: 'center',
      });
      doc.text('200%', ML + CW - 15, y + 24, { width: 30 });

      // ═══════════════════════════════════════════════════════════
      // PAGE 6: COSSEC TRAFFIC LIGHT GRID (SIGNATURE PAGE)
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(
        t('TABLERO COSSEC — SEMAFORO', 'COSSEC DASHBOARD — TRAFFIC LIGHTS'),
      );
      drawFooter();

      const ratios = cossec.ratios || [];

      // 4 columns x 3 rows grid
      const gridCols = 4;
      const gridRows = 3;
      const cellW = Math.floor((CW - (gridCols - 1) * 8) / gridCols);
      const cellH = 145;
      const cellGap = 8;

      for (let i = 0; i < Math.min(ratios.length, gridCols * gridRows); i++) {
        const ratio = ratios[i];
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const cellX = ML + col * (cellW + cellGap);
        const cellY = y + row * (cellH + cellGap);

        const rClr =
          ratio.status === 'info' ? '#64748B' : statusClr(ratio.status);

        // Filled background
        doc.rect(cellX, cellY, cellW, cellH).fill(rClr);

        // Ratio value (large, white, centered)
        const valStr =
          ratio.unit === '%'
            ? `${Number(ratio.value || 0).toFixed(1)}%`
            : ratio.unit === 'yr'
              ? `${Number(ratio.value || 0).toFixed(1)}yr`
              : ratio.unit === 'score'
                ? `${Number(ratio.value || 0).toFixed(0)}`
                : `${ratio.value}`;
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(20)
          .text(valStr, cellX + 4, cellY + 12, {
            width: cellW - 8,
            align: 'center',
          });

        // Ratio name (white)
        const ratioName = isEs ? ratio.nameEs || ratio.name : ratio.name;
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(ratioName, cellX + 6, cellY + 50, {
            width: cellW - 12,
            align: 'center',
          });

        // Threshold (white, semi-transparent feel via smaller size)
        doc
          .fill('rgba(255,255,255,0.85)')
          .font('Helvetica')
          .fontSize(6.5)
          .text(
            `${t('Umbral', 'Thr')}: ${ratio.threshold}`,
            cellX + 6,
            cellY + 75,
            { width: cellW - 12, align: 'center' },
          );

        // Status label
        const statusText =
          ratio.status === 'pass'
            ? t('CUMPLE', 'PASS')
            : ratio.status === 'warning'
              ? t('ALERTA', 'WARN')
              : ratio.status === 'fail'
                ? t('FALLO', 'FAIL')
                : 'INFO';
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(statusText, cellX + 6, cellY + 92, {
            width: cellW - 12,
            align: 'center',
          });

        // Sector median if available
        if (ratio.sectorMedian != null) {
          doc
            .fill('rgba(255,255,255,0.7)')
            .font('Helvetica')
            .fontSize(6)
            .text(
              `${t('Mediana', 'Median')}: ${ratio.sectorMedian}${ratio.unit === '%' ? '%' : ''}`,
              cellX + 6,
              cellY + 108,
              { width: cellW - 12, align: 'center' },
            );
        }

        // Percentile rank
        if (ratio.percentileRank != null) {
          doc
            .fill('#FFFFFF')
            .font('Helvetica-Bold')
            .fontSize(7)
            .text(`P${ratio.percentileRank}`, cellX + 6, cellY + cellH - 20, {
              width: cellW - 12,
              align: 'center',
            });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // PAGE 7: STRESS TEST SUMMARY
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('RESUMEN DE PRUEBAS DE ESTRES', 'STRESS TEST SUMMARY'));
      drawFooter();

      if (stressTest?.regulatory?.scenarios) {
        // Overall rating badge
        const overallRating = stressTest.regulatory.overallRating;
        const orClr =
          overallRating === 'resilient'
            ? '#16A34A'
            : overallRating === 'adequate'
              ? '#1ABFFF'
              : overallRating === 'vulnerable'
                ? '#D97706'
                : '#DC2626';

        doc.rect(ML, y, 200, 40).fill(orClr);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(16)
          .text(overallRating.toUpperCase(), ML + 10, y + 10, {
            width: 180,
            align: 'center',
          });
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(9)
          .text(t('Calificacion General', 'Overall Rating'), ML + 220, y + 14);
        y += 55;

        // Top scenarios comparison table
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(t('ESCENARIOS REGULATORIOS', 'REGULATORY SCENARIOS'), ML, y);
        y += 18;

        const stw = [140, 70, 70, 70, 70, 72];
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
          stw,
          { bg: '#1B3A6B', header: true },
        );

        for (let i = 0; i < stressTest.regulatory.scenarios.length; i++) {
          const sc = stressTest.regulatory.scenarios[i];
          y = tblRow(
            y,
            [
              sc.name,
              fmtM(sc.niImpact),
              fmtM(sc.mveImpact),
              fmtPct(sc.lcrImpact),
              fmtPct(sc.capitalImpact),
              sc.passFailStatus.toUpperCase(),
            ],
            stw,
            { bg: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' },
          );

          // Color-coded status overlay
          const statusX = ML + stw.slice(0, 5).reduce((a, b) => a + b, 0) + 4;
          const sClr =
            sc.passFailStatus === 'pass'
              ? '#16A34A'
              : sc.passFailStatus === 'warn'
                ? '#D97706'
                : '#DC2626';
          doc
            .fill(sClr)
            .font('Helvetica-Bold')
            .fontSize(7)
            .text(sc.passFailStatus.toUpperCase(), statusX, y - 15, {
              width: stw[5] - 8,
              lineBreak: false,
            });
        }
      }

      // Monte Carlo summary
      if (stressTest?.monteCarlo) {
        y += 25;
        const mc = stressTest.monteCarlo;
        doc
          .fill('#1B3A6B')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(t('SIMULACION MONTE CARLO', 'MONTE CARLO SIMULATION'), ML, y);
        y += 5;
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(8)
          .text(
            `${mc.paths} ${t('trayectorias', 'paths')} | ${mc.horizon} ${t('meses', 'months')}`,
            ML,
            y,
          );
        y += 18;

        const mcMetrics: [string, string][] = [
          [t('NII Esperado', 'Expected NII'), fmtM(mc.expectedNII)],
          [
            t('NII Peor Caso (P5)', 'Worst Case NII (P5)'),
            fmtM(mc.worstCaseNII),
          ],
          [t('NII en Riesgo', 'NII at Risk (EaR)'), fmtM(mc.niiAtRisk)],
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
      }

      // ═══════════════════════════════════════════════════════════
      // PAGE 8: BOARD RECOMMENDATIONS
      // ═══════════════════════════════════════════════════════════
      doc.addPage();
      y = pageHeader(t('RECOMENDACIONES PARA JUNTA', 'BOARD RECOMMENDATIONS'));
      drawFooter();

      doc
        .font('Helvetica')
        .fontSize(9)
        .fill('#475569')
        .text(
          t(
            'Las siguientes recomendaciones requieren atencion del Comite ALCO y la Junta de Directores.',
            'The following recommendations require attention from the ALCO Committee and the Board of Directors.',
          ),
          ML,
          y,
          { width: CW },
        );
      y += 25;

      // Numbered recommendations with priority badges
      const recs = summary.recommendations || [];
      const priorities = ['HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'LOW'];
      const priorityColors: Record<string, string> = {
        HIGH: '#DC2626',
        MEDIUM: '#D97706',
        LOW: '#16A34A',
      };
      const responsibleParties = [
        t('CFO / VP Finanzas', 'CFO / VP Finance'),
        t('Tesorero', 'Treasurer'),
        t('Comite ALCO', 'ALCO Committee'),
        t('Oficial de Riesgo', 'Risk Officer'),
        t('Junta de Directores', 'Board of Directors'),
      ];

      for (let i = 0; i < Math.min(recs.length, 5); i++) {
        const rec = recs[i];
        const priority = priorities[i] || 'MEDIUM';
        const responsible =
          responsibleParties[i] || t('Comite ALCO', 'ALCO Committee');
        const pClr = priorityColors[priority] || '#D97706';

        // Number circle
        doc.circle(ML + 14, y + 12, 14).fill('#1B3A6B');
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(13)
          .text(`${i + 1}`, ML + 4, y + 5, { width: 20, align: 'center' });

        // Priority badge
        doc.rect(ML + 38, y, 55, 16).fill(pClr);
        doc
          .fill('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(7)
          .text(priority, ML + 38, y + 4, { width: 55, align: 'center' });

        // Responsible party
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(7)
          .text(responsible, ML + 100, y + 3, { lineBreak: false });

        // Recommendation text
        doc
          .fill('#1F2937')
          .font('Helvetica')
          .fontSize(10)
          .text(rec, ML + 38, y + 20, { width: CW - 45 });
        const recH = doc.heightOfString(rec, { width: CW - 45 });
        y += Math.max(40, recH + 30);
      }

      // If fewer than 5 recommendations, pad with standard ones
      if (recs.length === 0) {
        doc
          .fill('#64748B')
          .font('Helvetica')
          .fontSize(10)
          .text(
            t(
              'No se identificaron acciones urgentes. Continuar monitoreando metricas trimestralmente.',
              'No urgent actions identified. Continue monitoring metrics quarterly.',
            ),
            ML + 38,
            y,
            { width: CW - 45 },
          );
        y += 30;
      }

      // Signature line
      y = Math.max(y + 20, 620);
      doc
        .moveTo(ML, y)
        .lineTo(PW - MR, y)
        .strokeColor('#D1D5DB')
        .lineWidth(0.5)
        .stroke();
      y += 15;
      doc
        .fill('#94A3B8')
        .font('Helvetica')
        .fontSize(8)
        .text(
          t(
            'Generado por CERNIQ — Plataforma de Inteligencia de Riesgo',
            'Generated by CERNIQ — Risk Intelligence Platform',
          ),
          ML,
          y,
          { width: CW, align: 'center' },
        );
      y += 12;
      doc
        .fill('#94A3B8')
        .font('Helvetica')
        .fontSize(7)
        .text('KLYTICS LLC, San Juan, Puerto Rico', ML, y, {
          width: CW,
          align: 'center',
        });
      y += 10;
      doc
        .fill('#94A3B8')
        .font('Helvetica')
        .fontSize(7)
        .text(
          `${t('Generado', 'Generated')}: ${new Date().toISOString()} | CERNIQ v1.0`,
          ML,
          y,
          { width: CW, align: 'center' },
        );

      doc.end();
    });
  }
}
