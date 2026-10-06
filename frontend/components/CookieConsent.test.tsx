import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CookieConsent from './CookieConsent';

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the banner when no consent is stored', async () => {
    render(<CookieConsent />);
    expect(await screen.findByRole('dialog', { name: /cookie consent/i })).toBeInTheDocument();
    expect(screen.getByText(/essential cookies/i)).toBeInTheDocument();
  });

  it('does not render when consent was already accepted', () => {
    localStorage.setItem('cerniq_cookie_consent', 'accepted');
    const { container } = render(<CookieConsent />);
    expect(container.innerHTML).toBe('');
  });

  it('hides the banner and stores "accepted" when Accept is clicked', async () => {
    const user = userEvent.setup();
    render(<CookieConsent />);

    await user.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('cerniq_cookie_consent')).toBe('accepted');
  });

  it('hides the banner and stores "declined" when Decline is clicked', async () => {
    const user = userEvent.setup();
    render(<CookieConsent />);

    await user.click(await screen.findByRole('button', { name: /decline/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('cerniq_cookie_consent')).toBe('declined');
  });
});
