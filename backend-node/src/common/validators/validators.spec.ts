import { IsBusinessEmailConstraint } from './is-business-email.validator';
import {
  IsAfterDateConstraint,
  MaxDateSpanConstraint,
} from './date-range.validator';
import { PasswordComplexityPipe } from './password-complexity.validator';
import { ParseUUIDPipe } from './is-uuid.validator';
import { BadRequestException } from '@nestjs/common';

describe('IsBusinessEmailConstraint', () => {
  const validator = new IsBusinessEmailConstraint();
  const mockArgs = {} as any;

  it('rejects gmail.com as a free email provider', () => {
    expect(validator.validate('user@gmail.com', mockArgs)).toBe(false);
  });

  it('rejects yahoo.com', () => {
    expect(validator.validate('user@yahoo.com', mockArgs)).toBe(false);
  });

  it('rejects hotmail.com', () => {
    expect(validator.validate('user@hotmail.com', mockArgs)).toBe(false);
  });

  it('rejects outlook.com', () => {
    expect(validator.validate('user@outlook.com', mockArgs)).toBe(false);
  });

  it('accepts a business domain email', () => {
    expect(validator.validate('cfo@cerniq.io', mockArgs)).toBe(true);
  });

  it('accepts another business domain', () => {
    expect(validator.validate('admin@mycreditunion.org', mockArgs)).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(validator.validate(null as any, mockArgs)).toBe(false);
    expect(validator.validate(undefined as any, mockArgs)).toBe(false);
  });

  it('rejects email without @ sign', () => {
    expect(validator.validate('not-an-email', mockArgs)).toBe(false);
  });

  it('returns descriptive default message', () => {
    const msg = validator.defaultMessage(mockArgs);
    expect(msg).toContain('business email');
  });
});

describe('IsAfterDateConstraint', () => {
  const validator = new IsAfterDateConstraint();

  function makeArgs(
    startDateField: string,
    obj: any,
    property: string = 'endDate',
  ) {
    return {
      constraints: [startDateField],
      object: obj,
      property,
    } as any;
  }

  it('returns true when endDate is after startDate', () => {
    const args = makeArgs('startDate', {
      startDate: '2025-01-01',
      endDate: '2025-06-01',
    });
    expect(validator.validate('2025-06-01', args)).toBe(true);
  });

  it('returns false when endDate is before startDate', () => {
    const args = makeArgs('startDate', {
      startDate: '2025-06-01',
      endDate: '2025-01-01',
    });
    expect(validator.validate('2025-01-01', args)).toBe(false);
  });

  it('returns false when dates are equal', () => {
    const args = makeArgs('startDate', {
      startDate: '2025-06-01',
      endDate: '2025-06-01',
    });
    expect(validator.validate('2025-06-01', args)).toBe(false);
  });

  it('returns true when startDate is missing (let @IsDateString handle it)', () => {
    const args = makeArgs('startDate', {
      startDate: null,
      endDate: '2025-06-01',
    });
    expect(validator.validate('2025-06-01', args)).toBe(true);
  });

  it('returns true when endDate is empty', () => {
    const args = makeArgs('startDate', {
      startDate: '2025-01-01',
      endDate: '',
    });
    expect(validator.validate('', args)).toBe(true);
  });

  it('returns descriptive default message', () => {
    const args = makeArgs('startDate', {}, 'endDate');
    const msg = validator.defaultMessage(args);
    expect(msg).toContain('endDate');
    expect(msg).toContain('startDate');
  });
});

describe('MaxDateSpanConstraint', () => {
  const validator = new MaxDateSpanConstraint();

  function makeArgs(startDateField: string, maxDays: number, obj: any) {
    return {
      constraints: [startDateField, maxDays],
      object: obj,
    } as any;
  }

  it('returns true when span is within max days', () => {
    const args = makeArgs('startDate', 30, {
      startDate: '2025-01-01',
      endDate: '2025-01-15',
    });
    expect(validator.validate('2025-01-15', args)).toBe(true);
  });

  it('returns false when span exceeds max days', () => {
    const args = makeArgs('startDate', 30, {
      startDate: '2025-01-01',
      endDate: '2025-06-01',
    });
    expect(validator.validate('2025-06-01', args)).toBe(false);
  });

  it('returns true when startDate is missing', () => {
    const args = makeArgs('startDate', 30, {
      startDate: null,
      endDate: '2025-01-15',
    });
    expect(validator.validate('2025-01-15', args)).toBe(true);
  });

  it('returns descriptive default message mentioning max days', () => {
    const args = makeArgs('startDate', 90, {});
    const msg = validator.defaultMessage(args);
    expect(msg).toContain('90');
  });
});

describe('PasswordComplexityPipe', () => {
  const pipe = new PasswordComplexityPipe();

  it('accepts a valid complex password', () => {
    expect(pipe.transform('StrongP@ss10')).toBe('StrongP@ss10');
  });

  it('rejects password shorter than 10 characters', () => {
    expect(() => pipe.transform('Ab1!short')).toThrow(BadRequestException);
  });

  it('rejects password without uppercase', () => {
    expect(() => pipe.transform('lowercase1!xx')).toThrow(BadRequestException);
  });

  it('rejects password without lowercase', () => {
    expect(() => pipe.transform('UPPERCASE1!XX')).toThrow(BadRequestException);
  });

  it('rejects password without digit', () => {
    expect(() => pipe.transform('NoDigitsHere!')).toThrow(BadRequestException);
  });

  it('rejects password without special character', () => {
    expect(() => pipe.transform('NoSpecial1Char')).toThrow(BadRequestException);
  });

  it('rejects empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('rejects null/undefined', () => {
    expect(() => pipe.transform(null as any)).toThrow(BadRequestException);
  });
});

describe('ParseUUIDPipe', () => {
  const pipe = new ParseUUIDPipe();

  it('accepts a valid UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(pipe.transform(uuid)).toBe(uuid);
  });

  it('accepts uppercase UUID', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000';
    expect(pipe.transform(uuid)).toBe(uuid);
  });

  it('rejects an invalid UUID', () => {
    expect(() => pipe.transform('not-a-uuid')).toThrow(BadRequestException);
  });

  it('rejects a short string', () => {
    expect(() => pipe.transform('12345')).toThrow(BadRequestException);
  });
});
