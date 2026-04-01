/**
 * useActivityFeed — WebSocket-backed activity feed hook for shared-chat.
 *
 * Features:
 * - WebSocket connection with Bearer-token auth (sent as first message)
 * - Heartbeat ping every 30 s to keep the connection alive
 * - Exponential-backoff auto-reconnect on unexpected close / error
 * - sendPresence() to broadcast the local user's presence entry
 * - Cleanup (close + clear timers) on unmount
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ActivityEvent, PresenceEntry } from "./types";

// ── Public API ───────────────────────────────────────────────────────────

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface UseActivityFeedReturn {
	events: ActivityEvent[];
	connectionState: ConnectionState;
	sendPresence: (entry: PresenceEntry) => void;
}

// ── Constants ────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_EVENTS = 200; // cap in-memory event list

// ── Hook ─────────────────────────────────────────────────────────────────

export function useActivityFeed(wsUrl: string, token: string): UseActivityFeedReturn {
	const [events, setEvents] = useState<ActivityEvent[]>([]);
	const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

	// Refs so callbacks never capture stale values
	const wsRef = useRef<WebSocket | null>(null);
	const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const attemptRef = useRef(0);
	const unmountedRef = useRef(false);

	// ── Helpers ──────────────────────────────────────────────────────────

	const clearHeartbeat = () => {
		if (heartbeatRef.current !== null) {
			clearInterval(heartbeatRef.current);
			heartbeatRef.current = null;
		}
	};

	const clearReconnect = () => {
		if (reconnectRef.current !== null) {
			clearTimeout(reconnectRef.current);
			reconnectRef.current = null;
		}
	};

	const closeSocket = () => {
		clearHeartbeat();
		if (wsRef.current) {
			// Remove listeners before closing to prevent reconnect loop on intentional close
			wsRef.current.onopen = null;
			wsRef.current.onmessage = null;
			wsRef.current.onerror = null;
			wsRef.current.onclose = null;
			wsRef.current.close();
			wsRef.current = null;
		}
	};

	// ── Connection ───────────────────────────────────────────────────────

	const connect = useCallback(() => {
		if (unmountedRef.current) return;

		setConnectionState("connecting");

		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			if (unmountedRef.current) {
				ws.close();
				return;
			}
			// Authenticate immediately after opening
			ws.send(JSON.stringify({ type: "auth", token }));

			attemptRef.current = 0;
			setConnectionState("connected");

			// Start heartbeat
			clearHeartbeat();
			heartbeatRef.current = setInterval(() => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
				}
			}, HEARTBEAT_INTERVAL_MS);
		};

		ws.onmessage = (evt: MessageEvent) => {
			if (unmountedRef.current) return;
			try {
				const data = JSON.parse(evt.data as string) as ActivityEvent;
				// Ignore pong / non-typed messages
				if (!data.type || !data.timestamp) return;
				setEvents((prev) => {
					const next = [data, ...prev];
					return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
				});
			} catch {
				// Silently ignore malformed frames
			}
		};

		ws.onerror = () => {
			if (unmountedRef.current) return;
			setConnectionState("error");
		};

		ws.onclose = (evt: CloseEvent) => {
			if (unmountedRef.current) return;
			clearHeartbeat();
			setConnectionState("disconnected");

			// Intentional close (code 1000) — do not reconnect
			if (evt.code === 1000) return;

			// Exponential backoff
			const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
			attemptRef.current += 1;

			clearReconnect();
			reconnectRef.current = setTimeout(connect, delay);
		};
	}, [wsUrl, token]); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Lifecycle ────────────────────────────────────────────────────────

	useEffect(() => {
		unmountedRef.current = false;
		connect();

		return () => {
			unmountedRef.current = true;
			clearReconnect();
			closeSocket();
		};
	}, [connect]);

	// ── sendPresence ─────────────────────────────────────────────────────

	const sendPresence = useCallback((entry: PresenceEntry) => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(
				JSON.stringify({
					type: "presence_update",
					...entry,
					timestamp: Date.now(),
				}),
			);
		}
	}, []);

	return { events, connectionState, sendPresence };
}
