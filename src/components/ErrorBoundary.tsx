import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('SENTRA ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-lg w-full rounded-2xl border border-destructive/50 bg-card p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h1 className="text-lg font-extrabold">SENTRA Encountered a Runtime Error</h1>
            </div>
            <p className="text-xs font-mono text-muted-foreground break-words bg-secondary/70 border border-border rounded-lg p-3">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: null })}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Recover Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
