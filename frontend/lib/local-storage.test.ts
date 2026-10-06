import { describe, it, expect, beforeEach } from 'vitest';
import { getStorageItem, setStorageItem, removeStorageItem } from './local-storage';

describe('local-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getStorageItem returns fallback when key missing', () => {
    expect(getStorageItem('missing', 42)).toBe(42);
  });

  it('setStorageItem stores and getStorageItem retrieves JSON', () => {
    setStorageItem('user', { name: 'Alice' });
    expect(getStorageItem('user', null)).toEqual({ name: 'Alice' });
  });

  it('removeStorageItem clears the key', () => {
    setStorageItem('key', 'value');
    removeStorageItem('key');
    expect(getStorageItem('key', 'gone')).toBe('gone');
  });
});
