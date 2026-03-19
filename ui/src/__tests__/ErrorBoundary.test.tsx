import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function ThrowingComponent(): ReactNode {
  throw new Error('Test error');
}

function GoodComponent(): ReactNode {
  return <div>Working fine</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Working fine')).toBeInTheDocument();
  });

  it('renders error UI when child throws', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByText('Return to Dashboard')).toBeInTheDocument();

    spy.mockRestore();
  });
});
