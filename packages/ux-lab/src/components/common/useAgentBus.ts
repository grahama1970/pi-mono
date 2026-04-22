/**
 * useAgentBus — WebSocket hook for agent ↔ UI control.
 *
 * Connects to ws://localhost:3001/ws. The agent sends commands,
 * the UI receives them and updates state. The human sees everything
 * happening in real time and can interrupt via the UI.
 *
 * Generic — any -lab view (prompt-lab, assistant-lab, pdf-lab, etc.)
 * uses the same bus. Commands are routed by `type` field.
 *
 * Protocol:
 *   Agent → UI:  { type: "select-prompt", payload: { name: "taxonomy_v1" } }
 *   Agent → UI:  { type: "narrate", payload: { message: "Running eval..." } }
 *   UI → Agent:  { type: "user-action", payload: { action: "pause" } }
 *   UI → Agent:  { type: "ack", payload: { command: "select-prompt", ok: true } }
 */

import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:7890/ws";
const RECONNECT_MS = 3000;

export interface AgentMessage {
	type: string;
	payload: Record<string, unknown>;
}

export type AgentCommandHandler = (msg: AgentMessage) => void;

export function useAgentBus(onCommand?: AgentCommandHandler) {
	const [connected, setConnected] = useState(false);
	const [agentActive, setAgentActive] = useState(false);
	const [narration, setNarration] = useState<string | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const handlersRef = useRef(onCommand);
	handlersRef.current = onCommand;

	useEffect(() => {
		let alive = true;
		let reconnectTimer: ReturnType<typeof setTimeout>;

		function connect() {
			if (!alive) return;
			const ws = new WebSocket(WS_URL);
			wsRef.current = ws;

			ws.onopen = () => {
				setConnected(true);
				// Announce presence
				ws.send(JSON.stringify({ type: "ui-connected", payload: { view: "prompt-lab" } }));
			};

			ws.onmessage = (event) => {
				try {
					const msg: AgentMessage = JSON.parse(event.data);
					// Handle narration messages generically
					if (msg.type === "narrate") {
						setNarration(msg.payload.message as string);
						setAgentActive(true);
						// Auto-clear after 10s
						setTimeout(() => setNarration(null), 10000);
					}
					if (msg.type === "agent-start") setAgentActive(true);
					if (msg.type === "agent-stop") {
						setAgentActive(false);
						setNarration(null);
					}
					// Forward to view-specific handler
					handlersRef.current?.(msg);
				} catch {
					/* ignore malformed */
				}
			};

			ws.onclose = () => {
				setConnected(false);
				wsRef.current = null;
				if (alive) reconnectTimer = setTimeout(connect, RECONNECT_MS);
			};

			ws.onerror = () => ws.close();
		}

		connect();
		return () => {
			alive = false;
			clearTimeout(reconnectTimer);
			wsRef.current?.close();
		};
	}, []);

	const send = useCallback((msg: AgentMessage) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(msg));
		}
	}, []);

	return { connected, agentActive, narration, send, setNarration };
}
