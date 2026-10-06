/**
 * Formatting utilities for currency, numbers, dates, and relative time.
 */

/** Format a number as USD currency */
export const formatCurrency = (v: number, locale = 'en-US'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(v);

/** Format a number with fixed decimal places */
export const formatNumber = (v: number, decimals = 2): string =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** Format a decimal as a percentage string, e.g. 0.1234 -> "12.34%" */
export const formatPercent = (v: number): string =>
  `${(v * 100).toFixed(2)}%`;

/** Format a date as "Jan 1, 2025" */
export const formatDate = (d: Date | string): string =>
  new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(d));

/** Format a date as a human-friendly relative time, e.g. "5m ago", "3h ago", "2d ago" */
export const formatRelativeTime = (d: Date | string): string => {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(d);
};

/** Format bytes into a human-readable size, e.g. "1.5 MB" */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};
