/**
 * ErrorBoundary — Production error boundary for chat components.
 * Catches React render errors and shows a recoverable fallback.
 * Required for COTS defense tools (MIL-STD-1472H error handling).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

export class ChatErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		this.props.onError?.(error, errorInfo);
		console.error("[ChatErrorBoundary]", error, errorInfo);
	}

	render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;
			return (
				<div
					data-qid="chat:error-boundary"
					title="A rendering error occurred. Click Retry to recover."
					style={{
						padding: 16,
						margin: "8px 0",
						background: "rgba(255,68,68,0.08)",
						border: "1px solid rgba(255,68,68,0.2)",
						borderRadius: 8,
						color: "#fca5a5",
						fontSize: "var(--font-size-body, 14px)",
						fontFamily: "var(--font-ui, sans-serif)",
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: 8 }}>Component Error</div>
					<div style={{ fontSize: "var(--font-size-sm, 12px)", color: "#94a3b8", marginBottom: 12 }}>
						{this.state.error?.message || "An unexpected error occurred"}
					</div>
					<button
						data-qid="chat:error-retry"
						data-qs-action="CHAT_ERROR_RETRY"
						title="Retry rendering this component"
						onClick={() => this.setState({ hasError: false, error: null })}
						style={{
							background: "rgba(255,68,68,0.1)",
							border: "1px solid rgba(255,68,68,0.3)",
							color: "#fca5a5",
							fontSize: "var(--font-size-sm, 12px)",
							padding: "8px 16px",
							borderRadius: 6,
							cursor: "pointer",
							minHeight: "var(--touch-min, 44px)",
						}}
					>
						Retry
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
