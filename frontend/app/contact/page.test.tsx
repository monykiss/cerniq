import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from 'react';
import ContactPage from './page';

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { track: vi.fn() },
  EVENTS: { LEAD_FORM_SUBMITTED: 'Lead Form Submitted' },
}));

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqMark: () => <div data-testid="cerniq-mark" />,
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  Send: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  CheckCircle2: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  Calendar: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  Mail: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
  Building2: (props: SVGProps<SVGSVGElement>) => <svg {...props} />,
}));

describe('ContactPage', () => {
  it('renders the contact form with all required fields', () => {
    render(<ContactPage />);

    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/institution name/i)).toBeInTheDocument();
    // Asset Size label is not wired via htmlFor, so query by text
    expect(screen.getByText(/asset size/i)).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<ContactPage />);

    expect(screen.getByRole('button', { name: /contact sales/i })).toBeInTheDocument();
  });

  it('has a hidden honeypot field for spam prevention', () => {
    render(<ContactPage />);

    const honeypotContainer = document.querySelector('[aria-hidden="true"]');
    expect(honeypotContainer).toBeInTheDocument();

    const honeypotInput = honeypotContainer!.querySelector('input[name="website"]');
    expect(honeypotInput).toBeInTheDocument();
    expect(honeypotInput).toHaveAttribute('tabindex', '-1');
  });

  it('renders the page heading', () => {
    render(<ContactPage />);

    expect(screen.getByText(/Talk to Sales About Partner or Assisted Rollout/i)).toBeInTheDocument();
  });

  it('renders the direct contact info', () => {
    render(<ContactPage />);

    expect(screen.getByText('hello@cerniq.io')).toBeInTheDocument();
  });
});
