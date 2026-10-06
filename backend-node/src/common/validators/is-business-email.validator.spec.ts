import { validate } from 'class-validator';
import {
  IsBusinessEmailConstraint,
  IsBusinessEmail,
} from './is-business-email.validator';

describe('IsBusinessEmailConstraint', () => {
  const constraint = new IsBusinessEmailConstraint();
  const args = {} as any;

  it('returns true for business domain emails', () => {
    expect(constraint.validate('cfo@cerniq.io', args)).toBe(true);
    expect(constraint.validate('admin@mycompany.com', args)).toBe(true);
  });

  it('returns false for free email providers', () => {
    expect(constraint.validate('user@gmail.com', args)).toBe(false);
    expect(constraint.validate('user@yahoo.com', args)).toBe(false);
    expect(constraint.validate('user@hotmail.com', args)).toBe(false);
    expect(constraint.validate('user@outlook.com', args)).toBe(false);
    expect(constraint.validate('user@aol.com', args)).toBe(false);
    expect(constraint.validate('user@icloud.com', args)).toBe(false);
    expect(constraint.validate('user@mail.com', args)).toBe(false);
    expect(constraint.validate('user@protonmail.com', args)).toBe(false);
    expect(constraint.validate('user@zoho.com', args)).toBe(false);
    expect(constraint.validate('user@yandex.com', args)).toBe(false);
    expect(constraint.validate('user@gmx.com', args)).toBe(false);
    expect(constraint.validate('user@live.com', args)).toBe(false);
  });

  it('returns false for empty, null, or non-string input', () => {
    expect(constraint.validate('', args)).toBe(false);
    expect(constraint.validate(null as any, args)).toBe(false);
    expect(constraint.validate(undefined as any, args)).toBe(false);
    expect(constraint.validate(123 as any, args)).toBe(false);
  });

  it('returns false for email without domain', () => {
    expect(constraint.validate('nodomain@', args)).toBe(false);
    expect(constraint.validate('just-a-string', args)).toBe(false);
  });

  it('is case-insensitive for domain matching', () => {
    expect(constraint.validate('user@GMAIL.COM', args)).toBe(false);
    expect(constraint.validate('user@Gmail.Com', args)).toBe(false);
  });

  it('defaultMessage returns expected text', () => {
    const msg = constraint.defaultMessage(args);
    expect(msg).toContain('business email');
  });
});

// ── Decorator integration test ───────────────────────────────────

class TestDto {
  @IsBusinessEmail()
  email: string;
}

describe('IsBusinessEmail decorator', () => {
  it('passes for business email', async () => {
    const dto = new TestDto();
    dto.email = 'cfo@cerniq.io';
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails for free email', async () => {
    const dto = new TestDto();
    dto.email = 'user@gmail.com';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
