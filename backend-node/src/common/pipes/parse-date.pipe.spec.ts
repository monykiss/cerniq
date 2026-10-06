import { ParseDatePipe } from './parse-date.pipe';
import { BadRequestException } from '@nestjs/common';

describe('ParseDatePipe', () => {
  const pipe = new ParseDatePipe();

  it('parses ISO 8601 date strings', () => {
    const result = pipe.transform('2026-03-28T12:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
  });

  it('parses YYYY-MM-DD format', () => {
    const result = pipe.transform('2026-03-28');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
  });

  it('parses MM/DD/YYYY format', () => {
    const result = pipe.transform('03/28/2026');
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(2); // March = 2
    expect(result.getDate()).toBe(28);
  });

  it('throws BadRequestException for empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('throws BadRequestException for invalid date', () => {
    expect(() => pipe.transform('not-a-date')).toThrow(BadRequestException);
  });

  // Coverage: lines 35-36 — US format MM/DD/YYYY parsing
  it('parses single-digit month/day MM/DD/YYYY', () => {
    const result = pipe.transform('1/5/2026');
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(5);
    expect(result.getFullYear()).toBe(2026);
  });

  it('parses US format with two-digit month and day', () => {
    const result = pipe.transform('12/25/2026');
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(11); // December = 11
    expect(result.getDate()).toBe(25);
  });

  // Coverage: truly invalid date string
  it('throws BadRequestException for completely invalid date', () => {
    expect(() => pipe.transform('not-a-date-at-all')).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for partial date string', () => {
    expect(() => pipe.transform('2026-13-45')).toThrow(BadRequestException);
  });

  it('throws for null-coerced string "null"', () => {
    // "null" is not a valid date
    expect(() => pipe.transform('null')).toThrow(BadRequestException);
  });

  it('throws for undefined-coerced string "undefined"', () => {
    expect(() => pipe.transform('undefined')).toThrow(BadRequestException);
  });
});
