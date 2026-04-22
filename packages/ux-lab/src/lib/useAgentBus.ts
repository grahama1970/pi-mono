import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentBusMessage {
	type: string;
	payload: any;
}

export function useAgentBus(onMessage?: (msg: AgentBusMessage) => void) {
	const [connected, setConnected] = useState(false);
	const [agentActive, setAgentActive] = useState(false);
	const [narration, setNarration] = useState<string | null>(null);
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		// Switchboard runs on port 7890, not the frontend dev server
		const socket = new WebSocket("ws://localhost:7890/ws");
		socketRef.current = socket;

		socket.onopen = () => {
			setConnected(true);
			console.log("[AGENT_BUS] Connected");
		};

		socket.onclose = () => {
			setConnected(false);
			console.log("[AGENT_BUS] Disconnected");
		};

		socket.onmessage = (event) => {
			try {
				const msg: AgentBusMessage = JSON.parse(event.data);
				if (onMessage) onMessage(msg);

				// Handle common event types
				if (msg.type === "pipeline-start" || msg.type === "eval-start") {
					setAgentActive(true);
				}
				if (msg.type === "pipeline-done" || msg.type === "eval-done") {
					setAgentActive(false);
				}
				if (msg.type === "narration") {
					setNarration(msg.payload.text);
				}
			} catch (err) {
				console.error("[AGENT_BUS] Failed to parse message:", err);
			}
		};

		return () => {
			socket.close();
		};
	}, [onMessage]);

	const send = useCallback((type: string, payload: any) => {
		if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
			socketRef.current.send(JSON.stringify({ type, payload }));
		}
	}, []);

	return { connected, agentActive, narration, send };
}
