/**
 * Lightweight date formatting utilities.
 * No external dependency — uses Intl.DateTimeFormat.
 */

/** Format a date as "Mar 28, 2026" */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** Format as relative time: "2 hours ago", "in 3 days" */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const absDiff = Math.abs(diffMs);

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (days > 0) return rtf.format(diffMs > 0 ? days : -days, 'day');
  if (hours > 0) return rtf.format(diffMs > 0 ? hours : -hours, 'hour');
  if (minutes > 0) return rtf.format(diffMs > 0 ? minutes : -minutes, 'minute');
  return rtf.format(diffMs > 0 ? seconds : -seconds, 'second');
}

/** Format as ISO date string (YYYY-MM-DD) */
export function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0];
}
