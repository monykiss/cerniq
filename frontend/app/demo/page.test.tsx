import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from 'react';
import DemoPage from './page';

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqMark: () => <div data-testid="cerniq-mark" />,
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ArrowRight: Icon,
    CheckCircle2: Icon,
    AlertTriangle: Icon,
    XCircle: Icon,
    FileText: Icon,
    Shield: Icon,
    MessageSquare: Icon,
    Send: Icon,
    ChevronRight: Icon,
    Sparkles: Icon,
    Receipt: Icon,
    Eye: Icon,
    Building2: Icon,
  };
});

describe('DemoPage', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  it('keeps the demo as proof and routes users toward the pilot path', () => {
    render(<DemoPage />);

    expect(screen.getAllByRole('link', { name: /Start Pilot/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/free analysis/i)).not.toBeInTheDocument();
  });
});
