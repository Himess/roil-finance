import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold text-negative mb-4">Something went wrong</h1>
            <p className="text-ink-secondary mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.href = '/'; }}
              className="btn-primary"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
