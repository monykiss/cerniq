import { describe, it, expect } from 'vitest';
import { pluralize, compactNumber } from './pluralize';

describe('pluralize', () => {
  it('uses singular for count 1', () => {
    expect(pluralize(1, 'item')).toBe('1 item');
  });

  it('uses auto-plural for count != 1', () => {
    expect(pluralize(5, 'item')).toBe('5 items');
  });

  it('accepts custom plural form', () => {
    expect(pluralize(3, 'child', 'children')).toBe('3 children');
  });

  it('handles zero', () => {
    expect(pluralize(0, 'result')).toBe('0 results');
  });
});

describe('compactNumber', () => {
  it('formats thousands as K', () => {
    expect(compactNumber(1500)).toBe('1.5K');
  });

  it('formats millions as M', () => {
    expect(compactNumber(2000000)).toBe('2M');
  });

  it('formats billions as B', () => {
    expect(compactNumber(3500000000)).toBe('3.5B');
  });

  it('leaves small numbers unchanged', () => {
    expect(compactNumber(42)).toBe('42');
  });
});
