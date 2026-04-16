import { useCallback, useEffect, useRef, useState } from "react";

export type WsStatus = "connecting" | "open" | "closed" | "error";

export interface WsMessage {
	type: string;
	payload: unknown;
	timestamp: number;
}

export function useWebSocket(url = "ws://localhost:3003") {
	const [status, setStatus] = useState<WsStatus>("closed");
	const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const connect = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) return;
		setStatus("connecting");
		try {
			const ws = new WebSocket(url);
			wsRef.current = ws;
			ws.onopen = () => setStatus("open");
			ws.onclose = () => {
				setStatus("closed");
				reconnectTimer.current = setTimeout(connect, 3000);
			};
			ws.onerror = () => setStatus("error");
			ws.onmessage = (ev) => {
				try {
					const data = JSON.parse(ev.data) as WsMessage;
					setLastMessage(data);
				} catch {
					// ignore non-JSON messages
				}
			};
		} catch {
			setStatus("error");
		}
	}, [url]);

	useEffect(() => {
		connect();
		return () => {
			clearTimeout(reconnectTimer.current);
			wsRef.current?.close();
		};
	}, [connect]);

	const sendMessage = useCallback((msg: WsMessage) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(msg));
		}
	}, []);

	return { lastMessage, sendMessage, status };
}
