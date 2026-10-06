import { requireEnv } from './required-env';

describe('requireEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the configured value', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/testdb';
    expect(requireEnv('DATABASE_URL')).toBe(
      'postgresql://localhost:5432/testdb',
    );
  });

  it('throws when the variable is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => requireEnv('DATABASE_URL')).toThrow(
      'DATABASE_URL is required.',
    );
  });

  it('throws when the variable is blank', () => {
    process.env.DATABASE_URL = '   ';
    expect(() => requireEnv('DATABASE_URL')).toThrow(
      'DATABASE_URL is required.',
    );
  });
});
