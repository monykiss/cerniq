import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatDate,
  formatRelativeTime,
  formatFileSize,
} from './format';

describe('formatCurrency', () => {
  it('formats positive USD', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats negative amounts', () => {
    expect(formatCurrency(-500)).toBe('-$500.00');
  });
});

describe('formatNumber', () => {
  it('uses two decimal places by default', () => {
    const result = formatNumber(1234.5);
    expect(result).toContain('1,234.50');
  });

  it('respects custom decimal places', () => {
    const result = formatNumber(3.14159, 4);
    expect(result).toContain('3.1416');
  });
});

describe('formatPercent', () => {
  it('converts decimal to percent string', () => {
    expect(formatPercent(0.1234)).toBe('12.34%');
  });

  it('handles zero', () => {
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('handles 100%', () => {
    expect(formatPercent(1)).toBe('100.00%');
  });
});

describe('formatDate', () => {
  it('formats a Date object', () => {
    // Use midday to avoid timezone boundary issues
    const result = formatDate(new Date('2025-01-15T12:00:00'));
    expect(result).toMatch(/Jan\s+15,\s+2025/);
  });

  it('formats an ISO string', () => {
    const result = formatDate('2025-06-01T12:00:00');
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/2025/);
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "just now" for very recent times', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatRelativeTime(new Date(now - 10_000))).toBe('just now');
  });

  it('returns minutes ago', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatRelativeTime(new Date(now - 5 * 60_000))).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatRelativeTime(new Date(now - 3 * 3600_000))).toBe('3h ago');
  });

  it('returns days ago', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatRelativeTime(new Date(now - 5 * 86400_000))).toBe('5d ago');
  });

  it('falls back to formatted date for old dates', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = formatRelativeTime(new Date(now - 60 * 86400_000));
    // Should contain a month abbreviation since it's > 30 days
    expect(result).toMatch(/\w{3}/);
  });
});

describe('formatFileSize', () => {
  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(2 * 1024 ** 3)).toBe('2.0 GB');
  });
});
