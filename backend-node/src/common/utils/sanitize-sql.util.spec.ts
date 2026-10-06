import {
  isSafeIdentifier,
  sanitizeIdentifier,
  sanitizeOrderDirection,
  validateSortField,
  escapeLikePattern,
} from './sanitize-sql.util';

describe('sanitize-sql utilities', () => {
  describe('isSafeIdentifier', () => {
    it('accepts valid identifiers', () => {
      expect(isSafeIdentifier('users')).toBe(true);
      expect(isSafeIdentifier('user_name')).toBe(true);
      expect(isSafeIdentifier('schema.table')).toBe(true);
      expect(isSafeIdentifier('_private')).toBe(true);
      expect(isSafeIdentifier('Col1')).toBe(true);
    });

    it('rejects unsafe identifiers', () => {
      expect(isSafeIdentifier('')).toBe(false);
      expect(isSafeIdentifier('1starts_with_number')).toBe(false);
      expect(isSafeIdentifier('has space')).toBe(false);
      expect(isSafeIdentifier('has;semicolon')).toBe(false);
      expect(isSafeIdentifier("Robert'); DROP TABLE users;--")).toBe(false);
      expect(isSafeIdentifier('table-name')).toBe(false);
    });
  });

  describe('sanitizeIdentifier', () => {
    it('returns valid identifiers unchanged', () => {
      expect(sanitizeIdentifier('users')).toBe('users');
      expect(sanitizeIdentifier('schema.table_name')).toBe('schema.table_name');
    });

    it('throws on unsafe identifiers', () => {
      expect(() => sanitizeIdentifier('DROP TABLE users')).toThrow(
        'Unsafe SQL identifier',
      );
      expect(() => sanitizeIdentifier('')).toThrow('Unsafe SQL identifier');
    });
  });

  describe('sanitizeOrderDirection', () => {
    it('normalizes ASC and DESC', () => {
      expect(sanitizeOrderDirection('asc')).toBe('ASC');
      expect(sanitizeOrderDirection('DESC')).toBe('DESC');
      expect(sanitizeOrderDirection(' Asc ')).toBe('ASC');
    });

    it('defaults to ASC for invalid input', () => {
      expect(sanitizeOrderDirection('RANDOM')).toBe('ASC');
      expect(sanitizeOrderDirection('')).toBe('ASC');
    });
  });

  describe('validateSortField', () => {
    const allowed = ['name', 'created_at', 'id'];

    it('returns field when in allowlist', () => {
      expect(validateSortField('name', allowed, 'id')).toBe('name');
    });

    it('returns default when field not in allowlist', () => {
      expect(validateSortField('email', allowed, 'id')).toBe('id');
    });

    it('returns default for empty field', () => {
      expect(validateSortField('', allowed, 'id')).toBe('id');
    });
  });

  describe('escapeLikePattern', () => {
    it('escapes percent signs', () => {
      expect(escapeLikePattern('100%')).toBe('100\\%');
    });

    it('escapes underscores', () => {
      expect(escapeLikePattern('user_name')).toBe('user\\_name');
    });

    it('escapes backslashes', () => {
      expect(escapeLikePattern('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('handles combined special characters', () => {
      expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
    });

    it('leaves normal text unchanged', () => {
      expect(escapeLikePattern('hello world')).toBe('hello world');
    });
  });
});
