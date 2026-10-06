import { PasswordStrengthConstraint } from './password-strength.validator';

describe('PasswordStrengthConstraint', () => {
  const validator = new PasswordStrengthConstraint();
  const mockArgs = {} as any;

  it('rejects empty string', () => {
    expect(validator.validate('', mockArgs)).toBe(false);
  });

  it('rejects null', () => {
    expect(validator.validate(null as any, mockArgs)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validator.validate(undefined as any, mockArgs)).toBe(false);
  });

  it('rejects password shorter than 8 characters', () => {
    expect(validator.validate('Ab1!xyz', mockArgs)).toBe(false);
  });

  it('rejects password without uppercase', () => {
    expect(validator.validate('abcdefg1!', mockArgs)).toBe(false);
  });

  it('rejects password without lowercase', () => {
    expect(validator.validate('ABCDEFG1!', mockArgs)).toBe(false);
  });

  it('rejects password without digit', () => {
    expect(validator.validate('Abcdefgh!', mockArgs)).toBe(false);
  });

  it('rejects password without special character', () => {
    expect(validator.validate('Abcdefg1', mockArgs)).toBe(false);
  });

  it('accepts a valid strong password', () => {
    expect(validator.validate('StrongP@ss1', mockArgs)).toBe(true);
  });

  it('accepts password with various special characters', () => {
    expect(validator.validate('Test1234!', mockArgs)).toBe(true);
    expect(validator.validate('Test1234@', mockArgs)).toBe(true);
    expect(validator.validate('Test1234#', mockArgs)).toBe(true);
    expect(validator.validate('Test1234$', mockArgs)).toBe(true);
  });

  it('accepts exactly 8 characters when all rules met', () => {
    expect(validator.validate('Ab1!cdef', mockArgs)).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(validator.validate(12345678 as any, mockArgs)).toBe(false);
  });

  describe('defaultMessage', () => {
    it('returns a descriptive error message', () => {
      const message = validator.defaultMessage(mockArgs);
      expect(message).toContain('8 characters');
      expect(message).toContain('uppercase');
      expect(message).toContain('lowercase');
      expect(message).toContain('number');
      expect(message).toContain('special character');
    });
  });
});
