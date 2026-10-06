import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import AdminSessionBoundary from './AdminSessionBoundary';

const replaceMock = vi.fn();
let pathname = '/admin/pipeline';
let hasKey = false;

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/admin-session', () => ({
  hasStoredAdminKey: () => hasKey,
}));

describe('AdminSessionBoundary', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pathname = '/admin/pipeline';
    hasKey = false;
  });

  it('redirects subpages to /admin when no admin key exists', async () => {
    render(
      <AdminSessionBoundary>
        <div>Secret content</div>
      </AdminSessionBoundary>,
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/admin');
    });
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('renders navigation and content when an admin key exists', () => {
    hasKey = true;

    render(
      <AdminSessionBoundary>
        <div>Secret content</div>
      </AdminSessionBoundary>,
    );

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });
});
