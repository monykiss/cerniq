import {
  requireEnv,
  getEnv,
  getEnvInt,
  getEnvBool,
  getEnvList,
  isProduction,
  isDevelopment,
  isTest,
} from './environment.util';

describe('environment utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('requireEnv', () => {
    it('returns value when env var exists', () => {
      process.env.TEST_VAR = 'hello';
      expect(requireEnv('TEST_VAR')).toBe('hello');
    });

    it('throws when env var is missing', () => {
      delete process.env.MISSING_VAR;
      expect(() => requireEnv('MISSING_VAR')).toThrow(
        'Missing required environment variable',
      );
    });

    it('throws when env var is empty string', () => {
      process.env.EMPTY_VAR = '';
      expect(() => requireEnv('EMPTY_VAR')).toThrow(
        'Missing required environment variable',
      );
    });
  });

  describe('getEnv', () => {
    it('returns env var value when set', () => {
      process.env.MY_VAR = 'value';
      expect(getEnv('MY_VAR', 'default')).toBe('value');
    });

    it('returns default when env var not set', () => {
      delete process.env.MY_VAR;
      expect(getEnv('MY_VAR', 'default')).toBe('default');
    });
  });

  describe('getEnvInt', () => {
    it('parses integer env var', () => {
      process.env.PORT = '3000';
      expect(getEnvInt('PORT', 8080)).toBe(3000);
    });

    it('returns default for non-numeric value', () => {
      process.env.PORT = 'abc';
      expect(getEnvInt('PORT', 8080)).toBe(8080);
    });

    it('returns default when not set', () => {
      delete process.env.PORT;
      expect(getEnvInt('PORT', 8080)).toBe(8080);
    });
  });

  describe('getEnvBool', () => {
    it('returns true for "true"', () => {
      process.env.FLAG = 'true';
      expect(getEnvBool('FLAG')).toBe(true);
    });

    it('returns true for "1"', () => {
      process.env.FLAG = '1';
      expect(getEnvBool('FLAG')).toBe(true);
    });

    it('returns true for "yes"', () => {
      process.env.FLAG = 'yes';
      expect(getEnvBool('FLAG')).toBe(true);
    });

    it('returns false for other values', () => {
      process.env.FLAG = 'false';
      expect(getEnvBool('FLAG')).toBe(false);
    });

    it('returns default when not set', () => {
      delete process.env.FLAG;
      expect(getEnvBool('FLAG', true)).toBe(true);
      expect(getEnvBool('FLAG')).toBe(false);
    });
  });

  describe('getEnvList', () => {
    it('splits comma-separated values', () => {
      process.env.ORIGINS = 'http://a.com, http://b.com , http://c.com';
      expect(getEnvList('ORIGINS')).toEqual([
        'http://a.com',
        'http://b.com',
        'http://c.com',
      ]);
    });

    it('returns default when not set', () => {
      delete process.env.ORIGINS;
      expect(getEnvList('ORIGINS', ['default'])).toEqual(['default']);
    });

    it('filters empty entries', () => {
      process.env.LIST = 'a,,b,';
      expect(getEnvList('LIST')).toEqual(['a', 'b']);
    });
  });

  describe('isProduction', () => {
    it('returns true when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
    });

    it('returns false otherwise', () => {
      process.env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });
  });

  describe('isDevelopment', () => {
    it('returns true when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(true);
    });

    it('returns true when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;
      expect(isDevelopment()).toBe(true);
    });
  });

  describe('isTest', () => {
    it('returns true when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      expect(isTest()).toBe(true);
    });
  });
});
