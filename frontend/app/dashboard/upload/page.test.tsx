import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  AnchorHTMLAttributes,
  ReactNode,
} from 'react';
import LegacyDashboardUploadRedirect from './page';

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
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

describe('LegacyDashboardUploadRedirect', () => {
  it('redirects the legacy upload route into the portal workspace', async () => {
    render(<LegacyDashboardUploadRedirect />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/portal/submit?createCycle=1');
    });

    expect(
      screen.getByRole('link', { name: /open reporting workspace/i }),
    ).toHaveAttribute('href', '/portal/submit?createCycle=1');
  });
});
