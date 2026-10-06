import { describe, it, expect, vi } from 'vitest';

const redirectMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

describe('PortalLoginPage', () => {
  it('redirects the legacy portal login route to the portal-intent login screen', async () => {
    const { default: PortalLoginPage } = await import('./page');

    await PortalLoginPage({});

    expect(redirectMock).toHaveBeenCalledWith(
      '/login?returnUrl=%2Fportal&mode=magic-link',
    );
  });

  it('preserves the billing success flag while redirecting', async () => {
    const { default: PortalLoginPage } = await import('./page');

    await PortalLoginPage({
      searchParams: Promise.resolve({ billing: 'success' }),
    });

    expect(redirectMock).toHaveBeenCalledWith(
      '/login?returnUrl=%2Fportal%3Fwelcome%3D1&mode=magic-link&billing=success',
    );
  });
});
