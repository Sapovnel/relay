import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches uncaught render-time and lifecycle errors anywhere below in the
 * tree and renders a recovery UI instead of letting React unmount the entire
 * app on a single broken component.
 *
 * Errors get logged to the console (so they show up in browser devtools and
 * any session-replay tooling that hooks console). The user gets a "Reload"
 * button — there's no graceful in-place recovery for a thrown render, but at
 * least they're not staring at a white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught', error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-8 flex items-start justify-center">
        <div className="max-w-2xl w-full mt-20">
          <div className="text-xs uppercase tracking-wider text-red-400 font-semibold mb-2">
            Something broke
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-4">
            The app hit an unexpected error.
          </h1>
          <p className="text-sm text-[color:var(--text-secondary)] mb-6">
            Your work is safe — anything you typed has been synced to the room and is
            persisted. Reload to continue.
          </p>
          <div className="flex gap-2 mb-6">
            <button onClick={this.handleReload} className="btn-primary">
              Reload
            </button>
            <button onClick={this.handleHome} className="btn-secondary">
              Back home
            </button>
          </div>
          <details className="card p-4">
            <summary className="text-xs text-[color:var(--text-tertiary)] cursor-pointer">
              Error details
            </summary>
            <pre className="mt-3 text-xs font-mono text-red-300 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            {this.state.error.stack && (
              <pre className="mt-2 text-[10px] font-mono text-[color:var(--text-tertiary)] whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
            )}
            {this.state.componentStack && (
              <pre className="mt-2 text-[10px] font-mono text-[color:var(--text-tertiary)] whitespace-pre-wrap">
                {this.state.componentStack}
              </pre>
            )}
          </details>
        </div>
      </div>
    );
  }
}
