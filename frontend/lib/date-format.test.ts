import { describe, it, expect } from 'vitest';
import { formatShortDate, toISODateString } from './date-format';

describe('date-format', () => {
  describe('formatShortDate', () => {
    it('formats a Date object', () => {
      const result = formatShortDate(new Date('2026-03-28T12:00:00Z'));
      expect(result).toContain('Mar');
      expect(result).toContain('2026');
    });

    it('formats a date string', () => {
      const result = formatShortDate('2026-01-15');
      expect(result).toContain('Jan');
      expect(result).toContain('2026');
    });
  });

  describe('toISODateString', () => {
    it('returns YYYY-MM-DD format', () => {
      expect(toISODateString(new Date('2026-03-28T12:00:00Z'))).toBe('2026-03-28');
    });
  });
});
