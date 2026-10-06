import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoErrorBoundary } from './DemoErrorBoundary';

// Mock @sentry/nextjs
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

// Mock lucide-react icons used by ErrorBoundary
vi.mock('lucide-react', () => ({
  RefreshCw: (props: Record<string, unknown>) => <svg data-testid="refresh-icon" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <svg data-testid="alert-icon" {...props} />,
}));

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Demo crash');
  }
  return <div>Demo content</div>;
}

describe('DemoErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Suppress React error boundary console.error noise
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <DemoErrorBoundary>
        <div>Demo content</div>
      </DemoErrorBoundary>,
    );

    expect(screen.getByText('Demo content')).toBeInTheDocument();
  });

  it('catches errors and shows fallback UI', () => {
    render(
      <DemoErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </DemoErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('does not show error UI when child does not throw', () => {
    render(
      <DemoErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </DemoErrorBoundary>,
    );

    expect(screen.getByText('Demo content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
