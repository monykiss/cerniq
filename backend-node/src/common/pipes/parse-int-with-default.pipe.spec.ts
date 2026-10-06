import { ParseIntWithDefaultPipe } from './parse-int-with-default.pipe';

describe('ParseIntWithDefaultPipe', () => {
  it('parses a valid integer string', () => {
    const pipe = new ParseIntWithDefaultPipe(0);
    expect(pipe.transform('42')).toBe(42);
  });

  it('returns default for non-numeric string', () => {
    const pipe = new ParseIntWithDefaultPipe(10);
    expect(pipe.transform('abc')).toBe(10);
  });

  it('returns default for empty string', () => {
    const pipe = new ParseIntWithDefaultPipe(1);
    expect(pipe.transform('')).toBe(1);
  });

  it('applies min constraint', () => {
    const pipe = new ParseIntWithDefaultPipe(1, { min: 5 });
    expect(pipe.transform('2')).toBe(5);
    expect(pipe.transform('10')).toBe(10);
  });

  it('applies max constraint', () => {
    const pipe = new ParseIntWithDefaultPipe(1, { max: 100 });
    expect(pipe.transform('200')).toBe(100);
    expect(pipe.transform('50')).toBe(50);
  });

  it('applies both min and max constraints', () => {
    const pipe = new ParseIntWithDefaultPipe(10, { min: 1, max: 50 });
    expect(pipe.transform('-5')).toBe(1);
    expect(pipe.transform('100')).toBe(50);
    expect(pipe.transform('25')).toBe(25);
  });
});
