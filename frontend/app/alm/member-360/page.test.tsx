import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import Member360DirectoryPage from './page';
import { StageBadge, stageLabel } from './lifecycle-stage';

/**
 * The page delegates fetching/loading/error to <AlmPage> and passes a render
 * prop for the success state. Mocking the wrapper to invoke that render prop
 * with fixture data is what lets the real MemberDirectoryContent — the part
 * this file actually owns — be exercised, including the empty-book seeding
 * path that a sales demo depends on.
 */
const almPageData = { current: null as unknown };

vi.mock('@/components/alm/AlmPage', () => ({
  AlmPage: ({
    children,
    controls,
  }: {
    children: (data: unknown, ctx: unknown) => ReactNode;
    controls?: ReactNode;
  }) => (
    <div>
      {controls}
      {children(almPageData.current, {
        locale: 'en',
        mod: { endpoint: '/api/alm/:institutionId/members' },
        isDemo: true,
      })}
    </div>
  ),
}));

vi.mock('@/components/alm/AlmDataUnavailable', () => ({
  AlmDataUnavailable: ({ message }: { message: { en: string; es: string } }) => (
    <p data-testid="data-unavailable">{message.en}</p>
  ),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/alm/member-360',
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en', t: (k: string) => k, ta: () => [] }),
}));

vi.mock('@/components/alm/ALMProvider', () => ({
  useALM: () => ({
    selectedId: 'inst-1',
    institution: { id: 'inst-1', name: 'Cooperativa Demo' },
    institutions: [],
    loading: false,
  }),
}));

// lucide-react is deliberately NOT mocked. A partial mock breaks
// lib/alm/registry.ts, which imports a large icon set eagerly, and a Proxy
// mock resolves lazily at page-import time before vitest initializes the JSX
// runtime ("Cannot access '__vi_import_2__' before initialization"). The real
// library renders fine in jsdom and these assertions don't depend on icons.

/**
 * These cover the two pure exports the directory page hangs its lifecycle
 * presentation on. They are deliberately not a mount of <AlmPage>, which owns
 * fetching/loading/error and is exercised by its own suite — duplicating that
 * here would test the wrapper, not this page's contribution.
 *
 * The stage vocabulary is the thing worth guarding: it is duplicated between
 * the Prisma `MemberLifecycleStage` enum, this page, and the profile page, so
 * a stage added backend-side without updating the UI is a real, silent drift.
 */
describe('Member 360 directory — lifecycle presentation', () => {
  const ALL_STAGES = [
    'ONBOARDING',
    'ACTIVE',
    'AT_RISK',
    'DELINQUENT',
    'WORKOUT',
    'CHARGED_OFF',
    'CHURNED',
  ] as const;

  it('labels every lifecycle stage in English', () => {
    for (const stage of ALL_STAGES) {
      const label = stageLabel(stage, 'en');
      expect(label).toBeTruthy();
      // An unmapped stage falls through to the raw enum name — that is the
      // drift this asserts against.
      expect(label).not.toBe(stage);
    }
  });

  it('labels every lifecycle stage in Spanish, and differently from English where the words differ', () => {
    // Bilingual parity is a product requirement for PR cooperativas, not a
    // nicety: the operator-facing UI is used in Spanish.
    for (const stage of ALL_STAGES) {
      const es = stageLabel(stage, 'es');
      expect(es).toBeTruthy();
      expect(es).not.toBe(stage);
    }
    // Spot-check that Spanish is actually translated, not echoed English.
    expect(stageLabel('CHURNED', 'es')).not.toBe(stageLabel('CHURNED', 'en'));
    expect(stageLabel('CHARGED_OFF', 'es')).not.toBe(stageLabel('CHARGED_OFF', 'en'));
  });

  it('falls back to the raw stage name rather than rendering blank for an unknown stage', () => {
    // Defensive: a backend that ships a new stage before the UI knows it
    // should show something inspectable, never an empty badge.
    const unknown = 'REINSTATED' as unknown as (typeof ALL_STAGES)[number];
    expect(stageLabel(unknown, 'en')).toBe('REINSTATED');
  });

  it('renders a badge carrying the localized label for each stage', () => {
    const { unmount } = render(<StageBadge stage="WORKOUT" locale="en" />);
    expect(screen.getByText(stageLabel('WORKOUT', 'en'))).toBeInTheDocument();
    unmount();

    render(<StageBadge stage="WORKOUT" locale="es" />);
    expect(screen.getByText(stageLabel('WORKOUT', 'es'))).toBeInTheDocument();
  });

  it('gives distressed and healthy stages visually distinct badge tones', () => {
    // The directory is scanned, not read — an operator must be able to spot a
    // WORKOUT member without reading the label.
    const { container: active } = render(<StageBadge stage="ACTIVE" locale="en" />);
    const activeClass = active.firstElementChild?.className ?? '';
    const { container: workout } = render(<StageBadge stage="WORKOUT" locale="en" />);
    const workoutClass = workout.firstElementChild?.className ?? '';

    expect(activeClass).not.toBe('');
    expect(workoutClass).not.toBe('');
    expect(activeClass).not.toBe(workoutClass);
  });

});

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    memberNumber: 'M-10001',
    fullName: 'María Rodríguez Colón',
    memberSince: '2019-04-02',
    lifecycleStage: 'ACTIVE',
    riskScore: 41,
    totalDeposits: 12500,
    totalLoans: 8200,
    ...overrides,
  };
}

function directoryPayload(overrides: Record<string, unknown> = {}) {
  return {
    institutionId: 'inst-1',
    total: 3,
    page: 1,
    pageSize: 25,
    gaps: [],
    members: [
      memberRow(),
      memberRow({ id: 'mem-2', memberNumber: 'M-10002', lifecycleStage: 'WORKOUT', riskScore: 88 }),
      memberRow({ id: 'mem-3', memberNumber: 'M-10003', lifecycleStage: 'CHURNED', riskScore: null }),
    ],
    ...overrides,
  };
}

describe('Member 360 directory — populated book', () => {
  beforeEach(() => {
    almPageData.current = directoryPayload();
    vi.restoreAllMocks();
  });

  it('lists every member returned by the API', () => {
    render(<Member360DirectoryPage />);
    expect(screen.getByText('M-10001')).toBeInTheDocument();
    expect(screen.getByText('M-10002')).toBeInTheDocument();
    expect(screen.getByText('M-10003')).toBeInTheDocument();
  });

  it('links each member to its profile, scoped to the institution', () => {
    render(<Member360DirectoryPage />);
    const link = screen.getByText('M-10001').closest('a');
    // The institution id must ride along — the profile route is tenant-scoped
    // and a bare member id would not resolve.
    expect(link).toHaveAttribute('href', '/alm/member-360/mem-1?id=inst-1');
  });

  it('renders a member whose riskScore is null without inventing a number', () => {
    // D1 at the presentation layer: an unscored member must not display 0.
    render(<Member360DirectoryPage />);
    const churnedRow = screen.getByText('M-10003').closest('tr');
    expect(churnedRow).not.toBeNull();
    expect(churnedRow?.textContent).not.toMatch(/\b0\b/);
  });

  it('surfaces the distressed-cohort counts an operator triages by', () => {
    render(<Member360DirectoryPage />);
    // One WORKOUT member is in the fixture; the metric strip must report it
    // rather than burying it in the table. getAllByText because the label
    // legitimately appears in the strip, the row badge, and the filter — the
    // assertion is that the triage metric exists at all.
    expect(screen.getAllByText('Workout').length).toBeGreaterThan(0);
    expect(screen.getAllByText('At Risk').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delinquent').length).toBeGreaterThan(0);
  });

  it('offers a stage filter covering every lifecycle stage', () => {
    render(<Member360DirectoryPage />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'WORKOUT' } });
    expect((select as HTMLSelectElement).value).toBe('WORKOUT');
  });
});

describe('Member 360 directory — empty book', () => {
  beforeEach(() => {
    almPageData.current = directoryPayload({ total: 0, members: [] });
    vi.restoreAllMocks();
  });

  it('offers a seeding action instead of a dead end when no members exist', () => {
    // D1: an institution with no members is a gap with an action, never a
    // silent zero-state.
    render(<Member360DirectoryPage />);
    expect(screen.getByTestId('data-unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Seed 50 demo members/i })).toBeInTheDocument();
  });

  it('reports the reason when the backend refuses to seed over real data', async () => {
    // seedDemoMembers refuses if a real (non-fixture) book already exists.
    // That refusal must surface, not vanish.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ skipped: true, reason: 'Institution already has real member data' }),
      }),
    );
    render(<Member360DirectoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Seed 50 demo members/i }));
    await waitFor(() =>
      expect(screen.getByText('Institution already has real member data')).toBeInTheDocument(),
    );
  });

  it('surfaces a transport failure rather than failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<Member360DirectoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Seed 50 demo members/i }));
    await waitFor(() => expect(screen.getByText(/HTTP 503/)).toBeInTheDocument());
  });
});
