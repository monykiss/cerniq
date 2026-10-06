import { TrimPipe } from './trim.pipe';

describe('TrimPipe', () => {
  const pipe = new TrimPipe();

  it('trims a simple string', () => {
    expect(pipe.transform('  hello  ')).toBe('hello');
  });

  it('trims leading whitespace', () => {
    expect(pipe.transform('   test')).toBe('test');
  });

  it('trims trailing whitespace', () => {
    expect(pipe.transform('test   ')).toBe('test');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(pipe.transform('   ')).toBe('');
  });

  it('passes through numbers unchanged', () => {
    expect(pipe.transform(42)).toBe(42);
  });

  it('passes through booleans unchanged', () => {
    expect(pipe.transform(true)).toBe(true);
  });

  it('passes through null unchanged', () => {
    expect(pipe.transform(null)).toBeNull();
  });

  it('passes through undefined unchanged', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it('trims all string fields in an object', () => {
    const result = pipe.transform({
      name: '  John  ',
      email: ' john@example.com ',
    });
    expect(result).toEqual({
      name: 'John',
      email: 'john@example.com',
    });
  });

  it('preserves non-string fields in an object', () => {
    const result = pipe.transform({
      name: '  John  ',
      age: 30,
      active: true,
    });
    expect(result).toEqual({
      name: 'John',
      age: 30,
      active: true,
    });
  });

  it('trims strings in arrays', () => {
    const result = pipe.transform(['  a  ', '  b  ', '  c  ']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('handles nested objects', () => {
    const result = pipe.transform({
      user: { name: '  Alice  ', role: ' admin ' },
    });
    expect(result).toEqual({
      user: { name: 'Alice', role: 'admin' },
    });
  });

  it('handles mixed arrays with objects', () => {
    const result = pipe.transform([{ name: '  Test  ' }, '  value  ', 42]);
    expect(result).toEqual([{ name: 'Test' }, 'value', 42]);
  });
});
