import { validate } from 'class-validator';
import { IsDateString } from 'class-validator';
import {
  IsAfterDateConstraint,
  IsAfterDate,
  MaxDateSpanConstraint,
  MaxDateSpan,
} from './date-range.validator';

// ── Unit tests for constraint classes ────────────────────────────

describe('IsAfterDateConstraint', () => {
  const constraint = new IsAfterDateConstraint();

  const makeArgs = (startDate: any) =>
    ({
      constraints: ['startDate'],
      object: { startDate },
      property: 'endDate',
    }) as any;

  it('returns true when endDate > startDate', () => {
    expect(constraint.validate('2026-06-01', makeArgs('2026-01-01'))).toBe(
      true,
    );
  });

  it('returns false when endDate <= startDate', () => {
    expect(constraint.validate('2026-01-01', makeArgs('2026-06-01'))).toBe(
      false,
    );
    expect(constraint.validate('2026-01-01', makeArgs('2026-01-01'))).toBe(
      false,
    );
  });

  it('returns true when startDate is missing (defers to other validators)', () => {
    expect(constraint.validate('2026-06-01', makeArgs(undefined))).toBe(true);
    expect(constraint.validate('2026-06-01', makeArgs(null))).toBe(true);
  });

  it('returns true when endDate is missing', () => {
    expect(constraint.validate('', makeArgs('2026-01-01'))).toBe(true);
  });

  it('returns true for invalid date strings (defers to @IsDateString)', () => {
    expect(constraint.validate('not-a-date', makeArgs('also-bad'))).toBe(true);
  });

  it('defaultMessage returns expected format', () => {
    const msg = constraint.defaultMessage({
      constraints: ['startDate'],
      property: 'endDate',
    } as any);
    expect(msg).toBe('endDate must be after startDate');
  });
});

describe('MaxDateSpanConstraint', () => {
  const constraint = new MaxDateSpanConstraint();

  const makeArgs = (startDate: any, maxDays: number) =>
    ({
      constraints: ['startDate', maxDays],
      object: { startDate },
      property: 'endDate',
    }) as any;

  it('returns true when span <= maxDays', () => {
    expect(constraint.validate('2026-01-31', makeArgs('2026-01-01', 365))).toBe(
      true,
    );
  });

  it('returns false when span > maxDays', () => {
    expect(constraint.validate('2027-06-01', makeArgs('2026-01-01', 30))).toBe(
      false,
    );
  });

  it('returns true when startDate is missing', () => {
    expect(constraint.validate('2026-06-01', makeArgs(undefined, 30))).toBe(
      true,
    );
  });

  it('returns true when endDate is missing', () => {
    expect(constraint.validate('', makeArgs('2026-01-01', 30))).toBe(true);
  });

  it('defaultMessage returns expected format', () => {
    const msg = constraint.defaultMessage({
      constraints: ['startDate', 90],
      property: 'endDate',
    } as any);
    expect(msg).toBe('Date range must not exceed 90 days');
  });
});

// ── Decorator integration tests ──────────────────────────────────

class TestDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsAfterDate('startDate')
  @MaxDateSpan('startDate', 90)
  endDate: string;
}

describe('IsAfterDate decorator', () => {
  it('passes validation when endDate > startDate within 90 days', async () => {
    const dto = new TestDto();
    dto.startDate = '2026-01-01';
    dto.endDate = '2026-02-01';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation when endDate < startDate', async () => {
    const dto = new TestDto();
    dto.startDate = '2026-06-01';
    dto.endDate = '2026-01-01';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const endErrors = errors.find((e) => e.property === 'endDate');
    expect(endErrors).toBeDefined();
  });

  it('fails validation when date span exceeds 90 days', async () => {
    const dto = new TestDto();
    dto.startDate = '2026-01-01';
    dto.endDate = '2026-12-01';
    const errors = await validate(dto);
    const endErrors = errors.find((e) => e.property === 'endDate');
    expect(endErrors).toBeDefined();
    expect(endErrors!.constraints).toHaveProperty('maxDateSpan');
  });
});
