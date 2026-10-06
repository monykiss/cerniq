import {
  truncate,
  capitalize,
  pluralize,
  toCamelCase,
  toSnakeCase,
  isBlank,
} from './string.util';

describe('string.util', () => {
  describe('truncate', () => {
    it('returns the string unchanged if within limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates and appends suffix', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });
  });

  describe('capitalize', () => {
    it('capitalizes the first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
    });

    it('returns empty string for empty input', () => {
      expect(capitalize('')).toBe('');
    });
  });

  describe('pluralize', () => {
    it('returns singular for count 1', () => {
      expect(pluralize('item', 1)).toBe('item');
    });

    it('adds -s for regular nouns', () => {
      expect(pluralize('item', 2)).toBe('items');
    });

    it('adds -ies for consonant+y words', () => {
      expect(pluralize('city', 3)).toBe('cities');
    });

    it('adds -es for sibilant endings', () => {
      expect(pluralize('box', 2)).toBe('boxes');
    });
  });

  describe('toCamelCase / toSnakeCase', () => {
    it('converts kebab-case to camelCase', () => {
      expect(toCamelCase('my-variable-name')).toBe('myVariableName');
    });

    it('converts camelCase to snake_case', () => {
      expect(toSnakeCase('myVariableName')).toBe('my_variable_name');
    });
  });

  describe('isBlank', () => {
    it('returns true for null/undefined/empty/whitespace', () => {
      expect(isBlank(null)).toBe(true);
      expect(isBlank(undefined)).toBe(true);
      expect(isBlank('')).toBe(true);
      expect(isBlank('  ')).toBe(true);
    });

    it('returns false for non-blank strings', () => {
      expect(isBlank('hello')).toBe(false);
    });
  });

  describe('toCamelCase edge cases', () => {
    it('lowercases the first character when input starts with uppercase', () => {
      expect(toCamelCase('Hello world')).toBe('helloWorld');
    });
  });
});
