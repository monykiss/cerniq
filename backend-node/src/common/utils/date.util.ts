/**
 * Business day calculations with Puerto Rico holiday calendar.
 * Handles business day arithmetic, date ranges, and holiday detection.
 */

/** Puerto Rico / US federal holidays (month is 1-indexed) */
const PR_HOLIDAYS: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 6, name: 'Three Kings Day / Epiphany' },
  { month: 3, day: 22, name: 'Emancipation Day' },
  { month: 7, day: 4, name: 'Independence Day' },
  { month: 7, day: 25, name: 'Constitution Day' },
  { month: 11, day: 19, name: 'Discovery of Puerto Rico Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
];

/**
 * Check if a date is a weekend (Saturday or Sunday).
 */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a PR holiday.
 */
export function isPRHoliday(date: Date): boolean {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return PR_HOLIDAYS.some((h) => h.month === month && h.day === day);
}

/**
 * Check if a date is a business day (not weekend, not holiday).
 */
export function isBusinessDay(date: Date): boolean {
  return !isWeekend(date) && !isPRHoliday(date);
}

/**
 * Add business days to a date (skipping weekends and holidays).
 */
export function addBusinessDays(startDate: Date, days: number): Date {
  const result = new Date(startDate);
  let remaining = Math.abs(days);
  const direction = days >= 0 ? 1 : -1;

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    if (isBusinessDay(result)) {
      remaining--;
    }
  }

  return result;
}

/**
 * Count business days between two dates (exclusive of end date).
 */
export function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  const target = new Date(end);

  while (current < target) {
    if (isBusinessDay(current)) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

/**
 * Get the next business day from a given date.
 */
export function nextBusinessDay(date: Date): Date {
  return addBusinessDays(date, 1);
}

/**
 * Get all PR holidays for a given year.
 */
export function getHolidaysForYear(
  year: number,
): Array<{ date: Date; name: string }> {
  return PR_HOLIDAYS.map((h) => ({
    date: new Date(year, h.month - 1, h.day),
    name: h.name,
  }));
}
