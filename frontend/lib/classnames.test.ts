import { describe, it, expect } from 'vitest';
import { cx } from './classnames';

describe('cx', () => {
  it('joins string arguments', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out falsy values', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('handles object notation', () => {
    expect(cx({ active: true, hidden: false, bold: true })).toBe('active bold');
  });

  it('mixes strings and objects', () => {
    expect(cx('base', { active: true, disabled: false })).toBe('base active');
  });
});
