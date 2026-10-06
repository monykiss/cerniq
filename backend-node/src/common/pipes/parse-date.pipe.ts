import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * Parse and validate date string inputs.
 * Accepts ISO 8601, YYYY-MM-DD, and MM/DD/YYYY formats.
 * Returns a valid Date object or throws BadRequestException.
 */
@Injectable()
export class ParseDatePipe implements PipeTransform<string, Date> {
  transform(value: string): Date {
    if (!value) {
      throw new BadRequestException('Date value is required');
    }

    const parsed = this.parseDate(value);
    if (!parsed || isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Invalid date format: "${value}". Use ISO 8601, YYYY-MM-DD, or MM/DD/YYYY`,
      );
    }

    return parsed;
  }

  private parseDate(value: string): Date | null {
    // ISO 8601 (2025-03-28T12:00:00Z)
    const isoDate = new Date(value);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // MM/DD/YYYY
    const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usMatch) {
      const [, month, day, year] = usMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    return null;
  }
}
