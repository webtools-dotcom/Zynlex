import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[xevo] ErrorBoundary caught:", error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center h-full gap-4 px-8"
          style={{ background: "var(--color-base)" }}
        >
          <AlertTriangle
            size={40}
            className="text-[var(--color-warning, #f59e0b)]"
          />
          <div className="text-center">
            <p
              className="text-sm font-medium mb-1"
              style={{ color: "var(--color-text-primary)" }}
            >
              Something went wrong
            </p>
            <p
              className="text-xs max-w-md"
              style={{ color: "var(--color-text-muted)" }}
            >
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors"
            style={{
              background: "var(--color-accent)",
              color: "#fff",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
