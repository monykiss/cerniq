import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import {
  ALM_CATEGORIES,
  ALM_MODULES,
  MODULES_BY_CATEGORY,
} from '@/lib/alm/registry';

const pathnameRef = { value: '/alm' };

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameRef.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...rest
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({ logout: vi.fn() }),
}));

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqLockup: () => <div>cerniq-lockup</div>,
}));

import Sidebar from './Sidebar';

function renderSidebar(pathname: string) {
  pathnameRef.value = pathname;
  return render(<Sidebar open={true} onClose={vi.fn()} />);
}

describe('Sidebar — ALM tree auto-discovery from registry', () => {
  it('renders every populated category label when the tree is expanded', () => {
    renderSidebar('/alm');
    const tree = document.getElementById('alm-module-tree')!;
    expect(tree).toBeInTheDocument();

    const populatedCategories = ALM_CATEGORIES.filter(
      (cat) => MODULES_BY_CATEGORY[cat.id].length > 0,
    );
    for (const cat of populatedCategories) {
      expect(within(tree).getByText(cat.label.en)).toBeInTheDocument();
    }
  });

  it('renders one link per registered module with its registry name + href', () => {
    renderSidebar('/alm');
    const tree = document.getElementById('alm-module-tree')!;

    for (const mod of ALM_MODULES) {
      const link = within(tree)
        .getAllByRole('link')
        .find((el) => el.getAttribute('href') === mod.href);
      expect(link, `expected a tree link for ${mod.slug} → ${mod.href}`).toBeDefined();
      expect(link!.textContent).toContain(mod.name.en);
    }
  });

  it('the link count inside the tree equals ALM_MODULES.length (no hidden hardcoding)', () => {
    renderSidebar('/alm');
    const tree = document.getElementById('alm-module-tree')!;
    const treeLinks = within(tree).getAllByRole('link');
    expect(treeLinks.length).toBe(ALM_MODULES.length);
  });

  it('shows a status badge for non-ga modules and omits it for ga modules', () => {
    renderSidebar('/alm');
    const tree = document.getElementById('alm-module-tree')!;

    const sampleNonGa = ALM_MODULES.find((m) => m.status !== 'ga');
    const sampleGa = ALM_MODULES.find((m) => m.status === 'ga');
    if (sampleNonGa) {
      const link = within(tree)
        .getAllByRole('link')
        .find((el) => el.getAttribute('href') === sampleNonGa.href)!;
      expect(link.textContent?.toLowerCase()).toContain(sampleNonGa.status);
    }
    if (sampleGa) {
      const link = within(tree)
        .getAllByRole('link')
        .find((el) => el.getAttribute('href') === sampleGa.href)!;
      expect(link.textContent?.toLowerCase()).not.toMatch(/\bga\b/);
    }
  });

  it('keeps the tree collapsed off /alm/* until the toggle is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar('/dashboard');
    expect(document.getElementById('alm-module-tree')).toBeNull();

    const toggle = screen.getByRole('button', {
      name: /sidebar\.almIntelligence/i,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('alm-module-tree')).toBeInTheDocument();
  });

  // ─── T5 named-contract locks ──────────────────────────────────────────────
  //
  // The generic count test above catches removal of *any* module, but the
  // failure message ("expected 88 to be 87") is ambiguous. The two named
  // locks below pin the specific module that §4.7 T5 of SESSION_HANDOFF.md
  // called out — agent-alerts, the live Risk Monitor / ALM Decision feed.
  // Split into registry-level + render-level so a failure points at the
  // right layer: "registry entry removed" vs "rendering broke".
  //
  // The display name is intentionally NOT asserted — renaming "Agent Alerts"
  // to "Live Alerts" is a copy decision, not a contract break. The slug,
  // href, and category are the contract.

  it('ALM_MODULES has an agent-alerts entry with the expected slug + href + category (T5 registry lock)', () => {
    const mod = ALM_MODULES.find((m) => m.slug === 'agent-alerts');
    expect(mod, 'agent-alerts removed from registry — restore the entry in lib/alm/registry.ts').toBeDefined();
    expect(mod!.href).toBe('/alm/agents/alerts');
    expect(mod!.category).toBe('core');
  });

  it('renders the agent-alerts module link in the ALM tree (T5 render lock)', () => {
    renderSidebar('/alm');
    const tree = document.getElementById('alm-module-tree')!;
    const link = within(tree)
      .getAllByRole('link')
      .find((el) => el.getAttribute('href') === '/alm/agents/alerts');
    expect(
      link,
      'agent-alerts module missing from sidebar tree — registry entry exists but the nav did not surface it. Check MODULES_BY_CATEGORY derivation in lib/alm/registry.ts and the .map() in Sidebar.tsx.',
    ).toBeDefined();
  });
});
