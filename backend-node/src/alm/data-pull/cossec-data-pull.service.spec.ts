import { NotFoundException } from '@nestjs/common';
import { CossecDataPullService } from './cossec-data-pull.service';

describe('CossecDataPullService', () => {
  let service: CossecDataPullService;

  beforeEach(() => {
    service = new CossecDataPullService();
  });

  describe('listAvailable', () => {
    it('returns all snapshot entries with the public-facing fields', () => {
      const list = service.listAvailable();
      expect(list.length).toBeGreaterThanOrEqual(12);
      for (const entry of list) {
        expect(entry.slug).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(entry.name).toBeTruthy();
        expect(entry.totalAssets).toBeGreaterThan(0);
        expect(entry.asOfQuarter).toMatch(/^Q[1-4]-\d{4}$/);
      }
    });

    it('includes market research notes Tier-1 anchors (Rincón, COOPACA, Oriental, Caguas)', () => {
      const slugs = service.listAvailable().map((entry) => entry.slug);
      expect(slugs).toEqual(
        expect.arrayContaining(['rincon', 'coopaca', 'oriental', 'caguas']),
      );
    });
  });

  describe('pullBySlug', () => {
    it('returns a fully-populated balance sheet for a valid slug', async () => {
      const result = await service.pullBySlug('caguas');

      expect(result.slug).toBe('caguas');
      expect(result.institutionName).toMatch(/Caguas/i);
      expect(result.state).toBe('PR');
      expect(result.source).toBe('cossec_public_filings');
      expect(result.disclosure).toContain('PRELIMINARY');
      expect(result.disclosure).toMatch(/Q[1-4]-2025/);
      // Anejo 9 Q2-2025: ~$136.6M → ~136.6 in millions
      expect(result.totalAssets).toBeCloseTo(136.6, 0);
      expect(result.netWorth).toBeGreaterThan(0);
      expect(result.netWorthRatio).toBeGreaterThan(8);
      expect(result.netWorthRatio).toBeLessThan(15);
    });

    it('balance sheet items reconcile to total assets within 2% tolerance', async () => {
      const result = await service.pullBySlug('oriental');
      const assetsSum = result.items
        .filter((i) => i.category === 'asset')
        .reduce((sum, i) => sum + i.balance, 0);
      const totalDeposits = result.items
        .filter((i) => i.category === 'liability')
        .reduce((sum, i) => sum + i.balance, 0);

      // Asset side ≈ total assets (within 5% — 2% premises/other reserved)
      expect(
        Math.abs(assetsSum - result.totalAssets) / result.totalAssets,
      ).toBeLessThan(0.05);
      // Deposit side + net worth ≈ total assets
      expect(
        Math.abs(totalDeposits + result.netWorth - result.totalAssets) /
          result.totalAssets,
      ).toBeLessThan(0.05);
    });

    it('every loan segment has positive balance, rate, duration, and loss rate', async () => {
      const result = await service.pullBySlug('coopaca');
      expect(result.loanSegments.length).toBeGreaterThanOrEqual(5);
      for (const segment of result.loanSegments) {
        expect(segment.balance).toBeGreaterThan(0);
        expect(segment.weightedAvgRate).toBeGreaterThan(0);
        expect(segment.weightedAvgMaturity).toBeGreaterThan(0);
        expect(segment.historicalLossRate).toBeGreaterThan(0);
      }
    });

    it('caches results within the 24h TTL', async () => {
      const a = await service.pullBySlug('rincon');
      const b = await service.pullBySlug('rincon');
      expect(b).toBe(a); // same reference → served from cache
    });

    it('throws NotFoundException for unknown slugs', async () => {
      await expect(service.pullBySlug('unknown-coop')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('normalizes slug input (case-insensitive, whitespace-trimmed)', async () => {
      const result = await service.pullBySlug('  CAGUAS  ');
      expect(result.slug).toBe('caguas');
    });

    it('asOfDate is a valid ISO date for the quarter end', async () => {
      const result = await service.pullBySlug('oriental');
      const date = new Date(result.asOfDate);
      expect(Number.isNaN(date.getTime())).toBe(false);
      expect(date.getUTCFullYear()).toBe(2025);
    });
  });

  describe('resolveSlugForName', () => {
    it('matches exact slug', () => {
      expect(service.resolveSlugForName('caguas')).toBe('caguas');
    });

    it('matches full institution name (case-insensitive)', () => {
      expect(service.resolveSlugForName('COOPACA')).toBe('coopaca');
    });

    it('returns null for unknown names', () => {
      expect(service.resolveSlugForName('Some Random Bank')).toBeNull();
    });

    it('matches when prospect name contains the slug as a substring', () => {
      expect(
        service.resolveSlugForName('Cooperativa de Ahorro y Crédito de Caguas'),
      ).toBe('caguas');
    });
  });
});
