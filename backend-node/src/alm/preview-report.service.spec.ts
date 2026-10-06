import { NotFoundException } from '@nestjs/common';
import { PreviewReportService } from './preview-report.service';

describe('PreviewReportService', () => {
  let service: PreviewReportService;

  beforeEach(() => {
    service = new PreviewReportService();
  });

  describe('getPreviewDefinition', () => {
    it('returns a valid definition for a known slug', () => {
      const def = service.getPreviewDefinition('cooperativa-ejemplo-este');
      expect(def.slug).toBe('cooperativa-ejemplo-este');
      expect(def.name).toBeTruthy();
      expect(def.assets).toBeGreaterThan(0);
      expect(def.niiTrend.length).toBeGreaterThan(0);
      expect(def.rateShock.length).toBeGreaterThan(0);
    });

    it('throws NotFoundException for unknown slug', () => {
      expect(() => service.getPreviewDefinition('nonexistent')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('generatePreviewReport', () => {
    it('generates a valid PDF buffer with watermark', async () => {
      const buffer = await service.generatePreviewReport(
        'cooperativa-ejemplo-este',
        'es',
      );
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
      // PDF magic bytes
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('embeds preview metadata in PDF info dictionary', async () => {
      const buffer = await service.generatePreviewReport(
        'cooperativa-ejemplo-centro',
        'en',
      );
      const pdfText = buffer.toString('latin1');
      // PDF info dict fields are embedded as text in the PDF stream
      expect(pdfText).toContain('CerniQ Preview Report Generator');
      expect(pdfText).toContain('CerniQ ALM Platform');
    });

    it('generates bilingual reports (en)', async () => {
      const buffer = await service.generatePreviewReport(
        'cooperativa-ejemplo-norte',
        'en',
      );
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('accepts custom watermark parameter without error', async () => {
      const buffer = await service.generatePreviewReport(
        'cooperativa-ejemplo-este',
        'es',
        'CUSTOM WATERMARK TEXT',
      );
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('throws NotFoundException for unknown slug during generation', async () => {
      await expect(
        service.generatePreviewReport('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
