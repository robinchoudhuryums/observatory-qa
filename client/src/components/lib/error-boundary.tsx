import React from "react";
import { reportError } from "@/lib/error-reporting";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Optional label surfaced in Sentry to identify which boundary caught the error. */
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Route through centralized error reporting (Sentry when configured).
    // Avoids logging to browser console in production where API responses or
    // form values captured in component stacks could contain PHI.
    reportError(error, {
      component: this.props.name ?? "ErrorBoundary",
      extra: {
        // componentStack is safe: it contains component names, not user data.
        componentStack: errorInfo?.componentStack?.slice(0, 2000) ?? "",
      },
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[200px]" role="alert" aria-live="assertive">
          <div className="p-4 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 rounded-lg text-red-700 dark:text-red-400 max-w-md text-center">
            <p className="font-bold mb-1">Something went wrong</p>
            <p className="text-sm mb-3">An unexpected error occurred. Please try again or return to the dashboard.</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 text-sm font-medium bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-900/70 rounded-md transition-colors"
                autoFocus
              >
                Try Again
              </button>
              <button
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
