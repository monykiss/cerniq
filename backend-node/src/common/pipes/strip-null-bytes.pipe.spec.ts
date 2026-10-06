import { StripNullBytesPipe } from './strip-null-bytes.pipe';

describe('StripNullBytesPipe', () => {
  let pipe: StripNullBytesPipe;

  beforeEach(() => {
    pipe = new StripNullBytesPipe();
  });

  it('should strip null bytes from strings', () => {
    expect(pipe.transform('hello\0world')).toBe('helloworld');
  });

  it('should strip multiple null bytes', () => {
    expect(pipe.transform('\0test\0value\0')).toBe('testvalue');
  });

  it('should return string unchanged when no null bytes', () => {
    expect(pipe.transform('clean string')).toBe('clean string');
  });

  it('should return non-string primitives unchanged', () => {
    expect(pipe.transform(42)).toBe(42);
    expect(pipe.transform(true)).toBe(true);
    expect(pipe.transform(null)).toBeNull();
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it('should strip null bytes from object string values', () => {
    const result = pipe.transform({
      name: 'John\0',
      email: 'test\0@example.com',
    });
    expect(result.name).toBe('John');
    expect(result.email).toBe('test@example.com');
  });

  it('should preserve non-string values in objects', () => {
    const result = pipe.transform({
      name: 'test\0',
      age: 25,
      active: true,
    });
    expect(result.name).toBe('test');
    expect(result.age).toBe(25);
    expect(result.active).toBe(true);
  });

  it('should strip null bytes from array elements', () => {
    const result = pipe.transform(['hello\0', 'world\0']);
    expect(result).toEqual(['hello', 'world']);
  });

  it('should handle nested objects', () => {
    const result = pipe.transform({
      user: { name: 'Alice\0', role: 'admin\0' },
    });
    expect(result.user.name).toBe('Alice');
    expect(result.user.role).toBe('admin');
  });

  it('should handle mixed arrays', () => {
    const result = pipe.transform(['text\0', 42, { key: 'val\0' }]);
    expect(result).toEqual(['text', 42, { key: 'val' }]);
  });

  it('should handle empty objects', () => {
    expect(pipe.transform({})).toEqual({});
  });

  it('should handle empty arrays', () => {
    expect(pipe.transform([])).toEqual([]);
  });

  it('should handle empty string', () => {
    expect(pipe.transform('')).toBe('');
  });
});
