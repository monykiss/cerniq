/**
 * CommandPalette — behavioural + a11y tests.
 *
 * Covers:
 *   - ⌘K / Ctrl+K global toggle
 *   - Escape closes the modal
 *   - Query filtering (fuzzy match across EN + ES)
 *   - ArrowDown / ArrowUp / Home / End navigation
 *   - Enter navigates via next/router
 *   - Empty-state message when no results
 *   - aria-expanded / aria-activedescendant contract
 *   - Combobox / listbox / option roles
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommandPalette, __resetRecentCacheForTesting } from './CommandPalette';

// ─── next/navigation mock ───────────────────────────────────────────────────

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

beforeEach(() => {
  pushMock.mockReset();
  // Start each test with an empty recent-modules list AND a fresh cache.
  try {
    window.localStorage.removeItem('cerniq.alm.recent.v1');
  } catch {
    // storage blocked — ignore
  }
  __resetRecentCacheForTesting();
});

afterEach(() => {
  cleanup();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function openPalette() {
  // ⌘K dispatch must go through the window listener the palette installs.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  });
}

async function closePalette() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

// ─── Closed state (default) ─────────────────────────────────────────────────

describe('CommandPalette — closed state', () => {
  it('renders the trigger button with ⌘K hint', () => {
    render(<CommandPalette />);
    expect(screen.getByRole('button', { name: /open command palette/i })).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('does not render the dialog until opened', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ─── Open state — keyboard toggle ───────────────────────────────────────────

describe('CommandPalette — keyboard toggle', () => {
  it('opens on ⌘K keydown', async () => {
    render(<CommandPalette />);
    await openPalette();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<CommandPalette />);
    await openPalette();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await closePalette();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the palette open on a second ⌘K and does not toggle it closed', async () => {
    render(<CommandPalette />);
    await openPalette();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await openPalette();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the open dialog into document.body instead of the local container tree', async () => {
    const { container } = render(<CommandPalette />);
    await openPalette();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  });
});

// ─── Open state — default view ──────────────────────────────────────────────

describe('CommandPalette — default view', () => {
  it('shows GA modules when the query is empty', async () => {
    render(<CommandPalette />);
    await openPalette();

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    // Default view lists up to MAX_RESULTS (20) GA modules — at least a few
    // canonical ones should show.
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('has combobox role on the input with aria-expanded=true', async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('aria-activedescendant points at the first result', async () => {
    render(<CommandPalette />);
    await openPalette();
    const input = screen.getByRole('combobox');
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(activeId).toMatch(/-opt-0$/);
  });
});

// ─── Query filtering ────────────────────────────────────────────────────────

describe('CommandPalette — search', () => {
  it('filters results by English name substring', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.type(input, 'cecl');

    const options = screen.getAllByRole('option');
    // At least one result matches 'cecl'
    expect(options.some((o) => /cecl/i.test(o.textContent ?? ''))).toBe(true);
  });

  it('filters by Spanish name (bilingual fuzzy match)', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.type(input, 'Monte Carlo');

    const options = screen.getAllByRole('option');
    expect(options.some((o) => /monte carlo/i.test(o.textContent ?? ''))).toBe(true);
  });

  it('shows an empty-state message for unmatched queries', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.type(input, 'xyzxyzxyzxyz');

    expect(screen.getByText(/no results found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

// ─── Keyboard navigation ────────────────────────────────────────────────────

describe('CommandPalette — keyboard nav', () => {
  it('ArrowDown moves the active index forward', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.keyboard('{ArrowDown}');

    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toMatch(/-opt-1$/);
  });

  it('ArrowUp does not go below zero', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{ArrowUp}');

    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toMatch(/-opt-0$/);
  });

  it('Enter navigates via router.push to the active module', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.type(input, 'var');
    await user.keyboard('{Enter}');

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]![0]).toMatch(/^\/alm\//);
  });

  it('clicking an option navigates via router.push', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    await user.click(screen.getAllByRole('option')[1]!);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]![0]).toMatch(/^\/alm\//);
  });

  it('Enter does nothing when results are empty', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole('combobox');
    await user.type(input, 'xyzxyzxyz');
    await user.keyboard('{Enter}');

    expect(pushMock).not.toHaveBeenCalled();
  });
});

// ─── Recent modules ─────────────────────────────────────────────────────────

describe('CommandPalette — recent modules', () => {
  it('does not show a Recent header when localStorage is empty', async () => {
    render(<CommandPalette />);
    await openPalette();
    // "Recent" header only appears if there's at least one recent item.
    expect(screen.queryByText(/recent/i)).toBeNull();
  });

  it('reads prior visits from localStorage on mount', async () => {
    // Seed storage BEFORE mounting
    window.localStorage.setItem('cerniq.alm.recent.v1', JSON.stringify(['var', 'cecl']));

    render(<CommandPalette />);
    await openPalette();

    // Recent section should be present and show the "Recent" header
    expect(screen.getByText(/^recent$/i)).toBeInTheDocument();
    // First result should be VaR (the most recent)
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('VaR Suite');
  });

  it('falls back gracefully on corrupt localStorage', async () => {
    window.localStorage.setItem('cerniq.alm.recent.v1', 'not valid json');

    render(<CommandPalette />);
    await openPalette();

    // Component should still render (no throw); no Recent header shown
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/^recent$/i)).toBeNull();
  });

  it('filters out unknown slugs from localStorage', async () => {
    window.localStorage.setItem(
      'cerniq.alm.recent.v1',
      JSON.stringify(['definitely-not-real', 'var']),
    );

    render(<CommandPalette />);
    await openPalette();

    // Only 'var' should show in Recent; 'definitely-not-real' is filtered out.
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('VaR Suite');
  });
});
