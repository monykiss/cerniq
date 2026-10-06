import { ParseUUIDSafePipe } from './parse-uuid.pipe';
import { BadRequestException } from '@nestjs/common';

describe('ParseUUIDSafePipe', () => {
  it('should parse a valid UUID and normalize to lowercase', () => {
    const pipe = new ParseUUIDSafePipe();
    const result = pipe.transform('A1B2C3D4-E5F6-7890-ABCD-EF1234567890');
    expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('should accept a valid lowercase UUID', () => {
    const pipe = new ParseUUIDSafePipe();
    const result = pipe.transform('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('should trim whitespace from UUID', () => {
    const pipe = new ParseUUIDSafePipe();
    const result = pipe.transform('  a1b2c3d4-e5f6-7890-abcd-ef1234567890  ');
    expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('should throw BadRequestException for invalid UUID format', () => {
    const pipe = new ParseUUIDSafePipe();
    expect(() => pipe.transform('not-a-uuid')).toThrow(BadRequestException);
    expect(() => pipe.transform('not-a-uuid')).toThrow('Invalid UUID format');
  });

  it('should throw BadRequestException for empty string', () => {
    const pipe = new ParseUUIDSafePipe();
    expect(() => pipe.transform('')).toThrow(BadRequestException);
    expect(() => pipe.transform('')).toThrow('UUID value is required');
  });

  it('should allow empty value when optional is true', () => {
    const pipe = new ParseUUIDSafePipe({ optional: true });
    const result = pipe.transform('');
    expect(result).toBe('');
  });

  it('should allow null/undefined value when optional is true', () => {
    const pipe = new ParseUUIDSafePipe({ optional: true });
    expect(pipe.transform(null as any)).toBeNull();
    expect(pipe.transform(undefined as any)).toBeUndefined();
  });

  it('should use custom error message when provided', () => {
    const pipe = new ParseUUIDSafePipe({ errorMessage: 'Custom error' });
    expect(() => pipe.transform('')).toThrow('Custom error');
  });

  it('should use custom error message for invalid format', () => {
    const pipe = new ParseUUIDSafePipe({ errorMessage: 'Bad ID' });
    expect(() => pipe.transform('invalid')).toThrow('Bad ID');
  });

  it('should reject UUIDs with wrong length', () => {
    const pipe = new ParseUUIDSafePipe();
    expect(() => pipe.transform('a1b2c3d4-e5f6-7890-abcd')).toThrow(
      BadRequestException,
    );
  });

  it('should reject UUIDs without dashes', () => {
    const pipe = new ParseUUIDSafePipe();
    expect(() => pipe.transform('a1b2c3d4e5f67890abcdef1234567890')).toThrow(
      BadRequestException,
    );
  });
});
