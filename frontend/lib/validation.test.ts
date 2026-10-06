import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  isValidPhone,
  isValidUUID,
  isValidURL,
  isNonEmpty,
  isInRange,
  hasMinLength,
  hasMaxLength,
} from './validation';

describe('validation utilities', () => {
  describe('isValidEmail', () => {
    it('accepts a standard email', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('rejects strings without @', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
    });

    it('trims whitespace before validating', () => {
      expect(isValidEmail('  user@example.com  ')).toBe(true);
    });
  });

  describe('isValidPhone', () => {
    it('accepts 10-digit US number', () => {
      expect(isValidPhone('(555) 123-4567')).toBe(true);
    });

    it('accepts 11-digit number starting with 1', () => {
      expect(isValidPhone('1-555-123-4567')).toBe(true);
    });

    it('rejects short numbers', () => {
      expect(isValidPhone('12345')).toBe(false);
    });
  });

  describe('isValidUUID', () => {
    it('accepts a valid UUID v4', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('rejects non-UUID strings', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
    });
  });

  describe('isValidURL', () => {
    it('accepts https URL', () => {
      expect(isValidURL('https://example.com')).toBe(true);
    });

    it('rejects garbage input', () => {
      expect(isValidURL('not a url')).toBe(false);
    });
  });

  describe('isNonEmpty / isInRange / hasMinLength / hasMaxLength', () => {
    it('isNonEmpty rejects whitespace-only strings', () => {
      expect(isNonEmpty('   ')).toBe(false);
      expect(isNonEmpty('a')).toBe(true);
    });

    it('isInRange checks inclusive bounds', () => {
      expect(isInRange(5, 1, 10)).toBe(true);
      expect(isInRange(0, 1, 10)).toBe(false);
    });

    it('hasMinLength / hasMaxLength check length bounds', () => {
      expect(hasMinLength('abc', 3)).toBe(true);
      expect(hasMinLength('ab', 3)).toBe(false);
      expect(hasMaxLength('abc', 3)).toBe(true);
      expect(hasMaxLength('abcd', 3)).toBe(false);
    });
  });
});
