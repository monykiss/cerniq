import { SanitizePipe } from './sanitize.pipe';

describe('SanitizePipe', () => {
  const pipe = new SanitizePipe();

  it('strips HTML angle brackets', () => {
    expect(pipe.transform('<script>alert("xss")</script>')).toBe(
      'scriptalert("xss")/script',
    );
  });

  it('strips javascript: protocol', () => {
    expect(pipe.transform('javascript:alert(1)')).toBe('alert(1)');
  });

  it('strips event handlers (onclick)', () => {
    expect(pipe.transform('onclick=alert(1)')).toBe('alert(1)');
  });

  it('strips event handlers (onerror)', () => {
    expect(pipe.transform('onerror=hack()')).toBe('hack()');
  });

  it('is case-insensitive for javascript:', () => {
    expect(pipe.transform('JAVASCRIPT:alert(1)')).toBe('alert(1)');
  });

  it('is case-insensitive for event handlers', () => {
    expect(pipe.transform('ONCLICK=alert(1)')).toBe('alert(1)');
  });

  it('trims whitespace', () => {
    expect(pipe.transform('  hello  ')).toBe('hello');
  });

  it('preserves safe content', () => {
    expect(pipe.transform('Hello, World!')).toBe('Hello, World!');
  });

  it('passes through numbers unchanged', () => {
    expect(pipe.transform(42)).toBe(42);
  });

  it('passes through null unchanged', () => {
    expect(pipe.transform(null)).toBeNull();
  });

  it('passes through undefined unchanged', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it('sanitizes all string fields in an object', () => {
    const result = pipe.transform({
      name: '<b>Bold</b>',
      bio: 'Safe text',
    });
    expect(result).toEqual({
      name: 'bBold/b',
      bio: 'Safe text',
    });
  });

  it('sanitizes strings in arrays', () => {
    const result = pipe.transform(['<script>bad</script>', 'good']);
    expect(result).toEqual(['scriptbad/script', 'good']);
  });

  it('handles nested objects', () => {
    const result = pipe.transform({
      user: { name: '<img onerror=alert(1)>' },
    });
    expect(result.user.name).not.toContain('<');
    expect(result.user.name).not.toContain('>');
    expect(result.user.name).not.toContain('onerror');
  });

  it('strips multiple XSS vectors in one string', () => {
    const input = '<script>javascript:onclick=alert(1)</script>';
    const result = pipe.transform(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('javascript:');
  });
});
