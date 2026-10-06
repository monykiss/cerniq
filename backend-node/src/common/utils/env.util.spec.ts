import {
  requireEnv,
  optionalEnv,
  envBool,
  envInt,
  envFloat,
  envEnum,
} from './env.util';

describe('env.util', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('requireEnv', () => {
    it('returns value when set', () => {
      process.env.TEST_KEY = 'hello';
      expect(requireEnv('TEST_KEY')).toBe('hello');
    });

    it('throws when missing', () => {
      delete process.env.MISSING_KEY;
      expect(() => requireEnv('MISSING_KEY')).toThrow(
        'Missing required env var: MISSING_KEY',
      );
    });

    it('throws on empty string', () => {
      process.env.EMPTY_KEY = '';
      expect(() => requireEnv('EMPTY_KEY')).toThrow(
        'Missing required env var: EMPTY_KEY',
      );
    });
  });

  describe('optionalEnv', () => {
    it('returns value when set', () => {
      process.env.OPT_KEY = 'value';
      expect(optionalEnv('OPT_KEY', 'default')).toBe('value');
    });

    it('returns default when missing', () => {
      delete process.env.OPT_KEY;
      expect(optionalEnv('OPT_KEY', 'fallback')).toBe('fallback');
    });
  });

  describe('envBool', () => {
    it.each(['1', 'true', 'yes', 'on', 'TRUE', 'Yes'])(
      'returns true for "%s"',
      (val) => {
        process.env.BOOL_KEY = val;
        expect(envBool('BOOL_KEY')).toBe(true);
      },
    );

    it.each(['0', 'false', 'no', 'off', 'FALSE', 'No'])(
      'returns false for "%s"',
      (val) => {
        process.env.BOOL_KEY = val;
        expect(envBool('BOOL_KEY')).toBe(false);
      },
    );

    it('returns default when unset', () => {
      delete process.env.BOOL_KEY;
      expect(envBool('BOOL_KEY', true)).toBe(true);
      expect(envBool('BOOL_KEY', false)).toBe(false);
    });

    it('returns default for unrecognized values', () => {
      process.env.BOOL_KEY = 'maybe';
      expect(envBool('BOOL_KEY', true)).toBe(true);
    });
  });

  describe('envInt', () => {
    it('parses integer', () => {
      process.env.INT_KEY = '42';
      expect(envInt('INT_KEY', 0)).toBe(42);
    });

    it('returns default for NaN', () => {
      process.env.INT_KEY = 'abc';
      expect(envInt('INT_KEY', 99)).toBe(99);
    });

    it('returns default when unset', () => {
      delete process.env.INT_KEY;
      expect(envInt('INT_KEY', 10)).toBe(10);
    });
  });

  describe('envFloat', () => {
    it('parses float', () => {
      process.env.FLOAT_KEY = '3.14';
      expect(envFloat('FLOAT_KEY', 0)).toBeCloseTo(3.14);
    });

    it('returns default for invalid', () => {
      process.env.FLOAT_KEY = 'not-a-number';
      expect(envFloat('FLOAT_KEY', 1.5)).toBe(1.5);
    });
  });

  describe('envEnum', () => {
    it('returns value when in allowed list', () => {
      process.env.ENV_KEY = 'production';
      expect(
        envEnum(
          'ENV_KEY',
          ['development', 'production', 'test'] as const,
          'development',
        ),
      ).toBe('production');
    });

    it('returns default when not in allowed list', () => {
      process.env.ENV_KEY = 'staging';
      expect(
        envEnum(
          'ENV_KEY',
          ['development', 'production', 'test'] as const,
          'development',
        ),
      ).toBe('development');
    });

    it('returns default when unset', () => {
      delete process.env.ENV_KEY;
      expect(envEnum('ENV_KEY', ['a', 'b'] as const, 'a')).toBe('a');
    });
  });
});
