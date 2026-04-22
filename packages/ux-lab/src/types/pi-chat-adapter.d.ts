/**
 * Type declarations for @pi-chat-adapter/hook
 * This module provides chat integration with Pi agent backend.
 */
declare module "@pi-chat-adapter/hook" {
	import type { ChatMessage } from "../components/shared-chat/types";

	export interface UsePiChatOptions {
		apiUrl?: string;
		apiBase?: string;
		project?: string;
		system?: string;
	}

	export interface ReasoningStep {
		id: string;
		type: string;
		skill?: string;
		status: "pending" | "running" | "done" | "failed";
		summary: string;
		detail?: string;
		duration?: number;
		startedAt?: number;
	}

	export interface UsePiChatReturn {
		messages: ChatMessage[];
		setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
		send: (content: string, type?: "natural" | "aql") => void;
		loading: boolean;
		error: string | null;
		/** True when streaming response is in progress */
		isStreaming?: boolean;
		/** Live reasoning steps for CAE trace during streaming */
		streamingSteps?: ReasoningStep[];
	}

	export function usePiChat(options?: UsePiChatOptions): UsePiChatReturn;
}
