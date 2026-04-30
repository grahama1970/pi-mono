/**
 * usePiChat — React hook that consumes the pi-chat-adapter SSE stream.
 *
 * Replaces the 211-line handleSend in ChatTab.tsx with:
 *   const { messages, send, isStreaming } = usePiChat({ apiBase: 'http://localhost:3001' })
 *   <ChatWell messages={messages} onSend={send} />
 *
 * The hook:
 * 1. POSTs to /api/agent/ask with the query
 * 2. Consumes SSE events (step, text, message, done, error)
 * 3. Builds ChatMessage[] with live streaming updates
 * 4. Returns structured messages for ChatWell to render
 */
import { useCallback, useRef, useState } from "react";

// Types mirrored from message-assembler (avoids server-side import in browser)
export interface EntityRef {
	id: string;
	label: string;
	type?: string;
	exists: boolean;
	displayOnly?: boolean;
	source?: "regex" | "structured" | string;
}
export interface EvidenceGate {
	gate: string;
	passed: boolean;
	detail: string;
	duration?: number;
}
export interface EvidenceCaseData {
	verdict: string;
	grade: string;
	gates_passed: number;
	gates_total: number;
	gate_summary: string;
	gate_trace?: EvidenceGate[];
	control_ids: string[];
	tier: string;
	drift?: { old_verdict: string; new_verdict: string; timestamp: string };
	recall_count?: number;
	source_traceability?: Record<string, number>;
}
export interface ReasoningStep {
	id: string;
	type: string;
	skill?: string;
	status: "running" | "done" | "failed" | "pending";
	summary: string;
	detail?: string;
	duration?: number;
	startedAt?: number;
}

export type EvidenceRunEventStatus = "pending" | "running" | "done" | "failed";

export type EvidenceRunEvent =
	| {
			type: "evidence_run_started";
			runId: string;
			timestamp: number;
			skill?: string;
			requestId?: string;
	  }
	| {
			type: "evidence_gate";
			runId: string;
			timestamp: number;
			gate: string;
			status: EvidenceRunEventStatus;
			passed?: boolean;
			detail?: string;
			duration?: number;
	  }
	| {
			type: "evidence_run_completed";
			runId: string;
			timestamp: number;
			verdict?: string;
			grade?: string;
			gatesPassed?: number;
			gatesTotal?: number;
			tier?: string;
	  }
	| {
			type: "evidence_run_failed";
			runId: string;
			timestamp: number;
			message?: string;
	  }
	| {
			type: "evidence_run_text";
			runId: string;
			timestamp: number;
			text: string;
	  };

export interface EvidenceRunTrace {
	runId: string;
	requestId?: string;
	skill?: string;
	status: EvidenceRunEventStatus;
	startedAt?: number;
	completedAt?: number;
	events: EvidenceRunEvent[];
}

export type CascadeLayer = "recall" | "intent" | "llm" | "aql";

export interface ChatMessage {
	id: string;
	role: "user" | "system" | "assistant" | "agent";
	content: string;
	timestamp: number;
	type?: "natural" | "aql";
	skillUsed?: string;
	entities?: EntityRef[];
	cascadeLayer?: CascadeLayer;
	verdict?: { state: string; gates: EvidenceGate[]; tier?: string };
	evidenceCase?: EvidenceCaseData;
	evidenceRun?: EvidenceRunTrace;
	reasoningSteps?: ReasoningStep[];
	recallItems?: unknown[];
	resultCount?: number;
	clarifyOptions?: Array<{ question: string }>;
	feedback?: "up" | "down" | null;
}

export interface UsePiChatOptions {
	/** Base URL for the Express server (default: http://localhost:3001) */
	apiBase?: string;
	/** Persona to use for queries (optional) */
	persona?: string;
	/** Called when viz mode should change (matrix, graph, dashboard) */
	onVizCommand?: (command: string, params?: Record<string, unknown>) => void;
}

export interface UsePiChatReturn {
	messages: ChatMessage[];
	send: (query: string, type?: "natural" | "aql") => void;
	isStreaming: boolean;
	streamingText: string;
	streamingSteps: ReasoningStep[];
	clearMessages: () => void;
}

let msgCounter = 0;
function nextId(): string {
	return `chat-${Date.now()}-${++msgCounter}`;
}

export function usePiChat(opts: UsePiChatOptions = {}): UsePiChatReturn {
	const { apiBase = "http://localhost:3001", persona, onVizCommand } = opts;
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [streamingText, setStreamingText] = useState("");
	const [streamingSteps, setStreamingSteps] = useState<ReasoningStep[]>([]);
	const abortRef = useRef<AbortController | null>(null);

	const send = useCallback(
		(query: string, type: "natural" | "aql" = "natural") => {
			// Add user message
			const userMsg: ChatMessage = {
				id: nextId(),
				role: "user",
				content: query,
				timestamp: Date.now(),
				type,
			};
			setMessages((prev) => [...prev, userMsg]);
			setIsStreaming(true);
			setStreamingText("");
			setStreamingSteps([]);

			// Abort previous request if still running
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;

			fetch(`${apiBase}/api/agent/ask`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query, persona }),
				signal: controller.signal,
			})
				.then(async (response) => {
					const reader = response.body?.getReader();
					if (!reader) throw new Error("No response body");

					const decoder = new TextDecoder();
					let buffer = "";
					let textAcc = "";

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";

						let eventType = "";
						for (const line of lines) {
							if (line.startsWith("event: ")) {
								eventType = line.slice(7).trim();
							} else if (line.startsWith("data: ") && eventType) {
								try {
									const data = JSON.parse(line.slice(6));
									switch (eventType) {
										case "step":
											if (data.steps) setStreamingSteps(data.steps);
											break;
										case "text":
											textAcc += data.text ?? "";
											setStreamingText(textAcc);
											break;
										case "message":
											// Final assembled ChatMessage from the adapter
											setMessages((prev) => [...prev, data as ChatMessage]);
											break;
										case "done":
											setIsStreaming(false);
											setStreamingText("");
											setStreamingSteps([]);
											break;
										case "error":
											setMessages((prev) => [
												...prev,
												{
													id: nextId(),
													role: "system",
													content: `Error: ${data.message}`,
													timestamp: Date.now(),
													type: "natural",
												},
											]);
											setIsStreaming(false);
											break;
									}
								} catch {
									/* malformed SSE data */
								}
								eventType = "";
							}
						}
					}
				})
				.catch((err) => {
					if (err.name === "AbortError") return;
					setMessages((prev) => [
						...prev,
						{
							id: nextId(),
							role: "system",
							content: `Connection error: ${err.message}`,
							timestamp: Date.now(),
							type: "natural",
						},
					]);
					setIsStreaming(false);
				});
		},
		[apiBase, persona, onVizCommand],
	);

	const clearMessages = useCallback(() => {
		setMessages([]);
		setStreamingText("");
		setStreamingSteps([]);
	}, []);

	return { messages, send, isStreaming, streamingText, streamingSteps, clearMessages };
}
