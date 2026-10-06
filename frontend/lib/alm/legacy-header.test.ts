import { describe, expect, it } from 'vitest';

import { looksLikeLegacyModuleHeader } from './legacy-header';

describe('looksLikeLegacyModuleHeader', () => {
  it('matches the common legacy module header structure', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg border"></div>
        <div>
          <h1 class="text-lg font-bold text-slate-950">Fed Futures</h1>
          <p class="text-xs text-slate-500">Subtitle</p>
        </div>
      </div>
    `;

    expect(looksLikeLegacyModuleHeader(root.firstElementChild)).toBe(true);
  });

  it('matches headers that use justify-between for right-side controls', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="flex items-center justify-between">
        <div><h1>Scenario Builder</h1></div>
        <div><button type="button">Run</button></div>
      </div>
    `;

    expect(looksLikeLegacyModuleHeader(root.firstElementChild)).toBe(true);
  });

  it('does not match non-header loading or warning surfaces', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="flex flex-1 items-center justify-center p-6">
        <div class="h-8 w-8 animate-spin rounded-full border-2"></div>
      </div>
    `;

    expect(looksLikeLegacyModuleHeader(root.firstElementChild)).toBe(false);
  });
});
